-- Add categorization_status to track async categorization progress
-- Values: 'none' (default), 'pending' (queued), 'done', 'failed'
-- Run this in Supabase SQL Editor

ALTER TABLE emails ADD COLUMN IF NOT EXISTS categorization_status text NOT NULL DEFAULT 'none';

-- Index for finding pending categorizations (cron fallback)
CREATE INDEX IF NOT EXISTS idx_emails_categorization_pending
  ON emails(categorization_status)
  WHERE categorization_status = 'pending';

-- Backfill: mark already-categorized emails as 'done'
UPDATE emails SET categorization_status = 'done' WHERE is_categorized = true;
