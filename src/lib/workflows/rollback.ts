import { createServiceClient } from '@/lib/supabase/server';
import {
  getGmailClient,
  untrashEmails,
  markAsReadBulk,
  markAsUnreadBulk,
  starEmails,
  unstarEmails,
} from '@/lib/gmail/client';
import type { GmailAccount, WorkflowExecutionStep } from '@/types';

interface RollbackResult {
  rolledBack: number;
  skipped: number;
  failed: number;
  details: string[];
}

/** Map each forward action to its reverse action type and DB mutation. */
type ReverseAction = {
  label: string;
  applyDb: (
    serviceClient: ServiceClient,
    emailIds: string[],
    emails: EmailRow[],
  ) => Promise<void>;
  applyGmail: (
    account: GmailAccount,
    gmailMessageIds: string[],
  ) => Promise<{ succeeded: number; failed: number }>;
} | null; // null = cannot reverse (e.g., reassign_category)

type ServiceClient = ReturnType<typeof createServiceClient>;

interface EmailRow {
  id: string;
  gmail_message_id: string;
  label_ids: string[];
  is_read: boolean;
  is_starred: boolean;
}

/** Gmail chunk size for batch API calls. */
const GMAIL_CHUNK_SIZE = 50;

/**
 * Build the reverse-action map. Each entry describes how to undo a forward action.
 *
 * For archive: re-add INBOX label.
 * For trash: remove TRASH label, re-add INBOX label (Gmail untrash also restores INBOX).
 * For star/unstar, mark_read/mark_unread: swap the operation.
 * For reassign_category: original category is not stored, so we skip.
 */
function getReverseAction(forwardAction: string): ReverseAction {
  switch (forwardAction) {
    case 'archive':
      return {
        label: 'unarchive (restore to INBOX)',
        applyDb: async (sc, _ids, emails) => {
          // Add INBOX back to label_ids for each email
          const results = await Promise.allSettled(
            emails.map((e) => {
              const labels = [...(e.label_ids ?? [])];
              if (!labels.includes('INBOX')) labels.push('INBOX');
              return sc.from('emails').update({ label_ids: labels }).eq('id', e.id);
            }),
          );
          const dbFailed = results.filter(
            (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value?.error),
          ).length;
          if (dbFailed > 0) {
            console.error(`[rollback] ${dbFailed} DB updates failed during unarchive`);
          }
        },
        applyGmail: async (account, gmailIds) => {
          // Gmail: add INBOX label back (reverse of archive which removed INBOX)
          const client = await getGmailClient(account);
          const results = await Promise.allSettled(
            gmailIds.map((id) =>
              client.users.messages.modify({
                userId: 'me',
                id,
                requestBody: { addLabelIds: ['INBOX'] },
              }),
            ),
          );
          const failed = results.filter((r) => r.status === 'rejected').length;
          return { succeeded: gmailIds.length - failed, failed };
        },
      };

    case 'trash':
      return {
        label: 'restore from trash',
        applyDb: async (sc, _ids, emails) => {
          const results = await Promise.allSettled(
            emails.map((e) => {
              const labels = ((e.label_ids ?? []) as string[]).filter((l) => l !== 'TRASH');
              if (!labels.includes('INBOX')) labels.push('INBOX');
              return sc.from('emails').update({ label_ids: labels }).eq('id', e.id);
            }),
          );
          const dbFailed = results.filter(
            (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value?.error),
          ).length;
          if (dbFailed > 0) {
            console.error(`[rollback] ${dbFailed} DB updates failed during restore`);
          }
        },
        applyGmail: async (account, gmailIds) => {
          const result = await untrashEmails(account, gmailIds);
          return { succeeded: result.restored, failed: result.failed };
        },
      };

    case 'star':
      return {
        label: 'unstar',
        applyDb: async (sc, ids) => {
          await sc.from('emails').update({ is_starred: false }).in('id', ids);
        },
        applyGmail: async (account, gmailIds) => {
          const result = await unstarEmails(account, gmailIds);
          return { succeeded: result.unstarred, failed: result.failed };
        },
      };

    case 'unstar':
      return {
        label: 'star',
        applyDb: async (sc, ids) => {
          await sc.from('emails').update({ is_starred: true }).in('id', ids);
        },
        applyGmail: async (account, gmailIds) => {
          const result = await starEmails(account, gmailIds);
          return { succeeded: result.starred, failed: result.failed };
        },
      };

    case 'mark_read':
      return {
        label: 'mark_unread',
        applyDb: async (sc, ids) => {
          await sc.from('emails').update({ is_read: false }).in('id', ids);
        },
        applyGmail: async (account, gmailIds) => {
          const result = await markAsUnreadBulk(account, gmailIds);
          return { succeeded: result.updated, failed: result.failed };
        },
      };

    case 'mark_unread':
      return {
        label: 'mark_read',
        applyDb: async (sc, ids) => {
          await sc.from('emails').update({ is_read: true }).in('id', ids);
        },
        applyGmail: async (account, gmailIds) => {
          const result = await markAsReadBulk(account, gmailIds);
          return { succeeded: result.updated, failed: result.failed };
        },
      };

    case 'reassign_category':
      // Can only reverse if original category was stored in the run log (previous_state)
      // This is handled specially in rollbackWorkflow — return a marker action
      return {
        label: 'restore original category',
        applyDb: async (sc, _ids, _emails) => {
          // No-op: handled per-email in rollbackWorkflow since each email may have a different original category
        },
        applyGmail: async () => {
          // No Gmail API call needed for category changes
          return { succeeded: 0, failed: 0 };
        },
      };

    default:
      return null;
  }
}

