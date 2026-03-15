import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import type { ViewType } from '@/types';

const VALID_VIEW_TYPES: ViewType[] = ['list', 'board', 'tree'];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'View config not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    name,
    view_type,
    group_by,
    filters,
    sort,
    date_range_start,
    date_range_end,
    is_active,
    is_pinned,
    icon,
    color,
  } = body as Record<string, unknown>;

  if (view_type !== undefined && !VALID_VIEW_TYPES.includes(view_type as ViewType)) {
    return NextResponse.json(
      { error: `Invalid view_type. Must be one of: ${VALID_VIEW_TYPES.join(', ')}` },
      { status: 400 }
    );
  }

  const serviceClient = createServiceClient();

  // Verify ownership
  const { data: existing } = await serviceClient
    .from('view_configs')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'View config not found' }, { status: 404 });
  }

  // If setting as active, deactivate others
  if (is_active === true) {
    await serviceClient
      .from('view_configs')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .eq('is_active', true)
      .neq('id', id);
  }

  // Build update payload — only include provided fields
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) update.name = name;
  if (view_type !== undefined) update.view_type = view_type;
  if (group_by !== undefined) update.group_by = group_by;
  if (filters !== undefined) update.filters = filters;
  if (sort !== undefined) update.sort = sort;
  if (date_range_start !== undefined) update.date_range_start = date_range_start;
  if (date_range_end !== undefined) update.date_range_end = date_range_end;
  if (is_active !== undefined) update.is_active = is_active;
  if (is_pinned !== undefined) update.is_pinned = is_pinned;
  if (icon !== undefined) update.icon = icon;
  if (color !== undefined) update.color = color;

  const { data, error } = await serviceClient
    .from('view_configs')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  const { error } = await serviceClient
    .from('view_configs')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
