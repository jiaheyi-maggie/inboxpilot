'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';

/**
 * Client-side PKCE code exchange component.
 *
 * Supabase PKCE flow stores the code verifier via document.cookie (browser-only).
 * Server-side exchangeCodeForSession() can't read it — it must happen client-side.
 * After exchange, navigates to /callback?session_ready=true for token storage.
 */
export function CodeExchange({ code }: { code: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function exchange() {
      const supabase = createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error('[auth/code-exchange] Failed:', error.message);
        setError(error.message);
        // Redirect to landing with error after a brief delay
        setTimeout(() => {
          window.location.href = '/?error=auth_failed';
        }, 2000);
        return;
      }

      // Session established — redirect to callback for token storage
      // Use hard navigation so middleware can read the new session cookies
      window.location.href = '/callback?session_ready=true';
    }

    exchange();
  }, [code]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive font-medium">Authentication failed</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
          <p className="text-xs text-muted-foreground mt-2">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Signing in...</span>
      </div>
    </div>
  );
}
