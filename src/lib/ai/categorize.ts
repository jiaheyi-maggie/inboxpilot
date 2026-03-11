import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@/lib/supabase/server';
import type { Email } from '@/types';

const BATCH_SIZE = 25;

const anthropic = new Anthropic();

const CATEGORIZE_TOOL: Anthropic.Messages.Tool = {
  name: 'categorize_emails',
  description: 'Categorize a batch of emails by category, topic, and priority.',
  input_schema: {
    type: 'object' as const,
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            email_id: { type: 'string', description: 'The email ID' },
            category: {
              type: 'string',
              enum: [
                'Work',
                'Personal',
                'Finance',
                'Shopping',
                'Travel',
                'Social',
                'Newsletters',
                'Notifications',
                'Promotions',
                'Other',
              ],
              description: 'Primary category',
            },
            topic: {
              type: 'string',
              description:
                'Specific topic like "Project Updates", "Receipts", "Flight Booking"',
            },
            priority: {
              type: 'string',
              enum: ['high', 'normal', 'low'],
              description:
                'Priority: high for urgent/important, low for noise/promotions',
            },
            confidence: {
              type: 'number',
              description: 'Confidence score 0.0-1.0',
            },
          },
          required: ['email_id', 'category', 'topic', 'priority', 'confidence'],
        },
      },
    },
    required: ['results'],
  },
};

interface CategorizeResult {
  email_id: string;
  category: string;
  topic: string;
  priority: string;
  confidence: number;
}

export async function categorizeEmails(
  emails: Email[]
): Promise<{ categorized: number; errors: number }> {
  const serviceClient = createServiceClient();
  let categorized = 0;
  let errors = 0;

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);

    const emailSummaries = batch
      .map(
        (e) =>
          `ID: ${e.id}\nFrom: ${e.sender_name ?? ''} <${e.sender_email ?? 'unknown'}>\nSubject: ${e.subject ?? '(no subject)'}\nSnippet: ${e.snippet ?? ''}`
      )
      .join('\n---\n');

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        tools: [CATEGORIZE_TOOL],
        tool_choice: { type: 'tool', name: 'categorize_emails' },
        messages: [
          {
            role: 'user',
            content: `Categorize each of the following emails. For each email, determine:
1. Category: the best-fit category from the allowed list
2. Topic: a specific 2-4 word topic description
3. Priority: "high" for urgent/action-required, "normal" for regular, "low" for noise/promotions
4. Confidence: how confident you are (0.0-1.0)

Emails:
${emailSummaries}`,
          },
        ],
      });

      const toolUse = response.content.find(
        (c) => c.type === 'tool_use'
      );
      if (!toolUse || toolUse.type !== 'tool_use') {
        errors += batch.length;
        continue;
      }

      const input = toolUse.input as { results: CategorizeResult[] };
      const rows = input.results.map((r) => ({
        email_id: r.email_id,
        category: r.category,
        topic: r.topic,
        priority: r.priority,
        confidence: r.confidence,
        categorized_at: new Date().toISOString(),
      }));

      const { error } = await serviceClient
        .from('email_categories')
        .upsert(rows, { onConflict: 'email_id' });

      if (error) {
        console.error('Failed to upsert categories:', error);
        errors += batch.length;
      } else {
        categorized += rows.length;
      }
    } catch (err) {
      console.error('Claude categorization error:', err);
      errors += batch.length;
    }
  }

  return { categorized, errors };
}

export async function getUncategorizedEmails(
  gmailAccountId: string,
  limit = 100
): Promise<Email[]> {
  const serviceClient = createServiceClient();

  const { data, error } = await serviceClient
    .from('emails')
    .select('*')
    .eq('gmail_account_id', gmailAccountId)
    .not(
      'id',
      'in',
      `(select email_id from email_categories)`
    )
    .order('received_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to fetch uncategorized emails:', error);
    return [];
  }

  return data as Email[];
}
