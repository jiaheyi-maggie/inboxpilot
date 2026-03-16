import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LandingHero } from '@/components/landing/hero';

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string }>;
}) {
  const { error, code } = await searchParams;

  // Diagnostic: if ?code= arrives here, Supabase is NOT redirecting to /callback.
  // This means the redirectTo URL is not in the Supabase Redirect URLs allow-list.
  if (code) {
    console.error(
      '[auth/page] OAuth code arrived at / instead of /callback.',
      'Check Supabase Dashboard > Auth > URL Configuration > Redirect URLs.',
      'Must include: https://inboxpilot-azure.vercel.app/callback'
    );
    // Forward to callback via client-side navigation (preserves cookies)
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
