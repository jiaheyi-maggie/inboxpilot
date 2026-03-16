import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@/lib/supabase/server';
import { CATEGORIES, importanceScoreToLabel } from '@/types';
import type { Email, ImportanceLabel } from '@/types';

const BATCH_SIZE = 25;

const anthropic = new Anthropic();

interface CategorizeResult {
  email_id: string;
  category: string;
  topic: string;
  importance: number;
  confidence: number;
}

/**
 * Map importance label back to legacy priority for backward compatibility.
 * Will be removed once priority column is dropped.
 */
function importanceToPriority(label: ImportanceLabel): 'high' | 'normal' | 'low' {
  switch (label) {
    case 'critical':
    case 'high':
      return 'high';
    case 'medium':
      return 'normal';
    case 'low':
    case 'noise':
      return 'low';
  }
}

/**
 * Fetch user's custom categories. Falls back to hardcoded defaults
 * if the user_categories table doesn't exist yet or has no rows.
 *
 * When gmailAccountId is provided, returns:
 * - Global categories (gmail_account_id IS NULL)
 * - This account's inbox-specific categories (gmail_account_id = gmailAccountId)
 * Excludes other accounts' inbox-specific categories.
 */
async function getUserCategories(
  userId: string,
  gmailAccountId?: string,
): Promise<{ name: string; description: string | null }[]> {
  const serviceClient = createServiceClient();

  let query = serviceClient
    .from('user_categories')
    .select('name, description, gmail_account_id')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });

  // When scoped to an account, fetch global + this account's categories only
  if (gmailAccountId) {
    query = query.or(`gmail_account_id.is.null,gmail_account_id.eq.${gmailAccountId}`);
  }

  const { data, error } = await query;

  if (error || !data || data.length === 0) {
    // Fall back to hardcoded defaults (pre-migration or no categories seeded)
    return CATEGORIES.map((name) => ({ name, description: null }));
  }

  return data;
}

/**
 * Fetch recent category corrections for this user to include as
 * few-shot learning context in the categorization prompt.
 */
async function getRecentCorrections(userId: string, limit = 20): Promise<
  { original_category: string; corrected_category: string; sender_email: string | null; sender_domain: string | null; subject: string | null }[]
> {
  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('category_corrections')
    .select('original_category, corrected_category, sender_email, sender_domain, subject')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data;
}

/**
 * Build the Claude tool schema with dynamic category names.
 */
function buildCategorizeTool(categoryNames: string[]): Anthropic.Messages.Tool {
  return {
    name: 'categorize_emails',
    description: 'Categorize a batch of emails by category, topic, and importance.',
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
                enum: categoryNames,
                description: 'Primary category',
              },
              topic: {
                type: 'string',
                description:
                  'Specific topic like "Project Updates", "Receipts", "Flight Booking"',
              },
              importance: {
                type: 'integer',
                minimum: 1,
                maximum: 5,
                description:
                  'Importance: 5=critical (urgent, needs immediate action), 4=high (important, should be seen today), 3=medium (regular email), 2=low (informational, can wait), 1=noise (promotional, automated, irrelevant)',
              },
              confidence: {
                type: 'number',
                description: 'Confidence score 0.0-1.0',
              },
            },
            required: ['email_id', 'category', 'topic', 'importance', 'confidence'],
          },
        },
      },
      required: ['results'],
    },
  };
}

/**
 * Options for categorizeEmails.
 * - refinementPrompt: When provided, the AI is instructed to refine/reclassify
 *   emails based on this NL instruction (e.g., "extract ads from shopping").
 *   The prompt is injected as additional context so the AI uses semantic judgment.
 * - sourceCategory: When provided with refinementPrompt, limits recategorization
 *   scope to emails currently in this category.
 */
interface CategorizeOptions {
  refinementPrompt?: string;
  sourceCategory?: string;
  /** When set, scopes categories to global + this account's inbox-specific ones */
  gmailAccountId?: string;
}

