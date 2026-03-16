import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';

/**
 * PUT /api/categories/reorder — Batch-update sort_order for user's categories.
 *
 * Body: { order: string[] } — array of category IDs in desired display order.
 * Sets sort_order = index (0, 1, 2, ...) for each category.
 *
 * Validates:
 *  - User is authenticated
 *  - All IDs belong to the authenticated user
 *  - At least one ID provided
 */
export async function PUT(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { order } = body as { order?: string[] };

  if (!Array.isArray(order) || order.length === 0) {
    return NextResponse.json(
      { error: 'order must be a non-empty array of category IDs' },
      { status: 400 },
    );
  }

  // Validate all entries are non-empty strings (UUIDs)
  if (order.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
    return NextResponse.json(
      { error: 'Each element in order must be a non-empty string' },
      { status: 400 },
    );
  }

  const serviceClient = createServiceClient();

  // Verify all IDs belong to this user in a single query
  const { data: owned, error: fetchError } = await serviceClient
    .from('user_categories')
    .select('id')
    .eq('user_id', user.id)
    .in('id', order);

  if (fetchError) {
    console.error('[categories/reorder] Failed to verify ownership:', fetchError);
    return NextResponse.json({ error: 'Failed to verify categories' }, { status: 500 });
  }

  const ownedIds = new Set((owned ?? []).map((c) => c.id));
  const unauthorized = order.filter((id) => !ownedIds.has(id));
  if (unauthorized.length > 0) {
    return NextResponse.json(
      { error: `Categories not found or not owned: ${unauthorized.join(', ')}` },
      { status: 404 },
    );
  }

  // Batch update: set sort_order = index for each category.
  // Supabase doesn't support batch-update-by-PK in a single call,
  // so we use Promise.allSettled for per-item error isolation.
  const results = await Promise.allSettled(
    order.map((id, index) =>
      serviceClient
        .from('user_categories')
        .update({ sort_order: index })
        .eq('id', id)
        .eq('user_id', user.id),
    ),
  );

  const failures = results.filter((r) => r.status === 'rejected');
  const dbErrors = results.filter(
    (r) => r.status === 'fulfilled' && r.value.error,
  );

  if (failures.length > 0 || dbErrors.length > 0) {
    console.error(
      '[categories/reorder] Partial failure:',
      failures.length,
      'rejected,',
      dbErrors.length,
      'db errors',
    );
    return NextResponse.json(
      { error: 'Some categories failed to update', updated: order.length - failures.length - dbErrors.length },
      { status: 207 },
    );
  }

  return NextResponse.json({ success: true, updated: order.length });
}
