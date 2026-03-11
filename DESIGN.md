# InboxPilot — Design Document

## Overview

InboxPilot is a web application that connects to Gmail, AI-categorizes emails using Claude, and presents them in a dynamic file-system-style tree. Users configure how their inbox is grouped (by category, sender, date, etc.) and browse emails through a hierarchical navigator.

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────▶│  Next.js 16  │────▶│  Supabase    │
│  (React 19)  │◀────│  App Router  │◀────│  PostgreSQL  │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                   ┌────────┼────────┐
                   ▼        ▼        ▼
              ┌────────┐ ┌──────┐ ┌───────┐
              │ Gmail  │ │Claude│ │Google │
              │  API   │ │Sonnet│ │OAuth  │
              └────────┘ └──────┘ └───────┘
```

**Server components** handle data fetching and auth checks. **Client components** manage interactive state (tree expansion, action menus, optimistic updates). **API routes** sit between the client and external services (Gmail, Claude, Supabase).

### Request Flow

```
User action (e.g., mark as read)
    → Client component calls POST /api/emails/[id]/actions
        → API route verifies auth + ownership via Supabase
        → API route calls Gmail API (messages.modify)
        → API route updates Supabase DB
        → API route calls Claude for categorization (if needed)
    → Client receives response
    → Client applies optimistic update + triggers tree refresh
```

---

## Database Schema

### Tables

#### `gmail_accounts`
Stores encrypted OAuth credentials for each user's linked Gmail account.

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | FK to auth.users |
| email | text | Gmail address |
| access_token_encrypted | text | AES-256-GCM encrypted Google access token |
| refresh_token_encrypted | text | AES-256-GCM encrypted Google refresh token |
| token_expires_at | timestamptz | Token expiry time |
| history_id | text | Gmail history ID for incremental sync (future) |
| last_sync_at | timestamptz | Last successful sync timestamp |
| sync_enabled | boolean | Whether background sync is active |
| granted_scope | text | `gmail.readonly` or `gmail.modify` |
| created_at | timestamptz | Row creation time |

Unique constraint: `(user_id, email)`.

#### `emails`
Cached email metadata fetched from Gmail. No email body content is stored.

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| gmail_account_id | uuid | FK to gmail_accounts |
| gmail_message_id | text | Gmail's message ID |
| thread_id | text | Gmail's thread ID |
| subject | text | Email subject line |
| sender_email | text | Sender's email address |
| sender_name | text | Sender's display name |
| sender_domain | text | Sender's domain (extracted) |
| snippet | text | Gmail-generated preview text |
| received_at | timestamptz | Email receive timestamp |
| is_read | boolean | Read/unread status |
| is_starred | boolean | Starred status |
| is_categorized | boolean | Whether AI has categorized this email |
| has_attachment | boolean | Whether email has attachments |
| label_ids | jsonb | Gmail label IDs (INBOX, UNREAD, STARRED, etc.) |
| created_at | timestamptz | Row creation time |

Unique constraint: `(gmail_account_id, gmail_message_id)`.

#### `email_categories`
AI-assigned classification for each email. One row per email.

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| email_id | uuid | FK to emails (unique, cascade delete) |
| category | text | Primary category (Work, Finance, etc.) |
| topic | text | Specific topic (e.g., "Project Updates") |
| priority | text | high / normal / low |
| confidence | float | AI confidence score (0.0–1.0) |
| categorized_at | timestamptz | When classification was made |

#### `grouping_configs`
User's saved tree grouping configuration. Only one active config per user.

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | FK to auth.users |
| levels | jsonb | Array of `{ dimension, label }` objects (1–5 levels) |
| date_range_start | date | Optional start date filter |
| date_range_end | date | Optional end date filter |
| is_active | boolean | Whether this is the user's current config |
| created_at | timestamptz | Row creation time |

#### `sync_jobs`
Tracks sync operations for observability.

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| gmail_account_id | uuid | FK to gmail_accounts |
| status | text | running / completed / failed |
| started_at | timestamptz | Sync start time |
| completed_at | timestamptz | Sync end time |
| emails_fetched | int | Count of new emails synced |
| emails_categorized | int | Count of emails categorized |
| error_message | text | Error details (if failed) |

#### `user_preferences`
Per-user settings.

| Column | Type | Description |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | FK to auth.users (unique) |
| auto_categorize_unread | boolean | Whether to auto-categorize unread emails |
| created_at | timestamptz | Row creation time |
| updated_at | timestamptz | Last update time |

### Row-Level Security

All tables enforce RLS policies. Users can only read and write their own data. The `auth.uid()` function is used in all policy conditions. Service-role clients bypass RLS for server-side operations (sync, categorization).

### Key Indexes

- `idx_emails_account_received` — `(gmail_account_id, received_at DESC)` for chronological listing
- `idx_emails_account_read` — `(gmail_account_id, is_read)` for unread queries
- `idx_emails_unread_uncategorized` — Partial index on `(gmail_account_id, is_read, is_categorized) WHERE is_read = false AND is_categorized = false`
- `idx_email_categories_category` — `(category)` for category grouping
- `idx_email_categories_email_id` — Unique on `(email_id)` for fast joins

---

## Authentication & Authorization

### OAuth Flow

```
Landing page
    → "Sign in with Google" button
    → Supabase Auth redirects to Google OAuth
    → User grants gmail.modify scope
    → Google redirects to Supabase callback
    → Supabase creates session, redirects to /callback route

