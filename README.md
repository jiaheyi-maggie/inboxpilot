# InboxPilot

AI-powered Gmail inbox organizer. Syncs email via the Gmail API, categorizes with Claude Sonnet, and provides a Notion-style multi-view dashboard for navigating and managing your inbox.

---

## Quick Start

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- An [Anthropic](https://console.anthropic.com) API key
- Google OAuth credentials configured in your Supabase project (scopes: `gmail.modify`, `email`, `profile`)

### Setup

1. Clone and install dependencies.

```bash
git clone https://github.com/your-org/inboxpilot.git
cd inboxpilot
npm install
```

2. Copy the environment template and fill in your values.

```bash
cp .env.example .env.local
```

3. Run database migrations in your Supabase SQL Editor, in order:

```
supabase/migrations/00001_initial_schema.sql
supabase/migrations/00002_unread_and_preferences.sql
supabase/migrations/00003_enable_realtime.sql
supabase/migrations/00004_categorization_status.sql
supabase/migrations/00005_workflows.sql
supabase/migrations/00006_email_body.sql
supabase/migrations/00007_user_categories.sql
supabase/migrations/00008_category_corrections.sql
supabase/migrations/00009_performance_indexes.sql
supabase/migrations/00010_view_modes.sql
supabase/migrations/00011_importance.sql
supabase/migrations/00012_view_configs.sql
```

4. Start the dev server.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in with Google to authorize Gmail access, then click **Sync** to pull your inbox.

---

## Features

### Gmail Sync and AI Categorization

InboxPilot syncs Gmail via the `gmail.modify` scope and uses Claude Sonnet (`tool_use` for structured output) to assign each email a **category**, **topic**, and **importance score**.

**5-level importance scoring**: critical / high / medium / low / noise

**10 default categories**: Work, Personal, Finance, Shopping, Travel, Social, Newsletters, Notifications, Promotions, Other

Categorization runs automatically after each sync. The `auto_categorize_unread` setting controls whether unread emails are included. By default, only emails you have read are categorized — unread emails appear in the **Unread** section at the top of the dashboard and are categorized on first open.

### Dashboard — Notion-style Multi-view

The dashboard has three view modes, switchable from tabs in the main panel:

**List view** — Flat email list within each group.

**Board view** — Kanban columns. Drag and drop emails between columns to instantly reassign their category (synced via `@dnd-kit`).

**Tree view** — Hierarchical grouping. Expand any node to drill into emails. Bulk actions are available on any node.

**9 grouping dimensions** (combinable): `category`, `topic`, `sender`, `sender_domain`, `date_month`, `date_week`, `importance`, `has_attachment`, `is_read`

**Inline toolbar** on each view: Filter, Sort, Group by any dimension.

**Sidebar navigation**: Unread section, system groups (Starred / Archived / Trash), category list with inline teach inputs. Navigation only — no email rendering in the sidebar.

**Real-time updates**: Supabase Realtime pushes live INSERT/UPDATE events. New emails show a toast; updates silently refresh the tree. Events are debounced at 500ms to coalesce bulk syncs.

### AI Assistant

**Cmd+K command palette** — search emails, navigate to views, run quick actions, or escalate to the AI chat. Built with `cmdk` + shadcn/ui.

**Persistent chat sidebar** — multi-turn conversation with Claude. Each message is classified by Claude Haiku into one of four intent types before being handled:

| Intent | Behavior |
|--------|----------|
| `context` | Saves your instruction as a category description to improve future categorization |
| `command` | Executes an immediate action (archive, star, move, etc.) |
| `rule` | Generates a workflow rule from natural language |
| `search` | Searches your synced emails |

All AI-classified actions show a **preview + confirm** step before executing.

**Teach inputs** — Inline input on each category. Describe what belongs there to refine future AI categorization.

### Workflow Automation

Workflows are trigger-condition-action graphs stored as JSONB. Generate them from natural language via the chat sidebar, or build them visually with the workflow editor (powered by `@xyflow/react`).

**Triggers**: `new_email`, `email_categorized`, `email_from_domain`, `unread_timeout`

**Conditions**: Match on category, topic, importance, sender, subject, attachment, read/starred status, Gmail label

**Actions**: trash, archive, star, mark read/unread, reassign category, recategorize with a refinement prompt

Workflows support test runs against existing email, backfill against historical email, and rollback. Execution is logged per step in `workflow_runs`.

### Email Management

- Star, archive, trash, mark read/unread — all synced back to Gmail
- Bulk actions on any tree node (trash, archive, mark read, reassign category for the entire group)
- Category reassignment via drag-and-drop (Board view) or "Move to..." picker
- Quick rule creation from any email
- Email body rendered in a sandboxed iframe

### Custom Categories

Create, edit, reorder, and delete categories in Settings. Each category has a name, description (used by the AI for classification), color, and sort order. Categories with user-authored descriptions produce more accurate AI assignments.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (bypasses RLS for data operations) |
| `TOKEN_ENCRYPTION_KEY` | Yes | 32-byte hex string for AES-256-GCM OAuth token encryption |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key (Sonnet for categorization, Haiku for intent classification) |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID (for Gmail token refresh) |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `CRON_SECRET` | Yes | Secret header value to authenticate Vercel cron requests |

Google OAuth is also configured in the Supabase dashboard under **Authentication > Providers > Google**. Both the app env vars and the Supabase provider config are required.

Generate a `TOKEN_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Project Structure

```
src/
├── app/
│   ├── (app)/                    # Authenticated routes (dashboard, settings, workflows)
│   ├── (auth)/                   # Google OAuth callback handler
│   ├── api/
│   │   ├── ai/intent/            # Claude Haiku intent classification
│   │   ├── categorize/           # Standalone AI categorization endpoint
│   │   ├── categories/           # User category CRUD
│   │   ├── emails/               # List, unread, actions, tree-actions, body, system groups
│   │   ├── settings/             # Preferences, grouping config, view config CRUD
│   │   ├── sync/                 # Gmail sync + categorize pipeline
│   │   ├── workflows/            # Workflow CRUD, generate, test, backfill, rollback, runs
│   │   └── cron/                 # Vercel cron endpoint (scheduled sync)
│   ├── privacy/
│   └── terms/
├── components/
│   ├── dashboard/
│   │   ├── active-view-router.tsx   # Routes to list/board/tree based on active ViewConfig
│   │   ├── board-view.tsx           # Kanban board container
│   │   ├── board-column.tsx         # Single kanban column
│   │   ├── board-card.tsx           # Draggable email card
│   │   ├── sidebar.tsx              # Navigation sidebar
│   │   ├── tree-view.tsx            # Hierarchical tree view
│   │   ├── view-tabs.tsx            # View tab strip
│   │   ├── view-toolbar.tsx         # Filter / Sort / Group by toolbar
│   │   └── category-teach-input.tsx # Inline AI teach input per category
│   ├── command-palette.tsx          # Cmd+K palette (cmdk)
│   ├── chat-sidebar.tsx             # Persistent AI chat sidebar
│   └── ui/                          # Shared primitives (Button, etc.)
├── contexts/
│   └── view-context.tsx             # ViewProvider — active view state
├── lib/
│   ├── ai/categorize.ts             # Claude Sonnet categorization logic
│   ├── gmail/
│   │   ├── client.ts                # Gmail API client with mutex token refresh
│   │   └── sync.ts                  # Sync pipeline (list → filter → fetch → upsert)
│   ├── grouping/engine.ts           # Grouping dimension definitions
│   ├── supabase/
│   │   ├── client.ts                # Browser Supabase client
│   │   └── server.ts                # Server client (user RLS) + service client
│   ├── crypto.ts                    # AES-256-GCM token encryption
│   └── utils.ts                     # cn() class name helper
└── types/index.ts                   # All interfaces, enums, and type definitions
```

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `gmail_accounts` | OAuth tokens (AES-256-GCM encrypted), sync state, granted scopes |
| `emails` | Email metadata from Gmail (sender, subject, snippet, read/starred/attachment flags) |
| `email_categories` | AI-assigned category, topic, importance score (1–5), confidence |
| `user_categories` | User-defined categories with descriptions, colors, and sort order |
| `grouping_configs` | Saved tree hierarchy configurations (JSONB `levels` array) |
| `view_configs` | Saved view configurations (type, group_by, filters, sort, pinned) |
| `workflows` | Workflow definitions (trigger-condition-action graph as JSONB) |
| `workflow_runs` | Execution history with per-step logs |
| `sync_jobs` | Sync run history with email counts and status |
| `user_preferences` | Per-user settings (`auto_categorize_unread`) |

---

## Architecture Notes

**Two Supabase clients** — `createServerSupabaseClient` respects RLS and is used for auth checks. `createServiceClient` uses the service role key and bypasses RLS for all data operations.

**JS-side grouping** — `GET /api/emails` does not use Supabase RPC. It fetches emails with the query builder, applies category/date filters in JavaScript, and groups results in memory. This works around PostgREST's lack of native `GROUP BY`.

**OAuth token encryption** — All Gmail tokens are encrypted at rest with AES-256-GCM + scrypt key derivation. The key never leaves the server environment.

**Gmail token refresh mutex** — `src/lib/gmail/client.ts` holds a per-account `Map` of in-flight refresh promises. Concurrent requests share a single refresh call rather than triggering parallel token exchanges.

**Email body** — Body HTML/text is stored in the `emails` table and rendered in a sandboxed iframe on demand. It is not included in list/tree queries.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack, React 19) |
| Database / Auth | Supabase (PostgreSQL + Google OAuth + RLS + Realtime) |
| AI | Anthropic Claude Sonnet 4 (categorization) + Haiku (intent classification) |
| Gmail | googleapis v171 — `gmail.modify` scope |
| Drag and drop | @dnd-kit/core + @dnd-kit/sortable |
| Command palette | cmdk + shadcn/ui (Radix primitives) |
| Workflow editor | @xyflow/react |
| Styling | Tailwind CSS 4 + lucide-react |
| Deployment | Vercel |

---

## Development

```bash
npm run dev        # Dev server with Turbopack
npm run build      # Production build
npm run lint       # ESLint
npm run test       # Vitest (single run)
npm run test:watch # Vitest in watch mode
```

Build must pass before merging. Run `npm run build` locally to catch type errors before pushing.

---

## Deployment

InboxPilot is designed for Vercel. Set all environment variables in your Vercel project settings. The cron endpoint at `POST /api/cron/sync` handles scheduled inbox syncs — configure it in `vercel.json` and use `CRON_SECRET` to authenticate requests.

---

## Security

- OAuth tokens encrypted at rest with AES-256-GCM
- All tables enforce Row-Level Security — users access only their own data
- Auth middleware protects all `(app)` routes
- Gmail write operations require explicit `gmail.modify` scope, enforced per account via `granted_scope`
- Redirect URLs validated against `/^\/[a-zA-Z]/` to prevent open redirects

---

## License

MIT
