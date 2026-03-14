import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DashboardClient } from './dashboard-client';
import type { ViewMode } from '@/types';

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  const serviceClient = createServiceClient();

  // Config query must resolve first — we redirect if missing
  const { data: config } = await serviceClient
    .from('grouping_configs')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (!config) redirect('/setup');

  // Remaining queries are independent — run in parallel.
  // Use select('*') for prefs/categories to avoid failing if view mode columns
  // haven't been migrated yet (00010_view_modes.sql).
  const [{ data: prefs }, { data: categories }, { data: account }] = await Promise.all([
    serviceClient
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .limit(1)
      .single(),
    serviceClient
      .from('user_categories')
      .select('*')
      .eq('user_id', user.id),
    serviceClient
      .from('gmail_accounts')
      .select('id, email, last_sync_at, sync_enabled, granted_scope')
      .eq('user_id', user.id)
      .limit(1)
      .single(),
  ]);

  const viewModeOverrides: Record<string, ViewMode> = {};
  for (const cat of categories ?? []) {
    if (cat.view_mode_override) {
      viewModeOverrides[cat.name] = cat.view_mode_override as ViewMode;
    }
  }

  return (
    <DashboardClient
      config={config}
      account={account}
      defaultViewMode={(prefs?.default_view_mode as ViewMode) ?? 'by_sender'}
      viewModeOverrides={viewModeOverrides}
    />
  );
}
