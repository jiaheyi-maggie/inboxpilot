-- Add body columns for on-demand email content caching.
-- Bodies are fetched from Gmail API when a user opens an email and cached here
-- to avoid repeated API calls.

ALTER TABLE emails ADD COLUMN IF NOT EXISTS body_html text;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS body_text text;
