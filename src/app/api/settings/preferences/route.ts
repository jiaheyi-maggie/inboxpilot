import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';

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
  const { auto_categorize_unread } = body as {
    auto_categorize_unread?: boolean;
  };

  const serviceClient = createServiceClient();

  const { data, error } = await serviceClient
    .from('user_preferences')
    .upsert(
      {
        user_id: user.id,
        auto_categorize_unread: auto_categorize_unread ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
