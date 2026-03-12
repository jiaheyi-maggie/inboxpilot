import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateSetup } from '@/lib/ai/generate-setup';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { prompt } = body as { prompt?: string };

  if (!prompt || prompt.trim().length === 0) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  if (prompt.trim().length > 2000) {
    return NextResponse.json({ error: 'Prompt too long (max 2000 characters)' }, { status: 400 });
  }

  try {
    const setup = await generateSetup(prompt.trim());
    return NextResponse.json(setup);
  } catch (err) {
    console.error('[setup-generate] Failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Generation failed' },
      { status: 500 }
    );
  }
}
