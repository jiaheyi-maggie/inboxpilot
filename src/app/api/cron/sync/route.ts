import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { syncEmails } from '@/lib/gmail/sync';
import { categorizeEmails, getUncategorizedEmails } from '@/lib/ai/categorize';
import type { GmailAccount } from '@/types';

const MAX_ACCOUNTS_PER_RUN = 5;
const STALE_JOB_MINUTES = 10;

export async function GET(request: NextRequest) {
  // Verify cron secret (guard against undefined CRON_SECRET)
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const results: Record<string, unknown>[] = [];

  // Clean up stale running jobs (crashed during previous run)
  const staleThreshold = new Date(
    Date.now() - STALE_JOB_MINUTES * 60 * 1000
  ).toISOString();
  await serviceClient
    .from('sync_jobs')
    .update({
      status: 'failed',
      error_message: 'Timed out (stale job)',
      completed_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .lt('started_at', staleThreshold);

  // Get active accounts, oldest-synced first
  const { data: accounts, error } = await serviceClient
    .from('gmail_accounts')
    .select('*')
    .eq('sync_enabled', true)
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(MAX_ACCOUNTS_PER_RUN);

  if (error || !accounts || accounts.length === 0) {
    return NextResponse.json({
      message: 'No accounts to sync',
      results: [],
    });
  }

  for (const raw of accounts) {
    const account = raw as GmailAccount;

    // Skip if there's already a running job
    const { data: runningJob } = await serviceClient
      .from('sync_jobs')
      .select('id')
      .eq('gmail_account_id', account.id)
      .eq('status', 'running')
      .limit(1)
      .single();

    if (runningJob) {
      results.push({
        account_id: account.id,
        status: 'skipped',
        reason: 'Already running',
      });
      continue;
    }

    // Create sync job
    const { data: job, error: jobInsertError } = await serviceClient
      .from('sync_jobs')
      .insert({
        gmail_account_id: account.id,
        status: 'running',
      })
      .select()
      .single();

    if (jobInsertError) {
      console.error(`[cron] Failed to create sync job for ${account.id}:`, jobInsertError);
    }

    try {
      const syncResult = await syncEmails(account);

      const uncategorized = await getUncategorizedEmails(account.id);
      let categorizeResult = { categorized: 0, errors: 0 };
      if (uncategorized.length > 0) {
        categorizeResult = await categorizeEmails(uncategorized, account.user_id);
      }

      if (job) {
        await serviceClient
          .from('sync_jobs')
          .update({
            status: 'completed',
            emails_fetched: syncResult.fetched,
            emails_categorized: categorizeResult.categorized,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }

      results.push({
        account_id: account.id,
        status: 'completed',
        fetched: syncResult.fetched,
        categorized: categorizeResult.categorized,
      });
    } catch (err) {
      console.error(`Sync failed for ${account.email}:`, err);

      if (job) {
        await serviceClient
          .from('sync_jobs')
          .update({
            status: 'failed',
            error_message:
              err instanceof Error ? err.message : 'Unknown error',
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);
      }

      // If token error, disable sync
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('invalid_grant') || msg.includes('Token has been')) {
        await serviceClient
          .from('gmail_accounts')
          .update({ sync_enabled: false })
          .eq('id', account.id);
      }

      results.push({
        account_id: account.id,
        status: 'failed',
        error: msg,
      });
    }
  }

  return NextResponse.json({ results });
}
