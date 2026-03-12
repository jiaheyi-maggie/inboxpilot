import { createServiceClient } from '@/lib/supabase/server';
import {
  archiveEmails,
  trashEmails,
  markAsReadBulk,
  markAsUnreadBulk,
  starEmails,
  unstarEmails,
} from '@/lib/gmail/client';
import type {
  GmailAccount,
  WorkflowGraph,
  TriggerNodeData,
  ConditionNodeData,
  ActionNodeData,
  WorkflowActionType,
} from '@/types';
import { partitionByGmailId } from '@/lib/email-utils';
import type { EmailWithCategoryData } from './engine';

interface BackfillResult {
  processed: number;
  skipped: number;
  failed: number;
}

// Max emails per backfill to stay within serverless time limits
const BATCH_LIMIT = 200;
// Gmail rate limit safety: process in chunks of 50 parallel requests
const GMAIL_CHUNK_SIZE = 50;

/**
 * Backfill a workflow against existing emails.
 *
 * Strategy: instead of running the full BFS engine per email (which makes
 * one Gmail API call per email), we:
 *   1. Query emails matching the trigger criteria
 *   2. Evaluate conditions in-memory for each email
 *   3. Group passing emails by action type
 *   4. Execute each action group in batch (parallel Gmail calls)
 *   5. Bulk-insert workflow_runs for audit
 *
 * For simple workflows (trigger → action or trigger → condition → action),
 * this is O(1) Gmail API batches instead of O(n) sequential calls.
 */
