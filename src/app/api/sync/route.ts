import { NextResponse } from 'next/server';
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
    console.log(`[sync-api] Starting sync for ${gmailAccount.email}, token_expires: ${gmailAccount.token_expires_at}`);
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
    let categorizeResult = { categorized: 0, errors: 0 };

    if (uncategorized.length > 0) {
      categorizeResult = await categorizeEmails(uncategorized);
    }

    // Update sync job
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

    console.log(`[sync-api] Done. fetched=${syncResult.fetched}, categorized=${categorizeResult.categorized}, totalEmails=${totalEmails}, totalCategorized=${totalCategorized}`);

    return NextResponse.json({
      success: true,
      fetched: syncResult.fetched,
      categorized: categorizeResult.categorized,
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
    return NextResponse.json(
      { error: 'Sync failed', details: errMsg },
      { status: 500 }
    );
  }
}
