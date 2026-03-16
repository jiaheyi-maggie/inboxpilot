import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/crypto';

const ACCOUNT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#84CC16', '#6366F1'];

/**
 * POST /api/auth/store-tokens
 * Called client-side after successful PKCE code exchange to store Gmail OAuth tokens.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    provider_token: string | null;
    provider_refresh_token: string | null;
    expires_in: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { provider_token, provider_refresh_token, expires_in } = body;

  if (!provider_token) {
    // No provider token — session established but no Gmail access
    // This is OK for the auth flow; Gmail sync will fail later with a clear error
    return NextResponse.json({ stored: false, reason: 'no_provider_token' });
  }

  const serviceClient = createServiceClient();
  const email = user.email ?? user.user_metadata?.email ?? '';

  // Detect granted scope
  let grantedScope = 'gmail.readonly';
  try {
    const tokenInfoRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${provider_token}`
    );
    if (tokenInfoRes.ok) {
      const tokenInfo = await tokenInfoRes.json();
      const scopeStr = (tokenInfo.scope as string) ?? '';
      if (scopeStr.includes('gmail.modify')) {
        grantedScope = 'gmail.modify';
      }
    }
  } catch {
    // Fall back to gmail.readonly
  }

  // Check if new account
  const { data: existingAccounts } = await serviceClient
    .from('gmail_accounts')
    .select('id, email')
    .eq('user_id', user.id);

  const existingCount = existingAccounts?.length ?? 0;
  const isNewAccount = !existingAccounts?.some((a) => a.email === email);

  // Build upsert payload
  const upsertPayload: Record<string, unknown> = {
    user_id: user.id,
    email,
    access_token_encrypted: encrypt(provider_token),
    token_expires_at: new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString(),
    granted_scope: grantedScope,
  };

  if (provider_refresh_token) {
    upsertPayload.refresh_token_encrypted = encrypt(provider_refresh_token);
  }

  if (isNewAccount) {
    const colorIndex = existingCount % ACCOUNT_COLORS.length;
    upsertPayload.color = ACCOUNT_COLORS[colorIndex];
    upsertPayload.display_name = email.split('@')[0];
  }

  const { error: upsertError } = await serviceClient
    .from('gmail_accounts')
    .upsert(upsertPayload, { onConflict: 'user_id,email' });

  if (upsertError) {
    console.error('[auth/store-tokens] Failed to store tokens:', upsertError);
    return NextResponse.json({ error: 'Failed to store tokens' }, { status: 500 });
  }

  return NextResponse.json({ stored: true, grantedScope });
}
