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
    // Sync emails from Gmail
    const syncResult = await syncEmails(gmailAccount);

    // Categorize uncategorized emails
    const uncategorized = await getUncategorizedEmails(gmailAccount.id);
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

    return NextResponse.json({
      success: true,
      fetched: syncResult.fetched,
      categorized: categorizeResult.categorized,
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

    return NextResponse.json(
      { error: 'Sync failed' },
      { status: 500 }
    );
  }
}
