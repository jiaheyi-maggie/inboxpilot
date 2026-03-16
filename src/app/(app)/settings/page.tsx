import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SettingsClient } from './settings-client';

export default async function SettingsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  const serviceClient = createServiceClient();

  const [{ data: prefs }, { data: accounts }] = await Promise.all([
    serviceClient
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .limit(1)
      .single(),
    serviceClient
      .from('gmail_accounts')
      .select('id, email, display_name, color, sync_enabled, last_sync_at, granted_scope')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true }),
  ]);

  return (
    <SettingsClient
      initialAutoCategorizeUnread={prefs?.auto_categorize_unread ?? false}
      accounts={(accounts ?? []).map((a) => ({
        id: a.id as string,
        email: a.email as string,
        display_name: a.display_name as string | null,
        color: a.color as string,
        sync_enabled: a.sync_enabled as boolean,
        last_sync_at: a.last_sync_at as string | null,
        granted_scope: a.granted_scope as string,
      }))}
    />
  );
}
