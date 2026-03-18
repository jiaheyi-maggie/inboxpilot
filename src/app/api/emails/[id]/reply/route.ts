import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { sendReply } from '@/lib/gmail/client';
import type { GmailAccount } from '@/types';

// Lazy initialization to avoid crash if ANTHROPIC_API_KEY is missing at import time
let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

/**
 * Fetch the original email's Gmail Message-ID header from the Gmail API.
 * This is the RFC 2822 Message-ID (e.g., "<abc@mail.gmail.com>"), NOT the
 * Gmail API resource ID. Required for In-Reply-To/References threading headers.
 */
async function fetchOriginalMessageIdHeader(
  account: GmailAccount,
  gmailMessageId: string,
): Promise<string | null> {
  const { getGmailClient } = await import('@/lib/gmail/client');
  const gmail = await getGmailClient(account);
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: gmailMessageId,
    format: 'metadata',
    metadataHeaders: ['Message-ID'],
  });
  const header = res.data.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === 'message-id',
  );
  return header?.value ?? null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: emailId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { action?: string; body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'draft' && action !== 'send') {
    return NextResponse.json(
      { error: 'Invalid action. Expected "draft" or "send".' },
      { status: 400 },
    );
  }

  const serviceClient = createServiceClient();

  // Fetch email with account info (same join pattern as actions/body routes)
  const { data: email, error: emailError } = await serviceClient
    .from('emails')
    .select(
      '*, gmail_accounts!inner(user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, id, email, history_id, last_sync_at, sync_enabled, granted_scope, created_at)',
    )
    .eq('id', emailId)
    .single();

  if (emailError || !email) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 });
  }

  const accountData = email.gmail_accounts as unknown as GmailAccount;
  if (accountData.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (accountData.granted_scope !== 'gmail.modify') {
    return NextResponse.json(
      { error: 'Gmail modify scope required. Please re-authenticate.' },
      { status: 403 },
    );
  }

  const gmailMessageId = email.gmail_message_id as string;
  if (!gmailMessageId) {
    return NextResponse.json(
      { error: 'Email has no Gmail message ID — cannot reply.' },
      { status: 400 },
    );
  }

  // --- DRAFT action: generate AI reply ---
  if (action === 'draft') {
    // Fetch category + importance context
    const { data: catRow } = await serviceClient
      .from('email_categories')
      .select('category, topic, importance_label, confidence')
      .eq('email_id', emailId)
      .single();

    // Fetch category description from user_categories (the user's "teachings")
    let categoryDescription: string | null = null;
    if (catRow?.category) {
      const { data: userCat } = await serviceClient
        .from('user_categories')
        .select('description')
        .eq('user_id', user.id)
        .eq('name', catRow.category)
        .single();
      categoryDescription = userCat?.description ?? null;
    }

    // Build context for the AI
    const categoryContext = catRow?.category
      ? `- Category: ${catRow.category}${categoryDescription ? ` (${categoryDescription})` : ''}`
      : '';
    const importanceContext = catRow?.importance_label
      ? `- Importance: ${catRow.importance_label}`
      : '';

    const emailSubject = (email.subject as string) ?? '(no subject)';
    const emailSnippet = (email.snippet as string) ?? '';
    const emailBodyText = (email.body_text as string | null) ?? emailSnippet;

    // Use body text (truncated to ~3000 chars to keep prompt fast for Haiku)
    const truncatedBody = emailBodyText.length > 3000
      ? emailBodyText.slice(0, 3000) + '\n[...truncated]'
      : emailBodyText;

    const systemPrompt = `You are drafting an email reply on behalf of the user.

Context about this email:
${categoryContext}
${importanceContext}

Guidelines:
- For critical/high importance: professional, thorough tone
- For medium importance: friendly but concise
- For low/noise importance: brief, one-liner if appropriate
- Match the formality level of the original email
- Don't include a greeting if the original didn't have one
- Don't include "Best regards" or similar closings unless the original had one
- Keep it concise -- aim for 2-5 sentences
- Never fabricate facts or commitments
- Return ONLY the reply text, no subject line, no headers, no markdown formatting`;

    try {
      const response = await getAnthropicClient().messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Subject: ${emailSubject}\n\n${truncatedBody}`,
          },
        ],
      });

      const textBlock = response.content.find((c) => c.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        return NextResponse.json(
          { error: 'AI returned no text response' },
          { status: 502 },
        );
      }

      return NextResponse.json({ draft: textBlock.text.trim() });
    } catch (err) {
      console.error(`[reply] AI draft generation failed for ${emailId}:`, err);
      const errMsg = err instanceof Error ? err.message : 'Draft generation failed';
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }
  }

  // --- SEND action: send the reply via Gmail ---
  if (action === 'send') {
    const replyBody = body.body;
    if (!replyBody || typeof replyBody !== 'string' || replyBody.trim().length === 0) {
      return NextResponse.json(
        { error: 'Reply body is required' },
        { status: 400 },
      );
    }
    if (replyBody.length > 50_000) {
      return NextResponse.json(
        { error: 'Reply body too large (max 50,000 characters)' },
        { status: 400 },
      );
    }

    const senderEmail = email.sender_email as string | null;
    if (!senderEmail) {
      return NextResponse.json(
        { error: 'Original sender email is missing -- cannot determine recipient.' },
        { status: 400 },
      );
    }

    // Build the reply subject
    const originalSubject = (email.subject as string) ?? '';
    const replySubject = originalSubject.toLowerCase().startsWith('re:')
      ? originalSubject
      : `Re: ${originalSubject}`;

    // Fetch the RFC 2822 Message-ID header for threading
    let rfc2822MessageId: string;
    try {
      const headerValue = await fetchOriginalMessageIdHeader(accountData, gmailMessageId);
      // Fall back to constructing one from the Gmail message ID if the header is missing
      rfc2822MessageId = headerValue ?? `<${gmailMessageId}@mail.gmail.com>`;
    } catch (err) {
      console.warn(`[reply] Failed to fetch Message-ID header for ${gmailMessageId}:`, err);
      rfc2822MessageId = `<${gmailMessageId}@mail.gmail.com>`;
    }

    try {
      const result = await sendReply(accountData, {
        originalMessageId: rfc2822MessageId,
        threadId: (email.thread_id as string | null) ?? null,
        to: senderEmail,
        subject: replySubject,
        body: replyBody.trim(),
      });

      return NextResponse.json({
        success: true,
        messageId: result.messageId,
      });
    } catch (err) {
      console.error(`[reply] Gmail send failed for ${emailId}:`, err);
      const errMsg = err instanceof Error ? err.message : 'Failed to send reply';
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }
  }

  // Should never reach here due to the action validation above
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
