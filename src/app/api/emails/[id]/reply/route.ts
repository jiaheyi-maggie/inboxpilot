import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { sendReply, sendForward, fetchEmailHeaders, fetchEmailBody } from '@/lib/gmail/client';
import type { GmailAccount } from '@/types';

// Lazy initialization to avoid crash if ANTHROPIC_API_KEY is missing at import time
let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

// Basic email format validation (permissive — just checks structure)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmailList(raw: unknown): string[] | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const list = raw
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    if (list.length === 0) return null;
    for (const addr of list) {
      if (!EMAIL_RE.test(addr)) return null;
    }
    return list;
  }
  if (Array.isArray(raw)) {
    const list = raw.map((e) => String(e).trim()).filter(Boolean);
    if (list.length === 0) return null;
    for (const addr of list) {
      if (!EMAIL_RE.test(addr)) return null;
    }
    return list;
  }
  return null;
}

/**
 * Parse email addresses from a header value like:
 * "Alice <alice@example.com>, Bob <bob@example.com>, charlie@example.com"
 * Returns an array of bare email addresses (lowercased).
 */
function parseEmailAddresses(headerValue: string | null): string[] {
  if (!headerValue) return [];
  // Split on commas, then extract the email from each part
  return headerValue.split(',').map((part) => {
    const match = part.match(/<([^>]+)>/);
    return (match ? match[1] : part).trim().toLowerCase();
  }).filter((e) => EMAIL_RE.test(e));
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

  type RequestBody = {
    action?: string;
    body?: string;
    replyAll?: boolean;
    forward?: boolean;
    forwardTo?: string;
    cc?: string | string[];
    bcc?: string | string[];
  };

  let body: RequestBody;
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

  const isForward = body.forward === true;
  const isReplyAll = body.replyAll === true;

  // --- DRAFT action: generate AI reply/forward draft ---
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

    const categoryContext = catRow?.category
      ? `- Category: ${catRow.category}${categoryDescription ? ` (${categoryDescription})` : ''}`
      : '';
    const importanceContext = catRow?.importance_label
      ? `- Importance: ${catRow.importance_label}`
      : '';

    const emailSubject = (email.subject as string) ?? '(no subject)';
    const emailSnippet = (email.snippet as string) ?? '';
    const emailBodyText = (email.body_text as string | null) ?? emailSnippet;

    const truncatedBody = emailBodyText.length > 3000
      ? emailBodyText.slice(0, 3000) + '\n[...truncated]'
      : emailBodyText;

    if (isForward) {
      // Forward draft: just a brief note — the forwarded content is built client-side
      const systemPrompt = `You are drafting a brief forwarding note for an email the user is forwarding to someone else.

Context about this email:
${categoryContext}
${importanceContext}

Guidelines:
- Write a very brief 1-sentence note explaining why the user might be forwarding this email
- Examples: "FYI — see below.", "Thought you'd find this interesting.", "Forwarding for your review."
- If the email is clearly actionable, say something like "Can you take a look at this?"
- Keep it under 15 words
- Return ONLY the forwarding note text, no subject line, no headers, no markdown`;

      try {
        const response = await getAnthropicClient().messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
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

        // Also fetch the original email headers + body for the forwarded content block
        let forwardedBlock = '';
        try {
          const headers = await fetchEmailHeaders(accountData, gmailMessageId);
          // Prefer cached body_text from DB, fall back to Gmail API
          let originalBody = (email.body_text as string | null);
          if (!originalBody) {
            const fetched = await fetchEmailBody(accountData, gmailMessageId);
            originalBody = fetched.body_text;
          }

          forwardedBlock = [
            '',
            '---------- Forwarded message ----------',
            headers.from ? `From: ${headers.from}` : null,
            headers.date ? `Date: ${headers.date}` : null,
            headers.subject ? `Subject: ${headers.subject}` : null,
            headers.to ? `To: ${headers.to}` : null,
            headers.cc ? `Cc: ${headers.cc}` : null,
            '',
            originalBody ?? emailSnippet ?? '',
          ].filter((line) => line !== null).join('\n');
        } catch (err) {
          console.warn(`[reply] Failed to build forwarded block for ${emailId}:`, err);
          forwardedBlock = `\n---------- Forwarded message ----------\nSubject: ${emailSubject}\n\n${emailSnippet ?? ''}`;
        }

        return NextResponse.json({
          draft: textBlock.text.trim(),
          forwardedContent: forwardedBlock,
        });
      } catch (err) {
        console.error(`[reply] AI forward draft generation failed for ${emailId}:`, err);
        const errMsg = err instanceof Error ? err.message : 'Draft generation failed';
        return NextResponse.json({ error: errMsg }, { status: 502 });
      }
    }

    // Regular reply / reply-all draft
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

      // For reply-all, also return the recipients so the UI can display them
      let replyAllRecipients: { to: string; cc: string } | undefined;
      if (isReplyAll) {
        try {
          const headers = await fetchEmailHeaders(accountData, gmailMessageId);
          const { to, cc } = buildReplyAllRecipients(
            headers.from,
            headers.to,
            headers.cc,
            accountData.email,
          );
          replyAllRecipients = { to, cc };
        } catch (err) {
          console.warn(`[reply] Failed to fetch reply-all recipients for ${emailId}:`, err);
        }
      }

      return NextResponse.json({
        draft: textBlock.text.trim(),
        ...(replyAllRecipients ? { replyAllRecipients } : {}),
      });
    } catch (err) {
      console.error(`[reply] AI draft generation failed for ${emailId}:`, err);
      const errMsg = err instanceof Error ? err.message : 'Draft generation failed';
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }
  }

  // --- SEND action: send the reply/forward via Gmail ---
  if (action === 'send') {
    const sendBody = body.body;
    if (!sendBody || typeof sendBody !== 'string' || sendBody.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message body is required' },
        { status: 400 },
      );
    }
    if (sendBody.length > 50_000) {
      return NextResponse.json(
        { error: 'Message body too large (max 50,000 characters)' },
        { status: 400 },
      );
    }

    // Parse optional CC/BCC from the request
    const ccList = validateEmailList(body.cc);
    const bccList = validateEmailList(body.bcc);
    const ccHeader = ccList ? ccList.join(', ') : undefined;
    const bccHeader = bccList ? bccList.join(', ') : undefined;

    // --- FORWARD ---
    if (isForward) {
      const forwardTo = body.forwardTo;
      if (!forwardTo || typeof forwardTo !== 'string' || !EMAIL_RE.test(forwardTo.trim())) {
        return NextResponse.json(
          { error: 'A valid "forwardTo" email address is required for forwards.' },
          { status: 400 },
        );
      }

      const originalSubject = (email.subject as string) ?? '';
      const fwdSubject = originalSubject.toLowerCase().startsWith('fwd:')
        ? originalSubject
        : `Fwd: ${originalSubject}`;

      try {
        const result = await sendForward(accountData, {
          to: forwardTo.trim(),
          subject: fwdSubject,
          body: sendBody.trim(),
          cc: ccHeader,
          bcc: bccHeader,
        });

        return NextResponse.json({
          success: true,
          messageId: result.messageId,
        });
      } catch (err) {
        console.error(`[reply] Gmail forward failed for ${emailId}:`, err);
        const errMsg = err instanceof Error ? err.message : 'Failed to send forward';
        return NextResponse.json({ error: errMsg }, { status: 502 });
      }
    }

    // --- REPLY / REPLY ALL ---
    const senderEmail = email.sender_email as string | null;
    if (!senderEmail) {
      return NextResponse.json(
        { error: 'Original sender email is missing — cannot determine recipient.' },
        { status: 400 },
      );
    }

    const originalSubject = (email.subject as string) ?? '';
    const replySubject = originalSubject.toLowerCase().startsWith('re:')
      ? originalSubject
      : `Re: ${originalSubject}`;

    // Fetch headers — needed for Message-ID (threading) and for Reply All recipients
    let headers;
    try {
      headers = await fetchEmailHeaders(accountData, gmailMessageId);
    } catch (err) {
      console.warn(`[reply] Failed to fetch headers for ${gmailMessageId}:`, err);
      headers = null;
    }

    const rfc2822MessageId = headers?.messageId ?? `<${gmailMessageId}@mail.gmail.com>`;

    // Determine To and CC for reply-all
    let toAddress = senderEmail;
    let replyCC = ccHeader;

    if (isReplyAll) {
      const { to, cc } = buildReplyAllRecipients(
        headers?.from ?? null,
        headers?.to ?? null,
        headers?.cc ?? null,
        accountData.email,
      );
      toAddress = to || senderEmail;
      // Merge reply-all CC with any manually-added CC from the user
      const allCC = [cc, ccHeader].filter(Boolean).join(', ');
      replyCC = allCC || undefined;
    }

    try {
      const result = await sendReply(accountData, {
        originalMessageId: rfc2822MessageId,
        threadId: (email.thread_id as string | null) ?? null,
        to: toAddress,
        subject: replySubject,
        body: sendBody.trim(),
        cc: replyCC,
        bcc: bccHeader,
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

/**
 * Build Reply All recipients from the original email headers.
 * - To: the original sender (From header)
 * - CC: everyone on the original To + CC, excluding the user's own email
 */
function buildReplyAllRecipients(
  from: string | null,
  to: string | null,
  cc: string | null,
  userEmail: string,
): { to: string; cc: string } {
  const userAddr = userEmail.toLowerCase();

  // Reply All "To" is the original sender
  const fromAddresses = parseEmailAddresses(from);
  const toAddress = fromAddresses[0] ?? userAddr;

  // Gather all other recipients (original To + CC), excluding the user and the original sender
  const excludeSet = new Set([userAddr, toAddress]);
  const originalTo = parseEmailAddresses(to);
  const originalCC = parseEmailAddresses(cc);
  const allOthers = [...originalTo, ...originalCC].filter(
    (addr) => !excludeSet.has(addr),
  );

  // Deduplicate
  const uniqueCC = [...new Set(allOthers)];

  return {
    to: toAddress,
    cc: uniqueCC.join(', '),
  };
}
