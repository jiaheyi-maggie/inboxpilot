import { google } from 'googleapis';
import { decrypt } from '@/lib/crypto';
import { createServiceClient } from '@/lib/supabase/server';
import type { GmailAccount } from '@/types';

export async function getGmailClient(account: GmailAccount) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  let accessToken = decrypt(account.access_token_encrypted);
  const tokenExpired =
    account.token_expires_at &&
    new Date(account.token_expires_at) < new Date();

  // Refresh token if expired
  if (tokenExpired && account.refresh_token_encrypted) {
    const refreshToken = decrypt(account.refresh_token_encrypted);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const { credentials } = await oauth2Client.refreshAccessToken();
    accessToken = credentials.access_token!;

    // Store refreshed token
    const { encrypt: enc } = await import('@/lib/crypto');
    const serviceClient = createServiceClient();
    await serviceClient
      .from('gmail_accounts')
      .update({
        access_token_encrypted: enc(accessToken),
        token_expires_at: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : new Date(Date.now() + 3600 * 1000).toISOString(),
      })
      .eq('id', account.id);
  }

  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
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
  if (!dateStr) return new Date().toISOString();
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return new Date().toISOString();
  }
}
