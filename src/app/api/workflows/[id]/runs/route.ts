import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/workflows/[id]/runs — paginated run history for a workflow
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { id: workflowId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Verify workflow ownership
  const { data: workflow } = await serviceClient
    .from('workflows')
    .select('id')
    .eq('id', workflowId)
    .eq('user_id', user.id)
    .single();

  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  // Parse pagination params
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20'), 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0'), 0);

  // Fetch runs
  const { data: runs, error, count } = await serviceClient
    .from('workflow_runs')
    .select('id, workflow_id, email_id, status, log, started_at, completed_at', { count: 'exact' })
    .eq('workflow_id', workflowId)
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[workflow-runs] Query failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    runs: runs ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
