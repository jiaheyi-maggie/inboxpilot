import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { buildGroupQuery, buildLeafQuery, DIMENSIONS } from '@/lib/grouping/engine';
import type { DimensionKey, GroupingLevel } from '@/types';

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

  // Parse parent filters from query params: filter.category=Work&filter.sender_domain=google.com
  const parentFilters: { dimension: DimensionKey; value: string }[] = [];
  searchParams.forEach((value, key) => {
    if (key.startsWith('filter.')) {
      const dimension = key.replace('filter.', '') as DimensionKey;
      if (DIMENSIONS[dimension]) {
        parentFilters.push({ dimension, value });
      }
    }
  });

  const limit = parseInt(searchParams.get('limit') ?? '50', 10);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  // If we've exhausted all grouping levels, return actual emails
  const isLeaf = currentLevel >= levels.length;

  if (isLeaf) {
    const { sql, params } = buildLeafQuery({
      gmailAccountId: account.id,
      parentFilters,
      dateRangeStart: config.date_range_start,
      dateRangeEnd: config.date_range_end,
      limit,
      offset,
    });

    const { data, error } = await serviceClient.rpc('execute_query', {
      query_text: sql,
      query_params: params,
    });

    if (error) {
      // Fallback: use Supabase query builder for leaf level
      let query = serviceClient
        .from('emails')
        .select(`
          *,
          email_categories(category, topic, priority, confidence)
        `)
        .eq('gmail_account_id', account.id)
        .order('received_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (config.date_range_start) {
        query = query.gte('received_at', config.date_range_start);
      }
      if (config.date_range_end) {
        query = query.lte('received_at', config.date_range_end);
      }

      // Apply parent filters using query builder where possible
      for (const filter of parentFilters) {
        if (filter.dimension === 'sender') {
          query = query.eq('sender_email', filter.value);
        } else if (filter.dimension === 'sender_domain') {
          query = query.eq('sender_domain', filter.value);
        } else if (filter.dimension === 'is_read') {
          query = query.eq('is_read', filter.value === 'true');
        } else if (filter.dimension === 'has_attachment') {
          query = query.eq('has_attachment', filter.value === 'true');
        }
      }

      const { data: fallbackData, error: fallbackError } = await query;
      if (fallbackError) {
        return NextResponse.json({ error: fallbackError.message }, { status: 500 });
      }

      const emails = (fallbackData ?? []).map((e: Record<string, unknown>) => {
        const cat = (e.email_categories as Record<string, unknown>[] | null)?.[0];
        return {
          ...e,
          category: cat?.category ?? null,
          topic: cat?.topic ?? null,
          priority: cat?.priority ?? null,
          confidence: cat?.confidence ?? null,
          email_categories: undefined,
        };
      });

      return NextResponse.json({ type: 'emails', data: emails });
    }

    return NextResponse.json({ type: 'emails', data: data ?? [] });
  }

  // Build group query for current level
  const { sql, params } = buildGroupQuery({
    gmailAccountId: account.id,
    levels,
    currentLevel,
    parentFilters,
    dateRangeStart: config.date_range_start,
    dateRangeEnd: config.date_range_end,
    limit,
    offset,
  });

  const { data, error } = await serviceClient.rpc('execute_query', {
    query_text: sql,
    query_params: params,
  });

  if (error) {
    // Fallback: use a simpler approach with Supabase query builder
    // For category/topic grouping, we need the join, so use raw approach
    console.error('RPC query failed, using fallback:', error);

    // Simple fallback for common dimensions
    const dimension = levels[currentLevel].dimension;
    let fallbackData: { group_key: string; count: number }[] = [];

    if (['sender_email', 'sender', 'sender_domain'].includes(dimension)) {
      const col = dimension === 'sender' ? 'sender_email' : dimension;
      let query = serviceClient
        .from('emails')
        .select(col)
        .eq('gmail_account_id', account.id);

      if (config.date_range_start) {
        query = query.gte('received_at', config.date_range_start);
      }
      if (config.date_range_end) {
        query = query.lte('received_at', config.date_range_end);
      }

      const { data: rawData } = await query;
      if (rawData) {
        const counts = new Map<string, number>();
        for (const row of rawData) {
          const key = (row as Record<string, string>)[col] ?? 'Unknown';
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        fallbackData = Array.from(counts.entries())
          .map(([group_key, count]) => ({ group_key, count }))
          .sort((a, b) => b.count - a.count)
          .slice(offset, offset + limit);
      }
    }

    return NextResponse.json({
      type: 'groups',
      dimension: levels[currentLevel].dimension,
      level: currentLevel,
      data: fallbackData,
    });
  }

  return NextResponse.json({
    type: 'groups',
    dimension: levels[currentLevel].dimension,
    level: currentLevel,
    data: data ?? [],
  });
}
