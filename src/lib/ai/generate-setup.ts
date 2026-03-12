import Anthropic from '@anthropic-ai/sdk';
import type { GroupingLevel, DimensionKey } from '@/types';

const anthropic = new Anthropic();

interface GeneratedSetup {
  categories: { name: string; description: string }[];
  grouping: GroupingLevel[];
  workflows: { name: string; description: string; prompt: string }[];
}

const SETUP_TOOL: Anthropic.Messages.Tool = {
  name: 'generate_inbox_setup',
  description: 'Generate a personalized inbox setup based on the user\'s description of how they want their email organized.',
  input_schema: {
    type: 'object' as const,
    properties: {
      categories: {
        type: 'array',
        description: 'Custom email categories tailored to the user. Usually 5-8 categories.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Category name (1-3 words, capitalized)' },
            description: { type: 'string', description: 'Short description to help AI classify emails into this category' },
          },
          required: ['name', 'description'],
        },
      },
      grouping_dimensions: {
        type: 'array',
        description: 'How to organize the email tree hierarchy. Usually 2 levels.',
        items: {
          type: 'object',
          properties: {
            dimension: {
              type: 'string',
              enum: ['category', 'topic', 'sender', 'sender_domain', 'date_month', 'date_week', 'priority', 'has_attachment', 'is_read'],
              description: 'The dimension to group by',
            },
            label: { type: 'string', description: 'Human-readable label for this level' },
          },
          required: ['dimension', 'label'],
        },
      },
      workflow_suggestions: {
        type: 'array',
        description: 'Simple automation rules described in plain English. These will be generated into workflows later.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short rule name' },
            description: { type: 'string', description: 'What this rule does' },
            prompt: { type: 'string', description: 'Natural language prompt to generate the workflow' },
          },
          required: ['name', 'description', 'prompt'],
        },
      },
    },
    required: ['categories', 'grouping_dimensions', 'workflow_suggestions'],
  },
};

const TEMPLATES: Record<string, string> = {
  professional: 'I want to separate work emails from personal, track action items, manage newsletters I subscribe to, and auto-archive promotional stuff. I get a lot of notifications from tools like GitHub, Jira, and Slack.',
  student: 'I\'m a student. I want to organize school/university emails, track assignments and deadlines, keep personal emails separate, and filter out noise from subscriptions and promotions.',
  minimal: 'I want a simple setup: important emails that need my attention, everything else sorted by who sent it. Auto-archive promotions and marketing.',
};

export async function generateSetup(promptOrTemplate: string): Promise<GeneratedSetup> {
  // Resolve template if it's a template key
  const prompt = TEMPLATES[promptOrTemplate] ?? promptOrTemplate;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: `You are setting up an AI-powered email organizer for a user. Based on their description, generate:
1. Custom categories: Tailored to their needs. Include both specific and catch-all categories. Each needs a clear description so the AI classifier understands what belongs there.
2. Grouping hierarchy: How to organize the email tree sidebar. "category" is the most common first level.
3. Starter workflow rules: 2-4 simple automation suggestions based on their stated preferences (e.g., auto-archive promotions, star important emails).

Keep categories concise (1-3 words each). Make descriptions specific enough for AI classification.`,
    tools: [SETUP_TOOL],
    tool_choice: { type: 'tool', name: 'generate_inbox_setup' },
    messages: [
      {
        role: 'user',
        content: `Set up my inbox. Here's what I want: "${prompt}"`,
      },
    ],
  });

  const toolUse = response.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Failed to generate setup');
  }

  const input = toolUse.input as {
    categories: { name: string; description: string }[];
    grouping_dimensions: { dimension: string; label: string }[];
    workflow_suggestions: { name: string; description: string; prompt: string }[];
  };

  return {
    categories: input.categories,
    grouping: input.grouping_dimensions.map((g) => ({
      dimension: g.dimension as DimensionKey,
      label: g.label,
    })),
    workflows: input.workflow_suggestions,
  };
}

export { TEMPLATES };
