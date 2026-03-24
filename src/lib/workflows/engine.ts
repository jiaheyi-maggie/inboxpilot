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
import { evaluateSmartCondition } from './llm-condition';

export interface EmailWithCategoryData extends Email {
  category?: string | null;
  topic?: string | null;
  /** @deprecated Use importance_label instead */
  priority?: string | null;
  importance_score?: number | null;
  importance_label?: string | null;
  confidence?: number | null;
}

/**
 * Ensure categories exist in user_categories, creating any that are missing.
 * Used by recategorize action to auto-create new categories before AI reclassification.
 */
async function ensureCategories(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
  categoryNames: string[],
): Promise<void> {
  const { data: existing } = await serviceClient
    .from('user_categories')
    .select('name')
    .eq('user_id', userId);

  const existingNames = new Set((existing ?? []).map((c: { name: string }) => c.name));
  const toCreate = categoryNames.filter((n) => !existingNames.has(n));

  if (toCreate.length === 0) return;

  // Get max sort_order to append new categories at the end
  const maxOrder = (existing ?? []).length;
  const inserts = toCreate.map((name, i) => ({
    user_id: userId,
    name,
    description: null,
    color: null,
    sort_order: maxOrder + i,
    is_default: false,
  }));

  const { error } = await serviceClient.from('user_categories').insert(inserts);
  if (error) {
    console.error('[engine] Failed to auto-create categories:', error);
  }
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
      const { passed, reasoning } = await evaluateCondition(condData, email);

      steps.push({
        nodeId: node.id,
        nodeType: 'condition',
        result: passed ? 'passed' : 'failed',
        detail: condData.mode === 'smart'
          ? `Smart: "${condData.prompt?.slice(0, 60) ?? ''}…" → ${passed ? 'Yes' : 'No'}`
          : `${condData.field} ${condData.operator} "${condData.value}" → ${passed ? 'Yes' : 'No'}`,
        reasoning,
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
            detail: condData.mode === 'smart'
              ? `Skipped (smart condition was ${passed ? 'Yes' : 'No'})`
              : `Skipped (condition "${condData.field}" was ${passed ? 'true' : 'false'})`,
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
 * Smart conditions call Claude Haiku; field conditions are synchronous string matching.
 */
async function evaluateCondition(
  condition: ConditionNodeData,
  email: EmailWithCategoryData
): Promise<{ passed: boolean; reasoning?: string }> {
  // Smart condition: delegate to LLM
  if (condition.mode === 'smart' && condition.prompt) {
    const result = await evaluateSmartCondition(
      condition.prompt,
      condition.contextFields,
      email,
    );
    return { passed: result.result, reasoning: result.reasoning };
  }

  // Field-based condition: synchronous string matching
  const fieldValue = getFieldValue(condition.field, email);
  const { operator, value } = condition;

  // Boolean operators don't use value
  if (operator === 'is_true') return { passed: fieldValue === 'true' || fieldValue === true };
  if (operator === 'is_false') return { passed: fieldValue === 'false' || fieldValue === false || fieldValue === null || fieldValue === undefined };

  // Normalize to string for comparison
  const actual = String(fieldValue ?? '').toLowerCase();
  const expected = String(value ?? '').toLowerCase();

  let passed = false;
  switch (operator) {
    case 'equals':
      passed = actual === expected; break;
    case 'not_equals':
      passed = actual !== expected; break;
    case 'contains':
      passed = actual.includes(expected); break;
    case 'not_contains':
      passed = !actual.includes(expected); break;
    case 'starts_with':
      passed = actual.startsWith(expected); break;
    case 'ends_with':
      passed = actual.endsWith(expected); break;
    default:
      passed = false;
  }
  return { passed };
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
    case 'importance':
      return email.importance_label;
    case 'priority':
      return email.importance_label ?? email.priority; // backward compat
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
    case 'account':
      return email.gmail_account_id;
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

    case 'recategorize': {
      // Recategorize uses AI to re-evaluate a single email with a refinement prompt.
      // Import is dynamic to avoid circular dependency.
      const { categorizeEmails } = await import('@/lib/ai/categorize');
      const userId = account.user_id;

      // Auto-create new categories if specified
      if (action.config?.newCategories?.length) {
        await ensureCategories(serviceClient, userId, action.config.newCategories);
      }

      await categorizeEmails(
        [email as unknown as import('@/types').Email],
        userId,
        {
          refinementPrompt: action.config?.refinementPrompt,
          sourceCategory: action.config?.sourceCategory,
          gmailAccountId: account.id,
        },
      );
      break;
    }

    default:
      throw new Error(`Unknown action type: ${action.actionType}`);
  }
}