interface ParsedLogAction {
  action: string;
  previousState?: { category?: string };
}

/**
 * Parse actions and previous state from a workflow_run log.
 * Log entries follow the pattern: "Backfill: applied <action>" or
 * "Backfill: applied <action1> + <action2>" for chained actions.
 * Also handles engine-produced logs like "Executed: <action>".
 * For reassign_category, extracts previous_state.category if available.
 */
function parseActionsFromLog(log: WorkflowExecutionStep[]): ParsedLogAction[] {
  const actions: ParsedLogAction[] = [];

  for (const entry of log) {
    if (!entry.detail) continue;

    // Extract previous_state if present (stored by backfill for reassign_category)
    const previousState = (entry as unknown as Record<string, unknown>).previous_state as
      { category?: string } | undefined;

    // Pattern: "Backfill: applied archive" or "Backfill: applied star + mark_read"
    const backfillMatch = entry.detail.match(/^Backfill: applied (.+)$/);
    if (backfillMatch) {
      const actionParts = backfillMatch[1].split(/\s*\+\s*/);
      for (const a of actionParts) {
        actions.push({ action: a.trim(), previousState });
      }
      continue;
    }

    // Pattern: "Executed: archive" or "Executed: star"
    const executedMatch = entry.detail.match(/^Executed: (\w+)/);
    if (executedMatch) {
      actions.push({ action: executedMatch[1], previousState });
    }
  }

  return actions;
}

/**
 * Roll back all completed runs of a workflow.
 *
 * 1. Fetch all workflow_runs where status = 'completed'
 * 2. Parse each run's log to determine what action was applied
 * 3. Reverse the action (update DB + call Gmail API)
 * 4. Mark rolled-back runs as status = 'rolled_back'
 * 5. Return a summary
 */
