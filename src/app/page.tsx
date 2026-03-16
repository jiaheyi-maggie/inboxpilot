import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LandingHero } from '@/components/landing/hero';
import { AuthCallback } from '@/components/auth/auth-callback';

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { error, code } = await searchParams;

  // For backward compat: if a ?code= arrives (PKCE), render client-side handler
  // For implicit flow: tokens arrive in the hash (#), handled by AuthCallback
  if (code) {
    return <AuthCallback />;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/dashboard');
  }

  return (
    <>
      <LandingHero error={error} />
      {/* AuthCallback handles implicit flow hash tokens on any landing page load */}
      <AuthCallback />
    </>
  );
}
