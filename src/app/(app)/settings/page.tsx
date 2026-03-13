import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SettingsClient } from './settings-client';
import type { ViewMode } from '@/types';

export default async function SettingsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  const serviceClient = createServiceClient();

  // Get user preferences (includes default_view_mode)
  const { data: prefs } = await serviceClient
    .from('user_preferences')
    .select('*')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  return (
    <SettingsClient
      initialViewMode={(prefs?.default_view_mode as ViewMode) ?? 'by_sender'}
      initialAutoCategorizeUnread={prefs?.auto_categorize_unread ?? false}
    />
  );
}
