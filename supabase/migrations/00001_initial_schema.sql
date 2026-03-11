-- InboxPilot initial schema
-- Run this in Supabase SQL Editor or via migrations

-- Gmail accounts linked to auth.users
create table if not exists gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  history_id text,
  last_sync_at timestamptz,
  sync_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, email)
);

-- Cached email metadata
create table if not exists emails (
  id uuid primary key default gen_random_uuid(),
  gmail_account_id uuid not null references gmail_accounts(id) on delete cascade,
  gmail_message_id text not null,
  thread_id text,
  subject text,
  sender_email text,
  sender_name text,
  sender_domain text,
  snippet text,
  received_at timestamptz not null default now(),
  is_read boolean not null default false,
  has_attachment boolean not null default false,
  label_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(gmail_account_id, gmail_message_id)
);

-- AI-assigned categories
create table if not exists email_categories (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references emails(id) on delete cascade unique,
  category text not null,
  topic text,
  priority text not null default 'normal',
  confidence float,
  categorized_at timestamptz not null default now()
);

-- User's saved grouping configurations
create table if not exists grouping_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Default',
  levels jsonb not null default '[{"dimension":"category","label":"Category"},{"dimension":"sender_domain","label":"Domain"},{"dimension":"date_month","label":"Month"}]',
  date_range_start timestamptz,
  date_range_end timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Background sync job tracking
create table if not exists sync_jobs (
  id uuid primary key default gen_random_uuid(),
  gmail_account_id uuid not null references gmail_accounts(id) on delete cascade,
  status text not null default 'running',
  emails_fetched int not null default 0,
  emails_categorized int not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Indexes for performance
create index if not exists idx_emails_gmail_account on emails(gmail_account_id);
create index if not exists idx_emails_received_at on emails(received_at);
create index if not exists idx_emails_sender_domain on emails(sender_domain);
create index if not exists idx_email_categories_category on email_categories(category);
create index if not exists idx_email_categories_email_id on email_categories(email_id);
create index if not exists idx_grouping_configs_user on grouping_configs(user_id, is_active);
create index if not exists idx_sync_jobs_account on sync_jobs(gmail_account_id, status);
create index if not exists idx_gmail_accounts_sync on gmail_accounts(sync_enabled, last_sync_at);

-- Row Level Security
alter table gmail_accounts enable row level security;
alter table emails enable row level security;
alter table email_categories enable row level security;
alter table grouping_configs enable row level security;
alter table sync_jobs enable row level security;

-- RLS policies: users can only see their own data
create policy "Users can view own gmail accounts"
  on gmail_accounts for select
  using (auth.uid() = user_id);

create policy "Users can insert own gmail accounts"
  on gmail_accounts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own gmail accounts"
  on gmail_accounts for update
  using (auth.uid() = user_id);

-- Emails: accessible via gmail_account ownership
create policy "Users can view own emails"
  on emails for select
  using (gmail_account_id in (
    select id from gmail_accounts where user_id = auth.uid()
  ));

-- Email categories: accessible via email -> gmail_account ownership
create policy "Users can view own email categories"
  on email_categories for select
  using (email_id in (
    select e.id from emails e
    join gmail_accounts ga on ga.id = e.gmail_account_id
    where ga.user_id = auth.uid()
  ));

-- Grouping configs
create policy "Users can manage own grouping configs"
  on grouping_configs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Sync jobs: viewable via gmail_account ownership
create policy "Users can view own sync jobs"
  on sync_jobs for select
  using (gmail_account_id in (
    select id from gmail_accounts where user_id = auth.uid()
  ));
