-- Migration: Unread email handling, user preferences, and Gmail write support
-- Run this in Supabase SQL Editor

-- User preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  auto_categorize_unread boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Track whether email has been AI-categorized (separate from having a category row)
ALTER TABLE emails ADD COLUMN IF NOT EXISTS is_categorized boolean NOT NULL DEFAULT false;

-- Track starred status (synced from Gmail)
ALTER TABLE emails ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false;

-- Backfill: mark existing emails with categories as categorized
UPDATE emails SET is_categorized = true
WHERE id IN (SELECT email_id FROM email_categories);

-- Track granted Gmail scope for re-auth detection
ALTER TABLE gmail_accounts ADD COLUMN IF NOT EXISTS granted_scope text DEFAULT 'gmail.readonly';

-- RLS for user_preferences
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own preferences"
  ON user_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_emails_unread_uncategorized
  ON emails(gmail_account_id, is_read, is_categorized)
  WHERE is_read = false AND is_categorized = false;
CREATE INDEX IF NOT EXISTS idx_emails_is_categorized
  ON emails(gmail_account_id, is_categorized);
CREATE INDEX IF NOT EXISTS idx_emails_is_starred
  ON emails(gmail_account_id, is_starred)
  WHERE is_starred = true;
