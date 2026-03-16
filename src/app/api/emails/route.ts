import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { DIMENSIONS } from '@/lib/grouping/engine';
import type { DimensionKey, GroupingLevel } from '@/types';

// --- Category-table dimensions that live on the email_categories join ---
const CATEGORY_DIMENSIONS = new Set<DimensionKey>(['category', 'topic', 'importance']);

// --- Account dimension (needs gmail_accounts join for display_name) ---
const ACCOUNT_DIMENSION: DimensionKey = 'account';

// Map dimension keys to their actual column names in email_categories.
// Most match 1:1 except importance → importance_label.
const CATEGORY_COLUMN_MAP: Partial<Record<DimensionKey, string>> = {
  category: 'category',
  topic: 'topic',
  importance: 'importance_label',
};

// --- Date dimensions that require formatting ---
const DATE_DIMENSIONS = new Set<DimensionKey>(['date_month', 'date_week']);

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const { searchParams } = new URL(request.url);

  // Get user's active config — try view_configs first, fall back to grouping_configs
  const configId = searchParams.get('configId');
  let config: Record<string, unknown> | null = null;

  if (configId) {
    // Try view_configs first
    const { data: vc } = await serviceClient
      .from('view_configs')
      .select('*')
      .eq('id', configId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (vc) {
      // Normalize view_configs shape to match grouping_configs
      config = { ...vc, levels: vc.group_by };
    } else {
      // Fall back to grouping_configs
      const { data: gc } = await serviceClient
        .from('grouping_configs')
        .select('*')
        .eq('id', configId)
        .eq('user_id', user.id)
        .maybeSingle();
      config = gc;
    }
  } else {
    // No configId — find active config from either table
    const { data: vc } = await serviceClient
      .from('view_configs')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (vc) {
      config = { ...vc, levels: vc.group_by };
    } else {
      const { data: gc } = await serviceClient
        .from('grouping_configs')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      config = gc;
    }
  }

  if (!config) {
    return NextResponse.json({ error: 'No grouping config' }, { status: 404 });
  }

  // Get user's Gmail accounts (multi-inbox support)
  const { data: allAccounts } = await serviceClient
    .from('gmail_accounts')
    .select('id')
    .eq('user_id', user.id);

  if (!allAccounts || allAccounts.length === 0) {
    return NextResponse.json({ error: 'No Gmail account' }, { status: 404 });
  }

  // If an account filter is specified, validate it belongs to this user, then use it
  const accountFilter = searchParams.get('filter.account');
  const allAccountIdSet = new Set(allAccounts.map((a) => a.id));
  if (accountFilter && !allAccountIdSet.has(accountFilter)) {
    return NextResponse.json({ error: 'Invalid account filter' }, { status: 403 });
  }
  const accountIds = accountFilter
    ? [accountFilter]
    : allAccounts.map((a) => a.id);

  // For backward compat, use first account id for single-account operations
  const account = { id: allAccounts[0].id };

  const levels = config.levels as GroupingLevel[];
  const currentLevel = parseInt(searchParams.get('level') ?? '0', 10);

  // Parse parent filters: filter.category=Work&filter.sender_domain=google.com
  // Note: filter.account is handled above by narrowing accountIds, so skip it here
  const parentFilters: { dimension: DimensionKey; value: string }[] = [];
  searchParams.forEach((value, key) => {
    if (key.startsWith('filter.')) {
      const rawDim = key.replace('filter.', '');
      if (rawDim === 'account') return; // handled via accountIds
      if (DIMENSIONS[rawDim as DimensionKey]) {
        parentFilters.push({ dimension: rawDim as DimensionKey, value });
      }
    }
  });

  // Allow up to 500 for board view which needs all emails to show complete columns
  const maxLimit = parseInt(searchParams.get('limit') ?? '0', 10) > 200 ? 500 : 200;
  const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, maxLimit));
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);

  // Support per-category view mode overrides via query params.
  // When `dimension` is passed, force group mode (not leaf) even if currentLevel >= config levels.
  // When `leaf` is true, force leaf mode regardless of level.
  const rawDimension = searchParams.get('dimension');
  const overrideDimension = rawDimension && DIMENSIONS[rawDimension as DimensionKey] ? (rawDimension as DimensionKey) : null;
  const forceLeaf = searchParams.get('leaf') === 'true';
  const hasGroupOverride = !!overrideDimension;

  const isLeaf = forceLeaf || (!hasGroupOverride && currentLevel >= levels.length);

  if (isLeaf) {
    return handleLeafQuery(serviceClient, accountIds, parentFilters, config, limit, offset);
  }

  return handleGroupQuery(serviceClient, accountIds, levels, currentLevel, parentFilters, config, limit, offset, overrideDimension);
}

/**
 * Fetch emails, apply all filters, and group by the target dimension.
 * Uses Supabase query builder + JS-side grouping (no RPC function needed).
 */
