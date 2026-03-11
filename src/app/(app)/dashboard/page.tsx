import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DashboardClient } from './dashboard-client';

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  const serviceClient = createServiceClient();

  // Get active grouping config
  const { data: config } = await serviceClient
    .from('grouping_configs')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single();

  // No config yet — send to setup wizard
  if (!config) redirect('/setup');

  // Get Gmail account status
  const { data: account } = await serviceClient
    .from('gmail_accounts')
    .select('id, email, last_sync_at, sync_enabled, granted_scope')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  // Get latest sync job
  const latestSync = account
    ? await serviceClient
        .from('sync_jobs')
        .select('*')
        .eq('gmail_account_id', account.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .single()
    : null;

  return (
    <DashboardClient
      config={config}
      account={account}
      lastSync={latestSync?.data}
      userEmail={user.email ?? ''}
    />
  );
}
