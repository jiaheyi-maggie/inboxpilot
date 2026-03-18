# InboxPilot

AI-powered Gmail inbox organizer. Syncs email via the Gmail API, categorizes with Claude Sonnet, and provides a Notion-style multi-view dashboard for navigating and managing your inbox.

---

## Getting Started

Sign in with your Google account to authorize Gmail access, then click **Sync** to pull your inbox. InboxPilot will automatically categorize your emails using AI.

> For developer setup (local dev, environment variables, database migrations, deployment), see [SETUP.md](SETUP.md).

---

## Features

### Gmail Sync and AI Categorization

InboxPilot syncs Gmail via the `gmail.modify` scope and uses Claude Sonnet (`tool_use` for structured output) to assign each email a **category**, **topic**, and **importance score**.

**5-level importance scoring**: critical / high / medium / low / noise

**10 default categories**: Work, Personal, Finance, Shopping, Travel, Social, Newsletters, Notifications, Promotions, Other

Categorization runs automatically after each sync. The `auto_categorize_unread` setting controls whether unread emails are included. By default, only emails you have read are categorized — unread emails appear in the **Unread** section at the top of the dashboard and are categorized on first open.

### Dashboard — Notion-style Multi-view

The dashboard has four view modes, switchable from tabs in the main panel:

**Focus view** — Tinder-style card stack for rapid email processing. Swipe right to archive, left to skip, up to star. Emails are ranked by a smart score: `importance × recency × unread boost`. Keyboard shortcuts: arrow keys, `e`/`s`/`f`/`z`, `?` for help. Includes snooze picker and undo toasts. Newsletter bundles are pulled out of the card stack and shown as a one-click "Archive All" digest.

**List view** — Flat email list with newsletter bundling. Low-importance categories (Newsletters, Promotions, Notifications) are auto-collapsed into expandable bundle rows with "Archive All" buttons.

**Board view** — Kanban columns. Drag and drop emails between columns to instantly reassign their category. Drag columns to reorder them (persisted via sort order).

**Tree view** — File-manager style. Drag emails onto folders to reassign. Right-click for context menus (rename, delete, create categories). Inline rename on double-click. Long-press for mobile.

**9 grouping dimensions** (combinable): `category`, `topic`, `sender`, `sender_domain`, `date_month`, `date_week`, `importance`, `has_attachment`, `is_read`

**Inline toolbar** on each view: Filter, Sort, Group by any dimension.

**Sidebar navigation**: Categories (with "All Categories" at top), Accounts (multi-inbox filter), system groups (Starred / Snoozed / Archived / Trash), Unread section. Navigation elements always visible at the top; unread queue at the bottom.

**Breadcrumb bar**: Always-visible navigation path showing your current location (e.g., `All Mail / Work — 42 emails`). Click any segment to navigate back.

**Real-time updates**: Supabase Realtime pushes live INSERT/UPDATE events. New emails show a toast; updates silently refresh the view. Events are debounced at 500ms.

**Mobile**: Compact scope bar with bottom sheet category picker — full viewport for email content.

### AI Assistant

**Cmd+K command palette** — search emails, navigate to views, run quick actions, or escalate to the AI chat.

**Persistent chat sidebar** — multi-turn conversation with Claude. Each message is classified into one of four intent types:

| Intent | Behavior |
|--------|----------|
| `context` | Saves your instruction as a category description to improve future categorization, then re-categorizes affected emails. Also detects layout commands ("put Personal last") and executes category reordering |
| `command` | Executes an immediate action (archive, star, move, etc.) |
| `rule` | Generates a workflow rule from natural language |
| `search` | Searches your synced emails with structured filters, displays results in the main content area |

**AI memory**: When you open the chat, it shows what you've previously taught it ("I remember what you've taught me"). In Settings, each category displays its teachings as a list with per-line delete buttons.

**Teach inputs** — Inline input on each category. Describe what belongs there to refine future AI categorization.

### Workflow Automation

Workflows are trigger-condition-action graphs stored as JSONB. Generate them from natural language via the chat sidebar, or build them visually with the workflow editor.

**Triggers**: `new_email`, `email_categorized`, `email_from_domain`, `unread_timeout`

**Conditions**: Match on category, topic, importance, sender, subject, attachment, read/starred status, Gmail label, account

**Actions**: trash, archive, star, mark read/unread, reassign category, recategorize with a refinement prompt

Workflows support test runs against existing email, backfill against historical email, and rollback.

### Email Management

- Star, archive, trash, mark read/unread — all synced back to Gmail with **undo toasts** (5-second window to reverse any action)
- **Snooze** — "Remind me later" with preset times (later today, tomorrow morning, this weekend, next week, or custom). Snoozed emails disappear and reappear at the scheduled time via cron
- **AI Auto-Reply** — Claude Haiku drafts context-aware replies using the email thread, category teachings, and importance level. Tone adapts automatically (formal for critical, casual for low). Send via Gmail API with proper conversation threading. Keyboard shortcuts: `r` to reply, `Cmd+Enter` to send
- Bulk actions on any tree node
- Category reassignment via drag-and-drop (Board view), context menu (Tree view), or "Move to..." picker
- **Email search** — search via chat ("find emails about Q4 report") or Cmd+K. AI intent classification extracts structured filters (category, sender, read status). Results shown with a searchable breadcrumb indicator
- Quick rule creation from any email
- Email body rendered in a sandboxed iframe

### Multi-Inbox

Connect multiple Gmail accounts from Settings via "Connect Another Gmail" (separate OAuth flow from Supabase auth). Each inbox syncs independently — newly connected accounts auto-sync in the background. View all inboxes unified or filter by account via sidebar. Categories can be global (all inboxes) or inbox-specific. Profile dropdown shows all connected accounts with colored dots.

### Custom Categories

Create, edit, reorder, and delete categories in Settings. Each category has a name, description (used by the AI for classification), color, and sort order. Categories with user-authored descriptions produce more accurate AI assignments.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack, React 19) |
| Database / Auth | Supabase (PostgreSQL + Google OAuth + RLS + Realtime) |
| AI | Anthropic Claude Sonnet 4 (categorization) + Haiku (intent classification) |
| Gmail | googleapis — `gmail.modify` scope |
| Drag and drop | @dnd-kit/core + @dnd-kit/sortable |
| Command palette | cmdk + shadcn/ui (Radix primitives) |
| Workflow editor | @xyflow/react |
| Styling | Tailwind CSS 4 + lucide-react |
| Deployment | Vercel |

---

## Security

- OAuth tokens encrypted at rest with AES-256-GCM
- All tables enforce Row-Level Security — users access only their own data
- Auth middleware protects all authenticated routes
- Gmail write operations require explicit `gmail.modify` scope, enforced per account
- Redirect URLs validated to prevent open redirects

---

## License

MIT
