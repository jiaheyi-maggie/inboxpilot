import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { decrypt, encrypt } from '@/lib/crypto';
import { createServiceClient } from '@/lib/supabase/server';
import type { GmailAccount } from '@/types';

// In-memory lock per account to prevent concurrent token refreshes
const refreshLocks = new Map<string, Promise<string>>();

// 5-minute buffer before actual expiry to account for clock skew
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export async function getGmailClient(account: GmailAccount) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  let accessToken = decrypt(account.access_token_encrypted);
  const tokenExpired =
    account.token_expires_at &&
    new Date(account.token_expires_at).getTime() < Date.now() + TOKEN_EXPIRY_BUFFER_MS;

  // Refresh token if expired (with per-account lock to prevent races)
  if (tokenExpired && account.refresh_token_encrypted) {
    accessToken = await refreshTokenWithLock(account);
  }

  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

async function refreshTokenWithLock(account: GmailAccount): Promise<string> {
  const existing = refreshLocks.get(account.id);
  if (existing) {
    return existing;
  }

  const promise = doRefreshToken(account).finally(() => {
    refreshLocks.delete(account.id);
  });

  refreshLocks.set(account.id, promise);
  return promise;
}

async function doRefreshToken(account: GmailAccount): Promise<string> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  const refreshToken = decrypt(account.refresh_token_encrypted!);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error('Token refresh returned no access token');
  }
  const accessToken = credentials.access_token;

  // Store refreshed token
  const serviceClient = createServiceClient();
  const { error: refreshUpdateError } = await serviceClient
    .from('gmail_accounts')
    .update({
      access_token_encrypted: encrypt(accessToken),
      token_expires_at: credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : new Date(Date.now() + 3600 * 1000).toISOString(),
    })
    .eq('id', account.id);
  if (refreshUpdateError) {
    console.error('[gmail] Failed to store refreshed token:', refreshUpdateError);
  }

  return accessToken;
}

export function extractSenderInfo(headers: { name: string; value: string }[]) {
  const fromHeader = headers.find(
    (h) => h.name.toLowerCase() === 'from'
  )?.value;
  if (!fromHeader) return { email: null, name: null, domain: null };

  // Parse "Name <email@domain.com>" or "email@domain.com"
  const match = fromHeader.match(/(?:"?([^"]*)"?\s)?<?([^\s>]+@[^\s>]+)>?/);
  if (!match) return { email: fromHeader, name: null, domain: null };

  const email = match[2]?.toLowerCase() ?? null;
  const name = match[1]?.trim() || null;
  const domain = email?.split('@')[1] ?? null;

  return { email, name, domain };
}

export function extractSubject(headers: { name: string; value: string }[]) {
  return (
    headers.find((h) => h.name.toLowerCase() === 'subject')?.value ?? null
  );
}