async function handleGroupQuery(
  serviceClient: ReturnType<typeof createServiceClient>,
  accountIds: string[],
  levels: GroupingLevel[],
  currentLevel: number,
  parentFilters: { dimension: DimensionKey; value: string }[],
  config: Record<string, unknown>,
  limit: number,
  offset: number,
  overrideDimension?: DimensionKey | null,
) {
  // Allow per-category view mode overrides to specify a different grouping dimension
  const targetDimension = overrideDimension ?? levels[currentLevel].dimension;

  // Determine if we need category data (for grouping or filtering)
  const needsCategories =
    CATEGORY_DIMENSIONS.has(targetDimension) ||
    parentFilters.some((f) => CATEGORY_DIMENSIONS.has(f.dimension));

  // Fetch only the columns needed for grouping + filtering (minimize data transfer)
  // Always include gmail_account_id for account dimension support
  const selectFields = needsCategories
    ? 'id, gmail_account_id, sender_email, sender_domain, is_read, has_attachment, received_at, email_categories(*)'
    : 'id, gmail_account_id, sender_email, sender_domain, is_read, has_attachment, received_at';

  let query = serviceClient
    .from('emails')
    .select(selectFields)
    .in('gmail_account_id', accountIds)
    .contains('label_ids', ['INBOX']);

  // Apply date range from config
  if (config.date_range_start) {
    query = query.gte('received_at', config.date_range_start as string);
  }
  if (config.date_range_end) {
    query = query.lte('received_at', config.date_range_end as string);
  }

  // Apply email-table parent filters via query builder
  for (const filter of parentFilters) {
    if (!CATEGORY_DIMENSIONS.has(filter.dimension) && !DATE_DIMENSIONS.has(filter.dimension)) {
      const col = getEmailColumn(filter.dimension);
      if (col) {
        if (filter.dimension === 'is_read' || filter.dimension === 'has_attachment') {
          query = query.eq(col, filter.value === 'true');
        } else {
          query = query.eq(col, filter.value);
        }
      }
    }
  }

  const { data: rows, error } = await query;

  if (error) {
    console.error('[emails] Group query failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    console.log(`[emails] 0 rows for accounts=${accountIds.join(',')}, dimension=${targetDimension}`);
    return NextResponse.json({
      type: 'groups',
      dimension: targetDimension,
      level: currentLevel,
      data: [],
    });
  }

  // Apply JS-side filters for category and date dimensions
  type RowWithCat = Record<string, unknown> & {
    email_categories?: Record<string, unknown> | Record<string, unknown>[] | null;
  };
  let filtered = rows as unknown as RowWithCat[];

  // Diagnostic: log shape of embedded email_categories for category dimensions
  if (CATEGORY_DIMENSIONS.has(targetDimension) && filtered.length > 0) {
    const sample = filtered[0]?.email_categories;
    const withCat = filtered.filter((r) => getCategory(r.email_categories) != null).length;
    console.log(
      `[emails] rows=${filtered.length}, withCategories=${withCat}, ` +
      `dimension=${targetDimension}, sampleType=${typeof sample}, ` +
      `isArray=${Array.isArray(sample)}, sample=${JSON.stringify(sample)?.slice(0, 200)}`
    );
  }

  for (const filter of parentFilters) {
    if (CATEGORY_DIMENSIONS.has(filter.dimension)) {
      const col = CATEGORY_COLUMN_MAP[filter.dimension] ?? filter.dimension;
      filtered = filtered.filter((row) => {
        const cat = getCategory(row.email_categories);
        return cat != null && cat[col] === filter.value;
      });
    } else if (DATE_DIMENSIONS.has(filter.dimension)) {
      filtered = filtered.filter((row) => {
        const key = formatDateDimension(row.received_at as string, filter.dimension);
        return key === filter.value;
      });
    }
  }

  // For account dimension, build a lookup map of account_id -> display_name
  let accountDisplayNames: Map<string, string> | null = null;
  if (targetDimension === ACCOUNT_DIMENSION) {
    accountDisplayNames = new Map();
    const { data: accts } = await serviceClient
      .from('gmail_accounts')
      .select('id, display_name, email')
      .in('id', accountIds);
    for (const a of accts ?? []) {
      accountDisplayNames.set(a.id, a.display_name ?? a.email);
    }
  }

  // Group by target dimension
  const counts = new Map<string, number>();

  for (const row of filtered) {
    let key: string | null = null;

    if (targetDimension === ACCOUNT_DIMENSION) {
      const accountId = row.gmail_account_id as string;
      key = accountDisplayNames?.get(accountId) ?? accountId ?? null;
    } else if (CATEGORY_DIMENSIONS.has(targetDimension)) {
      const cat = getCategory(row.email_categories);
      const col = CATEGORY_COLUMN_MAP[targetDimension] ?? targetDimension;
      key = cat ? (cat[col] as string) ?? null : null;
    } else if (DATE_DIMENSIONS.has(targetDimension)) {
      key = formatDateDimension(row.received_at as string, targetDimension);
    } else {
      const col = getEmailColumn(targetDimension);
      if (col) {
        const val = row[col];
        key = val != null ? String(val) : null;
      }
    }

    if (key != null) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  // Sort by count descending, apply offset + limit
  const sorted = Array.from(counts.entries())
    .map(([group_key, count]) => ({ group_key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(offset, offset + limit);

  console.log(`[emails] Grouped ${filtered.length} rows into ${sorted.length} groups for dimension=${targetDimension}: ${sorted.map(g => `${g.group_key}(${g.count})`).join(', ')}`);

  return NextResponse.json({
    type: 'groups',
    dimension: targetDimension,
    level: currentLevel,
    data: sorted,
  });
}

/**
 * Fetch actual email rows at the leaf level (all grouping levels exhausted).
 */
async function handleLeafQuery(
  serviceClient: ReturnType<typeof createServiceClient>,
  accountIds: string[],
  parentFilters: { dimension: DimensionKey; value: string }[],
  config: Record<string, unknown>,
  limit: number,
  offset: number,
) {
  let query = serviceClient
    .from('emails')
    .select(`
      *,
      email_categories(*)
    `)
    .in('gmail_account_id', accountIds)
    .contains('label_ids', ['INBOX'])
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (config.date_range_start) {
    query = query.gte('received_at', config.date_range_start as string);
  }
  if (config.date_range_end) {
    query = query.lte('received_at', config.date_range_end as string);
  }

  // Apply email-table parent filters via query builder
  for (const filter of parentFilters) {
    if (!CATEGORY_DIMENSIONS.has(filter.dimension) && !DATE_DIMENSIONS.has(filter.dimension)) {
      const col = getEmailColumn(filter.dimension);
      if (col) {
        if (filter.dimension === 'is_read' || filter.dimension === 'has_attachment') {
          query = query.eq(col, filter.value === 'true');
        } else {
          query = query.eq(col, filter.value);
        }
      }
    }
  }

  const { data: rawData, error } = await query;

  if (error) {
    console.error('[emails] Leaf query failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type RowWithCat = Record<string, unknown> & {
    email_categories?: Record<string, unknown> | Record<string, unknown>[] | null;
  };
  let rows = (rawData ?? []) as unknown as RowWithCat[];

  // Apply JS-side filters for category/date dimensions
  for (const filter of parentFilters) {
    if (CATEGORY_DIMENSIONS.has(filter.dimension)) {
      const col = CATEGORY_COLUMN_MAP[filter.dimension] ?? filter.dimension;
      rows = rows.filter((row) => {
        const cat = getCategory(row.email_categories);
        return cat != null && cat[col] === filter.value;
      });
    } else if (DATE_DIMENSIONS.has(filter.dimension)) {
      rows = rows.filter((row) => {
        const key = formatDateDimension(row.received_at as string, filter.dimension);
        return key === filter.value;
      });
    }
  }

  // Flatten category data onto each email
  const emails = rows.map((e) => {
    const cat = getCategory(e.email_categories);
    return {
      ...e,
      category: (cat?.category as string) ?? null,
      topic: (cat?.topic as string) ?? null,
      priority: (cat?.priority as string) ?? null,
      importance_score: (cat?.importance_score as number) ?? null,
      importance_label: (cat?.importance_label as string) ?? null,
      confidence: (cat?.confidence as number) ?? null,
      email_categories: undefined,
    };
  });

  return NextResponse.json({ type: 'emails', data: emails });
}

// --- Helpers ---

/**
 * Normalize the embedded email_categories relationship.
 * PostgREST returns a single object (not array) for one-to-one relationships
 * (email_categories.email_id has a UNIQUE constraint), but may return an array
 * in older PostgREST versions. Handle both shapes.
 */
function getCategory(
  emailCategories: Record<string, unknown> | Record<string, unknown>[] | null | undefined,
): Record<string, unknown> | null {
  if (emailCategories == null) return null;
  if (Array.isArray(emailCategories)) return emailCategories[0] ?? null;
  return emailCategories;
}

function getEmailColumn(dimension: DimensionKey): string | null {
  const map: Partial<Record<DimensionKey, string>> = {
    sender: 'sender_email',
    sender_domain: 'sender_domain',
    is_read: 'is_read',
    has_attachment: 'has_attachment',
  };
  return map[dimension] ?? null;
}

function formatDateDimension(dateStr: string, dimension: DimensionKey): string | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;

  if (dimension === 'date_month') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  if (dimension === 'date_week') {
    // ISO 8601 week: the week containing the year's first Thursday
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    // Set to nearest Thursday (current day + 4 - current day number, Mon=1..Sun=7)
    const dayNum = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  return null;
}
