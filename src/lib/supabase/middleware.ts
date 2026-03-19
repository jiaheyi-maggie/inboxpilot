import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
      // Explicit cookie options to guarantee session persistence across browser
      // restarts. Without these, some environments may default to session-only
      // cookies (no maxAge) which are cleared when the browser/tab closes.
      // maxAge: 400 days = maximum allowed by Chrome (RFC 6265bis).
      cookieOptions: {
        path: '/',
        secure: request.nextUrl.protocol === 'https:',
        sameSite: 'lax' as const,
        httpOnly: false,
        maxAge: 400 * 24 * 60 * 60, // 400 days
      },
    }
  );

  // getUser() is essential for session persistence: it validates the current
  // access token and, if expired, uses the refresh token to obtain new tokens.
  // The new tokens are written back to cookies via setAll(). Without this call,
  // the access token expires after 1 hour and the user must re-authenticate.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users away from app routes
  const isAppRoute =
    request.nextUrl.pathname.startsWith('/dashboard') ||
    request.nextUrl.pathname.startsWith('/setup') ||
    request.nextUrl.pathname.startsWith('/settings') ||
    request.nextUrl.pathname.startsWith('/workflows');
  if (!user && isAppRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return createRedirectWithCookies(url, supabaseResponse);
  }

  // Redirect authenticated users from landing to dashboard
  if (user && request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return createRedirectWithCookies(url, supabaseResponse);
  }

  return supabaseResponse;
}

function createRedirectWithCookies(url: URL, supabaseResponse: NextResponse): NextResponse {
  const redirectResponse = NextResponse.redirect(url);
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}
