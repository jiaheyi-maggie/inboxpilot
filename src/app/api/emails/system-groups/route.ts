import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/emails/system-groups — returns counts for starred, archived, and trash.
 * Accepts optional ?accountId=UUID to filter to a specific account.
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  const { data: accounts } = await serviceClient
    .from('gmail_accounts')
    .select('id')
    .eq('user_id', user.id);

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ error: 'No Gmail account' }, { status: 404 });
  }

  const allAccountIds = accounts.map((a) => a.id);

  // Optional: filter to a specific account
  const accountIdParam = request.nextUrl.searchParams.get('accountId');
  let accountIds = allAccountIds;

  if (accountIdParam) {
    // Validate the accountId belongs to this user
    if (!allAccountIds.includes(accountIdParam)) {
      return NextResponse.json({ error: 'Account not found' }, { status: 403 });
    }
    accountIds = [accountIdParam];
  }

  // Run all four counts in parallel
  const [starredRes, archivedRes, trashRes, snoozedRes] = await Promise.all([
    serviceClient
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .in('gmail_account_id', accountIds)
      .eq('is_starred', true)
      .contains('label_ids', ['INBOX']),
    serviceClient
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .in('gmail_account_id', accountIds)
      .not('label_ids', 'cs', '{"INBOX"}')
      .not('label_ids', 'cs', '{"TRASH"}')
      .is('snoozed_until', null),
    serviceClient
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .in('gmail_account_id', accountIds)
      .contains('label_ids', ['TRASH']),
    serviceClient
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .in('gmail_account_id', accountIds)
      .not('snoozed_until', 'is', null),
  ]);

  if (starredRes.error || archivedRes.error || trashRes.error || snoozedRes.error) {
    console.error('[system-groups] Count query failed:', {
      starred: starredRes.error,
      archived: archivedRes.error,
      trash: trashRes.error,
      snoozed: snoozedRes.error,
    });
    return NextResponse.json({ error: 'Failed to fetch counts' }, { status: 500 });
  }

  return NextResponse.json({
    groups: {
      starred: starredRes.count ?? 0,
      archived: archivedRes.count ?? 0,
      trash: trashRes.count ?? 0,
      snoozed: snoozedRes.count ?? 0,
    },
  });
}
