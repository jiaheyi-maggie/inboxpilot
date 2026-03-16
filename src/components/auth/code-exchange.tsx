'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

/**
 * Handles PKCE code exchange client-side.
 *
 * The Supabase browser client auto-detects ?code= in the URL and exchanges it
 * via onAuthStateChange. We just need to wait for the SIGNED_IN event.
 */
export function CodeExchange() {
  const [status, setStatus] = useState<'exchanging' | 'storing' | 'error'>('exchanging');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // The Supabase client auto-detects ?code= in the URL hash/params
    // and calls exchangeCodeForSession internally during initialization.
    // We listen for the auth state change.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          setStatus('storing');

          // Store Gmail tokens via a lightweight API call
          try {
            await fetch('/api/auth/store-tokens', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                provider_token: session.provider_token ?? null,
                provider_refresh_token: session.provider_refresh_token ?? null,
                expires_in: session.expires_in ?? 3600,
              }),
            });
          } catch (err) {
            console.error('[auth] Failed to store tokens:', err);
            // Non-fatal — user is still signed in, just Gmail sync won't work
          }

          // Navigate to dashboard (or setup if first-time)
          window.location.href = '/dashboard';
        }

        if (event === 'SIGNED_OUT') {
          // Auth failed or was cancelled
          setStatus('error');
          setErrorMsg('Authentication was cancelled');
        }
      }
    );

    // Fallback: if no auth event fires within 15s, show error
    const timeout = setTimeout(() => {
      setStatus('error');
      setErrorMsg('Authentication timed out. Please try again.');
    }, 15000);

    // Also try explicit exchange as a fallback
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          console.error('[auth/code-exchange] Explicit exchange failed:', error.message);
          // Don't set error state yet — onAuthStateChange might still fire
          // from the auto-detection
        }
      });
    }

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-sm text-destructive font-medium">Authentication failed</p>
          {errorMsg && <p className="text-xs text-muted-foreground">{errorMsg}</p>}
          <a href="/" className="text-sm text-primary hover:underline">
            Try again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">
          {status === 'storing' ? 'Setting up your account...' : 'Signing in...'}
        </span>
      </div>
    </div>
  );
}
