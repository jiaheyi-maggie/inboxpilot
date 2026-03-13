-- Add view mode support to user_preferences and user_categories
-- CSS cascade model: global default_view_mode + per-category view_mode_override

-- Global default view mode (applies to all categories unless overridden)
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS default_view_mode text NOT NULL DEFAULT 'by_sender';

-- Per-category view mode override (null = use global default)
ALTER TABLE user_categories
  ADD COLUMN IF NOT EXISTS view_mode_override text;
