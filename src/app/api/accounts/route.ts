import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/accounts — returns the authenticated user's connected Gmail accounts.
 * Used by: settings account manager, workflow condition dropdown.
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

  const { data: accounts, error } = await serviceClient
    .from('gmail_accounts')
    .select('id, email, display_name, color, sync_enabled, last_sync_at, granted_scope')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[accounts] Failed to fetch accounts:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ accounts: accounts ?? [] });
}
