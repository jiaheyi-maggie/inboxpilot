'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Handles implicit flow auth callback.
 *
 * With implicit flow, Supabase returns tokens in the URL hash (#access_token=...).
 * The browser Supabase client auto-detects and processes them via onAuthStateChange.
 * This component listens for SIGNED_IN and stores Gmail tokens, then navigates to dashboard.
 */
export function AuthCallback() {
  const handledRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session && !handledRef.current) {
          handledRef.current = true;

          // Store Gmail tokens
          if (session.provider_token) {
            try {
              await fetch('/api/auth/store-tokens', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  provider_token: session.provider_token,
                  provider_refresh_token: session.provider_refresh_token ?? null,
                  expires_in: session.expires_in ?? 3600,
                }),
              });
            } catch (err) {
              console.error('[auth] Failed to store tokens:', err);
            }
          }

          // Navigate to dashboard — use hard navigation so middleware reads new cookies
          window.location.href = '/dashboard';
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // This component renders nothing — it's just an auth listener
  return null;
}
