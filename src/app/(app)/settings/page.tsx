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

  const { data: config } = await serviceClient
    .from('grouping_configs')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single();

  // Get user preferences
  const { data: prefs } = await serviceClient
    .from('user_preferences')
    .select('*')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  const defaultLevels = [
    { dimension: 'category' as const, label: 'Category' },
    { dimension: 'sender_domain' as const, label: 'Domain' },
    { dimension: 'date_month' as const, label: 'Month' },
  ];

  return (
    <SettingsClient
      initialLevels={config?.levels ?? defaultLevels}
      initialDateStart={config?.date_range_start ?? null}
      initialDateEnd={config?.date_range_end ?? null}
      initialAutoCategorizeUnread={prefs?.auto_categorize_unread ?? false}
    />
  );
}
