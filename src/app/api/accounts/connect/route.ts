import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { google } from 'googleapis';
import { cookies } from 'next/headers';

function getOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost:3000';
  // x-forwarded-proto can be comma-separated (e.g., "https, http") — take the first
  const rawProto = request.headers.get('x-forwarded-proto') ?? 'http';
  const protocol = rawProto.split(',')[0].trim();
  return `${protocol}://${host}`;
}

/**
 * GET /api/accounts/connect
 * Initiates a direct Google OAuth flow to connect an additional Gmail account.
 * This is separate from Supabase auth — the user stays logged in.
 */
export async function GET(request: NextRequest) {
  const origin = getOrigin(request);

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/settings?error=google_oauth_not_configured`);
  }

  const redirectUri = `${origin}/api/accounts/connect/callback`;
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Generate CSRF state token and store in cookie
  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    prompt: 'select_account consent',
    state,
  });

  return NextResponse.redirect(authUrl);
}
