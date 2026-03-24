'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FolderTree, Sparkles, Clock } from 'lucide-react';
import { toast } from 'sonner';

export function LandingHero({ error }: { error?: string }) {
  const [loading, setLoading] = useState(false);

  // Show auth error from redirect (e.g., ?error=auth_failed)
  useEffect(() => {
    if (error === 'auth_failed') {
      toast.error('Authentication failed. Please try again.');
    } else if (error === 'no_code') {
      toast.error('Authorization was cancelled. Please try again.');
    }
  }, [error]);

  const handleSignIn = async () => {
    if (loading) return; // guard against double-clicks
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/callback`,
          scopes: 'https://www.googleapis.com/auth/gmail.modify',
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account consent',
          },
        },
      });
      if (error) {
        console.error('[auth] signInWithOAuth failed:', error.message);
        toast.error('Could not connect to Google. Please try again.');
        setLoading(false);
      }
      // If no error, browser is redirecting — don't reset loading
    } catch (err) {
      console.error('[auth] signInWithOAuth exception:', err);
      toast.error('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="" width={24} height={24} className="rounded" />
          <span className="font-bold text-slate-900">Vorra</span>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center max-w-lg mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
            Your inbox,
            <br />
            organized by AI
          </h1>
          <p className="text-slate-500 text-base sm:text-lg">
            Vorra automatically categorizes your emails and lets you browse
            them like a file system. Group by category, sender, date — any way you
            want.
          </p>
        </div>

        <Button
          onClick={handleSignIn}
          disabled={loading}
          size="lg"
          className="w-full sm:w-auto px-8"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          {loading ? 'Connecting...' : 'Sign in with Google'}
        </Button>

        <p className="text-xs text-slate-400 mt-3">
          Secure access to organize, archive, and manage your inbox.
        </p>
      </main>

      {/* Features */}
      <section className="px-6 py-12 border-t border-slate-100">
        <div className="max-w-lg mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6">
          <Feature
            icon={<Sparkles className="h-5 w-5 text-violet-500" />}
            title="AI Categorization"
            description="Emails are automatically sorted into Work, Shopping, Finance, and more"
          />
          <Feature
            icon={<FolderTree className="h-5 w-5 text-amber-500" />}
            title="Tree Navigation"
            description="Browse your inbox like a file system with customizable grouping"
          />
          <Feature
            icon={<Clock className="h-5 w-5 text-blue-500" />}
            title="Background Sync"
            description="Your inbox stays organized automatically, even when you're away"
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-slate-100 text-center text-xs text-slate-400 flex items-center justify-center gap-3">
        <a href="/privacy" className="hover:text-slate-600">Privacy Policy</a>
        <span>·</span>
        <a href="/terms" className="hover:text-slate-600">Terms of Service</a>
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center sm:text-left">
      <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
        {icon}
        <h3 className="font-semibold text-sm text-slate-900">{title}</h3>
      </div>
      <p className="text-xs text-slate-500">{description}</p>
    </div>
  );
}
