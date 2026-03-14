import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@/lib/supabase/server';
import { CATEGORIES } from '@/types';
import type { WorkflowGraph, WorkflowTriggerType, WorkflowActionType, WorkflowConditionField, WorkflowConditionOperator, ActionNodeData } from '@/types';

const anthropic = new Anthropic();

interface GenerateResult {
  name: string;
  description: string;
  graph: WorkflowGraph;
  summary: string; // Human-readable rule description
}

/**
 * Fetch user's custom category names for prompt context.
 */
async function getUserCategoryNames(userId: string): Promise<string[]> {
  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('user_categories')
    .select('name')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });

  if (error || !data || data.length === 0) {
    return [...CATEGORIES];
  }
  return data.map((c) => c.name);
}

const WORKFLOW_TOOL: Anthropic.Messages.Tool = {
  name: 'create_workflow',
  description: 'Create an email automation workflow from the user\'s natural language description.',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: 'Short name for the workflow (2-6 words)',
      },
      description: {
        type: 'string',
        description: 'One sentence description of what this workflow does',
      },
      summary: {
        type: 'string',
        description: 'Human-readable summary: "When [trigger], if [conditions], then [actions]"',
      },
      trigger: {
        type: 'object',
        properties: {
          triggerType: {
            type: 'string',
            enum: ['new_email', 'email_categorized', 'email_from_domain', 'unread_timeout'],
            description: 'new_email: fires on every new email. email_categorized: fires after AI categorization. email_from_domain: fires when sender domain matches. unread_timeout: fires when unread for N minutes.',
          },
          config: {
            type: 'object',
            properties: {
              domain: { type: 'string', description: 'For email_from_domain trigger' },
              category: { type: 'string', description: 'For email_categorized trigger (optional)' },
              timeoutMinutes: { type: 'number', description: 'For unread_timeout trigger' },
            },
          },
        },
        required: ['triggerType'],
      },
      conditions: {
        type: 'array',
        description: 'Optional conditions to filter which emails match. Leave empty if no filtering needed.',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              enum: ['category', 'topic', 'importance', 'sender_email', 'sender_domain', 'subject', 'has_attachment', 'is_read', 'is_starred', 'label'],
            },
            operator: {
              type: 'string',
              enum: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_true', 'is_false'],
            },
            value: { type: 'string', description: 'Value to compare against. For boolean operators (is_true/is_false), leave empty.' },
          },
          required: ['field', 'operator'],
        },
      },
      actions: {
        type: 'array',
        description: 'Actions to perform on matching emails.',
        items: {
          type: 'object',
          properties: {
            actionType: {
              type: 'string',
              enum: ['trash', 'archive', 'star', 'unstar', 'mark_read', 'mark_unread', 'reassign_category', 'recategorize'],
              description: 'recategorize: use when the user wants to split, refine, or reclassify emails within a category using AI judgment (e.g., "extract ads from shopping", "split work into urgent and non-urgent"). reassign_category: use when moving ALL emails to a specific known category.',
            },
            config: {
              type: 'object',
              properties: {
                category: { type: 'string', description: 'Target category for reassign_category action' },
                sourceCategory: { type: 'string', description: 'For recategorize: the source category to refine (e.g., "Shopping")' },
                refinementPrompt: { type: 'string', description: 'For recategorize: natural language instruction for AI reclassification (e.g., "separate ads and promotional content from actual shopping orders")' },
                newCategories: { type: 'array', items: { type: 'string' }, description: 'For recategorize: new category names to create before running AI reclassification (e.g., ["Ads"]). Only include categories that do NOT already exist in the user\'s list.' },
              },
            },
          },
          required: ['actionType'],
        },
      },
    },
    required: ['name', 'description', 'summary', 'trigger', 'actions'],
  },
};

/**
 * Convert the flat tool output to a positioned WorkflowGraph.
 */
