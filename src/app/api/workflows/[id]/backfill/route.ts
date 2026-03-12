import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { backfillWorkflow } from '@/lib/workflows/backfill';
import type { GmailAccount, WorkflowGraph } from '@/types';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/workflows/[id]/backfill — Run a workflow against existing matching emails.
 * Called automatically when a workflow is enabled, or manually by the user.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Fetch workflow + verify ownership
  const { data: workflow, error: wfErr } = await serviceClient
    .from('workflows')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (wfErr || !workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  if (!workflow.is_enabled) {
    return NextResponse.json({ error: 'Workflow must be enabled to backfill' }, { status: 400 });
  }

  // Fetch Gmail account
  const { data: account, error: accErr } = await serviceClient
    .from('gmail_accounts')
    .select('*')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (accErr || !account) {
    return NextResponse.json({ error: 'No Gmail account linked' }, { status: 404 });
  }

  try {
    const graph = workflow.graph as WorkflowGraph;
    const result = await backfillWorkflow(workflow.id, graph, account as GmailAccount);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error(`[backfill-api] Backfill failed for workflow ${id}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Backfill failed' },
      { status: 500 }
    );
  }
}
