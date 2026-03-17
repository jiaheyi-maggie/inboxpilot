import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  const serviceClient = createServiceClient();

  // Fetch ALL connected Gmail accounts for header (profile dropdown, scope banner, sync status)
  const { data: accounts } = await serviceClient
    .from('gmail_accounts')
    .select('id, email, last_sync_at, sync_enabled, granted_scope, color, display_name')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  return (
    <AppShell userEmail={user.email ?? ''} accounts={accounts ?? []}>
      {children}
    </AppShell>
  );
}