function buildGraph(input: {
  trigger: { triggerType: string; config?: Record<string, unknown> };
  conditions?: { field: string; operator: string; value?: string }[];
  actions: { actionType: string; config?: Record<string, unknown> }[];
}): WorkflowGraph {
  const nodes: WorkflowGraph['nodes'] = [];
  const edges: WorkflowGraph['edges'] = [];
  let x = 0;
  const Y = 0;
  const SPACING = 300;

  // Trigger node
  const triggerId = 'trigger-1';
  nodes.push({
    id: triggerId,
    type: 'trigger',
    position: { x, y: Y },
    data: {
      triggerType: input.trigger.triggerType as WorkflowTriggerType,
      config: (input.trigger.config ?? {}) as { domain?: string; category?: string; timeoutMinutes?: number },
    },
  });
  x += SPACING;

  let lastNodeId = triggerId;

  // Condition nodes (chained sequentially)
  if (input.conditions && input.conditions.length > 0) {
    for (let i = 0; i < input.conditions.length; i++) {
      const cond = input.conditions[i];
      const condId = `condition-${i + 1}`;
      nodes.push({
        id: condId,
        type: 'condition',
        position: { x, y: Y },
        data: {
          field: cond.field as WorkflowConditionField,
          operator: cond.operator as WorkflowConditionOperator,
          value: cond.value ?? '',
        },
      });
      edges.push({
        id: `edge-${lastNodeId}-${condId}`,
        source: lastNodeId,
        target: condId,
        sourceHandle: lastNodeId.startsWith('condition') ? 'true' : null,
      });

      // Validator requires both true and false edges on condition nodes.
      // Add a "stop" action on the false branch (no-op — mark_read is idempotent).
      const stopId = `stop-${i + 1}`;
      nodes.push({
        id: stopId,
        type: 'action',
        position: { x, y: Y + 200 },
        data: { actionType: 'mark_read' as WorkflowActionType, config: {} },
      });
      edges.push({
        id: `edge-${condId}-false-${stopId}`,
        source: condId,
        target: stopId,
        sourceHandle: 'false',
      });

      lastNodeId = condId;
      x += SPACING;
    }
  }

  // Action nodes (connected to the true branch of the last condition, or directly to trigger)
  if (input.actions.length === 0) {
    throw new Error('Workflow must have at least one action');
  }

  for (let i = 0; i < input.actions.length; i++) {
    const act = input.actions[i];
    const actId = `action-${i + 1}`;
    nodes.push({
      id: actId,
      type: 'action',
      position: { x, y: Y + i * 100 },
      data: {
        actionType: act.actionType as WorkflowActionType,
        config: (act.config ?? {}) as ActionNodeData['config'],
      },
    });
    edges.push({
      id: `edge-${lastNodeId}-${actId}`,
      source: lastNodeId,
      target: actId,
      sourceHandle: lastNodeId.startsWith('condition') ? 'true' : null,
    });
  }

  return { nodes, edges };
}

export async function generateWorkflow(
  prompt: string,
  userId: string,
): Promise<GenerateResult> {
  const categoryNames = await getUserCategoryNames(userId);

  const systemPrompt = `You are an email workflow automation builder. The user describes a rule they want in plain English, and you create a structured workflow.

Available categories for this user: ${categoryNames.join(', ')}

Guidelines:
- For domain-based rules (e.g. "emails from linkedin.com"), prefer email_from_domain trigger over new_email + condition.
- For category-based rules (e.g. "archive all Promotions"), use email_categorized trigger with the category.
- For general rules on new emails, use new_email trigger with conditions.
- Use unread_timeout only when the user mentions time-based unread rules.
- Keep it simple: use the minimum nodes needed. Most rules need just 1 trigger + 1 action.
- For reassign_category action, the target category must be from the user's list.

IMPORTANT — When to use recategorize vs reassign_category vs conditions:
- Use "recategorize" when the user wants to SPLIT, REFINE, or EXTRACT a subset from a category using semantic/AI judgment. Examples: "extract ads from shopping", "separate urgent work emails", "split newsletters into tech and non-tech". The recategorize action uses AI to re-evaluate each email — do NOT try to replicate this with string-matching conditions (contains/equals). Set sourceCategory to the category being refined, and refinementPrompt to a clear NL instruction for the AI. If the refinement requires a new category that doesn't exist in the user's list, include it in newCategories so it gets auto-created.
- Use "reassign_category" when the user wants to move ALL emails to a specific category unconditionally.
- Do NOT use condition nodes with field="subject" operator="contains" to approximate semantic classification. That approach is brittle and misses context. If the user's intent requires understanding email content, use recategorize.

- The summary should be a clear human-readable description: "When [trigger], if [conditions], then [actions]"`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    tools: [WORKFLOW_TOOL],
    tool_choice: { type: 'tool', name: 'create_workflow' },
    messages: [
      {
        role: 'user',
        content: `Create an email workflow for: "${prompt}"`,
      },
    ],
  });

  const toolUse = response.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Failed to generate workflow — no tool output from AI');
  }

  const input = toolUse.input as {
    name: string;
    description: string;
    summary: string;
    trigger: { triggerType: string; config?: Record<string, unknown> };
    conditions?: { field: string; operator: string; value?: string }[];
    actions: { actionType: string; config?: Record<string, unknown> }[];
  };

  const graph = buildGraph(input);

  return {
    name: input.name,
    description: input.description,
    graph,
    summary: input.summary,
  };
}
