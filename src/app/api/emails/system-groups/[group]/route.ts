import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import type { SystemGroupKey } from '@/types';

type Params = { params: Promise<{ group: string }> };

const VALID_GROUPS: SystemGroupKey[] = ['starred', 'archived', 'trash'];

/**
 * GET /api/emails/system-groups/[group] — list emails in a system group.
 * Supports ?limit=N&offset=N for pagination and ?accountId=UUID for account filtering.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { group } = await params;

  if (!(VALID_GROUPS as string[]).includes(group)) {
    return NextResponse.json({ error: `Invalid group: ${group}` }, { status: 400 });
  }

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
    if (!allAccountIds.includes(accountIdParam)) {
      return NextResponse.json({ error: 'Account not found' }, { status: 403 });
    }
    accountIds = [accountIdParam];
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10) || 0, 0);

  let query = serviceClient
    .from('emails')
    .select('*, email_categories(*)')
    .in('gmail_account_id', accountIds)
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1);

  switch (group as SystemGroupKey) {
    case 'starred':
      query = query.eq('is_starred', true).contains('label_ids', ['INBOX']);
      break;
    case 'archived':
      query = query
        .not('label_ids', 'cs', '{"INBOX"}')
        .not('label_ids', 'cs', '{"TRASH"}');
      break;
    case 'trash':
      query = query.contains('label_ids', ['TRASH']);
      break;
  }

  const { data: emails, error } = await query;

  if (error) {
    console.error(`[system-groups] Query for ${group} failed:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    group,
    emails: emails ?? [],
    count: emails?.length ?? 0,
  });
}
