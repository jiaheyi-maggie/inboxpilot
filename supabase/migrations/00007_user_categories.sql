-- User-defined email categories
-- Replaces the hardcoded CATEGORIES array with per-user custom categories.
-- Seeded with defaults on first use.

CREATE TABLE user_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,             -- helps Claude understand intent
  color text,                   -- optional hex color for badge
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE user_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_categories" ON user_categories
  FOR ALL USING (user_id = auth.uid());

-- Index for fast lookup by user
CREATE INDEX idx_user_categories_user ON user_categories(user_id, sort_order);
