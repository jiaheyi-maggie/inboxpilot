-- 00013_multi_inbox.sql
-- Multi-inbox support: allows users to connect multiple Gmail accounts
-- and view all emails in a unified, AI-categorized dashboard.

-- 1. Add color and display_name to gmail_accounts
ALTER TABLE gmail_accounts
  ADD COLUMN IF NOT EXISTS color text DEFAULT '#3B82F6',
  ADD COLUMN IF NOT EXISTS display_name text;

-- Backfill display_name from email (extract part before @)
UPDATE gmail_accounts
SET display_name = split_part(email, '@', 1)
WHERE display_name IS NULL;

-- Assign visually distinct default colors to existing accounts.
-- Each user's accounts get a different color from a preset palette.
WITH ranked AS (
  SELECT id, user_id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) AS rn
  FROM gmail_accounts
)
UPDATE gmail_accounts ga
SET color = CASE r.rn
  WHEN 1 THEN '#3B82F6'  -- blue
  WHEN 2 THEN '#10B981'  -- emerald
  WHEN 3 THEN '#F59E0B'  -- amber
  WHEN 4 THEN '#EF4444'  -- red
  WHEN 5 THEN '#8B5CF6'  -- violet
  WHEN 6 THEN '#EC4899'  -- pink
  WHEN 7 THEN '#06B6D4'  -- cyan
  WHEN 8 THEN '#F97316'  -- orange
  ELSE '#6B7280'          -- gray fallback
END
FROM ranked r
WHERE ga.id = r.id;

-- 2. Add gmail_account_id to user_categories for inbox-specific categories
-- NULL = global category (applies to all inboxes)
-- SET = inbox-specific category
ALTER TABLE user_categories
  ADD COLUMN IF NOT EXISTS gmail_account_id uuid REFERENCES gmail_accounts(id) ON DELETE CASCADE;

-- Drop the old unique constraint (user_id, name) and create a new one
-- that includes gmail_account_id so the same category name can exist
-- as both global and inbox-specific.
-- Use a partial unique index to handle NULLs correctly:
--   - Global categories: unique on (user_id, name) WHERE gmail_account_id IS NULL
--   - Inbox-specific: unique on (user_id, name, gmail_account_id) WHERE gmail_account_id IS NOT NULL
ALTER TABLE user_categories DROP CONSTRAINT IF EXISTS user_categories_user_id_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_categories_global_unique
  ON user_categories(user_id, name) WHERE gmail_account_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_categories_account_unique
  ON user_categories(user_id, name, gmail_account_id) WHERE gmail_account_id IS NOT NULL;

-- Index for filtering categories by account
CREATE INDEX IF NOT EXISTS idx_user_categories_account
  ON user_categories(gmail_account_id) WHERE gmail_account_id IS NOT NULL;

-- 3. Add 'account' dimension to the group_emails_by_dimension function
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
    WHEN 'account' THEN 'ga.display_name'
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
      WHEN 'account' THEN 'ga.display_name'
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
     LEFT JOIN gmail_accounts ga ON ga.id = e.gmail_account_id
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

-- 4. Update fetch_filtered_emails to support 'account' filter/sort
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
      WHEN 'account' THEN 'e.gmail_account_id::text'
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
