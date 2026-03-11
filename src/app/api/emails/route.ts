import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { DIMENSIONS } from '@/lib/grouping/engine';
import type { DimensionKey, GroupingLevel } from '@/types';

// --- Category-table dimensions that live on the email_categories join ---
const CATEGORY_DIMENSIONS = new Set<DimensionKey>(['category', 'topic', 'priority']);

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

  // Get user's active grouping config
  const configId = searchParams.get('configId');
  let configQuery = serviceClient
    .from('grouping_configs')
    .select('*')
    .eq('user_id', user.id);

  if (configId) {
    configQuery = configQuery.eq('id', configId);
  } else {
    configQuery = configQuery.eq('is_active', true);
  }

  const { data: config } = await configQuery.limit(1).single();
  if (!config) {
    return NextResponse.json({ error: 'No grouping config' }, { status: 404 });
  }

  // Get user's Gmail account
  const { data: account } = await serviceClient
    .from('gmail_accounts')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (!account) {
    return NextResponse.json({ error: 'No Gmail account' }, { status: 404 });
  }

  const levels = config.levels as GroupingLevel[];
  const currentLevel = parseInt(searchParams.get('level') ?? '0', 10);

  // Parse parent filters: filter.category=Work&filter.sender_domain=google.com
  const parentFilters: { dimension: DimensionKey; value: string }[] = [];
  searchParams.forEach((value, key) => {
    if (key.startsWith('filter.')) {
      const dimension = key.replace('filter.', '') as DimensionKey;
      if (DIMENSIONS[dimension]) {
        parentFilters.push({ dimension, value });
      }
    }
  });

  const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200));
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);

  const isLeaf = currentLevel >= levels.length;

  if (isLeaf) {
    return handleLeafQuery(serviceClient, account.id, parentFilters, config, limit, offset);
  }

  return handleGroupQuery(serviceClient, account.id, levels, currentLevel, parentFilters, config, limit, offset);
}

/**
 * Fetch emails, apply all filters, and group by the target dimension.
 * Uses Supabase query builder + JS-side grouping (no RPC function needed).
 */
async function handleGroupQuery(
  serviceClient: ReturnType<typeof createServiceClient>,
  gmailAccountId: string,
  levels: GroupingLevel[],
  currentLevel: number,
  parentFilters: { dimension: DimensionKey; value: string }[],
  config: Record<string, unknown>,
  limit: number,
  offset: number,
) {
  const targetDimension = levels[currentLevel].dimension;

  // Determine if we need category data (for grouping or filtering)
  const needsCategories =
    CATEGORY_DIMENSIONS.has(targetDimension) ||
    parentFilters.some((f) => CATEGORY_DIMENSIONS.has(f.dimension));

  // Fetch only the columns needed for grouping + filtering (minimize data transfer)
  const selectFields = needsCategories
    ? 'id, sender_email, sender_domain, is_read, has_attachment, received_at, email_categories(category, topic, priority)'
    : 'id, sender_email, sender_domain, is_read, has_attachment, received_at';

  let query = serviceClient
    .from('emails')
    .select(selectFields)
    .eq('gmail_account_id', gmailAccountId);

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
    return NextResponse.json({
      type: 'groups',
      dimension: targetDimension,
      level: currentLevel,
      data: [],
    });
  }

  // Apply JS-side filters for category and date dimensions
  type RowWithCat = Record<string, unknown> & {
    email_categories?: Record<string, unknown>[] | null;
  };
  let filtered = rows as unknown as RowWithCat[];

  for (const filter of parentFilters) {
    if (CATEGORY_DIMENSIONS.has(filter.dimension)) {
      filtered = filtered.filter((row) => {
        const cat = Array.isArray(row.email_categories) ? row.email_categories[0] : null;
        return cat != null && cat[filter.dimension] === filter.value;
      });
    } else if (DATE_DIMENSIONS.has(filter.dimension)) {
      filtered = filtered.filter((row) => {
        const key = formatDateDimension(row.received_at as string, filter.dimension);
        return key === filter.value;
      });
    }
  }

  // Group by target dimension
  const counts = new Map<string, number>();

  for (const row of filtered) {
    let key: string | null = null;

    if (CATEGORY_DIMENSIONS.has(targetDimension)) {
      const cat = Array.isArray(row.email_categories) ? row.email_categories[0] : null;
      key = cat ? (cat[targetDimension] as string) ?? null : null;
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
  gmailAccountId: string,
  parentFilters: { dimension: DimensionKey; value: string }[],
  config: Record<string, unknown>,
  limit: number,
  offset: number,
) {
  let query = serviceClient
    .from('emails')
    .select(`
      *,
      email_categories(category, topic, priority, confidence)
    `)
    .eq('gmail_account_id', gmailAccountId)
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
    email_categories?: Record<string, unknown>[] | null;
  };
  let rows = (rawData ?? []) as unknown as RowWithCat[];

  // Apply JS-side filters for category/date dimensions
  for (const filter of parentFilters) {
    if (CATEGORY_DIMENSIONS.has(filter.dimension)) {
      rows = rows.filter((row) => {
        const cat = Array.isArray(row.email_categories) ? row.email_categories[0] : null;
        return cat != null && cat[filter.dimension] === filter.value;
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
    const cat = Array.isArray(e.email_categories) ? e.email_categories[0] : null;
    return {
      ...e,
      category: (cat?.category as string) ?? null,
      topic: (cat?.topic as string) ?? null,
      priority: (cat?.priority as string) ?? null,
      confidence: (cat?.confidence as number) ?? null,
      email_categories: undefined,
    };
  });

  return NextResponse.json({ type: 'emails', data: emails });
}

// --- Helpers ---

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