/callback route
    → Exchanges code for session (via Supabase)
    → Extracts provider_token (Google access token)
    → Calls Google tokeninfo endpoint to detect granted scope
    → Encrypts tokens with AES-256-GCM
    → Upserts gmail_accounts row
    → Redirects to /setup (first time) or /dashboard (returning user)
```

### Scope Detection

The app requests `gmail.modify` scope (which is a superset of `gmail.readonly`). After OAuth, the callback route introspects the Google access token via `https://www.googleapis.com/oauth2/v3/tokeninfo` to detect which scope was actually granted. This is stored as `granted_scope` on the `gmail_accounts` row.

If a user has only `gmail.readonly` (e.g., they signed up before the scope upgrade), write operations return 403 and the dashboard shows a re-authentication banner.

### Token Security

- Access and refresh tokens are encrypted with **AES-256-GCM** using a `TOKEN_ENCRYPTION_KEY` environment variable
- Key derivation uses **scrypt** (N=16384, r=8, p=1)
- Stored format: `iv:authTag:ciphertext` (hex-encoded)
- Tokens are decrypted only at the moment of use, never cached in plaintext

### Middleware

The Next.js middleware (`middleware.ts`) runs on every request:
- Protected routes (`/dashboard`, `/settings`, `/setup`): redirects to `/` if not authenticated
- Landing page (`/`): redirects to `/dashboard` if already authenticated
- Updates session cookies in the response

---

## Email Sync

### Sync Process

```
syncEmails(account)
    1. List message IDs from Gmail (max 500, newest first)
    2. Filter out already-synced IDs (batch lookup against emails table)
    3. Fetch metadata for new messages (batches of 50)
    4. Extract: subject, sender info, date, labels, starred/read status
    5. Upsert into emails table
    6. Update gmail_accounts.last_sync_at
```

### What's Synced

Only email **metadata** is fetched (using `format: 'metadata'`):
- Subject, sender name/email/domain
- Gmail-generated snippet (first ~100 chars of body)
- Received date
- Label IDs (INBOX, UNREAD, STARRED, custom labels)
- Read and starred status (derived from labels)

**No email body content is ever stored.**

### Sync Triggers

1. **Manual** — User taps sync button in the dashboard header
2. **Auto on load** — Dashboard triggers sync if last sync was >5 minutes ago
3. **Cron job** — `GET /api/cron/sync` runs on a schedule (Vercel cron), syncs up to 5 accounts per invocation, prioritizing the oldest-synced accounts

### Deduplication

Emails are uniquely identified by `(gmail_account_id, gmail_message_id)`. The sync process checks existing IDs before fetching metadata, so re-syncs don't create duplicates.

---

## AI Categorization

### Model and Approach

- **Model:** Claude Sonnet 4 (`claude-sonnet-4-20250514`)
- **Method:** Tool-based structured output via the Anthropic SDK
- **Batch size:** 25 emails per API call

### Categorization Output

For each email, Claude returns:

| Field | Type | Description |
|---|---|---|
| category | enum | One of: Work, Personal, Finance, Shopping, Travel, Social, Newsletters, Notifications, Promotions, Other |
| topic | string | 2–4 word topic description (e.g., "Project Updates", "Flight Booking") |
| priority | enum | high (urgent/action-required), normal (regular), low (noise/promotions) |
| confidence | float | 0.0–1.0 confidence score |

### Categorization Behavior

By default, only **read** emails are categorized. Unread emails stay uncategorized until the user reads them (either by tapping in the Unread section or via the action menu). This preserves the "what's new" signal.

Users can opt into auto-categorization of unread emails via Settings > Behavior > "Auto-categorize unread emails".

### When Categorization Runs

1. **During sync** — After emails are fetched, uncategorized read emails are batched to Claude
2. **On mark as read** — When a user marks an email as read (via Unread section or action menu), that email is immediately categorized
3. **Manual trigger** — `POST /api/categorize` categorizes all pending emails

---

## Tree Navigation

### Concept

The inbox is presented as a hierarchical tree. Users configure 1–5 grouping levels, each representing a **dimension** to group by. The tree dynamically generates SQL GROUP BY queries to aggregate emails.

### Available Dimensions

