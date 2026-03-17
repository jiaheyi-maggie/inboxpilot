-- Add snooze support to emails table.
-- snoozed_until: when set, the email is hidden from all views until this timestamp passes.
-- The cron job checks for expired snoozes and restores them to the inbox.

ALTER TABLE emails ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

-- Partial index: only index rows that are actually snoozed (sparse).
-- Used by the cron job to find emails whose snooze has expired.
CREATE INDEX IF NOT EXISTS idx_emails_snoozed
  ON emails (snoozed_until)
  WHERE snoozed_until IS NOT NULL;
