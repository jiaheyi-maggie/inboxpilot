import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';

/**
 * PUT /api/categories/[id] — Update a category.
 */
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
  const { name, description, color, sort_order } = body as {
    name?: string;
    description?: string;
    color?: string | null;
    sort_order?: number;
  };

  const serviceClient = createServiceClient();

  // Verify ownership
  const { data: existing } = await serviceClient
    .from('user_categories')
    .select('user_id')
    .eq('id', id)
    .single();

  if (!existing || existing.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) {
    const trimmed = name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    }
    if (trimmed.length > 50) {
      return NextResponse.json({ error: 'Name too long (max 50 characters)' }, { status: 400 });
    }
    updates.name = trimmed;
  }
  if (description !== undefined) {
    const trimmed = description?.trim() || null;
    if (trimmed && trimmed.length > 200) {
      return NextResponse.json({ error: 'Description too long (max 200 characters)' }, { status: 400 });
    }
    updates.description = trimmed;
  }
  if (color !== undefined) updates.color = color;
  if (sort_order !== undefined) updates.sort_order = sort_order;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
  }

  const { data: category, error } = await serviceClient
    .from('user_categories')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Category name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }

  return NextResponse.json({ category });
}

/**
 * DELETE /api/categories/[id] — Delete a category.
 */
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

  // Verify ownership
  const { data: existing } = await serviceClient
    .from('user_categories')
    .select('user_id')
    .eq('id', id)
    .single();

  if (!existing || existing.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { error } = await serviceClient
    .from('user_categories')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