| Dimension | Groups by | Example groups |
|---|---|---|
| `category` | AI-assigned category | Work, Finance, Shopping |
| `topic` | AI-assigned topic | Project Updates, Receipts |
| `sender` | Full sender email | alice@example.com |
| `sender_domain` | Sender's domain | example.com, gmail.com |
| `date_month` | Month of received date | 2025-01, 2025-02 |
| `date_week` | ISO week of received date | 2025-W01, 2025-W02 |
| `priority` | AI-assigned priority | high, normal, low |
| `has_attachment` | Attachment presence | true, false |
| `is_read` | Read status | true, false |

### Query Engine

The grouping engine (`lib/grouping/engine.ts`) generates two types of queries:

**Group query** (non-leaf levels): Returns `(group_key, count)` pairs by grouping emails on the current dimension, filtered by all parent-level selections.

**Leaf query** (final level): Returns full email objects with joined category data, filtered by all accumulated selections.

```
Example: User configures [Category, Domain, Month]

Level 0: GROUP BY category → [Work: 42, Shopping: 15, ...]
    Level 1: GROUP BY sender_domain WHERE category='Work' → [company.com: 30, ...]
        Level 2: SELECT emails WHERE category='Work' AND sender_domain='company.com'
            → [email1, email2, email3, ...]
```

The engine uses Supabase RPC calls with dynamic SQL for the GROUP BY queries, falling back to the Supabase query builder if RPC is unavailable.

### Date Range Filtering

Users can optionally set start/end dates on their grouping config. When set, all tree queries filter `received_at` within the date range. This lets users focus on a specific time period (e.g., "last 3 months").

---

## Email Actions

### Single-Email Actions

All actions are performed via `POST /api/emails/[id]/actions` with a JSON body `{ action }`.

| Action | Gmail API Call | DB Update |
|---|---|---|
| `mark_read` | Remove UNREAD label | Set `is_read = true`, trigger categorization |
| `mark_unread` | Add UNREAD label | Set `is_read = false` |
| `trash` | `messages.trash` | Delete row (cascades to email_categories) |
| `archive` | Remove INBOX label | Remove INBOX from `label_ids` array |
| `star` | Add STARRED label | Set `is_starred = true` |
| `unstar` | Remove STARRED label | Set `is_starred = false` |

All write operations require `gmail.modify` scope. If the user only has `gmail.readonly`, the API returns 403.

### Bulk Category Actions

`POST /api/emails/category-actions` operates on all emails in a category.

| Action | Behavior |
|---|---|
| `trash` | Trash all emails in the category (Gmail + DB) |
| `archive` | Archive all emails (remove INBOX label in Gmail + DB) |
| `reassign` | Move all emails to a different category (DB only, `confidence: 1.0`) |

### Manual Category Reassignment

`PUT /api/emails/[id]/category` lets users move a single email to a different category. This is stored with `confidence: 1.0` to indicate a manual override.

---

## Unread Email Flow

### Default Behavior (auto-categorize OFF)

```
New email arrives in Gmail
    → Sync fetches it (is_read=false, is_categorized=false)
    → Email appears in the Unread section (pinned at top of tree)
    → User taps the email
        → mark_read action fires
        → Gmail: removes UNREAD label
        → DB: is_read = true
        → Claude categorizes the email
        → DB: is_categorized = true, email_categories row created
    → Email disappears from Unread section
    → Email appears in the tree under its category
```

### Auto-categorize ON

```
New email arrives in Gmail
    → Sync fetches it (is_read=false, is_categorized=false)
    → Sync immediately categorizes ALL uncategorized emails (including unread)
    → Email appears directly in the tree under its category
    → Unread section stays empty (all emails are pre-categorized)
```

### Categorize All Button

The Unread section has a "Categorize all" button that marks all unread emails as read and triggers categorization in sequence, with per-email error handling.

---

## UI Architecture

### Page Layout

```
┌──────────────────────────────────────────┐
│  Header: Logo | Sync | Settings | Avatar │
├──────────────────────────────────────────┤
│  [Re-auth banner if gmail.readonly]      │
├────────────────┬─────────────────────────┤
│  Tree Nav      │  Email List             │
│  ┌──────────┐  │  ┌───────────────────┐  │
│  │ Unread(5)│  │  │ sender  ★  date ⋯│  │
│  ├──────────┤  │  │ Subject line      │  │
│  │ Work  42 │  │  │ snippet...        │  │
│  │ Finance 8│  │  │ [Category] [High] │  │
│  │ Shopping │  │  ├───────────────────┤  │
│  │   ...    │  │  │ next email...     │  │
│  └──────────┘  │  └───────────────────┘  │
└────────────────┴─────────────────────────┘
```

### Mobile Responsiveness

