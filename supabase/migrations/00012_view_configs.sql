-- 00012_view_configs.sql
-- Unified view configuration system replacing grouping_configs + view_mode_picker.
-- Single source of truth for how a user views their emails (list/board/tree + filters/sort/group).

-- 1. Create view_configs table
CREATE TABLE view_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Default',

  -- View layout
  view_type text NOT NULL DEFAULT 'list'
    CHECK (view_type IN ('list', 'board', 'tree')),

  -- Grouping dimensions (ordered array of {dimension, label} objects)
  group_by jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Filter state (array of {field, operator, value} objects)
  filters jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Sort state (array of {field, direction} objects)
  sort jsonb NOT NULL DEFAULT '[{"field": "received_at", "direction": "desc"}]'::jsonb,

  -- Date range (carried from grouping_configs pattern)
  date_range_start timestamptz,
  date_range_end timestamptz,

  -- Activation & ordering
  is_active boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,

  -- Future-proof (Phase 5: saved views)
  is_pinned boolean NOT NULL DEFAULT false,
  icon text,
  color text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. RLS
ALTER TABLE view_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_view_configs" ON view_configs
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3. Indexes
CREATE INDEX idx_view_configs_user_active ON view_configs(user_id, is_active);
CREATE INDEX idx_view_configs_user_order ON view_configs(user_id, sort_order);

-- Prevent duplicate active "Default" configs per user (guards against concurrent tab race)
CREATE UNIQUE INDEX idx_view_configs_user_default_active
  ON view_configs(user_id) WHERE (name = 'Default' AND is_active = true);

-- 4. Data migration: copy active grouping_configs → view_configs
-- Maps old view modes to new view types and group_by arrays
INSERT INTO view_configs (user_id, name, view_type, group_by, date_range_start, date_range_end, is_active)
SELECT
  gc.user_id,
  'Default',
  CASE
    WHEN up.default_view_mode = 'flat' THEN 'list'
    ELSE 'tree'
  END,
  gc.levels,
  gc.date_range_start,
  gc.date_range_end,
  true
FROM grouping_configs gc
LEFT JOIN user_preferences up ON up.user_id = gc.user_id
WHERE gc.is_active = true
ON CONFLICT DO NOTHING;

-- 5. Server-side GROUP BY function
-- Replaces JS-side grouping in /api/emails/route.ts for performance.
-- Accepts a dimension key, maps to SQL column, returns grouped counts.
CREATE OR REPLACE FUNCTION group_emails_by_dimension(
  p_gmail_account_id uuid,
  p_dimension text,
  p_parent_filters jsonb DEFAULT '[]'::jsonb,
  p_date_start timestamptz DEFAULT NULL,
  p_date_end timestamptz DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
) RETURNS TABLE(group_key text, count bigint) AS $$
DECLARE
  dim_col text;
  query text;
  where_clauses text[];
  filter_record jsonb;
  filter_dim text;
  filter_val text;
  filter_col text;
  param_idx int := 1;
  param_values text[];
BEGIN
  -- Map dimension key to SQL column expression
  dim_col := CASE p_dimension
    WHEN 'category' THEN 'ec.category'
    WHEN 'topic' THEN 'ec.topic'
    WHEN 'sender' THEN 'e.sender_email'
    WHEN 'sender_domain' THEN 'e.sender_domain'
    WHEN 'date_month' THEN 'to_char(e.received_at, ''YYYY-MM'')'
    WHEN 'date_week' THEN 'to_char(e.received_at, ''IYYY-"W"IW'')'
    WHEN 'importance' THEN 'ec.importance_label'
    WHEN 'has_attachment' THEN 'e.has_attachment::text'
    WHEN 'is_read' THEN 'e.is_read::text'
    ELSE NULL
  END;

  IF dim_col IS NULL THEN
    RAISE EXCEPTION 'Unknown dimension: %', p_dimension;
  END IF;

  -- Verify the caller owns this gmail account
  IF NOT EXISTS (
    SELECT 1 FROM gmail_accounts
    WHERE id = p_gmail_account_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: gmail account not owned by caller';
  END IF;

  -- Build WHERE clauses
  where_clauses := ARRAY[
    format('e.gmail_account_id = %L', p_gmail_account_id),
    format('%s IS NOT NULL', dim_col)
  ];

  -- Add parent filter conditions
  FOR filter_record IN SELECT * FROM jsonb_array_elements(p_parent_filters)
  LOOP
    filter_dim := filter_record->>'dimension';
    filter_val := filter_record->>'value';

    filter_col := CASE filter_dim
      WHEN 'category' THEN 'ec.category'
      WHEN 'topic' THEN 'ec.topic'
      WHEN 'sender' THEN 'e.sender_email'
      WHEN 'sender_domain' THEN 'e.sender_domain'
      WHEN 'date_month' THEN 'to_char(e.received_at, ''YYYY-MM'')'
      WHEN 'date_week' THEN 'to_char(e.received_at, ''IYYY-"W"IW'')'
      WHEN 'importance' THEN 'ec.importance_label'
      WHEN 'has_attachment' THEN 'e.has_attachment::text'
      WHEN 'is_read' THEN 'e.is_read::text'
      ELSE NULL
    END;

    IF filter_col IS NOT NULL THEN
      where_clauses := array_append(where_clauses, format('%s = %L', filter_col, filter_val));
    END IF;
  END LOOP;

  -- Date range
  IF p_date_start IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('e.received_at >= %L', p_date_start));
  END IF;
  IF p_date_end IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('e.received_at <= %L', p_date_end));
  END IF;

  -- Build and execute query
  query := format(
    'SELECT %s::text AS group_key, COUNT(*)::bigint AS count
     FROM emails e
     LEFT JOIN email_categories ec ON ec.email_id = e.id
     WHERE %s
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT %s OFFSET %s',
    dim_col,
    array_to_string(where_clauses, ' AND '),
    p_limit,
    p_offset
  );

  RETURN QUERY EXECUTE query;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Leaf query function for fetching actual emails with filters
