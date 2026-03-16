import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DashboardClient } from './dashboard-client';
import type { ViewConfig, ViewMode } from '@/types';

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  const serviceClient = createServiceClient();

  // Try to load the new view_configs first, fall back to grouping_configs
  const [{ data: viewConfig }, { data: legacyConfig }] = await Promise.all([
    serviceClient
      .from('view_configs')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
    serviceClient
      .from('grouping_configs')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ]);

  // If neither exists, redirect to setup
  if (!viewConfig && !legacyConfig) redirect('/setup');

  // Build a ViewConfig from whatever source we have
  let activeView: ViewConfig;

  if (viewConfig) {
    activeView = viewConfig as ViewConfig;
  } else if (legacyConfig) {
    // Migrate: create a real view_configs row from legacy grouping_configs.
    // Uses INSERT with conflict handling (partial unique index on user_id WHERE name='Default' AND is_active=true).
    const { data: prefs } = await serviceClient
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    const viewMode = (prefs?.default_view_mode as ViewMode) ?? 'by_sender';

    // Attempt INSERT — if a concurrent tab already created one, this fails silently
    await serviceClient
      .from('view_configs')
      .insert({
        user_id: user.id,
        name: 'Default',
        view_type: viewMode === 'flat' ? 'list' : 'tree',
        group_by: legacyConfig.levels ?? [],
        filters: [],
        sort: [{ field: 'received_at', direction: 'desc' }],
        date_range_start: legacyConfig.date_range_start,
        date_range_end: legacyConfig.date_range_end,
        is_active: true,
      })
      .select()
      .maybeSingle();

    // Always re-query to get the authoritative row (handles both fresh insert and concurrent-tab scenarios)
    const { data: migratedConfig } = await serviceClient
      .from('view_configs')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (migratedConfig) {
      activeView = migratedConfig as ViewConfig;
    } else {
      // Should never reach here — INSERT just succeeded or a row already existed.
      // Redirect to setup as a safe fallback.
      redirect('/setup');
    }
  } else {
    // TypeScript guard — should never reach here due to redirect above
    redirect('/setup');
  }

  // Fetch ALL accounts for multi-inbox support
  const { data: accounts } = await serviceClient
    .from('gmail_accounts')
    .select('id, email, last_sync_at, sync_enabled, granted_scope, color, display_name')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  // Primary account (first one) used for backward-compat in single-account checks
  const account = accounts && accounts.length > 0 ? accounts[0] : null;

  return (
    <DashboardClient
      viewConfig={activeView}
      account={account}
      accounts={accounts ?? []}
    />
  );
}
