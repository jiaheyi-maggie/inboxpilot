import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LandingHero } from '@/components/landing/hero';

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { error, code } = await searchParams;

  // If Supabase sends ?code= here (instead of /callback), redirect to the
  // server-side callback route for robust PKCE exchange + token storage.
  if (code) {
    redirect(`/callback?code=${encodeURIComponent(code)}`);
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
