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
    // Group stuck emails by gmail_account_id to resolve user_id per account
    const byAccount = new Map<string, Email[]>();
    for (const e of stuckEmails as Email[]) {
      const key = e.gmail_account_id;
      if (!byAccount.has(key)) byAccount.set(key, []);
      byAccount.get(key)!.push(e);
    }

    // Resolve user_id for each account
    const accountIds = [...byAccount.keys()];
    const { data: accounts } = await serviceClient
      .from('gmail_accounts')
      .select('id, user_id')
      .in('id', accountIds);
    const accountUserMap = new Map<string, string>();
    if (accounts) {
      for (const a of accounts) accountUserMap.set(a.id, a.user_id);
    }

    let totalCategorized = 0;
    let totalErrors = 0;

    for (const [accountId, emails] of byAccount) {
      const userId = accountUserMap.get(accountId);
      if (!userId) {
        console.warn(`[cron] No user_id found for account ${accountId}, skipping ${emails.length} emails`);
        totalErrors += emails.length;
        continue;
      }
      const result = await categorizeEmails(emails, userId);
      totalCategorized += result.categorized;
      totalErrors += result.errors;
    }

    console.log(`[cron] Recovery categorization done: categorized=${totalCategorized}, errors=${totalErrors}`);

    // Mark any remaining failures
    if (totalErrors > 0) {
      const { data: nowCategorized } = await serviceClient
        .from('emails')
        .select('id')
        .in('id', stuckEmails.map((e) => e.id))
        .eq('is_categorized', true);

      const categorizedIds = new Set<string>();
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
      recovered: totalCategorized,
      errors: totalErrors,
    });
  } catch (err) {
    console.error('[cron] Recovery categorization failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron job failed' },
      { status: 500 }
    );
  }
}

/**
 * Process unread_timeout workflow triggers.
 * Called separately or can be appended to the existing GET cron handler.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  try {
    const { runWorkflowsForEmail } = await import('@/lib/workflows/runner');
    type TriggerData = { triggerType: string; config?: { timeoutMinutes?: number } };
    type WorkflowRow = {
      id: string;
      user_id: string;
      graph: { nodes: { type: string; data: TriggerData }[] };
    };

    // Find enabled workflows with unread_timeout triggers
    const { data: workflows } = await serviceClient
      .from('workflows')
      .select('id, user_id, graph')
      .eq('is_enabled', true);

    const timeoutWorkflows = (workflows as WorkflowRow[] | null)?.filter((w) => {
      const trigger = w.graph?.nodes?.find((n) => n.type === 'trigger');
      return trigger && (trigger.data as TriggerData).triggerType === 'unread_timeout';
    });

    if (!timeoutWorkflows || timeoutWorkflows.length === 0) {
      return NextResponse.json({ success: true, processed: 0 });
    }

    let totalProcessed = 0;

    for (const wf of timeoutWorkflows) {
      const trigger = wf.graph.nodes.find((n) => n.type === 'trigger');
      const timeoutMinutes = (trigger?.data as TriggerData)?.config?.timeoutMinutes ?? 60;
      const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

      // Find unread emails older than timeout
      const { data: account } = await serviceClient
        .from('gmail_accounts')
        .select('*')
        .eq('user_id', wf.user_id)
        .limit(1)
        .single();

      if (!account) continue;

      const { data: unreadEmails } = await serviceClient
        .from('emails')
        .select('*, email_categories(*)')
        .eq('gmail_account_id', account.id)
        .eq('is_read', false)
        .lt('received_at', cutoff)
        .limit(50);

      if (!unreadEmails || unreadEmails.length === 0) continue;

      // Deduplication: skip emails that already have a run for this workflow
      const emailIds = unreadEmails.map((e) => e.id);
      const { data: existingRuns } = await serviceClient
        .from('workflow_runs')
        .select('email_id')
        .eq('workflow_id', wf.id)
        .in('email_id', emailIds);

      const alreadyProcessed = new Set(
        (existingRuns ?? []).map((r) => r.email_id)
      );

      for (const emailRow of unreadEmails) {
        if (alreadyProcessed.has(emailRow.id)) continue;

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
        await runWorkflowsForEmail(emailWithCat, 'unread_timeout', account);
        totalProcessed++;
      }
    }

    return NextResponse.json({ success: true, processed: totalProcessed });
  } catch (err) {
    console.error('[cron] Workflow timeout processing failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron job failed' },
      { status: 500 }
    );
  }
}
