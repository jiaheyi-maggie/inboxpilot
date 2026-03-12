# InboxPilot

AI-powered Gmail inbox organizer. Syncs emails via Gmail API, categorizes with Claude Sonnet, and displays in a configurable tree view.

## Stack

- **Framework**: Next.js 16 (App Router, Turbopack, React 19)
- **Database/Auth**: Supabase (PostgreSQL + Google OAuth + RLS)
- **AI**: Anthropic Claude Sonnet via `@anthropic-ai/sdk` (tool_use for structured output)
- **Gmail**: `googleapis` — gmail.modify scope for read/write
- **Styling**: Tailwind CSS 4 + `lucide-react` icons + `class-variance-authority`
- **Deployment**: Vercel

## Commands

```bash
npm run dev          # Dev server (Turbopack)
npm run build        # Production build — run before committing
npm run lint         # ESLint
```

## Project Structure

```
src/
├── app/
│   ├── (app)/           # Authenticated routes (dashboard, settings)
│   ├── (auth)/          # OAuth callback handler
│   ├── api/
│   │   ├── emails/      # Tree data, unread, actions, category-actions
│   │   ├── sync/        # Gmail sync + categorize pipeline
│   │   ├── categorize/  # Standalone AI categorization
│   │   ├── cron/        # Vercel cron endpoint
│   │   └── settings/    # User preferences CRUD
│   ├── privacy/         # Legal pages
│   └── terms/
├── components/
│   ├── dashboard/       # EmailTree, TreeNode, EmailList, UnreadSection, SyncStatus
│   └── ui/              # Shared primitives (Button, etc.)
├── lib/
│   ├── ai/              # categorize.ts — Claude Sonnet categorization
│   ├── gmail/           # client.ts (API client), sync.ts (sync logic)
│   ├── grouping/        # engine.ts — dimension definitions
│   ├── supabase/        # client.ts (browser), server.ts (server + service role)
│   ├── crypto.ts        # AES-256-GCM encryption for OAuth tokens
│   └── utils.ts         # cn() helper
└── types/
    └── index.ts         # All interfaces and types
```

## Database Schema (Supabase)

| Table | Purpose |
|---|---|
| `gmail_accounts` | OAuth tokens (AES-256-GCM encrypted), sync state, `granted_scope` |
| `emails` | Email metadata synced from Gmail. Key columns: `is_read`, `is_starred`, `is_categorized` |
| `email_categories` | AI-assigned: `category`, `topic`, `priority`, `confidence`. FK to emails |
| `grouping_configs` | User's tree hierarchy. `levels` is JSONB array of `{dimension, label}` |
| `sync_jobs` | Sync run history with status/counts |
| `user_preferences` | `auto_categorize_unread` toggle |

### Migrations

Run in Supabase SQL Editor (not via CLI):
- `supabase/migrations/00001_initial_schema.sql` — Base tables + RLS
- `supabase/migrations/00002_unread_and_preferences.sql` — `is_categorized`, `is_starred`, `granted_scope`, `user_preferences`

## Key Architecture Patterns

### Two Supabase Clients
- **User client** (`createServerSupabaseClient`): Respects RLS, used for auth checks
- **Service client** (`createServiceClient`): Bypasses RLS with service role key, used for data operations

### OAuth Token Encryption
Tokens stored encrypted with AES-256-GCM + scrypt key derivation in `src/lib/crypto.ts`. Key: `ENCRYPTION_KEY` env var.

### Gmail Token Refresh
`src/lib/gmail/client.ts` uses per-account mutex locks to prevent concurrent token refreshes. `getGmailClient(account)` returns an authenticated `gmail_v1.Gmail` instance.

### Sync + Categorize Pipeline
1. `POST /api/sync` → `syncEmails()` (list → filter → fetch metadata → upsert)
2. After sync, checks `auto_categorize_unread` preference
3. If `false` (default): only categorize **read** uncategorized emails
4. If `true`: categorize all uncategorized emails
5. `categorizeEmails()` sends batches of ~25 to Claude Sonnet via `tool_use`

### Tree Data (No RPC, JS-Side Grouping)
`GET /api/emails` does NOT use Supabase RPC functions. It:
1. Fetches emails via query builder (with optional `email_categories` join)
2. Applies email-table filters via Supabase `.eq()`
3. Applies category/date filters in JavaScript
4. Groups by target dimension in JavaScript
5. Returns `{ type: 'groups', dimension, level, data: [{group_key, count}] }`

This is because Supabase PostgREST doesn't support native GROUP BY.

### Unread Email Flow
- Unread uncategorized emails appear in pinned `UnreadSection` at top of dashboard
- Tapping an email → `POST /api/emails/[id]/actions` with `mark_read` → triggers individual categorization → email moves to tree
- "Categorize All" button → `POST /api/categorize` with `includeUnread: true`

### Dimension Types
- **Email-table**: `sender`, `sender_domain`, `is_read`, `has_attachment`
- **Category-table** (requires join): `category`, `topic`, `priority`
- **Date** (JS formatting): `date_month`, `date_week`

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ENCRYPTION_KEY=               # For AES-256-GCM token encryption
ANTHROPIC_API_KEY=             # Claude Sonnet for categorization
CRON_SECRET=                   # Vercel cron auth
```

Google OAuth is configured in Supabase dashboard (not in app env vars). Scopes: `gmail.modify`, `email`, `profile`.

## Environment Variables (Server)

Note: `server.ts` references `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not `ANON_KEY`) and `SUPABASE_SECRET_KEY` (not `SERVICE_ROLE_KEY`). Also `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are needed for Gmail token refresh in `src/lib/gmail/client.ts`.

## Known Issues & Gotchas

- **PostgREST one-to-one returns object, not array**: `email_categories.email_id` has a UNIQUE constraint → PostgREST 11+ returns embedded `email_categories` as a single object (or null), NOT an array. Always use the `getCategory()` helper in `/api/emails/route.ts` to normalize both shapes.
- **Google refresh tokens**: Only sent on FIRST authorization. Re-auth doesn't include it. Callback route conditionally includes `refresh_token_encrypted` in upsert.
- **Supabase TypeScript parser**: Relationship select strings like `email_categories(category, topic, priority)` don't type correctly. Use `as unknown as T` double cast.
- **No `execute_query` RPC**: Earlier code referenced this but it was never created. All tree queries use JS-side grouping.
- **Supabase `.range()`**: Uses inclusive bounds — `range(0, 49)` returns 50 rows.
- **React hooks ordering**: `useCallback` must be defined before any `useEffect` that references it in the dependency array.
- **"Synced 0" is normal for returning users**: Means no NEW emails since last sync — existing emails are already in DB. The tree should still show previously synced + categorized emails.
