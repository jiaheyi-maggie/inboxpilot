import {
  trashEmail,
  archiveEmail,
  starEmail,
  unstarEmail,
  markAsRead,
  markAsUnread,
} from '@/lib/gmail/client';
import { createServiceClient } from '@/lib/supabase/server';
import type {
  GmailAccount,
  Email,
  WorkflowGraph,
  WorkflowNode,
  WorkflowEdge,
  WorkflowExecutionStep,
  TriggerNodeData,
  ConditionNodeData,
  ActionNodeData,
  WorkflowConditionField,
} from '@/types';

export interface EmailWithCategoryData extends Email {
  category?: string | null;
  topic?: string | null;
  priority?: string | null;
  confidence?: number | null;
}

interface ExecuteOptions {
  dryRun?: boolean;
}

interface ExecuteResult {
  steps: WorkflowExecutionStep[];
  status: 'completed' | 'failed';
}

/**
 * BFS-walks the workflow graph starting from the trigger node.
 * Evaluates conditions against email data and executes actions.
 * In dry-run mode, logs what would happen without executing Gmail API calls.
 */
export async function executeWorkflow(
  graph: WorkflowGraph,
  email: EmailWithCategoryData,
  account: GmailAccount,
  options: ExecuteOptions = {}
): Promise<ExecuteResult> {
  const { dryRun = false } = options;
  const steps: WorkflowExecutionStep[] = [];
  const { nodes, edges } = graph;

  // Build lookup maps
  const nodeMap = new Map<string, WorkflowNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const adjacency = new Map<string, WorkflowEdge[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge);
  }

  // Find trigger node
  const trigger = nodes.find((n) => n.type === 'trigger');
  if (!trigger) {
    return {
      steps: [{
        nodeId: 'unknown',
        nodeType: 'trigger',
        result: 'error',
        detail: 'No trigger node found in workflow',
        timestamp: new Date().toISOString(),
      }],
      status: 'failed',
    };
  }

  // Log trigger
  steps.push({
    nodeId: trigger.id,
    nodeType: 'trigger',
    result: 'executed',
    detail: `Trigger: ${(trigger.data as TriggerNodeData).triggerType}`,
    timestamp: new Date().toISOString(),
  });

  // BFS from trigger
  const queue: string[] = [];
  const visited = new Set<string>();
  visited.add(trigger.id);

  // Enqueue trigger's outgoing edges' targets
  for (const edge of adjacency.get(trigger.id) ?? []) {
    if (!visited.has(edge.target)) {
      queue.push(edge.target);
      visited.add(edge.target);
    }
  }

  let hasError = false;

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    if (node.type === 'condition') {
      const condData = node.data as ConditionNodeData;
      const passed = evaluateCondition(condData, email);

      steps.push({
        nodeId: node.id,
        nodeType: 'condition',
        result: passed ? 'passed' : 'failed',
        detail: `${condData.field} ${condData.operator} "${condData.value}" → ${passed ? 'Yes' : 'No'}`,
        timestamp: new Date().toISOString(),
      });

      // Follow edges matching the condition result
      const handleKey = passed ? 'true' : 'false';
      for (const edge of adjacency.get(node.id) ?? []) {
        if (edge.sourceHandle === handleKey && !visited.has(edge.target)) {
          queue.push(edge.target);
          visited.add(edge.target);
        }
      }

      // Mark entire subtree on the other branch as skipped (BFS)
      const skippedHandle = passed ? 'false' : 'true';
      const skipQueue: string[] = [];
      for (const edge of adjacency.get(node.id) ?? []) {
        if (edge.sourceHandle === skippedHandle && !visited.has(edge.target)) {
          skipQueue.push(edge.target);
          visited.add(edge.target);
        }
      }
      while (skipQueue.length > 0) {
        const skipId = skipQueue.shift()!;
        const skippedNode = nodeMap.get(skipId);
        if (skippedNode) {
          steps.push({
            nodeId: skippedNode.id,
            nodeType: skippedNode.type,
            result: 'skipped',
            detail: `Skipped (condition "${condData.field}" was ${passed ? 'true' : 'false'})`,
            timestamp: new Date().toISOString(),
          });
          // Also skip all descendants
          for (const edge of adjacency.get(skipId) ?? []) {
            if (!visited.has(edge.target)) {
              skipQueue.push(edge.target);
              visited.add(edge.target);
            }
          }
        }
      }
    } else if (node.type === 'action') {
      const actionData = node.data as ActionNodeData;

      if (dryRun) {
        steps.push({
          nodeId: node.id,
          nodeType: 'action',
          result: 'executed',
          detail: `[DRY RUN] Would execute: ${actionData.actionType}${actionData.config?.category ? ` → ${actionData.config.category}` : ''}`,
          timestamp: new Date().toISOString(),
        });
      } else {
        try {
          await executeAction(actionData, email, account);
          steps.push({
            nodeId: node.id,
            nodeType: 'action',
            result: 'executed',
            detail: `Executed: ${actionData.actionType}${actionData.config?.category ? ` → ${actionData.config.category}` : ''}`,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          hasError = true;
          steps.push({
            nodeId: node.id,
            nodeType: 'action',
            result: 'error',
            detail: `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
            timestamp: new Date().toISOString(),
          });
        }
      }

      // Actions can chain — follow outgoing edges
      for (const edge of adjacency.get(node.id) ?? []) {
        if (!visited.has(edge.target)) {
          queue.push(edge.target);
          visited.add(edge.target);
        }
      }
    }
  }

  return {
    steps,
    status: hasError ? 'failed' : 'completed',
  };
}

/**
 * Evaluate a condition against email data.
 */
function evaluateCondition(
  condition: ConditionNodeData,
  email: EmailWithCategoryData
): boolean {
  const fieldValue = getFieldValue(condition.field, email);
  const { operator, value } = condition;

  // Boolean operators don't use value
  if (operator === 'is_true') return fieldValue === 'true' || fieldValue === true;
  if (operator === 'is_false') return fieldValue === 'false' || fieldValue === false || fieldValue === null || fieldValue === undefined;

  // Normalize to string for comparison
  const actual = String(fieldValue ?? '').toLowerCase();
  const expected = String(value ?? '').toLowerCase();

  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'not_equals':
      return actual !== expected;
    case 'contains':
      return actual.includes(expected);
    case 'not_contains':
      return !actual.includes(expected);
    case 'starts_with':
      return actual.startsWith(expected);
    case 'ends_with':
      return actual.endsWith(expected);
    default:
      return false;
  }
}

/**
 * Extract a field value from email data for condition evaluation.
 */
function getFieldValue(
  field: WorkflowConditionField,
  email: EmailWithCategoryData
): string | boolean | null | undefined {
  switch (field) {
    case 'category':
      return email.category;
    case 'topic':
      return email.topic;
    case 'priority':
      return email.priority;
    case 'sender_email':
      return email.sender_email;
    case 'sender_domain':
      return email.sender_domain;
    case 'subject':
      return email.subject;
    case 'has_attachment':
      return email.has_attachment;
    case 'is_read':
      return email.is_read;
    case 'is_starred':
      return email.is_starred;
    case 'label':
      return email.label_ids?.join(',') ?? '';
    default:
      return null;
  }
}

/**
 * Execute a single action on an email.
 */
async function executeAction(
  action: ActionNodeData,
  email: EmailWithCategoryData,
  account: GmailAccount
): Promise<void> {
  const serviceClient = createServiceClient();

  switch (action.actionType) {
    case 'trash': {
      await trashEmail(account, email.gmail_message_id);
      const currentLabels = (email.label_ids ?? []).filter((l) => l !== 'INBOX');
      if (!currentLabels.includes('TRASH')) currentLabels.push('TRASH');
      await serviceClient
        .from('emails')
        .update({ label_ids: currentLabels })
        .eq('id', email.id);
      break;
    }

    case 'archive':
      await archiveEmail(account, email.gmail_message_id);
      await serviceClient
        .from('emails')
        .update({ label_ids: (email.label_ids ?? []).filter((l) => l !== 'INBOX') })
        .eq('id', email.id);
      break;

    case 'star':
      await starEmail(account, email.gmail_message_id);
      await serviceClient.from('emails').update({ is_starred: true }).eq('id', email.id);
      break;

    case 'unstar':
      await unstarEmail(account, email.gmail_message_id);
      await serviceClient.from('emails').update({ is_starred: false }).eq('id', email.id);
      break;

    case 'mark_read':
      await markAsRead(account, email.gmail_message_id);
      await serviceClient.from('emails').update({ is_read: true }).eq('id', email.id);
      break;

    case 'mark_unread':
      await markAsUnread(account, email.gmail_message_id);
      await serviceClient.from('emails').update({ is_read: false }).eq('id', email.id);
      break;

    case 'reassign_category': {
      if (!action.config?.category) {
        throw new Error('reassign_category requires a target category');
      }
      // Upsert: works whether or not email_categories row exists yet
      await serviceClient
        .from('email_categories')
        .upsert({
          email_id: email.id,
          category: action.config.category,
          confidence: 1.0,
          categorized_at: new Date().toISOString(),
        }, {
          onConflict: 'email_id',
        });
      // Also mark the email as categorized
      await serviceClient
        .from('emails')
        .update({ is_categorized: true, categorization_status: 'done' })
        .eq('id', email.id);
      break;
    }

    default:
      throw new Error(`Unknown action type: ${action.actionType}`);
  }
}
