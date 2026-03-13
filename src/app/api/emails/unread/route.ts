import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Get user's Gmail account
  const { data: account } = await serviceClient
    .from('gmail_accounts')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (!account) {
    return NextResponse.json({ error: 'No Gmail account' }, { status: 404 });
  }

  // Fetch all unread inbox emails (exclude trashed/archived)
  const { data: emails, error } = await serviceClient
    .from('emails')
    .select('*, email_categories(category)')
    .eq('gmail_account_id', account.id)
    .eq('is_read', false)
    .contains('label_ids', ['INBOX'])
    .order('received_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ emails: emails ?? [], count: emails?.length ?? 0 });
}
