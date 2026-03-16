import { NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { syncEmails } from '@/lib/gmail/sync';
import { categorizeEmails, getUncategorizedEmails } from '@/lib/ai/categorize';
import type { GmailAccount, Email } from '@/types';

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Get user's Gmail accounts — support multi-inbox
  const requestAccountId = new URL(request.url).searchParams.get('accountId');

  let accountQuery = serviceClient
    .from('gmail_accounts')
    .select('*')
    .eq('user_id', user.id)
    .eq('sync_enabled', true);

  // If a specific account is requested, only sync that one
  if (requestAccountId) {
    accountQuery = accountQuery.eq('id', requestAccountId);
  }

  const { data: accountRows, error: accountError } = await accountQuery;

  if (accountError || !accountRows || accountRows.length === 0) {
    return NextResponse.json(
      { error: 'No Gmail account linked' },
      { status: 404 }
    );
  }

  const accounts = accountRows as GmailAccount[];

  // Check if the primary account has sufficient Gmail scopes (backward compat check)
  const primaryAccount = accounts[0];
  if (!primaryAccount.granted_scope || primaryAccount.granted_scope === 'none') {
    return NextResponse.json(
      {
        error: 'Gmail permissions not granted',
        details: 'Please sign out and sign in again to grant Gmail access.',
        needsReauth: true,
      },
      { status: 403 }
    );
  }

  // Check user preference for auto-categorize behavior (shared across accounts)
  const { data: prefs } = await serviceClient
    .from('user_preferences')
    .select('auto_categorize_unread')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  const includeUnread = prefs?.auto_categorize_unread ?? false;

  // Aggregate results across all accounts
  let totalFetched = 0;
  let totalPendingCategorization = 0;

  // Per-account data for background processing
  const bgTasks: {
    account: GmailAccount;
    jobId: string | null;
    insertedGmailMsgIds: string[];
    uncategorized: Email[];
  }[] = [];

  // Sync each account sequentially
  for (const gmailAccount of accounts) {
    // Skip accounts without proper scopes
    if (!gmailAccount.granted_scope || gmailAccount.granted_scope === 'none') {
      console.warn(`[sync-api] Skipping account ${gmailAccount.email}: no scope`);
      continue;
    }

    // Create sync job per account
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
      console.log(`[sync-api] Sync done for ${gmailAccount.email}: fetched=${syncResult.fetched}, errors=${syncResult.errors}`);

      totalFetched += syncResult.fetched;

      const uncategorized = await getUncategorizedEmails(gmailAccount.id, { includeUnread });
      console.log(`[sync-api] Uncategorized for ${gmailAccount.email} (includeUnread=${includeUnread}): ${uncategorized.length}`);

      totalPendingCategorization += uncategorized.length;

      // Mark uncategorized emails as pending for background categorization
      if (uncategorized.length > 0) {
        const uncategorizedIds = uncategorized.map((e) => e.id);
        await serviceClient
          .from('emails')
          .update({ categorization_status: 'pending' })
          .in('id', uncategorizedIds);
      }

      // Update sync job as completed (categorization happens in background)
      if (job) {
        await serviceClient
          .from('sync_jobs')
          .update({
            status: 'completed',
            emails_fetched: syncResult.fetched,
            emails_categorized: 0,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }

      bgTasks.push({
        account: gmailAccount,
        jobId: job?.id ?? null,
        insertedGmailMsgIds: syncResult.insertedGmailMessageIds,
        uncategorized,
      });
    } catch (err) {
      console.error(`[sync-api] Sync failed for ${gmailAccount.email}:`, err);

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
    }
  }

  // Fetch total counts across all accounts for diagnostic context
  const allAccountIds = accounts.map((a) => a.id);
  const { count: totalEmails } = await serviceClient
    .from('emails')
    .select('*', { count: 'exact', head: true })
    .in('gmail_account_id', allAccountIds);
  const { count: totalCategorized } = await serviceClient
    .from('emails')
    .select('*', { count: 'exact', head: true })
    .in('gmail_account_id', allAccountIds)
    .eq('is_categorized', true);

  // Schedule background workflow execution + categorization via after()
  after(async () => {
    const bgServiceClient = createServiceClient();
    const { runWorkflowsForEmail } = await import('@/lib/workflows/runner');

    for (const task of bgTasks) {
      const { account: gmailAccount, jobId, insertedGmailMsgIds, uncategorized } = task;

      // 1. Fire new_email + email_from_domain triggers for newly synced emails
      if (insertedGmailMsgIds.length > 0) {
        try {
          const { data: newEmails } = await bgServiceClient
            .from('emails')
            .select('*, email_categories(*)')
            .eq('gmail_account_id', gmailAccount.id)
            .in('gmail_message_id', insertedGmailMsgIds);

          if (newEmails && newEmails.length > 0) {
            console.log(`[sync-bg] Running new_email workflows for ${newEmails.length} emails (${gmailAccount.email})`);
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
              await runWorkflowsForEmail(emailWithCat, 'new_email', gmailAccount);
              if (emailWithCat.sender_domain) {
                await runWorkflowsForEmail(emailWithCat, 'email_from_domain', gmailAccount);
              }
            }
          }
        } catch (wfErr) {
          console.error(`[sync-bg] new_email workflow failed for ${gmailAccount.email}:`, wfErr);
        }
      }

      // 2. Background categorization (scoped to this account's categories)
      if (uncategorized.length > 0) {
        try {
          console.log(`[sync-bg] Starting background categorization of ${uncategorized.length} emails (${gmailAccount.email})`);
          const catResult = await categorizeEmails(uncategorized, user.id, { gmailAccountId: gmailAccount.id });
          console.log(`[sync-bg] Categorization done for ${gmailAccount.email}: categorized=${catResult.categorized}, errors=${catResult.errors}`);

          if (jobId) {
            await bgServiceClient
              .from('sync_jobs')
              .update({ emails_categorized: catResult.categorized })
              .eq('id', jobId);
          }

          // 3. Fire email_categorized triggers
          try {
            const { data: categorizedEmails } = await bgServiceClient
              .from('emails')
              .select('*, email_categories(*)')
              .in('id', uncategorized.map((e) => e.id))
              .eq('is_categorized', true);

            if (categorizedEmails && categorizedEmails.length > 0) {
              console.log(`[sync-bg] Running email_categorized workflows for ${categorizedEmails.length} emails (${gmailAccount.email})`);
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
                await runWorkflowsForEmail(emailWithCat, 'email_categorized', gmailAccount);
              }
            }
          } catch (wfErr) {
            console.error(`[sync-bg] email_categorized workflow failed for ${gmailAccount.email}:`, wfErr);
          }
        } catch (err) {
          console.error(`[sync-bg] Background categorization failed for ${gmailAccount.email}:`, err);
        }
      }
    }
  });

  console.log(`[sync-api] Responding. accounts=${accounts.length}, fetched=${totalFetched}, pendingCategorization=${totalPendingCategorization}, totalEmails=${totalEmails}, totalCategorized=${totalCategorized}`);

  return NextResponse.json({
    success: true,
    fetched: totalFetched,
    pendingCategorization: totalPendingCategorization,
    totalEmails: totalEmails ?? 0,
    totalCategorized: totalCategorized ?? 0,
    accountsSynced: accounts.length,
  });
}
