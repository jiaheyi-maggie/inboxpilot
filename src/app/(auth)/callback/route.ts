import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/crypto';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=no_code`);
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/?error=auth_failed`);
  }

  const session = data.session;
  const user = session.user;
  const providerToken = session.provider_token;
  const providerRefreshToken = session.provider_refresh_token;

  // Store encrypted OAuth tokens for Gmail API access
  if (providerToken) {
    const serviceClient = createServiceClient();
    const email = user.email ?? user.user_metadata?.email ?? '';

    // Detect granted scope from user metadata
    const scopes = (user.user_metadata?.provider_scopes as string) ?? '';
    const grantedScope = scopes.includes('gmail.modify')
      ? 'gmail.modify'
      : 'gmail.readonly';

    const { error: upsertError } = await serviceClient
      .from('gmail_accounts')
      .upsert(
        {
          user_id: user.id,
          email,
          access_token_encrypted: encrypt(providerToken),
          refresh_token_encrypted: providerRefreshToken
            ? encrypt(providerRefreshToken)
            : null,
          token_expires_at: new Date(
            Date.now() + (session.expires_in ?? 3600) * 1000
          ).toISOString(),
          granted_scope: grantedScope,
        },
        { onConflict: 'user_id,email' }
      );

    if (upsertError) {
      console.error('Failed to store Gmail tokens:', upsertError);
    }

    // Check if first-time user — redirect to setup wizard
    const { data: existingConfig } = await serviceClient
      .from('grouping_configs')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!existingConfig) {
      return NextResponse.redirect(`${origin}/setup`);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
