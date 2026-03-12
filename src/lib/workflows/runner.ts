import { createServiceClient } from '@/lib/supabase/server';
import { executeWorkflow, type EmailWithCategoryData } from './engine';
import type {
  GmailAccount,
  Workflow,
  WorkflowGraph,
  WorkflowTriggerType,
  TriggerNodeData,
} from '@/types';

interface RunSummary {
  workflowId: string;
  workflowName: string;
  runId: string;
  status: 'completed' | 'failed';
  stepsCount: number;
}

/**
 * Run all enabled workflows matching the given trigger type for an email.
 * Called from sync pipeline (after categorization) and cron (for unread_timeout).
 */
export async function runWorkflowsForEmail(
  email: EmailWithCategoryData,
  triggerType: WorkflowTriggerType,
  account: GmailAccount
): Promise<RunSummary[]> {
  const serviceClient = createServiceClient();
  const summaries: RunSummary[] = [];

  // Fetch all enabled workflows for this user
  const { data: workflows, error } = await serviceClient
    .from('workflows')
    .select('*')
    .eq('user_id', account.user_id)
    .eq('is_enabled', true);

  if (error || !workflows || workflows.length === 0) {
    return summaries;
  }

  // Filter to workflows matching the trigger type
  const matching = (workflows as Workflow[]).filter((w) => {
    const graph = w.graph as WorkflowGraph;
    const trigger = graph.nodes.find((n) => n.type === 'trigger');
    if (!trigger) return false;

    const triggerData = trigger.data as TriggerNodeData;
    if (triggerData.triggerType !== triggerType) return false;

    // Additional trigger-specific matching
    switch (triggerType) {
      case 'email_from_domain':
        return (
          triggerData.config?.domain &&
          email.sender_domain?.toLowerCase() === triggerData.config.domain.toLowerCase()
        );
      case 'email_categorized':
        // If a specific category is configured, only match that
        if (triggerData.config?.category) {
          return email.category?.toLowerCase() === triggerData.config.category.toLowerCase();
        }
        return true; // Match any categorization
      case 'new_email':
        return true;
      case 'unread_timeout':
        // Timeout matching is done by the cron caller — if we get here, it matched
        return true;
      default:
        return false;
    }
  });

  // Execute each matching workflow sequentially to avoid Gmail rate limits
  for (const workflow of matching) {
    try {
      const graph = workflow.graph as WorkflowGraph;
      const result = await executeWorkflow(graph, email, account, { dryRun: false });

      // Insert workflow_runs record with snapshot
      const { data: run, error: insertError } = await serviceClient
        .from('workflow_runs')
        .insert({
          workflow_id: workflow.id,
          email_id: email.id,
          status: result.status,
          graph_snapshot: graph,
          log: result.steps,
          started_at: result.steps[0]?.timestamp ?? new Date().toISOString(),
          completed_at: result.steps[result.steps.length - 1]?.timestamp ?? new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError) {
        console.error(`[workflow-runner] Failed to insert run for workflow ${workflow.id}:`, insertError);
      }

      summaries.push({
        workflowId: workflow.id,
        workflowName: workflow.name,
        runId: run?.id ?? 'unknown',
        status: result.status,
        stepsCount: result.steps.length,
      });
    } catch (err) {
      console.error(`[workflow-runner] Workflow ${workflow.id} failed:`, err);

      // Still record the failed run
      const failedAt = new Date().toISOString();
      const { data: failedRun } = await serviceClient
        .from('workflow_runs')
        .insert({
          workflow_id: workflow.id,
          email_id: email.id,
          status: 'failed',
          graph_snapshot: workflow.graph,
          log: [{
            nodeId: 'runner',
            nodeType: 'trigger' as const,
            result: 'error' as const,
            detail: err instanceof Error ? err.message : 'Unknown error',
            timestamp: failedAt,
          }],
          started_at: failedAt,
          completed_at: failedAt,
        })
        .select('id')
        .single();

      summaries.push({
        workflowId: workflow.id,
        workflowName: workflow.name,
        runId: failedRun?.id ?? 'unknown',
        status: 'failed',
        stepsCount: 0,
      });
    }
  }

  return summaries;
}
