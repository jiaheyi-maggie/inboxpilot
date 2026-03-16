import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { google } from 'googleapis';
import { encrypt } from '@/lib/crypto';
import { cookies } from 'next/headers';

const ACCOUNT_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
  '#84CC16', '#6366F1',
];

function getOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost:3000';
  const protocol = request.headers.get('x-forwarded-proto') ?? 'http';
  return `${protocol}://${host}`;
}

/**
 * GET /api/accounts/connect/callback
 * Handles the Google OAuth callback after user grants Gmail access.
 * Exchanges the authorization code for tokens and stores them in gmail_accounts.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const origin = getOrigin(request);

  if (error) {
    console.error('[connect/callback] OAuth error:', error);
    return NextResponse.redirect(`${origin}/settings?error=oauth_cancelled`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/settings?error=missing_code`);
  }

  // Verify CSRF state
  const cookieStore = await cookies();
  const storedState = cookieStore.get('oauth_state')?.value;
  cookieStore.delete('oauth_state');

  if (!storedState || storedState !== state) {
    console.error('[connect/callback] CSRF state mismatch');
    return NextResponse.redirect(`${origin}/settings?error=invalid_state`);
  }

  // Verify the user is still authenticated
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/?error=auth_failed`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = `${origin}/api/accounts/connect/callback`;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Exchange authorization code for tokens
  let tokens;
  try {
    const { tokens: t } = await oauth2Client.getToken(code);
    tokens = t;
  } catch (err) {
    console.error('[connect/callback] Token exchange failed:', err);
    return NextResponse.redirect(`${origin}/settings?error=token_exchange_failed`);
  }

  if (!tokens.access_token) {
    return NextResponse.redirect(`${origin}/settings?error=no_access_token`);
  }

  // Get the Gmail email address for this account
  oauth2Client.setCredentials(tokens);
  let email: string;
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    email = userInfo.email ?? '';
    if (!email) {
      return NextResponse.redirect(`${origin}/settings?error=no_email`);
    }
  } catch (err) {
    console.error('[connect/callback] Failed to get user info:', err);
    return NextResponse.redirect(`${origin}/settings?error=userinfo_failed`);
  }

  // Detect granted scope
  let grantedScope = 'gmail.readonly';
  if (tokens.scope?.includes('gmail.modify')) {
    grantedScope = 'gmail.modify';
  }

  // Store tokens in gmail_accounts
  const serviceClient = createServiceClient();

  const { data: existingAccounts } = await serviceClient
    .from('gmail_accounts')
    .select('id, email')
    .eq('user_id', user.id);

  const existingCount = existingAccounts?.length ?? 0;
  const isNewAccount = !existingAccounts?.some((a) => a.email === email);

  const upsertPayload: Record<string, unknown> = {
    user_id: user.id,
    email,
    access_token_encrypted: encrypt(tokens.access_token),
    token_expires_at: tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString(),
    granted_scope: grantedScope,
  };

  if (tokens.refresh_token) {
    upsertPayload.refresh_token_encrypted = encrypt(tokens.refresh_token);
  }

  if (isNewAccount) {
    upsertPayload.display_name = email.split('@')[0];
    upsertPayload.color = ACCOUNT_COLORS[existingCount % ACCOUNT_COLORS.length];
  }

  const { error: upsertError } = await serviceClient
    .from('gmail_accounts')
    .upsert(upsertPayload, { onConflict: 'user_id,email' });

  if (upsertError) {
    console.error('[connect/callback] Failed to store Gmail account:', upsertError);
    return NextResponse.redirect(`${origin}/settings?error=storage_failed`);
  }

  // Redirect back to settings with success indicator
  const status = isNewAccount ? 'account_connected' : 'account_refreshed';
  return NextResponse.redirect(`${origin}/settings?success=${status}&email=${encodeURIComponent(email)}`);
}
