import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateWorkflow } from '@/lib/workflows/generate';

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

  if (prompt.length > 500) {
    return NextResponse.json({ error: 'Prompt too long (max 500 characters)' }, { status: 400 });
  }

  try {
    const result = await generateWorkflow(prompt.trim(), user.id);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[workflow-generate] Failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Generation failed' },
      { status: 500 }
    );
  }
}
