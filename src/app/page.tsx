import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LandingHero } from '@/components/landing/hero';
import { CodeExchange } from '@/components/auth/code-exchange';

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { error, code } = await searchParams;

  // PKCE code exchange must happen client-side because the code verifier
  // cookie was set via document.cookie (browser-only, not in server cookies).
  if (code) {
    return <CodeExchange code={code} />;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/dashboard');
  }

  return <LandingHero error={error} />;
}
