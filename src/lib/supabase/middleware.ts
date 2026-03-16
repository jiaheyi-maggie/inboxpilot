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
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Handle PKCE code exchange when Supabase sends ?code= to the Site URL (/).
  // This MUST happen before getUser() — the code exchange establishes the session,
  // and the middleware has guaranteed cookie read/write access.
  const code = request.nextUrl.searchParams.get('code');
  if (code && request.nextUrl.pathname === '/') {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Session established — redirect to /callback to handle token storage
      // (account creation, scope detection, first-time user check).
      // The session cookies are set via setAll() above, so /callback can read them.
      const url = request.nextUrl.clone();
      url.pathname = '/callback';
      // Pass a flag so callback knows the code is already exchanged
      url.searchParams.delete('code');
      url.searchParams.set('session_ready', 'true');
      return createRedirectWithCookies(url, supabaseResponse);
    } else {
      console.error('[middleware] exchangeCodeForSession failed:', error.message);
      // Fall through to render landing page with error
      const url = request.nextUrl.clone();
      url.pathname = '/';
      url.searchParams.delete('code');
      url.searchParams.set('error', 'auth_failed');
      return createRedirectWithCookies(url, supabaseResponse);
    }
  }

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

/**
 * Create a redirect response that preserves auth cookies from supabaseResponse.
 */
function createRedirectWithCookies(url: URL, supabaseResponse: NextResponse): NextResponse {
  const redirectResponse = NextResponse.redirect(url);
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}
