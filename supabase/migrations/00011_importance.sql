-- 00011_importance.sql
-- Replace priority (high/normal/low) with importance (1-5 scale + label)
-- Importance is richer: critical(5), high(4), medium(3), low(2), noise(1)

-- 1. Add importance columns to email_categories
ALTER TABLE email_categories
  ADD COLUMN IF NOT EXISTS importance_score smallint,
  ADD COLUMN IF NOT EXISTS importance_label text;

-- 2. Add per-category importance config to user_categories
ALTER TABLE user_categories
  ADD COLUMN IF NOT EXISTS importance_weight smallint NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS importance_criteria text;

-- 3. Add global importance criteria to user_preferences
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS importance_criteria text;

-- 4. Index for importance-based sorting within categories
CREATE INDEX IF NOT EXISTS idx_email_categories_importance
  ON email_categories(email_id, importance_score DESC);

-- 5. Backfill existing rows: map priority → importance
UPDATE email_categories SET
  importance_score = CASE priority
    WHEN 'high' THEN 4
    WHEN 'normal' THEN 3
    WHEN 'low' THEN 2
    ELSE 3
  END,
  importance_label = CASE priority
    WHEN 'high' THEN 'high'
    WHEN 'normal' THEN 'medium'
    WHEN 'low' THEN 'low'
    ELSE 'medium'
  END
WHERE importance_score IS NULL;

-- NOTE: priority column is NOT dropped. It will be deprecated in code
-- and removed in a future migration after full cutover.
