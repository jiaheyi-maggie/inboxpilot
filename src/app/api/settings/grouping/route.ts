import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import type { GroupingLevel, DimensionKey } from '@/types';
import { DIMENSIONS } from '@/lib/grouping/engine';

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
    .from('grouping_configs')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (error) {
    return NextResponse.json({ error: 'No config found' }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { levels, date_range_start, date_range_end } = body as {
    levels: GroupingLevel[];
    date_range_start?: string | null;
    date_range_end?: string | null;
  };

  // Validate levels
  if (!Array.isArray(levels) || levels.length === 0 || levels.length > 5) {
    return NextResponse.json(
      { error: 'Must have 1-5 grouping levels' },
      { status: 400 }
    );
  }

  const seen = new Set<DimensionKey>();
  for (const level of levels) {
    if (!DIMENSIONS[level.dimension]) {
      return NextResponse.json(
        { error: `Invalid dimension: ${level.dimension}` },
        { status: 400 }
      );
    }
    if (seen.has(level.dimension)) {
      return NextResponse.json(
        { error: `Duplicate dimension: ${level.dimension}` },
        { status: 400 }
      );
    }
    seen.add(level.dimension);
  }

  const serviceClient = createServiceClient();

  // Deactivate existing configs
  await serviceClient
    .from('grouping_configs')
    .update({ is_active: false })
    .eq('user_id', user.id)
    .eq('is_active', true);

  // Insert new config
  const { data, error } = await serviceClient
    .from('grouping_configs')
    .insert({
      user_id: user.id,
      levels,
      date_range_start: date_range_start ?? null,
      date_range_end: date_range_end ?? null,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
