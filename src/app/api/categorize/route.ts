import { NextRequest, NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { categorizeEmails, getUncategorizedEmails } from '@/lib/ai/categorize';
import { markAsReadBulk } from '@/lib/gmail/client';
import type { GmailAccount } from '@/types';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse optional body — markRead: true means also mark unread emails as read (used by "Categorize All" in Unread section)
  let markRead = false;
  try {
    const body = await request.json();
    markRead = body?.markRead === true;
  } catch {
    // No body or invalid JSON — that's fine, defaults to markRead=false
  }

  const serviceClient = createServiceClient();

  const { data: account } = await serviceClient
    .from('gmail_accounts')
    .select('*')
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

  // If markRead requested, mark all unread emails as read in Gmail + DB
  const unreadEmails = markRead ? uncategorized.filter((e) => !e.is_read) : [];
  if (unreadEmails.length > 0) {
    const gmailMessageIds = unreadEmails.map((e) => e.gmail_message_id);
    const emailIds = unreadEmails.map((e) => e.id);

    // Update DB immediately so UI reflects the change
    await serviceClient
      .from('emails')
      .update({ is_read: true })
      .in('id', emailIds);

    // Mark as read in Gmail in background (non-blocking)
    after(async () => {
      try {
        const result = await markAsReadBulk(account as GmailAccount, gmailMessageIds);
        if (result.failed > 0) {
          console.warn(`[categorize] markAsReadBulk: ${result.failed}/${gmailMessageIds.length} failed`);
        }
      } catch (err) {
        console.error('[categorize] markAsReadBulk failed:', err);
      }
    });
  }

  // Mark emails as pending categorization
  const uncategorizedIds = uncategorized.map((e) => e.id);
  await serviceClient
    .from('emails')
    .update({ categorization_status: 'pending' })
    .in('id', uncategorizedIds);

  // Schedule background categorization
  after(async () => {
    try {
      console.log(`[categorize-bg] Starting background categorization of ${uncategorized.length} emails`);
      const result = await categorizeEmails(uncategorized, user.id);
      console.log(`[categorize-bg] Done: categorized=${result.categorized}, errors=${result.errors}`);
    } catch (err) {
      console.error('[categorize-bg] Background categorization failed:', err);
    }
  });

  return NextResponse.json({
    success: true,
    pending: uncategorized.length,
    markedRead: unreadEmails.length,
    message: `Categorizing ${uncategorized.length} emails in background`,
  });
}
