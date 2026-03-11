import type { gmail_v1 } from 'googleapis';
import { createServiceClient } from '@/lib/supabase/server';
import { getGmailClient, extractSenderInfo, extractSubject, extractDate } from './client';
import type { GmailAccount } from '@/types';

const MAX_MESSAGES_PER_SYNC = 500;
const BATCH_SIZE = 50;

export async function syncEmails(account: GmailAccount): Promise<{
  fetched: number;
  errors: number;
}> {
  const gmail = await getGmailClient(account);
  const serviceClient = createServiceClient();
  let fetched = 0;
  let errors = 0;

  // List messages (newest first)
  let pageToken: string | undefined;
  const messageIds: string[] = [];

  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      maxResults: Math.min(BATCH_SIZE, MAX_MESSAGES_PER_SYNC - messageIds.length),
      pageToken,
      q: '-in:spam -in:trash',
    });

    const messages = res.data.messages ?? [];
    messageIds.push(...messages.map((m) => m.id!));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && messageIds.length < MAX_MESSAGES_PER_SYNC);

  // Filter out already-synced messages
  const { data: existingEmails } = await serviceClient
    .from('emails')
    .select('gmail_message_id')
    .eq('gmail_account_id', account.id)
    .in('gmail_message_id', messageIds);

  const existingIds = new Set(
    (existingEmails ?? []).map((e) => e.gmail_message_id)
  );
  const newMessageIds = messageIds.filter((id) => !existingIds.has(id));

  // Fetch and store new messages in batches
  for (let i = 0; i < newMessageIds.length; i += BATCH_SIZE) {
    const batch = newMessageIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((msgId) =>
        gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        })
      )
    );

    const rows = results
      .map((result, idx) => {
        if (result.status === 'rejected') {
          errors++;
          return null;
        }
        const msg = result.value.data;
        return messageToRow(account.id, msg);
      })
      .filter(Boolean);

    if (rows.length > 0) {
      const { error } = await serviceClient
        .from('emails')
        .upsert(rows as Record<string, unknown>[], {
          onConflict: 'gmail_account_id,gmail_message_id',
          ignoreDuplicates: true,
        });

      if (error) {
        console.error('Failed to upsert emails:', error);
        errors += rows.length;
      } else {
        fetched += rows.length;
      }
    }
  }

  // Update last_sync_at
  await serviceClient
    .from('gmail_accounts')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('id', account.id);

  return { fetched, errors };
}

function messageToRow(
  gmailAccountId: string,
  msg: gmail_v1.Schema$Message
) {
  const headers = (msg.payload?.headers ?? []) as {
    name: string;
    value: string;
  }[];
  const { email, name, domain } = extractSenderInfo(headers);
  const subject = extractSubject(headers);
  const receivedAt = extractDate(headers);

  const labelIds = msg.labelIds ?? [];
  const isRead = !labelIds.includes('UNREAD');
  const hasAttachment =
    msg.payload?.parts?.some(
      (p) => p.filename && p.filename.length > 0
    ) ?? false;

  return {
    gmail_account_id: gmailAccountId,
    gmail_message_id: msg.id!,
    thread_id: msg.threadId ?? null,
    subject,
    sender_email: email,
    sender_name: name,
    sender_domain: domain,
    snippet: msg.snippet ?? null,
    received_at: receivedAt,
    is_read: isRead,
    has_attachment: hasAttachment,
    label_ids: labelIds,
  };
}
