import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

/** Preset colors for account color picker. */
const VALID_COLORS = [
  '#3B82F6', // blue
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
  '#84CC16', // lime
  '#6366F1', // indigo
];

/**
 * PUT /api/accounts/[id] — update display_name and/or color for a Gmail account.
 * Only the account owner can update.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Verify the account belongs to this user
  const { data: account } = await serviceClient
    .from('gmail_accounts')
    .select('id, user_id')
    .eq('id', id)
    .single();

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  if (account.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Parse and validate the update payload
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};

  if (typeof body.display_name === 'string') {
    const trimmed = body.display_name.trim();
    if (trimmed.length > 50) {
      return NextResponse.json({ error: 'Display name must be 50 characters or less' }, { status: 400 });
    }
    updates.display_name = trimmed || null; // empty string → null in DB
  }

  if (typeof body.color === 'string') {
    if (!VALID_COLORS.includes(body.color)) {
      return NextResponse.json({ error: 'Invalid color' }, { status: 400 });
    }
    updates.color = body.color;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data: updated, error } = await serviceClient
    .from('gmail_accounts')
    .update(updates)
    .eq('id', id)
    .select('id, email, display_name, color, sync_enabled, last_sync_at, granted_scope')
    .single();

  if (error) {
    console.error('[accounts] Failed to update account:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ account: updated });
}