export async function categorizeEmails(
  emails: Email[],
  userId: string,
  options: CategorizeOptions = {},
): Promise<{ categorized: number; errors: number }> {
  const serviceClient = createServiceClient();
  let categorized = 0;
  let errors = 0;

  // Fetch user's custom categories, scoped to account if provided (E3)
  const userCategories = await getUserCategories(userId, options.gmailAccountId);
  const categoryNames = userCategories.map((c) => c.name);
  const tool = buildCategorizeTool(categoryNames);

  // Build category descriptions for the prompt
  const categoryDescriptions = userCategories
    .filter((c) => c.description)
    .map((c) => `- ${c.name}: ${c.description}`)
    .join('\n');

  // Fetch recent corrections for learning context (E4)
  const corrections = await getRecentCorrections(userId);
  const correctionContext = corrections.length > 0
    ? `\n\nUser correction history (learn from these preferences — when in doubt, follow the user's pattern):\n${
      corrections
        .map((c) => {
          const from = c.sender_email ?? c.sender_domain ?? 'unknown sender';
          const subj = c.subject ? ` about "${c.subject}"` : '';
          return `- Email from "${from}"${subj} was recategorized from "${c.original_category}" → "${c.corrected_category}"`;
        })
        .join('\n')
    }`
    : '';

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);

    const emailSummaries = batch
      .map(
        (e) =>
          `ID: ${e.id}\nFrom: ${e.sender_name ?? ''} <${e.sender_email ?? 'unknown'}>\nSubject: ${e.subject ?? '(no subject)'}\nSnippet: ${e.snippet ?? ''}`
      )
      .join('\n---\n');

    try {
      // Build refinement context if this is a recategorize action
      const refinementContext = options.refinementPrompt
        ? `\n\nREFINEMENT TASK: ${options.refinementPrompt}${options.sourceCategory ? `\nThese emails are currently categorized as "${options.sourceCategory}". Re-evaluate each email and assign it to the most appropriate category based on the refinement instruction above. If an email does not match the refinement criteria, keep it in "${options.sourceCategory}".` : ''}`
        : '';

      const systemContent = categoryDescriptions
        ? `Category definitions:\n${categoryDescriptions}${correctionContext}${refinementContext}`
        : correctionContext || refinementContext
          ? `${correctionContext.trim()}${refinementContext}`
          : undefined;

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        ...(systemContent ? { system: systemContent } : {}),
        tools: [tool],
        tool_choice: { type: 'tool', name: 'categorize_emails' },
        messages: [
          {
            role: 'user',
            content: `Categorize each of the following emails. For each email, determine:
1. Category: the best-fit category from the allowed list
2. Topic: a specific 2-4 word topic description
3. Importance (1-5): 5=critical (urgent, needs immediate action), 4=high (important, should be seen today), 3=medium (regular), 2=low (informational, can wait), 1=noise (promotional, automated, irrelevant)
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

      // Validate: only accept results whose email_id matches the input batch
      const batchIds = new Set(batch.map((e) => e.id));
      const validResults = input.results.filter((r) => batchIds.has(r.email_id));
      if (validResults.length < input.results.length) {
        console.warn(
          `[categorize] AI returned ${input.results.length - validResults.length} unrecognized email_id(s), discarded`
        );
      }

      // Also validate categories are in the allowed set
      const categorySet = new Set(categoryNames);
      const filteredResults = validResults.filter((r) => {
        if (!categorySet.has(r.category)) {
          console.warn(`[categorize] AI returned invalid category "${r.category}", discarding`);
          return false;
        }
        return true;
      });

      const rows = filteredResults.map((r) => {
        const score = Math.max(1, Math.min(5, Math.round(Number(r.importance) || 3)));
        const label = importanceScoreToLabel(score);
        return {
          email_id: r.email_id,
          category: r.category,
          topic: r.topic,
          importance_score: score,
          importance_label: label,
          priority: importanceToPriority(label), // backward compat
          confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
          categorized_at: new Date().toISOString(),
        };
      });

      if (rows.length === 0) {
        errors += batch.length;
        continue;
      }

      const { error } = await serviceClient
        .from('email_categories')
        .upsert(rows, { onConflict: 'email_id' });

      if (error) {
        console.error('Failed to upsert categories:', error);
        errors += batch.length;
      } else {
        categorized += rows.length;

        // Mark emails as categorized + update status
        const categorizedIds = rows.map((r) => r.email_id);
        const { error: markError } = await serviceClient
          .from('emails')
          .update({ is_categorized: true, categorization_status: 'done' })
          .in('id', categorizedIds);
        if (markError) {
          console.error('[categorize] Failed to mark emails as categorized:', markError);
        }
      }
    } catch (err) {
      console.error('Claude categorization error:', err);
      errors += batch.length;
    }
  }

  return { categorized, errors };
}

/**
 * Fetch already-categorized emails for re-categorization.
 * Optionally filtered by source category (via email_categories join).
 */
export async function getCategorizedEmails(
  userId: string,
  opts: { sourceCategory?: string; limit?: number; gmailAccountId?: string } = {}
): Promise<Email[]> {
  const { sourceCategory, limit = 100, gmailAccountId } = opts;
  const serviceClient = createServiceClient();

  // First, get all gmail account IDs for this user (or use the specific one)
  let accountIds: string[];
  if (gmailAccountId) {
    accountIds = [gmailAccountId];
  } else {
    const { data: accounts } = await serviceClient
      .from('gmail_accounts')
      .select('id')
      .eq('user_id', userId);
    accountIds = (accounts ?? []).map((a) => a.id);
  }

  if (accountIds.length === 0) return [];

  // Fetch categorized emails with their categories
  let query = serviceClient
    .from('emails')
    .select('*, email_categories!inner(category)')
    .in('gmail_account_id', accountIds)
    .eq('is_categorized', true)
    .order('received_at', { ascending: false })
    .limit(limit);

  // Filter by source category in the join table
  if (sourceCategory) {
    query = query.eq('email_categories.category', sourceCategory);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[getCategorizedEmails] Failed to fetch:', error);
    return [];
  }

  // Strip the join data — categorizeEmails only needs Email fields
  return (data ?? []).map((row) => {
    const { email_categories: _, ...email } = row as Record<string, unknown> & { email_categories: unknown };
    return email as unknown as Email;
  });
}

export async function getUncategorizedEmails(
  gmailAccountId: string,
  opts: { includeUnread?: boolean; limit?: number } = {}
): Promise<Email[]> {
  const { includeUnread = false, limit = 100 } = opts;
  const serviceClient = createServiceClient();

  let query = serviceClient
    .from('emails')
    .select('*')
    .eq('gmail_account_id', gmailAccountId)
    .eq('is_categorized', false)
    .order('received_at', { ascending: false })
    .limit(limit);

  // By default, only categorize read emails (skip unread)
  if (!includeUnread) {
    query = query.eq('is_read', true);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch uncategorized emails:', error);
    return [];
  }

  return data as Email[];
}
