import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import {
  markAsRead,
  markAsUnread,
  trashEmail,
  untrashEmail,
  archiveEmail,
  starEmail,
  unstarEmail,
} from '@/lib/gmail/client';
import { categorizeEmails } from '@/lib/ai/categorize';
import { buildActionResult } from '@/lib/email-utils';
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

  const validActions: EmailAction[] = ['mark_read', 'mark_unread', 'trash', 'archive', 'star', 'unstar', 'restore'];
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
        // 1. Mark as read in Gmail + DB immediately
        await markAsRead(accountData, gmailMessageId);
        const updateFields: Record<string, unknown> = { is_read: true };

        // 2. If not yet categorized, set status to pending and defer categorization
        const needsCategorization = !email.is_categorized;
        if (needsCategorization) {
          updateFields.categorization_status = 'pending';
        }

        const { error: readErr } = await serviceClient
          .from('emails')
          .update(updateFields)
          .eq('id', emailId);
        if (readErr) console.error('[email-action] DB update failed:', readErr);

        // 3. If already categorized, return the existing category
        let assignedCategory: string | null = null;
        if (!needsCategorization) {
          const { data: catRow } = await serviceClient
            .from('email_categories')
            .select('category')
            .eq('email_id', emailId)
            .single();
          assignedCategory = catRow?.category ?? null;
        }

        // 4. Schedule background categorization + workflow execution via after()
        if (needsCategorization) {
          const accountForWorkflows = accountData;

          after(async () => {
            try {
              const bgServiceClient = createServiceClient();
              const emailForCat = { ...email, gmail_accounts: undefined } as unknown as Email;
              const catResult = await categorizeEmails([emailForCat], user.id);

              if (catResult.categorized > 0) {
                await bgServiceClient
                  .from('emails')
                  .update({ categorization_status: 'done' })
                  .eq('id', emailId);

                // Fire email_categorized workflows for this newly categorized email
                try {
                  const { runWorkflowsForEmail } = await import('@/lib/workflows/runner');
                  const { data: catEmail } = await bgServiceClient
                    .from('emails')
                    .select('*, email_categories(*)')
                    .eq('id', emailId)
                    .single();

                  if (catEmail) {
                    const cat = (catEmail as Record<string, unknown>).email_categories;
                    const catObj = Array.isArray(cat) ? cat[0] : cat;
                    const emailWithCat = {
                      ...catEmail,
                      email_categories: undefined,
                      category: (catObj as Record<string, unknown>)?.category as string ?? null,
                      topic: (catObj as Record<string, unknown>)?.topic as string ?? null,
                      priority: (catObj as Record<string, unknown>)?.priority as string ?? null,
                      confidence: (catObj as Record<string, unknown>)?.confidence as number ?? null,
                      importance_score: (catObj as Record<string, unknown>)?.importance_score as number ?? null,
                      importance_label: (catObj as Record<string, unknown>)?.importance_label as string ?? null,
                    };
                    await runWorkflowsForEmail(emailWithCat, 'email_categorized', accountForWorkflows);
                  }
                } catch (wfErr) {
                  console.error(`[email-action] email_categorized workflow failed for ${emailId}:`, wfErr);
                }
              } else {
                console.error(`[email-action] Background categorization returned 0 for ${emailId}`);
                await bgServiceClient
                  .from('emails')
                  .update({ categorization_status: 'failed' })
                  .eq('id', emailId);
              }
            } catch (err) {
              console.error(`[email-action] Background categorization failed for ${emailId}:`, err);
              const bgServiceClient = createServiceClient();
              await bgServiceClient
                .from('emails')
                .update({ categorization_status: 'failed' })
                .eq('id', emailId)
                .then(() => {});
            }
          });
        }

        return NextResponse.json({
          success: true,
          action: 'mark_read',
          categorization_status: needsCategorization ? 'pending' : 'done',
          category: assignedCategory,
        });
      }

      case 'mark_unread': {
        await markAsUnread(accountData, gmailMessageId);
        const { error: unreadErr } = await serviceClient
          .from('emails')
          .update({ is_read: false })
          .eq('id', emailId);
        if (unreadErr) console.error('[email-action] DB update is_read failed:', unreadErr);
        const unreadRes = buildActionResult('mark_unread', { affected: 1, failed: 0 }, unreadErr?.message ?? null);
        return NextResponse.json(unreadRes.body, { status: unreadRes.status });
      }

      case 'trash': {
        await trashEmail(accountData, gmailMessageId);
        const currentLabelsForTrash = (email.label_ids as string[]) ?? [];
        const trashLabels = currentLabelsForTrash.filter((l: string) => l !== 'INBOX');
        if (!trashLabels.includes('TRASH')) trashLabels.push('TRASH');
        const { error: trashErr } = await serviceClient
          .from('emails')
          .update({ label_ids: trashLabels })
          .eq('id', emailId);
        if (trashErr) console.error('[email-action] DB update label_ids for trash failed:', trashErr);
        const trashRes = buildActionResult('trash', { affected: 1, failed: 0 }, trashErr?.message ?? null);
        return NextResponse.json(trashRes.body, { status: trashRes.status });
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
        const archiveRes = buildActionResult('archive', { affected: 1, failed: 0 }, archiveErr?.message ?? null);
        return NextResponse.json(archiveRes.body, { status: archiveRes.status });
      }

      case 'star': {
        await starEmail(accountData, gmailMessageId);
        const { error: starErr } = await serviceClient
          .from('emails')
          .update({ is_starred: true })
          .eq('id', emailId);
        if (starErr) console.error('[email-action] DB update is_starred failed:', starErr);
        const starRes = buildActionResult('star', { affected: 1, failed: 0 }, starErr?.message ?? null);
        return NextResponse.json(starRes.body, { status: starRes.status });
      }

      case 'unstar': {
        await unstarEmail(accountData, gmailMessageId);
        const { error: unstarErr } = await serviceClient
          .from('emails')
          .update({ is_starred: false })
          .eq('id', emailId);
        if (unstarErr) console.error('[email-action] DB update is_starred failed:', unstarErr);
        const unstarRes = buildActionResult('unstar', { affected: 1, failed: 0 }, unstarErr?.message ?? null);
        return NextResponse.json(unstarRes.body, { status: unstarRes.status });
      }

      case 'restore': {
        await untrashEmail(accountData, gmailMessageId);
        const currentLabelsForRestore = (email.label_ids as string[]) ?? [];
        const restoreLabels = currentLabelsForRestore.filter((l: string) => l !== 'TRASH');
        if (!restoreLabels.includes('INBOX')) restoreLabels.push('INBOX');
        const { error: restoreErr } = await serviceClient
          .from('emails')
          .update({ label_ids: restoreLabels })
          .eq('id', emailId);
        if (restoreErr) console.error('[email-action] DB update label_ids for restore failed:', restoreErr);
        const restoreRes = buildActionResult('restore', { affected: 1, failed: 0 }, restoreErr?.message ?? null);
        return NextResponse.json(restoreRes.body, { status: restoreRes.status });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error(`[email-action] ${action} failed for ${emailId}:`, err);
    return NextResponse.json(
      { error: 'Action failed' },
      { status: 500 }
    );
  }
}
