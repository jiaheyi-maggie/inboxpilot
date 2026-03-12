-- Track manual category corrections for AI learning loop.
-- When a user moves an email to a different category, we record
-- the correction so future categorization runs can learn from it.

CREATE TABLE category_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_id uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  original_category text NOT NULL,
  corrected_category text NOT NULL,
  sender_email text,           -- denormalized for prompt context
  sender_domain text,
  subject text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE category_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_corrections" ON category_corrections
  FOR ALL USING (user_id = auth.uid());

CREATE INDEX idx_corrections_user ON category_corrections(user_id, created_at DESC);