export async function backfillWorkflow(
  workflowId: string,
  graph: WorkflowGraph,
  account: GmailAccount,
): Promise<BackfillResult> {
  const serviceClient = createServiceClient();

  // --- 1. Parse the graph to extract trigger, conditions, and actions ---
  const trigger = graph.nodes.find((n) => n.type === 'trigger');
  if (!trigger) return { processed: 0, skipped: 0, failed: 0 };

  const triggerData = trigger.data as TriggerNodeData;
  const { actions, conditions } = traceHappyPath(graph, trigger.id);

  if (actions.length === 0) return { processed: 0, skipped: 0, failed: 0 };

  // --- 2. Query emails matching trigger criteria ---
  let query = serviceClient
    .from('emails')
    .select('*, email_categories(category, topic, priority, confidence)')
    .eq('gmail_account_id', account.id)
    .contains('label_ids', ['INBOX'])
    .order('received_at', { ascending: false })
    .limit(BATCH_LIMIT);

  switch (triggerData.triggerType) {
    case 'email_from_domain':
      if (triggerData.config?.domain) {
        query = query.ilike('sender_domain', triggerData.config.domain);
      }
      break;
    case 'email_categorized':
      query = query.eq('is_categorized', true);
      if (triggerData.config?.category) {
        // Need JS-side filter since category is in the join table
      }
      break;
    case 'new_email':
      // All inbox emails
      break;
    case 'unread_timeout':
      if (triggerData.config?.timeoutMinutes) {
        const cutoff = new Date(Date.now() - triggerData.config.timeoutMinutes * 60 * 1000).toISOString();
        query = query.eq('is_read', false).lt('received_at', cutoff);
      }
      break;
  }

  const { data: rawEmails, error: queryErr } = await query;
  if (queryErr || !rawEmails || rawEmails.length === 0) {
    return { processed: 0, skipped: 0, failed: 0 };
  }

  // Normalize email_categories (PostgREST object vs array shape)
  type RowWithCat = Record<string, unknown> & {
    email_categories?: Record<string, unknown> | Record<string, unknown>[] | null;
  };
  const emails: EmailWithCategoryData[] = (rawEmails as unknown as RowWithCat[]).map((row) => {
    const cat = row.email_categories;
    const catObj = Array.isArray(cat) ? cat[0] : cat;
    return {
      ...row,
      email_categories: undefined,
      category: (catObj as Record<string, unknown>)?.category as string ?? null,
      topic: (catObj as Record<string, unknown>)?.topic as string ?? null,
      priority: (catObj as Record<string, unknown>)?.priority as string ?? null,
      confidence: (catObj as Record<string, unknown>)?.confidence as number ?? null,
    } as unknown as EmailWithCategoryData;
  });

  // --- 3. Apply trigger-specific JS-side filter (email_categorized with category config) ---
  let filtered = emails;
  if (triggerData.triggerType === 'email_categorized' && triggerData.config?.category) {
    const targetCat = triggerData.config.category.toLowerCase();
    filtered = filtered.filter((e) => e.category?.toLowerCase() === targetCat);
  }

  // --- 4. Deduplication: skip emails that already have a run for this workflow ---
  const emailIds = filtered.map((e) => e.id);
  if (emailIds.length === 0) return { processed: 0, skipped: 0, failed: 0 };

  const { data: existingRuns } = await serviceClient
    .from('workflow_runs')
    .select('email_id')
    .eq('workflow_id', workflowId)
    .in('email_id', emailIds);

  const alreadyProcessed = new Set((existingRuns ?? []).map((r) => r.email_id));
  filtered = filtered.filter((e) => !alreadyProcessed.has(e.id));

  if (filtered.length === 0) return { processed: 0, skipped: emailIds.length, failed: 0 };

  // --- 5. Evaluate conditions in-memory, collect emails per action ---
  const actionGroups = new Map<WorkflowActionType, { emails: EmailWithCategoryData[]; config: Record<string, unknown> }>();

  let skipped = 0;
  for (const email of filtered) {
    // Evaluate all conditions — if any fails, skip
    let passed = true;
    for (const cond of conditions) {
      if (!evaluateConditionSimple(cond, email)) {
        passed = false;
        break;
      }
    }
    if (!passed) {
      skipped++;
      continue;
    }

    // Group by each action in the happy path
    for (const action of actions) {
      const key = action.actionType;
      if (!actionGroups.has(key)) {
        actionGroups.set(key, { emails: [], config: action.config ?? {} });
      }
      actionGroups.get(key)!.emails.push(email);
    }
  }

  // --- 6. Execute each action group in batch ---
  let totalProcessed = 0;
  let totalFailed = 0;
  const succeededEmailIds = new Set<string>();
  const failedEmailIds = new Set<string>();

  for (const [actionType, group] of actionGroups) {
    const { emails: actionEmails, config } = group;
    // Filter out emails with null/missing gmail_message_id
    const { valid: validEmails, invalid: skippedEmails } = partitionByGmailId(actionEmails);
    if (skippedEmails.length > 0) {
      console.warn(`[backfill] Skipped ${skippedEmails.length} emails with missing gmail_message_id for ${actionType}`);
      totalFailed += skippedEmails.length;
    }
    if (validEmails.length === 0) continue;

    const gmailIds = validEmails.map((e) => e.gmail_message_id);
    const dbIds = validEmails.map((e) => e.id);

    try {
      // Process in chunks to respect Gmail rate limits
      for (let i = 0; i < gmailIds.length; i += GMAIL_CHUNK_SIZE) {
        const chunkGmailIds = gmailIds.slice(i, i + GMAIL_CHUNK_SIZE);
        const chunkDbIds = dbIds.slice(i, i + GMAIL_CHUNK_SIZE);
        const chunkEmails = validEmails.slice(i, i + GMAIL_CHUNK_SIZE);

        const result = await executeBatchAction(actionType, chunkGmailIds, chunkDbIds, chunkEmails, config, account, serviceClient);
        totalProcessed += result.succeeded;
        totalFailed += result.failed;

        // Track per-chunk success: if entire chunk succeeded, mark all as succeeded.
        // If any failed, mark entire chunk as failed (we can't identify which specific
        // emails failed since bulk helpers return aggregate counts).
        if (result.failed === 0) {
          for (const email of chunkEmails) succeededEmailIds.add(email.id);
        } else {
          for (const email of chunkEmails) failedEmailIds.add(email.id);
        }
      }
    } catch (err) {
      console.error(`[backfill] Batch action ${actionType} failed:`, err);
      totalFailed += actionEmails.length;
      for (const email of actionEmails) failedEmailIds.add(email.id);
    }
  }

  // --- 7. Bulk-insert workflow_runs for audit ---
  // Only record succeeded emails as 'completed'. Record failed emails as 'failed'.
  const allEmailIds = new Set([...succeededEmailIds, ...failedEmailIds]);
  if (allEmailIds.size > 0) {
    const now = new Date().toISOString();
    const actionSummary = actions.map((a) => a.actionType).join(' + ');
    const runs = Array.from(allEmailIds).map((emailId) => {
      const status = failedEmailIds.has(emailId) && !succeededEmailIds.has(emailId) ? 'failed' : 'completed';
      return {
        workflow_id: workflowId,
        email_id: emailId,
        status,
        graph_snapshot: graph,
        log: [{
          nodeId: 'backfill',
          nodeType: 'trigger' as const,
          result: (status === 'completed' ? 'executed' : 'error') as 'executed' | 'error',
          detail: status === 'completed'
            ? `Backfill: applied ${actionSummary}`
            : `Backfill: failed to apply ${actionSummary}`,
          timestamp: now,
        }],
        started_at: now,
        completed_at: now,
      };
    });

    // Bulk insert in chunks (Supabase has row limits per insert)
    for (let i = 0; i < runs.length; i += 100) {
      const chunk = runs.slice(i, i + 100);
      const { error: insertErr } = await serviceClient
        .from('workflow_runs')
        .insert(chunk);
      if (insertErr) {
        console.error('[backfill] Failed to insert workflow_runs:', insertErr);
      }
    }
  }

  console.log(`[backfill] Workflow ${workflowId}: processed=${totalProcessed}, skipped=${skipped + alreadyProcessed.size}, failed=${totalFailed}`);

  return {
    processed: totalProcessed,
    skipped: skipped + alreadyProcessed.size,
    failed: totalFailed,
  };
}

