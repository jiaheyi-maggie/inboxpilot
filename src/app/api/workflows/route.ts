import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import type { WorkflowGraph } from '@/types';

/**
 * GET /api/workflows — list all workflows for the current user
 */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const { data: workflows, error } = await serviceClient
    .from('workflows')
    .select('id, name, description, is_enabled, graph, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[workflows] List failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Attach last run info for each workflow
  const workflowIds = (workflows ?? []).map((w) => w.id);
  const lastRuns: Record<string, { status: string; completed_at: string }> = {};

  if (workflowIds.length > 0) {
    const { data: runs } = await serviceClient
      .from('workflow_runs')
      .select('workflow_id, status, completed_at')
      .in('workflow_id', workflowIds)
      .order('started_at', { ascending: false });

    if (runs) {
      // Keep only the most recent run per workflow
      for (const run of runs) {
        if (!lastRuns[run.workflow_id]) {
          lastRuns[run.workflow_id] = {
            status: run.status,
            completed_at: run.completed_at,
          };
        }
      }
    }
  }

  const enriched = (workflows ?? []).map((w) => ({
    ...w,
    lastRun: lastRuns[w.id] ?? null,
  }));

  return NextResponse.json({ workflows: enriched });
}

/**
 * POST /api/workflows — create a new workflow
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const name = body.name || 'Untitled Workflow';
  const description = body.description || null;
  const graph: WorkflowGraph = body.graph || { nodes: [], edges: [] };

  const serviceClient = createServiceClient();
  const { data: workflow, error } = await serviceClient
    .from('workflows')
    .insert({
      user_id: user.id,
      name,
      description,
      graph,
    })
    .select()
    .single();

  if (error) {
    console.error('[workflows] Create failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ workflow }, { status: 201 });
}
