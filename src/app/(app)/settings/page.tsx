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

  const { data: prefs } = await serviceClient
    .from('user_preferences')
    .select('*')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  return (
    <SettingsClient
      initialAutoCategorizeUnread={prefs?.auto_categorize_unread ?? false}
    />
  );
}
