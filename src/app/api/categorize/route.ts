import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { categorizeEmails, getUncategorizedEmails } from '@/lib/ai/categorize';

export async function POST() {
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
    return NextResponse.json(
      { error: 'No Gmail account linked' },
      { status: 404 }
    );
  }

  const uncategorized = await getUncategorizedEmails(account.id);

  if (uncategorized.length === 0) {
    return NextResponse.json({
      success: true,
      categorized: 0,
      message: 'All emails are already categorized',
    });
  }

  const result = await categorizeEmails(uncategorized);

  return NextResponse.json({
    success: true,
    categorized: result.categorized,
    errors: result.errors,
  });
}
