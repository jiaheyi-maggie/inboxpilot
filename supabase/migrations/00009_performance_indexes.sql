-- Performance indexes for the emails table
--
-- The primary bottleneck is the inbox query:
--   SELECT ... FROM emails
--   WHERE gmail_account_id = ? AND label_ids @> ARRAY['INBOX']
--   ORDER BY received_at DESC
--
-- label_ids is text[] and the Supabase .contains() operator translates to
-- the @> (array containment) operator, which requires a GIN index.
--
-- Additionally, composite indexes support the ordering and unread queries
-- without requiring separate index scans + sort.
--
-- Note: email_categories(email_id) already has a UNIQUE constraint (which
-- implicitly creates a B-tree index) plus an explicit idx_email_categories_email_id
-- from 00001_initial_schema.sql, so no additional index is needed there.

-- 1. GIN index on label_ids for array containment queries (@> operator)
--    Supports: WHERE label_ids @> '{INBOX}', label_ids @> '{SENT}', etc.
CREATE INDEX IF NOT EXISTS idx_emails_label_ids_gin
  ON emails USING gin (label_ids);

-- 2. Composite index for the primary inbox query pattern:
--    WHERE gmail_account_id = ? ORDER BY received_at DESC
--    The DESC on received_at lets Postgres satisfy the ORDER BY via index scan
--    instead of a separate sort step.
CREATE INDEX IF NOT EXISTS idx_emails_account_received
  ON emails (gmail_account_id, received_at DESC);

-- 3. Composite index for unread email queries (used by /api/emails/unread):
--    WHERE gmail_account_id = ? AND is_read = false
CREATE INDEX IF NOT EXISTS idx_emails_account_is_read
  ON emails (gmail_account_id, is_read);
