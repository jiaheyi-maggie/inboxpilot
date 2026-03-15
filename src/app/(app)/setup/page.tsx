import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SetupWizard } from './setup-wizard';

export default async function SetupPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  const serviceClient = createServiceClient();

  // If user already has a config (either new or legacy), skip to dashboard
  const [{ data: viewConfig }, { data: legacyConfig }] = await Promise.all([
    serviceClient
      .from('view_configs')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
    serviceClient
      .from('grouping_configs')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ]);

  if (viewConfig || legacyConfig) redirect('/dashboard');

  return <SetupWizard />;
}
