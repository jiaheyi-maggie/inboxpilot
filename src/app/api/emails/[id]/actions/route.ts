import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import {
  markAsRead,
  markAsUnread,
  trashEmail,
  archiveEmail,
  starEmail,
  unstarEmail,
} from '@/lib/gmail/client';
import { categorizeEmails } from '@/lib/ai/categorize';
import type { GmailAccount, EmailAction, Email } from '@/types';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: emailId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const action = body.action as EmailAction;

  const validActions: EmailAction[] = ['mark_read', 'mark_unread', 'trash', 'archive', 'star', 'unstar'];
  if (!action || !validActions.includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Get the email and verify ownership
  const { data: email, error: emailError } = await serviceClient
    .from('emails')
    .select('*, gmail_accounts!inner(user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, id, email, history_id, last_sync_at, sync_enabled, granted_scope, created_at)')
    .eq('id', emailId)
    .single();

  if (emailError || !email) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 });
  }

  const accountData = email.gmail_accounts as unknown as GmailAccount;
  if (accountData.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Check if user has gmail.modify scope for write operations
  if (accountData.granted_scope !== 'gmail.modify') {
    return NextResponse.json(
      { error: 'Gmail modify scope required. Please re-authenticate.' },
      { status: 403 }
    );
  }

  const gmailMessageId = email.gmail_message_id as string;

  try {
    switch (action) {
      case 'mark_read': {
        await markAsRead(accountData, gmailMessageId);
        const { error: readErr } = await serviceClient
          .from('emails')
          .update({ is_read: true })
          .eq('id', emailId);
        if (readErr) console.error('[email-action] DB update is_read failed:', readErr);

        // Only categorize if not already categorized
        let didCategorize = false;
        if (!email.is_categorized) {
          const emailForCat = { ...email, gmail_accounts: undefined } as unknown as Email;
          const catResult = await categorizeEmails([emailForCat]);
          didCategorize = catResult.categorized > 0;
        }

        return NextResponse.json({
          success: true,
          action: 'mark_read',
          categorized: didCategorize,
        });
      }

      case 'mark_unread': {
        await markAsUnread(accountData, gmailMessageId);
        const { error: unreadErr } = await serviceClient
          .from('emails')
          .update({ is_read: false })
          .eq('id', emailId);
        if (unreadErr) console.error('[email-action] DB update is_read failed:', unreadErr);
        return NextResponse.json({ success: true, action: 'mark_unread' });
      }

      case 'trash': {
        await trashEmail(accountData, gmailMessageId);
        const { error: trashErr } = await serviceClient
          .from('emails')
          .delete()
          .eq('id', emailId);
        if (trashErr) console.error('[email-action] DB delete failed:', trashErr);
        return NextResponse.json({ success: true, action: 'trash', deleted: true });
      }

      case 'archive': {
        await archiveEmail(accountData, gmailMessageId);
        const currentLabels = (email.label_ids as string[]) ?? [];
        const newLabels = currentLabels.filter((l: string) => l !== 'INBOX');
        const { error: archiveErr } = await serviceClient
          .from('emails')
          .update({ label_ids: newLabels })
          .eq('id', emailId);
        if (archiveErr) console.error('[email-action] DB update label_ids failed:', archiveErr);
        return NextResponse.json({ success: true, action: 'archive' });
      }

      case 'star': {
        await starEmail(accountData, gmailMessageId);
        const { error: starErr } = await serviceClient
          .from('emails')
          .update({ is_starred: true })
          .eq('id', emailId);
        if (starErr) console.error('[email-action] DB update is_starred failed:', starErr);
        return NextResponse.json({ success: true, action: 'star' });
      }

      case 'unstar': {
        await unstarEmail(accountData, gmailMessageId);
        const { error: unstarErr } = await serviceClient
          .from('emails')
          .update({ is_starred: false })
          .eq('id', emailId);
        if (unstarErr) console.error('[email-action] DB update is_starred failed:', unstarErr);
        return NextResponse.json({ success: true, action: 'unstar' });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error(`[email-action] ${action} failed for ${emailId}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Action failed' },
      { status: 500 }
    );
  }
}
