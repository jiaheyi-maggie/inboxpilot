# InboxPilot

**Your inbox, organized by AI.**

InboxPilot connects to your Gmail account, automatically categorizes every email using AI, and lets you browse your inbox like a file system. Group by category, sender, date, priority — any way you want.

## Features

- **AI Categorization** — Emails are automatically sorted into categories (Work, Finance, Shopping, Newsletters, etc.) with topic labels and priority levels
- **Tree Navigation** — Browse your inbox as a hierarchical tree with up to 5 customizable grouping levels
- **Unread Inbox** — New emails stay in a pinned "Unread" section until you read them, then get categorized and filed into the tree
- **Email Actions** — Archive, trash, star, and move emails between categories — changes sync back to Gmail
- **Bulk Actions** — Trash, archive, or reassign all emails in a category at once
- **Background Sync** — Your inbox stays organized automatically, even when you're away
- **Flexible Grouping** — Configure how emails are grouped: by category, sender, domain, month, week, priority, read status, or attachment status
- **Date Filtering** — Focus on a specific time range with start/end date filters

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router, Server Components) |
| UI | [React 19](https://react.dev), [Tailwind CSS 4](https://tailwindcss.com) |
| Database & Auth | [Supabase](https://supabase.com) (PostgreSQL + Google OAuth + RLS) |
| Email | [Gmail API](https://developers.google.com/gmail/api) via googleapis |
| AI | [Claude Sonnet](https://anthropic.com) via Anthropic SDK |
| Deployment | [Vercel](https://vercel.com) |

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) account (free tier works)
- A [Google Cloud](https://console.cloud.google.com) project with Gmail API enabled
- An [Anthropic](https://console.anthropic.com) API key

### Install and run

```bash
git clone https://github.com/your-username/inboxpilot.git
cd inboxpilot
npm install
cp .env.local.example .env.local
# Fill in your environment variables (see SETUP.md)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Full setup guide

See **[SETUP.md](./SETUP.md)** for detailed instructions on configuring Supabase, Google OAuth, Anthropic, environment variables, and deploying to Vercel.

## How It Works

1. **Sign in** with your Google account — InboxPilot requests Gmail access
2. **Sync** pulls your email metadata from Gmail (subject, sender, date, labels)
3. **AI categorizes** each email using Claude Sonnet, assigning a category, topic, priority, and confidence score
4. **Tree view** groups emails using your chosen dimensions (e.g., Category > Domain > Month)
5. **Actions** you take (archive, trash, star) sync back to Gmail in real time

Unread emails stay in a separate pinned section until you read them. Once read, they're categorized and appear in the tree. You can toggle auto-categorization in Settings if you prefer immediate filing.

## Project Structure

```
src/
  app/
    (app)/dashboard/     # Main inbox view
    (app)/settings/      # Grouping config + preferences
    (app)/setup/         # First-time onboarding wizard
    (auth)/callback/     # Google OAuth callback
    api/                 # REST API routes
  components/
    dashboard/           # Tree, email list, unread section, actions
    settings/            # Grouping builder, date picker
    landing/             # Sign-in page
    ui/                  # Button, Badge primitives
  lib/
    ai/                  # Claude categorization engine
    gmail/               # Gmail API client + sync
    grouping/            # Dynamic SQL query builder for tree nav
    supabase/            # Database client helpers
    crypto.ts            # AES-256-GCM token encryption
  types/
    index.ts             # All TypeScript interfaces and enums
supabase/
  migrations/            # Database schema (run with `supabase db push`)
```

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable API key |
| `SUPABASE_SECRET_KEY` | Supabase secret key (server-side only) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `TOKEN_ENCRYPTION_KEY` | AES encryption key for OAuth tokens (`openssl rand -hex 16`) |
| `CRON_SECRET` | Secret for authenticating cron job requests (`openssl rand -hex 8`) |
| `NEXT_PUBLIC_APP_URL` | Your app's public URL |

## Security

- OAuth tokens are encrypted at rest using AES-256-GCM before storage
- All database tables enforce Row-Level Security — users can only access their own data
- Auth middleware protects all app routes
- Gmail write operations require explicit `gmail.modify` scope (detected and enforced per-user)
- No email body content is stored — only metadata (subject, sender, snippet, labels)

## License

MIT
