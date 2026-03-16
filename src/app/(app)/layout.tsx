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

  // Fetch primary Gmail account for header (scope banner, sync status)
  const { data: account } = await serviceClient
    .from('gmail_accounts')
    .select('id, email, last_sync_at, sync_enabled, granted_scope')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return (
    <AppShell userEmail={user.email ?? ''} account={account}>
      {children}
    </AppShell>
  );
}
