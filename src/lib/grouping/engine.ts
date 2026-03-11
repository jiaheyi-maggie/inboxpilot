import type { DimensionDef, DimensionKey, GroupingLevel, TreeNode, EmailWithCategory } from '@/types';

export const DIMENSIONS: Record<DimensionKey, DimensionDef> = {
  category: {
    key: 'category',
    label: 'Category',
    sqlColumn: 'ec.category',
    description: 'AI-assigned category (Work, Shopping, etc.)',
  },
  topic: {
    key: 'topic',
    label: 'Topic',
    sqlColumn: 'ec.topic',
    description: 'Specific topic (Project Updates, Receipts, etc.)',
  },
  sender: {
    key: 'sender',
    label: 'Sender',
    sqlColumn: 'e.sender_email',
    description: 'Full sender email address',
  },
  sender_domain: {
    key: 'sender_domain',
    label: 'Domain',
    sqlColumn: 'e.sender_domain',
    description: 'Sender domain (gmail.com, company.com)',
  },
  date_month: {
    key: 'date_month',
    label: 'Month',
    sqlColumn: "to_char(e.received_at, 'YYYY-MM')",
    description: 'Month (2026-03)',
  },
  date_week: {
    key: 'date_week',
    label: 'Week',
    sqlColumn: "to_char(e.received_at, 'IYYY-\"W\"IW')",
    description: 'ISO week (2026-W10)',
  },
  priority: {
    key: 'priority',
    label: 'Priority',
    sqlColumn: 'ec.priority',
    description: 'AI-assigned priority (high, normal, low)',
  },
  has_attachment: {
    key: 'has_attachment',
    label: 'Has Attachment',
    sqlColumn: 'e.has_attachment',
    description: 'Whether email has attachments',
  },
  is_read: {
    key: 'is_read',
    label: 'Read Status',
    sqlColumn: 'e.is_read',
    description: 'Read or unread',
  },
};

export function getAvailableDimensions(
  selectedDimensions: DimensionKey[]
): DimensionDef[] {
  const selected = new Set(selectedDimensions);
  return Object.values(DIMENSIONS).filter((d) => !selected.has(d.key));
}

interface GroupQueryParams {
  gmailAccountId: string;
  levels: GroupingLevel[];
  currentLevel: number;
  parentFilters: { dimension: DimensionKey; value: string }[];
  dateRangeStart?: string | null;
  dateRangeEnd?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * Build a dynamic GROUP BY query for tree navigation.
 * Returns { sql, params } to be executed via supabase.rpc() or raw query.
 */
export function buildGroupQuery(params: GroupQueryParams): {
  sql: string;
  params: unknown[];
} {
  const {
    gmailAccountId,
    levels,
    currentLevel,
    parentFilters,
    dateRangeStart,
    dateRangeEnd,
    limit = 50,
    offset = 0,
  } = params;

  const dimension = DIMENSIONS[levels[currentLevel].dimension];
  const sqlParams: unknown[] = [gmailAccountId];
  let paramIdx = 2;

  // WHERE clauses
  const whereClauses = ['e.gmail_account_id = $1'];

  // Parent filter conditions
  for (const filter of parentFilters) {
    const parentDim = DIMENSIONS[filter.dimension];
    whereClauses.push(`${parentDim.sqlColumn} = $${paramIdx}`);
    sqlParams.push(filter.value);
    paramIdx++;
  }

  // Date range
  if (dateRangeStart) {
    whereClauses.push(`e.received_at >= $${paramIdx}`);
    sqlParams.push(dateRangeStart);
    paramIdx++;
  }
  if (dateRangeEnd) {
    whereClauses.push(`e.received_at <= $${paramIdx}`);
    sqlParams.push(dateRangeEnd);
    paramIdx++;
  }

  const whereStr = whereClauses.join(' AND ');

  const sql = `
    SELECT ${dimension.sqlColumn} as group_key, COUNT(*)::int as count
    FROM emails e
    LEFT JOIN email_categories ec ON ec.email_id = e.id
    WHERE ${whereStr}
      AND ${dimension.sqlColumn} IS NOT NULL
    GROUP BY group_key
    ORDER BY count DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return { sql, params: sqlParams };
}

/**
 * Build query to fetch actual emails at the leaf level (all grouping levels exhausted).
 */
export function buildLeafQuery(params: {
  gmailAccountId: string;
  parentFilters: { dimension: DimensionKey; value: string }[];
  dateRangeStart?: string | null;
  dateRangeEnd?: string | null;
  limit?: number;
  offset?: number;
}): { sql: string; params: unknown[] } {
  const {
    gmailAccountId,
    parentFilters,
    dateRangeStart,
    dateRangeEnd,
    limit = 50,
    offset = 0,
  } = params;

  const sqlParams: unknown[] = [gmailAccountId];
  let paramIdx = 2;

  const whereClauses = ['e.gmail_account_id = $1'];

  for (const filter of parentFilters) {
    const dim = DIMENSIONS[filter.dimension];
    whereClauses.push(`${dim.sqlColumn} = $${paramIdx}`);
    sqlParams.push(filter.value);
    paramIdx++;
  }

  if (dateRangeStart) {
    whereClauses.push(`e.received_at >= $${paramIdx}`);
    sqlParams.push(dateRangeStart);
    paramIdx++;
  }
  if (dateRangeEnd) {
    whereClauses.push(`e.received_at <= $${paramIdx}`);
    sqlParams.push(dateRangeEnd);
    paramIdx++;
  }

  const sql = `
    SELECT
      e.id, e.gmail_message_id, e.subject, e.sender_email, e.sender_name,
      e.sender_domain, e.snippet, e.received_at, e.is_read, e.has_attachment,
      ec.category, ec.topic, ec.priority, ec.confidence
    FROM emails e
    LEFT JOIN email_categories ec ON ec.email_id = e.id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY e.received_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return { sql, params: sqlParams };
}
