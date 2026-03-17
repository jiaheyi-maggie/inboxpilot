import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import type { ViewType, ViewFilter, ViewSort, GroupingLevel } from '@/types';

const VALID_VIEW_TYPES: ViewType[] = ['list', 'board', 'tree', 'focus'];

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('view_configs')
    .select('*')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    name = 'Default',
    view_type = 'list',
    group_by = [],
    filters = [],
    sort = [{ field: 'received_at', direction: 'desc' }],
    date_range_start = null,
    date_range_end = null,
    is_active = true,
  } = body as {
    name?: string;
    view_type?: ViewType;
    group_by?: GroupingLevel[];
    filters?: ViewFilter[];
    sort?: ViewSort[];
    date_range_start?: string | null;
    date_range_end?: string | null;
    is_active?: boolean;
  };

  if (!VALID_VIEW_TYPES.includes(view_type)) {
    return NextResponse.json(
      { error: `Invalid view_type. Must be one of: ${VALID_VIEW_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  const serviceClient = createServiceClient();

  // If setting as active, deactivate existing active configs
  if (is_active) {
    await serviceClient
      .from('view_configs')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .eq('is_active', true);
  }

  const { data, error } = await serviceClient
    .from('view_configs')
    .insert({
      user_id: user.id,
      name,
      view_type,
      group_by,
      filters,
      sort,
      date_range_start,
      date_range_end,
      is_active,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
