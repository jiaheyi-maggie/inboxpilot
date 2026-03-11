# InboxPilot — Setup Guide

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) account (free tier works)
- A [Google Cloud](https://console.cloud.google.com) account
- An [Anthropic](https://console.anthropic.com) account (for Claude API)
- Supabase CLI (`brew install supabase/tap/supabase`)
- GitHub CLI (`brew install gh`) — optional, for deployment

---

## 1. Supabase Project

### Create the project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **New Project**
3. Choose an organization, name the project (e.g. `inboxpilot`), set a database password, pick a region
4. Wait for the project to finish provisioning

### Link to the codebase

```bash
cd /path/to/inboxpilot
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
```

Your project ref is the random string in your Supabase URL: `https://<PROJECT_REF>.supabase.co`

### Run the database migration

```bash
supabase db push
```

This runs `supabase/migrations/00001_initial_schema.sql`, which creates all tables (`gmail_accounts`, `emails`, `email_categories`, `grouping_configs`, `sync_jobs`), indexes, and row-level security policies.

Alternatively, you can paste the contents of that file directly into the Supabase dashboard → SQL Editor → New Query → Run.

---

## 2. Google Cloud OAuth Credentials

### Enable the Gmail API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Library**
4. Search for **Gmail API** → click **Enable**

### Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** user type
3. Fill in the app name (`InboxPilot`), support email, and developer email
4. Under **Scopes**, add: `https://www.googleapis.com/auth/gmail.readonly`
5. Add your email under **Test users** (required while in testing mode)
6. Save

### Create OAuth credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Add **Authorized redirect URI**:
   ```
   https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback
   ```
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

---

## 3. Supabase Google Auth Provider

1. Go to your Supabase dashboard → **Authentication → Providers → Google**
2. Toggle **Enable**
3. Paste the **Google Client ID** and **Client Secret** from step 2
4. Save

---

## 4. Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Navigate to **API Keys**
3. Create a new key and copy it

---

## 5. Environment Variables

Copy the example file:

```bash
cp .env.local.example .env.local
```

Fill in each value:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same page → Publishable API key (starts with `sb_publishable_`) |
| `SUPABASE_SECRET_KEY` | Same page → Secret API key (starts with `sb_secret_`, keep secret!) |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → Credentials |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credentials |
| `ANTHROPIC_API_KEY` | Anthropic Console → API Keys |
| `TOKEN_ENCRYPTION_KEY` | Generate: `openssl rand -hex 16` |
| `CRON_SECRET` | Generate: `openssl rand -hex 8` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` for local dev |

---

## 6. Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You should see the landing page with a "Sign in with Google" button.

### First-time flow

1. Click **Sign in with Google** → authorize Gmail read-only access
2. You'll be redirected to `/dashboard`
3. Tap the **sync button** (top right) to fetch and categorize your emails
4. Go to **Settings** (gear icon) to customize your grouping levels

---

## 7. Deploy to Vercel

### Push to GitHub (if not already done)

```bash
gh repo create inboxpilot --public --source=. --push
```

### Deploy

1. Go to [vercel.com](https://vercel.com) → Import your GitHub repo
2. Set **all environment variables** from step 5 in Vercel → Settings → Environment Variables
3. Update `NEXT_PUBLIC_APP_URL` to your Vercel deployment URL (e.g. `https://inboxpilot.vercel.app`)
4. Deploy

### Post-deploy: update OAuth redirect

Add your Vercel URL to Google Cloud OAuth authorized redirect URIs:

```
https://inboxpilot-azure.vercel.app.app/callback
```

---

## Troubleshooting

| Issue | Fix |
|---|---|
| "No Gmail account linked" after sign-in | Check that Google OAuth provider is enabled in Supabase and redirect URI matches exactly |
| Sync fails with 401 | Gmail access token expired and refresh failed — sign out and sign back in |
| Emails sync but no categories appear | Check that `ANTHROPIC_API_KEY` is set and valid |
| Cron job not running | Vercel cron requires Pro plan. For Hobby plan, trigger sync manually via the UI |
| Build fails locally | Run `npm install` again, ensure Node 18+ |
