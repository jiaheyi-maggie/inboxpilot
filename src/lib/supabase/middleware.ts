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

  // Skip getUser() when ?code= is present — the code exchange hasn't
  // happened yet (it's done client-side). Calling getUser() here could
  // interfere with the PKCE cookie state.
  if (request.nextUrl.pathname === '/' && request.nextUrl.searchParams.has('code')) {
    return supabaseResponse;
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
