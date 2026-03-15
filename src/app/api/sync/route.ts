import { NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { syncEmails } from '@/lib/gmail/sync';
import { categorizeEmails, getUncategorizedEmails } from '@/lib/ai/categorize';
import type { GmailAccount } from '@/types';

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Get user's Gmail account
  const { data: account, error: accountError } = await serviceClient
    .from('gmail_accounts')
    .select('*')
    .eq('user_id', user.id)
    .eq('sync_enabled', true)
    .limit(1)
    .single();

  if (accountError || !account) {
    return NextResponse.json(
      { error: 'No Gmail account linked' },
      { status: 404 }
    );
  }

  const gmailAccount = account as GmailAccount;

  // Check if the account has sufficient Gmail scopes
  if (!gmailAccount.granted_scope || gmailAccount.granted_scope === 'none') {
    return NextResponse.json(
      {
        error: 'Gmail permissions not granted',
        details: 'Please sign out and sign in again to grant Gmail access.',
        needsReauth: true,
      },
      { status: 403 }
    );
  }

  // Create sync job
  const { data: job } = await serviceClient
    .from('sync_jobs')
    .insert({
      gmail_account_id: gmailAccount.id,
      status: 'running',
    })
    .select()
    .single();

  try {
    console.log(`[sync-api] Starting sync for ${gmailAccount.email}`);
    const syncResult = await syncEmails(gmailAccount);
    console.log(`[sync-api] Sync done: fetched=${syncResult.fetched}, errors=${syncResult.errors}`);

    // Check user preference for auto-categorize behavior
    const { data: prefs } = await serviceClient
      .from('user_preferences')
      .select('auto_categorize_unread')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    const includeUnread = prefs?.auto_categorize_unread ?? false;
    const uncategorized = await getUncategorizedEmails(gmailAccount.id, { includeUnread });
    console.log(`[sync-api] Uncategorized (includeUnread=${includeUnread}): ${uncategorized.length}`);

    // Mark uncategorized emails as pending for background categorization
    if (uncategorized.length > 0) {
      const uncategorizedIds = uncategorized.map((e) => e.id);
      await serviceClient
        .from('emails')
        .update({ categorization_status: 'pending' })
        .in('id', uncategorizedIds);
    }

    // Fetch total counts for diagnostic context
    const { count: totalEmails } = await serviceClient
      .from('emails')
      .select('*', { count: 'exact', head: true })
      .eq('gmail_account_id', gmailAccount.id);
    const { count: totalCategorized } = await serviceClient
      .from('emails')
      .select('*', { count: 'exact', head: true })
      .eq('gmail_account_id', gmailAccount.id)
      .eq('is_categorized', true);

    // Update sync job as completed (categorization happens in background)
    if (job) {
      await serviceClient
        .from('sync_jobs')
        .update({
          status: 'completed',
          emails_fetched: syncResult.fetched,
          emails_categorized: 0, // will be updated after background categorization
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    }

    // Schedule background workflow execution + categorization via after()
    const jobId = job?.id;
    const accountForWorkflows = gmailAccount;
    const insertedGmailMsgIds = syncResult.insertedGmailMessageIds;

    after(async () => {
      const bgServiceClient = createServiceClient();
      const { runWorkflowsForEmail } = await import('@/lib/workflows/runner');

      // 1. Fire new_email + email_from_domain triggers for newly synced emails
      if (insertedGmailMsgIds.length > 0) {
        try {
          // Batch query by gmail_message_id to get internal IDs
          const { data: newEmails } = await bgServiceClient
            .from('emails')
            .select('*, email_categories(*)')
            .eq('gmail_account_id', gmailAccount.id)
            .in('gmail_message_id', insertedGmailMsgIds);

          if (newEmails && newEmails.length > 0) {
            console.log(`[sync-bg] Running new_email workflows for ${newEmails.length} emails`);
            for (const emailRow of newEmails) {
              const cat = emailRow.email_categories;
              const catObj = Array.isArray(cat) ? cat[0] : cat;
              const emailWithCat = {
                ...emailRow,
                email_categories: undefined,
                category: (catObj as Record<string, unknown>)?.category as string ?? null,
                topic: (catObj as Record<string, unknown>)?.topic as string ?? null,
                priority: (catObj as Record<string, unknown>)?.priority as string ?? null,
                confidence: (catObj as Record<string, unknown>)?.confidence as number ?? null,
                importance_score: (catObj as Record<string, unknown>)?.importance_score as number ?? null,
                importance_label: (catObj as Record<string, unknown>)?.importance_label as string ?? null,
              };
              await runWorkflowsForEmail(emailWithCat, 'new_email', accountForWorkflows);
              if (emailWithCat.sender_domain) {
                await runWorkflowsForEmail(emailWithCat, 'email_from_domain', accountForWorkflows);
              }
            }
          }
        } catch (wfErr) {
          console.error('[sync-bg] new_email/email_from_domain workflow execution failed:', wfErr);
        }
      }

      // 2. Background categorization
      if (uncategorized.length > 0) {
        try {
          console.log(`[sync-bg] Starting background categorization of ${uncategorized.length} emails`);
          const catResult = await categorizeEmails(uncategorized, user.id);
          console.log(`[sync-bg] Background categorization done: categorized=${catResult.categorized}, errors=${catResult.errors}`);

          if (jobId) {
            await bgServiceClient
              .from('sync_jobs')
              .update({ emails_categorized: catResult.categorized })
              .eq('id', jobId);
          }

          // 3. Fire email_categorized triggers for newly categorized emails
          try {
            const { data: categorizedEmails } = await bgServiceClient
              .from('emails')
              .select('*, email_categories(*)')
              .in('id', uncategorized.map((e) => e.id))
              .eq('is_categorized', true);

            if (categorizedEmails && categorizedEmails.length > 0) {
              console.log(`[sync-bg] Running email_categorized workflows for ${categorizedEmails.length} emails`);
              for (const emailRow of categorizedEmails) {
                const cat = emailRow.email_categories;
                const catObj = Array.isArray(cat) ? cat[0] : cat;
                const emailWithCat = {
                  ...emailRow,
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
            }
          } catch (wfErr) {
            console.error('[sync-bg] email_categorized workflow execution failed:', wfErr);
          }
        } catch (err) {
          console.error('[sync-bg] Background categorization failed:', err);
        }
      }
    });

    console.log(`[sync-api] Responding. fetched=${syncResult.fetched}, pendingCategorization=${uncategorized.length}, totalEmails=${totalEmails}, totalCategorized=${totalCategorized}`);

    return NextResponse.json({
      success: true,
      fetched: syncResult.fetched,
      pendingCategorization: uncategorized.length,
      totalEmails: totalEmails ?? 0,
      totalCategorized: totalCategorized ?? 0,
    });
  } catch (err) {
    console.error('Sync failed:', err);

    if (job) {
      await serviceClient
        .from('sync_jobs')
        .update({
          status: 'failed',
          error_message: err instanceof Error ? err.message : 'Unknown error',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    }

    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    const isAuthError = errMsg.includes('insufficient authentication scopes') || errMsg.includes('401') || errMsg.includes('403');
    return NextResponse.json(
      {
        error: 'Sync failed',
        details: isAuthError
          ? 'Gmail permissions expired or insufficient. Please sign out and sign in again.'
          : errMsg,
        needsReauth: isAuthError,
      },
      { status: isAuthError ? 403 : 500 }
    );
  }
}
