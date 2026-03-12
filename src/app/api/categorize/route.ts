import { NextResponse, after } from 'next/server';
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

  // Explicit categorize action should always include unread emails —
  // this is called by the "Categorize All" button in the unread section
  const uncategorized = await getUncategorizedEmails(account.id, { includeUnread: true });

  if (uncategorized.length === 0) {
    return NextResponse.json({
      success: true,
      categorized: 0,
      message: 'All emails are already categorized',
    });
  }

  // Mark emails as pending
  const uncategorizedIds = uncategorized.map((e) => e.id);
  await serviceClient
    .from('emails')
    .update({ categorization_status: 'pending' })
    .in('id', uncategorizedIds);

  // Schedule background categorization
  after(async () => {
    try {
      console.log(`[categorize-bg] Starting background categorization of ${uncategorized.length} emails`);
      const result = await categorizeEmails(uncategorized);
      console.log(`[categorize-bg] Done: categorized=${result.categorized}, errors=${result.errors}`);
    } catch (err) {
      console.error('[categorize-bg] Background categorization failed:', err);
    }
  });

  return NextResponse.json({
    success: true,
    pending: uncategorized.length,
    message: `Categorizing ${uncategorized.length} emails in background`,
  });
}
