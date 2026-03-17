-- 00014_focus_view_type.sql
-- Add 'focus' to the view_type CHECK constraint on view_configs.
-- The Focus view is a swipe-to-process card stack sorted by importance.

ALTER TABLE view_configs DROP CONSTRAINT IF EXISTS view_configs_view_type_check;
ALTER TABLE view_configs ADD CONSTRAINT view_configs_view_type_check
  CHECK (view_type IN ('list', 'board', 'tree', 'focus'));
