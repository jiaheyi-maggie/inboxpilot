import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import type { IntentResponse } from '@/types';

// Lazy initialization — avoids crash at import time if ANTHROPIC_API_KEY is missing
let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

const SYSTEM_PROMPT = `You are InboxPilot's AI assistant. Your job is to classify user messages into one of four intent types and respond with structured JSON.

## Intent Types

1. **context** — The user is teaching you something about a category, sender, or pattern.
   Examples: "January is important for Taxes", "Emails from boss@work.com are always high priority"
   Response details: { "target": "category:CategoryName" or "general", "context_text": "the teaching context to save" }

2. **command** — The user wants to perform an action on their emails.
   Examples: "Archive all noise older than 7 days", "Star all work emails from today", "Mark newsletters as read"
   Response details: { "action": "archive"|"trash"|"star"|"unstar"|"mark_read"|"mark_unread", "filters": { "category": "...", "importance": "...", "age_days": N, ... }, "estimated_count": N, "description": "human-readable description of what will happen" }

3. **rule** — The user wants to create an ongoing automation rule / workflow.
   Examples: "Always archive promotional emails", "Auto-star emails from my manager"
   Response details: { "trigger": "description of when this fires", "action": "what should happen", "workflow_suggestion": "natural language description suitable for workflow generation" }

4. **search** — The user is searching for specific emails.
   Examples: "Find emails about the Q4 report", "Show me unread from amazon.com"
   Response details: { "query": "search terms", "filters": { "sender_domain": "...", "category": "...", "is_read": false, ... } }

## Context
The user may provide a current category context (e.g., they're viewing the "Taxes" category). Use this to inform your classification.

## Rules
- Always respond with valid JSON matching: { "type": "...", "summary": "1-2 sentence summary", "details": { ... } }
- Be concise in summaries. Use natural language the user would understand.
- For commands, always estimate the count conservatively. If unsure, use 0 and say "I'll count when executing."
- For context, extract the key teaching that should be saved as a category description update.
- Never hallucinate email counts or specific data you don't have access to.`;

/**
 * POST /api/ai/intent — Classify a user message into context/command/rule/search.
 * Uses Claude Haiku for fast classification.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { message?: string; context?: { category?: string } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { message, context } = body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  if (message.trim().length > 1000) {
    return NextResponse.json({ error: 'Message too long (max 1000 characters)' }, { status: 400 });
  }

  // Fetch user's categories for context
  const serviceClient = createServiceClient();
  const { data: categories } = await serviceClient
    .from('user_categories')
    .select('name, description')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true });

  const categoryContext = categories && categories.length > 0
    ? `\n\nUser's categories: ${categories.map((c) => c.name + (c.description ? ` (${c.description})` : '')).join(', ')}`
    : '';

  const viewingContext = context?.category
    ? `\nThe user is currently viewing the "${context.category}" category.`
    : '';

  try {
    const response = await getAnthropicClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT + categoryContext + viewingContext,
      messages: [
        {
          role: 'user',
          content: message.trim(),
        },
      ],
    });

    const textBlock = response.content.find((c) => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { error: 'AI returned no text response' },
        { status: 502 }
      );
    }

    // Parse the JSON from the response — handle markdown code blocks
    let jsonText = textBlock.text.trim();
    // Strip markdown code fences if present
    if (jsonText.startsWith('```')) {
      jsonText = jsonText
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?\s*```$/, '');
    }

    let parsed: IntentResponse;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      // If JSON parsing fails, wrap the response as a generic context type
      console.warn('[intent] Failed to parse AI JSON, raw:', textBlock.text);
      parsed = {
        type: 'context',
        summary: textBlock.text,
        details: {},
      };
    }

    // Validate the type field
    const validTypes: readonly string[] = ['context', 'command', 'rule', 'search'];
    if (!validTypes.includes(parsed.type)) {
      parsed.type = 'context';
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[intent] AI classification error:', err);
    const errMsg = err instanceof Error ? err.message : 'AI classification failed';
    return NextResponse.json({ error: errMsg }, { status: 502 });
  }
}