CREATE OR REPLACE FUNCTION fetch_filtered_emails(
  p_gmail_account_id uuid,
  p_filters jsonb DEFAULT '[]'::jsonb,
  p_sort_field text DEFAULT 'received_at',
  p_sort_direction text DEFAULT 'desc',
  p_date_start timestamptz DEFAULT NULL,
  p_date_end timestamptz DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
) RETURNS TABLE(
  id uuid,
  gmail_message_id text,
  thread_id text,
  subject text,
  sender_email text,
  sender_name text,
  sender_domain text,
  snippet text,
  received_at timestamptz,
  is_read boolean,
  is_starred boolean,
  has_attachment boolean,
  label_ids text[],
  category text,
  topic text,
  priority text,
  importance_score smallint,
  importance_label text,
  confidence real
) AS $$
DECLARE
  query text;
  where_clauses text[];
  filter_record jsonb;
  filter_field text;
  filter_op text;
  filter_val text;
  filter_col text;
  sort_col text;
  sort_dir text;
BEGIN
  -- Verify the caller owns this gmail account
  IF NOT EXISTS (
    SELECT 1 FROM gmail_accounts
    WHERE id = p_gmail_account_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: gmail account not owned by caller';
  END IF;

  where_clauses := ARRAY[
    format('e.gmail_account_id = %L', p_gmail_account_id),
    'e.label_ids @> ARRAY[''INBOX'']'
  ];

  -- Apply filters
  FOR filter_record IN SELECT * FROM jsonb_array_elements(p_filters)
  LOOP
    filter_field := filter_record->>'field';
    filter_op := COALESCE(filter_record->>'operator', 'eq');
    filter_val := filter_record->>'value';

    filter_col := CASE filter_field
      WHEN 'category' THEN 'ec.category'
      WHEN 'topic' THEN 'ec.topic'
      WHEN 'sender' THEN 'e.sender_email'
      WHEN 'sender_email' THEN 'e.sender_email'
      WHEN 'sender_domain' THEN 'e.sender_domain'
      WHEN 'importance' THEN 'ec.importance_label'
      WHEN 'importance_label' THEN 'ec.importance_label'
      WHEN 'has_attachment' THEN 'e.has_attachment::text'
      WHEN 'is_read' THEN 'e.is_read::text'
      WHEN 'is_starred' THEN 'e.is_starred::text'
      ELSE NULL
    END;

    IF filter_col IS NOT NULL THEN
      CASE filter_op
        WHEN 'eq' THEN
          where_clauses := array_append(where_clauses, format('%s = %L', filter_col, filter_val));
        WHEN 'neq' THEN
          where_clauses := array_append(where_clauses, format('%s != %L', filter_col, filter_val));
        WHEN 'contains' THEN
          where_clauses := array_append(where_clauses, format('%s ILIKE %L', filter_col, '%%' || filter_val || '%%'));
        ELSE
          where_clauses := array_append(where_clauses, format('%s = %L', filter_col, filter_val));
      END CASE;
    END IF;
  END LOOP;

  -- Date range
  IF p_date_start IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('e.received_at >= %L', p_date_start));
  END IF;
  IF p_date_end IS NOT NULL THEN
    where_clauses := array_append(where_clauses, format('e.received_at <= %L', p_date_end));
  END IF;

  -- Sort column mapping
  sort_col := CASE p_sort_field
    WHEN 'received_at' THEN 'e.received_at'
    WHEN 'sender_email' THEN 'e.sender_email'
    WHEN 'subject' THEN 'e.subject'
    WHEN 'importance_score' THEN 'ec.importance_score'
    WHEN 'category' THEN 'ec.category'
    ELSE 'e.received_at'
  END;

  sort_dir := CASE WHEN p_sort_direction = 'asc' THEN 'ASC' ELSE 'DESC' END;

  query := format(
    'SELECT
      e.id, e.gmail_message_id, e.thread_id, e.subject,
      e.sender_email, e.sender_name, e.sender_domain, e.snippet,
      e.received_at, e.is_read, e.is_starred, e.has_attachment, e.label_ids,
      ec.category, ec.topic, ec.priority,
      ec.importance_score, ec.importance_label, ec.confidence
     FROM emails e
     LEFT JOIN email_categories ec ON ec.email_id = e.id
     WHERE %s
     ORDER BY %s %s NULLS LAST
     LIMIT %s OFFSET %s',
    array_to_string(where_clauses, ' AND '),
    sort_col, sort_dir,
    p_limit, p_offset
  );

  RETURN QUERY EXECUTE query;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
