import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/emails/unread — returns unread inbox emails.
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

  // Get user's Gmail accounts (multi-inbox)
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
    if (!allAccountIds.includes(accountIdParam)) {
      return NextResponse.json({ error: 'Account not found' }, { status: 403 });
    }
    accountIds = [accountIdParam];
  }

  // Fetch all unread inbox emails (exclude trashed/archived/snoozed)
  const { data: emails, error } = await serviceClient
    .from('emails')
    .select('*, email_categories(*)')
    .in('gmail_account_id', accountIds)
    .eq('is_read', false)
    .contains('label_ids', ['INBOX'])
    .is('snoozed_until', null)
    .order('received_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ emails: emails ?? [], count: emails?.length ?? 0 });
}
