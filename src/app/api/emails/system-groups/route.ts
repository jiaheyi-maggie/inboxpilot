import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/emails/system-groups — returns counts for starred, archived, and trash.
 * These are system-level groups independent of AI categorization.
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

  const { data: account } = await serviceClient
    .from('gmail_accounts')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (!account) {
    return NextResponse.json({ error: 'No Gmail account' }, { status: 404 });
  }

  // Run all three counts in parallel
  const [starredRes, archivedRes, trashRes] = await Promise.all([
    serviceClient
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('gmail_account_id', account.id)
      .eq('is_starred', true)
      .contains('label_ids', ['INBOX']),
    serviceClient
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('gmail_account_id', account.id)
      .not('label_ids', 'cs', '{"INBOX"}')
      .not('label_ids', 'cs', '{"TRASH"}'),
    serviceClient
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('gmail_account_id', account.id)
      .contains('label_ids', ['TRASH']),
  ]);

  return NextResponse.json({
    groups: {
      starred: starredRes.count ?? 0,
      archived: archivedRes.count ?? 0,
      trash: trashRes.count ?? 0,
    },
  });
}