/**
 * Trace the "happy path" through the graph: follow true branches of conditions,
 * collect all conditions and actions in execution order.
 * Works for the common pattern: trigger → condition? → action (→ action)*
 */
function traceHappyPath(
  graph: WorkflowGraph,
  triggerId: string,
): { conditions: ConditionNodeData[]; actions: ActionNodeData[] } {
  const conditions: ConditionNodeData[] = [];
  const actions: ActionNodeData[] = [];

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, typeof graph.edges>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) adjacency.get(edge.source)?.push(edge);

  const visited = new Set<string>();
  const queue = [triggerId];
  visited.add(triggerId);

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    if (node.type === 'condition') {
      conditions.push(node.data as ConditionNodeData);
      // Follow only the true branch
      for (const edge of adjacency.get(nodeId) ?? []) {
        if (edge.sourceHandle === 'true' && !visited.has(edge.target)) {
          visited.add(edge.target);
          queue.push(edge.target);
        }
      }
    } else if (node.type === 'action') {
      actions.push(node.data as ActionNodeData);
      // Follow chained actions
      for (const edge of adjacency.get(nodeId) ?? []) {
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          queue.push(edge.target);
        }
      }
    } else {
      // Trigger node — follow all outgoing edges
      for (const edge of adjacency.get(nodeId) ?? []) {
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          queue.push(edge.target);
        }
      }
    }
  }

  return { conditions, actions };
}

/**
 * Simple condition evaluation matching engine.ts logic.
 */
function evaluateConditionSimple(condition: ConditionNodeData, email: EmailWithCategoryData): boolean {
  const fieldValue = getFieldValue(condition.field, email);
  const { operator, value } = condition;

  if (operator === 'is_true') return fieldValue === 'true' || fieldValue === true;
  if (operator === 'is_false') return fieldValue === 'false' || fieldValue === false || fieldValue === null || fieldValue === undefined;

  const actual = String(fieldValue ?? '').toLowerCase();
  const expected = String(value ?? '').toLowerCase();

  switch (operator) {
    case 'equals': return actual === expected;
    case 'not_equals': return actual !== expected;
    case 'contains': return actual.includes(expected);
    case 'not_contains': return !actual.includes(expected);
    case 'starts_with': return actual.startsWith(expected);
    case 'ends_with': return actual.endsWith(expected);
    default: return false;
  }
}