export async function rollbackWorkflow(
  workflowId: string,
  account: GmailAccount,
): Promise<RollbackResult> {
  const serviceClient = createServiceClient();
  const details: string[] = [];
  let rolledBack = 0;
  let skipped = 0;
  let failed = 0;

  // --- 1. Fetch all completed runs for this workflow ---
  const { data: runs, error: runsErr } = await serviceClient
    .from('workflow_runs')
    .select('id, email_id, log, status')
    .eq('workflow_id', workflowId)
    .eq('status', 'completed')
    .order('started_at', { ascending: false });

  if (runsErr) {
    console.error('[rollback] Failed to fetch workflow runs:', runsErr);
    return { rolledBack: 0, skipped: 0, failed: 0, details: [`DB error: ${runsErr.message}`] };
  }

  if (!runs || runs.length === 0) {
    return { rolledBack: 0, skipped: 0, failed: 0, details: ['No completed runs to roll back'] };
  }

  // --- 2. Group runs by action type for batch processing ---
  // Each run may have multiple actions (chained). We group emails by reverse-action.
  // For reassign_category, also track per-email original categories.
  interface PendingRollback {
    reverse: NonNullable<ReverseAction>;
    runIds: string[];
    emailIds: string[];
  }

  const rollbackMap = new Map<string, PendingRollback>();
  // Per-email original category for reassign_category rollback
  const categoryRollbackMap = new Map<string, string>(); // emailId → original category

  for (const run of runs) {
    if (!run.email_id) {
      skipped++;
      details.push(`Run ${run.id}: no email_id, skipped`);
      continue;
    }

    const log = run.log as WorkflowExecutionStep[];
    const parsedActions = parseActionsFromLog(log);

    if (parsedActions.length === 0) {
      skipped++;
      details.push(`Run ${run.id}: no parseable action in log, skipped`);
      continue;
    }

    for (const { action, previousState } of parsedActions) {
      // For reassign_category, check if we have the original category
      if (action === 'reassign_category') {
        if (previousState?.category) {
          categoryRollbackMap.set(run.email_id, previousState.category);
        } else {
          skipped++;
          details.push(`Run ${run.id}: reassign_category has no previous_state, skipped`);
          continue;
        }
      }

      const reverse = getReverseAction(action);
      if (!reverse) {
        skipped++;
        details.push(`Run ${run.id}: unable to rollback "${action}"`);
        continue;
      }

      const key = action; // Group by forward action type
      if (!rollbackMap.has(key)) {
        rollbackMap.set(key, { reverse, runIds: [], emailIds: [] });
      }
      const group = rollbackMap.get(key)!;
      // Avoid duplicates (same email could appear in multiple runs theoretically)
      if (!group.emailIds.includes(run.email_id)) {
        group.emailIds.push(run.email_id);
      }
      if (!group.runIds.includes(run.id)) {
        group.runIds.push(run.id);
      }
    }
  }

  // --- 3. Execute each reverse-action group in batch ---
  for (const [actionType, group] of rollbackMap) {
    const { reverse, emailIds } = group;

    // Special handling for reassign_category: restore per-email original categories
    if (actionType === 'reassign_category') {
      let catRolledBack = 0;
      let catFailed = 0;
      for (const emailId of emailIds) {
        const originalCategory = categoryRollbackMap.get(emailId);
        if (!originalCategory) {
          catFailed++;
          continue;
        }
        try {
          const { error: upsertErr } = await serviceClient
            .from('email_categories')
            .upsert(
              { email_id: emailId, category: originalCategory, confidence: 1.0, categorized_at: new Date().toISOString() },
              { onConflict: 'email_id' }
            );
          if (upsertErr) {
            catFailed++;
            console.error(`[rollback] Failed to restore category for ${emailId}:`, upsertErr);
          } else {
            catRolledBack++;
          }
        } catch {
          catFailed++;
        }
      }
      rolledBack += catRolledBack;
      failed += catFailed;
      if (catRolledBack > 0) {
        details.push(`Restored original category for ${catRolledBack} email${catRolledBack !== 1 ? 's' : ''}`);
      }
      if (catFailed > 0) {
        details.push(`Failed to restore category for ${catFailed} email${catFailed !== 1 ? 's' : ''}`);
      }
      continue;
    }

    // Fetch email rows to get gmail_message_id and current label_ids
    const { data: emailRows, error: emailErr } = await serviceClient
      .from('emails')
      .select('id, gmail_message_id, label_ids, is_read, is_starred')
      .in('id', emailIds);

    if (emailErr || !emailRows || emailRows.length === 0) {
      failed += emailIds.length;
      details.push(`Failed to fetch emails for ${actionType} rollback: ${emailErr?.message ?? 'no rows'}`);
      continue;
    }

    const emails = emailRows as EmailRow[];
    const validEmails = emails.filter((e) => e.gmail_message_id);
    const invalidCount = emails.length - validEmails.length;
    if (invalidCount > 0) {
      failed += invalidCount;
      details.push(`${invalidCount} emails missing gmail_message_id for ${actionType} rollback`);
    }

    if (validEmails.length === 0) continue;

    // Process in chunks of GMAIL_CHUNK_SIZE
    for (let i = 0; i < validEmails.length; i += GMAIL_CHUNK_SIZE) {
      const chunk = validEmails.slice(i, i + GMAIL_CHUNK_SIZE);
      const chunkGmailIds = chunk.map((e) => e.gmail_message_id);
      const chunkDbIds = chunk.map((e) => e.id);

      try {
        // Apply Gmail-side rollback
        const gmailResult = await reverse.applyGmail(account, chunkGmailIds);

        // Apply DB-side rollback
        await reverse.applyDb(serviceClient, chunkDbIds, chunk);

        rolledBack += gmailResult.succeeded;
        failed += gmailResult.failed;

        if (gmailResult.failed > 0) {
          details.push(`${gmailResult.failed} Gmail failures during ${reverse.label} (chunk ${i / GMAIL_CHUNK_SIZE + 1})`);
        }
      } catch (err) {
        failed += chunk.length;
        const message = err instanceof Error ? err.message : 'Unknown error';
        details.push(`Error during ${reverse.label}: ${message}`);
        console.error(`[rollback] ${reverse.label} failed:`, err);
      }
    }
  }

  // --- 4. Mark all processed runs as 'rolled_back' ---
  const allRunIds = runs.map((r) => r.id);
  if (allRunIds.length > 0) {
    // Update in chunks to avoid exceeding query limits
    for (let i = 0; i < allRunIds.length; i += 100) {
      const chunk = allRunIds.slice(i, i + 100);
      const { error: updateErr } = await serviceClient
        .from('workflow_runs')
        .update({ status: 'rolled_back' })
        .in('id', chunk);

      if (updateErr) {
        console.error('[rollback] Failed to update run statuses:', updateErr);
        details.push(`Failed to mark ${chunk.length} runs as rolled_back: ${updateErr.message}`);
      }
    }
  }

  const summary = `Rolled back ${rolledBack}, skipped ${skipped}, failed ${failed} across ${runs.length} runs`;
  details.unshift(summary);
  console.log(`[rollback] Workflow ${workflowId}: ${summary}`);

  return { rolledBack, skipped, failed, details };
}
