import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { categorizeEmails } from '@/lib/ai/categorize';
import type { Email } from '@/types';

/**
 * Cron endpoint — called by Vercel Cron or external scheduler.
 * 1. Re-processes emails stuck in categorization_status = 'pending' for >5 minutes
 *    (handles edge case where after() fails/times out on Vercel)
 * 2. Could be extended for other periodic tasks (e.g., workflow triggers)
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Find emails stuck in 'pending' for more than 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: stuckEmails, error } = await serviceClient
    .from('emails')
    .select('*')
    .eq('categorization_status', 'pending')
    .lt('created_at', fiveMinutesAgo)
    .order('received_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[cron] Failed to fetch stuck emails:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!stuckEmails || stuckEmails.length === 0) {
    return NextResponse.json({ success: true, recovered: 0 });
  }

  console.log(`[cron] Found ${stuckEmails.length} emails stuck in pending categorization`);

  try {
    const result = await categorizeEmails(stuckEmails as Email[]);
    console.log(`[cron] Recovery categorization done: categorized=${result.categorized}, errors=${result.errors}`);

    // Mark any remaining failures
    if (result.errors > 0) {
      // categorizeEmails already marks successful ones as is_categorized=true
      // Mark the ones that failed
      const categorizedIds = new Set<string>();
      // Re-fetch to find which ones got categorized
      const { data: nowCategorized } = await serviceClient
        .from('emails')
        .select('id')
        .in('id', stuckEmails.map((e) => e.id))
        .eq('is_categorized', true);

      if (nowCategorized) {
        nowCategorized.forEach((e) => categorizedIds.add(e.id));
      }

      const stillPendingIds = stuckEmails
        .map((e) => e.id)
        .filter((id) => !categorizedIds.has(id));

      if (stillPendingIds.length > 0) {
        await serviceClient
          .from('emails')
          .update({ categorization_status: 'failed' })
          .in('id', stillPendingIds);
      }
    }

    return NextResponse.json({
      success: true,
      recovered: result.categorized,
      errors: result.errors,
    });
  } catch (err) {
    console.error('[cron] Recovery categorization failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron job failed' },
      { status: 500 }
    );
  }
}