export function extractDate(headers: { name: string; value: string }[]) {
  const dateStr = headers.find(
    (h) => h.name.toLowerCase() === 'date'
  )?.value;
  if (!dateStr) {
    console.warn('[gmail] Missing Date header, falling back to now()');
    return new Date().toISOString();
  }
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    console.warn(`[gmail] Unparseable Date header: "${dateStr}", falling back to now()`);
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

// --- Gmail Write Operations (require gmail.modify scope) ---

export async function markAsRead(account: GmailAccount, gmailMessageId: string) {
  const gmail = await getGmailClient(account);
  await gmail.users.messages.modify({
    userId: 'me',
    id: gmailMessageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });
}

export async function markAsUnread(account: GmailAccount, gmailMessageId: string) {
  const gmail = await getGmailClient(account);
  await gmail.users.messages.modify({
    userId: 'me',
    id: gmailMessageId,
    requestBody: { addLabelIds: ['UNREAD'] },
  });
}

export async function trashEmail(account: GmailAccount, gmailMessageId: string) {
  const gmail = await getGmailClient(account);
  await gmail.users.messages.trash({ userId: 'me', id: gmailMessageId });
}

export async function trashEmails(account: GmailAccount, gmailMessageIds: string[]) {
  const gmail = await getGmailClient(account);
  const results = await Promise.allSettled(
    gmailMessageIds.map((id) =>
      gmail.users.messages.trash({ userId: 'me', id })
    )
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  return { trashed: gmailMessageIds.length - failed, failed };
}

export async function archiveEmail(account: GmailAccount, gmailMessageId: string) {
  const gmail = await getGmailClient(account);
  await gmail.users.messages.modify({
    userId: 'me',
    id: gmailMessageId,
    requestBody: { removeLabelIds: ['INBOX'] },
  });
}

export async function archiveEmails(account: GmailAccount, gmailMessageIds: string[]) {
  const gmail = await getGmailClient(account);
  const results = await Promise.allSettled(
    gmailMessageIds.map((id) =>
      gmail.users.messages.modify({
        userId: 'me',
        id,
        requestBody: { removeLabelIds: ['INBOX'] },
      })
    )
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  return { archived: gmailMessageIds.length - failed, failed };
}

export async function markAsReadBulk(account: GmailAccount, gmailMessageIds: string[]) {
  const gmail = await getGmailClient(account);
  const results = await Promise.allSettled(
    gmailMessageIds.map((id) =>
      gmail.users.messages.modify({
        userId: 'me',
        id,
        requestBody: { removeLabelIds: ['UNREAD'] },
      })
    )
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  return { updated: gmailMessageIds.length - failed, failed };
}

export async function markAsUnreadBulk(account: GmailAccount, gmailMessageIds: string[]) {
  const gmail = await getGmailClient(account);
  const results = await Promise.allSettled(
    gmailMessageIds.map((id) =>
      gmail.users.messages.modify({
        userId: 'me',
        id,
        requestBody: { addLabelIds: ['UNREAD'] },
      })
    )
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  return { updated: gmailMessageIds.length - failed, failed };
}

export async function starEmail(account: GmailAccount, gmailMessageId: string) {
  const gmail = await getGmailClient(account);
  await gmail.users.messages.modify({
    userId: 'me',
    id: gmailMessageId,
    requestBody: { addLabelIds: ['STARRED'] },
  });
}

export async function unstarEmail(account: GmailAccount, gmailMessageId: string) {
  const gmail = await getGmailClient(account);
  await gmail.users.messages.modify({
    userId: 'me',
    id: gmailMessageId,
    requestBody: { removeLabelIds: ['STARRED'] },
  });
}

export async function starEmails(account: GmailAccount, gmailMessageIds: string[]) {
  const gmail = await getGmailClient(account);
  const results = await Promise.allSettled(
    gmailMessageIds.map((id) =>
      gmail.users.messages.modify({
        userId: 'me',
        id,
        requestBody: { addLabelIds: ['STARRED'] },
      })
    )
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  return { starred: gmailMessageIds.length - failed, failed };
}

export async function unstarEmails(account: GmailAccount, gmailMessageIds: string[]) {
  const gmail = await getGmailClient(account);
  const results = await Promise.allSettled(
    gmailMessageIds.map((id) =>
      gmail.users.messages.modify({
        userId: 'me',
        id,
        requestBody: { removeLabelIds: ['STARRED'] },
      })
    )
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  return { unstarred: gmailMessageIds.length - failed, failed };
}

export async function unarchiveEmail(account: GmailAccount, gmailMessageId: string) {
  const gmail = await getGmailClient(account);
  await gmail.users.messages.modify({
    userId: 'me',
    id: gmailMessageId,
    requestBody: { addLabelIds: ['INBOX'] },
  });
}

export async function untrashEmail(account: GmailAccount, gmailMessageId: string) {
  const gmail = await getGmailClient(account);
  await gmail.users.messages.untrash({ userId: 'me', id: gmailMessageId });
}

export async function untrashEmails(account: GmailAccount, gmailMessageIds: string[]) {
  const gmail = await getGmailClient(account);
  const results = await Promise.allSettled(
    gmailMessageIds.map((id) =>
      gmail.users.messages.untrash({ userId: 'me', id })
    )
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  return { restored: gmailMessageIds.length - failed, failed };
}

// --- Email Body Fetching ---

export async function fetchEmailBody(
  account: GmailAccount,
  gmailMessageId: string
): Promise<{ body_html: string | null; body_text: string | null }> {
  const gmail = await getGmailClient(account);
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: gmailMessageId,
    format: 'full',
  });

  const payload = res.data.payload;
  if (!payload) return { body_html: null, body_text: null };

  const { html, text } = extractBodyParts(payload);
  return { body_html: html, body_text: text };
}

/**
 * Recursively walk MIME parts to extract text/html and text/plain bodies.
 * Handles simple messages, multipart/alternative, and nested multipart/mixed.
 */
function extractBodyParts(
  part: gmail_v1.Schema$MessagePart
): { html: string | null; text: string | null } {
  const mime = part.mimeType ?? '';

  // Leaf node with body data
  if (part.body?.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (mime === 'text/html') return { html: decoded, text: null };
    if (mime === 'text/plain') return { html: null, text: decoded };
    // Unknown mime with body data — treat as text
    return { html: null, text: decoded };
  }

  // Multipart — recurse into children
  if (part.parts) {
    let html: string | null = null;
    let text: string | null = null;
    for (const sub of part.parts) {
      // Skip attachment parts (they have a filename)
      if (sub.filename && sub.filename.length > 0) continue;
      const result = extractBodyParts(sub);
      if (result.html && !html) html = result.html;
      if (result.text && !text) text = result.text;
    }
    return { html, text };
  }

  return { html: null, text: null };
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}