On mobile, the tree and email list use a navigation pattern:
- Tree view fills the screen
- Tapping a leaf node navigates to the email list view
- A "Back to tree" button returns to the tree

On desktop (lg+), tree and email list display side-by-side.

### Component Hierarchy

```
DashboardClient
├── Header (logo, sync, settings, user menu)
├── Banners (no account, first sync, re-auth)
└── EmailTree
    ├── UnreadSection
    │   └── UnreadEmailRow (tap to mark read + categorize)
    ├── TreeNode (recursive)
    │   ├── CategoryActions (trash/archive/reassign all)
    │   └── TreeNode (children)
    └── EmailList
        └── EmailRow
            ├── StarButton
            ├── ActionMenu (mark read/unread, archive, star, move, trash)
            └── CategoryPicker (move to modal)
```

### State Management

- No global state library — uses React `useState` and `useCallback` hooks
- Optimistic updates: UI updates immediately on action, reverts on error
- Tree refreshes via a callback chain: action → `onEmailUpdated` → `handleEmailsChanged` → `fetchNodes()` + `setRefreshKey()`
- Unread section re-fetches when `refreshKey` prop changes (triggered by email actions anywhere in the tree)

---

## Settings

### Grouping Builder

Users configure their tree grouping through a visual editor:
- **1–5 levels**, each selecting a dimension from the available list
- **Drag-style reordering** (add/remove levels)
- **Date range filter** — optional start/end dates
- Changes are saved as a new `grouping_configs` row (previous config is deactivated)

### User Preferences

| Setting | Default | Description |
|---|---|---|
| Auto-categorize unread | OFF | When off, unread emails stay in the Unread section until manually read |

---

## Background Sync (Cron)

`GET /api/cron/sync` is designed to run as a Vercel cron job.

### Behavior

1. Validates `CRON_SECRET` header for authorization
2. Cleans up stale sync jobs (running for >10 minutes → marked as failed)
3. Selects up to 5 gmail accounts (oldest last_sync_at first, sync_enabled=true)
4. For each account: runs `syncEmails()` + `categorizeEmails()` (respecting user preferences)
5. Creates/updates `sync_jobs` records for observability

### Error Handling

- If token refresh fails with `invalid_grant`, the account's `sync_enabled` is set to false (user must re-authenticate)
- Each account is synced independently — one failure doesn't block others
- Stale jobs are cleaned up on each invocation

---

## API Reference

### Email Endpoints

| Method | Route | Description |
|---|---|---|
| GET | `/api/emails?level=N&configId=X&filter.*=Y` | Tree navigation — returns groups or leaf emails |
| GET | `/api/emails/unread` | List unread uncategorized emails |
| POST | `/api/emails/[id]/actions` | Single email action (mark_read, trash, etc.) |
| PUT | `/api/emails/[id]/category` | Reassign email to a different category |
| POST | `/api/emails/category-actions` | Bulk action on all emails in a category |

### Sync & Categorization

| Method | Route | Description |
|---|---|---|
| POST | `/api/sync` | Manual sync trigger |
| POST | `/api/categorize` | Manual categorization trigger |
| GET | `/api/cron/sync` | Background sync (cron job) |

### Settings

| Method | Route | Description |
|---|---|---|
| GET/PUT | `/api/settings/grouping` | Read/write grouping configuration |
| GET/PUT | `/api/settings/preferences` | Read/write user preferences |

### Auth

| Method | Route | Description |
|---|---|---|
| GET | `/callback` | Google OAuth callback handler |

---

## Error Handling Strategy

### API Routes

- All Gmail API calls are wrapped in try/catch blocks
- DB write errors are logged with `console.error` but don't fail the request (Gmail action already succeeded)
- Unknown actions return 400, missing auth returns 401, wrong ownership returns 403, missing resources return 404

### UI Components

- Failed actions display inline error messages (red text below the email)
- The Unread section shows error messages when mark-read or categorize-all fails
- "Categorize all" processes emails sequentially with per-email error tracking
- Network errors are caught and displayed as "Network error"

### Token Refresh

- Expired Google access tokens are automatically refreshed using the stored refresh token
- If refresh fails (null access token), throws an explicit error
- If refresh succeeds, the new token is encrypted and stored in the DB
- DB update failures during token storage are logged but don't block the request

---

## Future Considerations

- **Incremental sync** — Use Gmail's `history.list` API instead of full message listing for faster syncs
- **Email body storage** — Currently only metadata is stored; body content could enable better search and summarization
- **Snooze** — Requires: archive email + store snooze_until + background job to re-inbox (needs reliable cron)
- **Custom categories** — Let users define their own category taxonomy beyond the 10 defaults
- **Multi-account** — The schema supports it (gmail_accounts has user_id + email unique), but the UI assumes one account
- **Search** — Full-text search across stored email metadata
- **Swipe gestures** — Mobile swipe-to-archive/trash
