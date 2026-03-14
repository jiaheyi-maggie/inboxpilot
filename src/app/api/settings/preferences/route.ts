import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { viewModeToLevels } from '@/lib/grouping/engine';
import { VIEW_MODES, type ViewMode } from '@/types';

const VALID_VIEW_MODES = VIEW_MODES.map((m) => m.value);

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const { data } = await serviceClient
    .from('user_preferences')
    .select('*')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  // Return defaults if no preferences row exists
  return NextResponse.json(
    data ?? {
      auto_categorize_unread: false,
      default_view_mode: 'by_sender',
    }
  );
}

export async function PUT(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { auto_categorize_unread, default_view_mode } = body as {
    auto_categorize_unread?: boolean;
    default_view_mode?: ViewMode;
  };

  if (auto_categorize_unread !== undefined && typeof auto_categorize_unread !== 'boolean') {
    return NextResponse.json({ error: 'auto_categorize_unread must be boolean' }, { status: 400 });
  }

  if (default_view_mode !== undefined && !(VALID_VIEW_MODES as string[]).includes(default_view_mode)) {
    return NextResponse.json({ error: `Invalid view mode. Must be one of: ${VALID_VIEW_MODES.join(', ')}` }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Get current preferences to preserve unchanged fields.
  // Use select('*') so we don't fail if view mode column hasn't been migrated yet.
  const { data: current } = await serviceClient
    .from('user_preferences')
    .select('*')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  const newAutoCategorize = auto_categorize_unread ?? current?.auto_categorize_unread ?? false;

  // Build upsert payload dynamically — only include default_view_mode
  // if the caller sent it (avoids writing to a column that may not exist pre-migration)
  const upsertPayload: Record<string, unknown> = {
    user_id: user.id,
    auto_categorize_unread: newAutoCategorize,
    updated_at: new Date().toISOString(),
  };

  if (default_view_mode !== undefined) {
    upsertPayload.default_view_mode = default_view_mode;
  } else if (current?.default_view_mode != null) {
    // Preserve existing value when only auto_categorize_unread changes
    upsertPayload.default_view_mode = current.default_view_mode;
  }

  const { data, error } = await serviceClient
    .from('user_preferences')
    .upsert(upsertPayload, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const newViewMode = (upsertPayload.default_view_mode as ViewMode | undefined) ?? 'by_sender';

  // Sync view mode to grouping_configs (compatibility layer)
  if (default_view_mode !== undefined) {
    const levels = viewModeToLevels(newViewMode);

    // Deactivate existing configs
    const { error: deactivateError } = await serviceClient
      .from('grouping_configs')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (!deactivateError) {
      // Insert new config matching the view mode
      const { error: insertError } = await serviceClient
        .from('grouping_configs')
        .insert({
          user_id: user.id,
          levels,
          date_range_start: null,
          date_range_end: null,
          is_active: true,
        });

      if (insertError) {
        console.error('[preferences] Failed to insert grouping_configs:', insertError);
        // Re-activate the most recent old config so user isn't left with none
        const { data: latestConfig } = await serviceClient
          .from('grouping_configs')
          .select('id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (latestConfig) {
          await serviceClient
            .from('grouping_configs')
            .update({ is_active: true })
            .eq('id', latestConfig.id);
        }
      }
    } else {
      console.error('[preferences] Failed to deactivate grouping_configs:', deactivateError);
    }
  }

  return NextResponse.json(data);
}