function getFieldValue(
  field: string,
  email: EmailWithCategoryData,
): string | boolean | null | undefined {
  switch (field) {
    case 'category': return email.category;
    case 'topic': return email.topic;
    case 'priority': return email.priority;
    case 'sender_email': return email.sender_email;
    case 'sender_domain': return email.sender_domain;
    case 'subject': return email.subject;
    case 'has_attachment': return email.has_attachment;
    case 'is_read': return email.is_read;
    case 'is_starred': return email.is_starred;
    case 'label': return email.label_ids?.join(',') ?? '';
    default: return null;
  }
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function executeBatchAction(
  actionType: WorkflowActionType,
  gmailIds: string[],
  dbIds: string[],
  emails: EmailWithCategoryData[],
  config: Record<string, unknown>,
  account: GmailAccount,
  serviceClient: ServiceClient,
): Promise<{ succeeded: number; failed: number }> {
  switch (actionType) {
    case 'archive': {
      const result = await archiveEmails(account, gmailIds);
      // Update DB: remove INBOX from label_ids (concurrent, matching trash pattern)
      const archiveDbResults = await Promise.allSettled(
        emails.map((e) => {
          const newLabels = (e.label_ids ?? []).filter((l) => l !== 'INBOX');
          return serviceClient.from('emails').update({ label_ids: newLabels }).eq('id', e.id);
        })
      );
      const archiveDbFailed = archiveDbResults.filter(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value?.error)
      ).length;
      if (archiveDbFailed > 0) {
        console.error(`[backfill] ${archiveDbFailed} DB label updates failed during archive`);
      }
      return { succeeded: result.archived, failed: result.failed };
    }

    case 'trash': {
      const result = await trashEmails(account, gmailIds);
      // Soft-delete: update labels (remove INBOX, add TRASH) instead of deleting from DB
      const trashDbResults = await Promise.allSettled(
        emails.map((e) => {
          const currentLabels = ((e.label_ids ?? []) as string[]).filter((l) => l !== 'INBOX');
          if (!currentLabels.includes('TRASH')) currentLabels.push('TRASH');
          return serviceClient
            .from('emails')
            .update({ label_ids: currentLabels })
            .eq('id', e.id);
        })
      );
      const trashDbFailed = trashDbResults.filter(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value?.error)
      ).length;
      if (trashDbFailed > 0) {
        console.error(`[backfill] ${trashDbFailed} DB label updates failed during trash`);
      }
      return { succeeded: result.trashed, failed: result.failed };
    }

    case 'star': {
      const result = await starEmails(account, gmailIds);
      await serviceClient.from('emails').update({ is_starred: true }).in('id', dbIds);
      return { succeeded: result.starred, failed: result.failed };
    }

    case 'unstar': {
      const result = await unstarEmails(account, gmailIds);
      await serviceClient.from('emails').update({ is_starred: false }).in('id', dbIds);
      return { succeeded: result.unstarred, failed: result.failed };
    }

    case 'mark_read': {
      const result = await markAsReadBulk(account, gmailIds);
      await serviceClient.from('emails').update({ is_read: true }).in('id', dbIds);
      return { succeeded: result.updated, failed: result.failed };
    }

    case 'mark_unread': {
      const result = await markAsUnreadBulk(account, gmailIds);
      await serviceClient.from('emails').update({ is_read: false }).in('id', dbIds);
      return { succeeded: result.updated, failed: result.failed };
    }

    case 'reassign_category': {
      const category = config.category as string;
      if (!category) return { succeeded: 0, failed: dbIds.length };

      // Bulk upsert categories — no Gmail API call needed
      const upserts = dbIds.map((emailId) => ({
        email_id: emailId,
        category,
        confidence: 1.0,
        categorized_at: new Date().toISOString(),
      }));

      // Upsert in chunks
      let succeeded = 0;
      for (let i = 0; i < upserts.length; i += 100) {
        const chunk = upserts.slice(i, i + 100);
        const { error } = await serviceClient
          .from('email_categories')
          .upsert(chunk, { onConflict: 'email_id' });
        if (error) {
          console.error('[backfill] reassign_category upsert failed:', error);
        } else {
          succeeded += chunk.length;
        }
      }

      // Mark emails as categorized
      await serviceClient
        .from('emails')
        .update({ is_categorized: true, categorization_status: 'done' })
        .in('id', dbIds);

      return { succeeded, failed: dbIds.length - succeeded };
    }

    default:
      console.warn(`[backfill] Unknown action type: ${actionType}`);
      return { succeeded: 0, failed: gmailIds.length };
  }
}
