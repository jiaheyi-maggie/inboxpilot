import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { CATEGORIES } from '@/types';

/**
 * GET /api/categories — Fetch user's categories.
 * Seeds defaults on first access.
 */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Fetch existing categories
  const { data: existing, error } = await serviceClient
    .from('user_categories')
    .select('*')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }

  // Seed defaults if user has no categories
  if (!existing || existing.length === 0) {
    const defaults = CATEGORIES.map((name, i) => ({
      user_id: user.id,
      name,
      description: null,
      color: null,
      sort_order: i,
      is_default: true,
    }));

    const { data: seeded, error: seedError } = await serviceClient
      .from('user_categories')
      .insert(defaults)
      .select('*');

    if (seedError) {
      console.error('[categories] Failed to seed defaults:', seedError);
      // Return the hardcoded defaults as a fallback
      return NextResponse.json({
        categories: CATEGORIES.map((name, i) => ({
          id: `default-${i}`,
          user_id: user.id,
          name,
          description: null,
          color: null,
          sort_order: i,
          is_default: true,
          created_at: new Date().toISOString(),
        })),
      });
    }

    return NextResponse.json({ categories: seeded });
  }

  return NextResponse.json({ categories: existing });
}

/**
 * POST /api/categories — Create a new custom category.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { name, description, color } = body as {
    name?: string;
    description?: string;
    color?: string;
  };

  if (!name || name.trim().length === 0) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Get the next sort order
  const { data: existing } = await serviceClient
    .from('user_categories')
    .select('sort_order')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { data: category, error } = await serviceClient
    .from('user_categories')
    .insert({
      user_id: user.id,
      name: name.trim(),
      description: description?.trim() || null,
      color: color || null,
      sort_order: nextOrder,
      is_default: false,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Category already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }

  return NextResponse.json({ category }, { status: 201 });
}
