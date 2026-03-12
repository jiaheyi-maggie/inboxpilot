import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { validateWorkflow } from '@/lib/workflows/validate';
import type { WorkflowGraph } from '@/types';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/workflows/[id] — get a single workflow
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  const { data: workflow, error } = await serviceClient
    .from('workflows')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  return NextResponse.json({ workflow });
}

/**
 * PUT /api/workflows/[id] — update a workflow
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const serviceClient = createServiceClient();

  // Verify ownership
  const { data: existing, error: fetchErr } = await serviceClient
    .from('workflows')
    .select('id, is_enabled')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  // Build update payload — only include provided fields
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.name !== undefined) update.name = body.name;
  if (body.description !== undefined) update.description = body.description;
  if (body.graph !== undefined) update.graph = body.graph;

  // If enabling, validate the graph first
  if (body.is_enabled !== undefined) {
    if (body.is_enabled === true) {
      const graph = (body.graph ?? (await getGraph(serviceClient, id, user.id))) as WorkflowGraph;
      const validation = validateWorkflow(graph);
      if (!validation.valid) {
        return NextResponse.json(
          { error: 'Cannot enable workflow', validationErrors: validation.errors },
          { status: 400 }
        );
      }
    }
    update.is_enabled = body.is_enabled;
  }

  const { data: workflow, error: updateErr } = await serviceClient
    .from('workflows')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (updateErr) {
    console.error('[workflows] Update failed:', updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ workflow });
}

/**
 * DELETE /api/workflows/[id] — delete a workflow (cascades to runs)
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Verify ownership before deleting
  const { data: existing } = await serviceClient
    .from('workflows')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  const { error: deleteErr } = await serviceClient
    .from('workflows')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (deleteErr) {
    console.error('[workflows] Delete failed:', deleteErr);
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// Helper to fetch graph when not provided in update body
// Note: ownership already verified before calling this, but we add user_id
// as defense-in-depth since service client bypasses RLS.
async function getGraph(
  client: ReturnType<typeof createServiceClient>,
  id: string,
  userId: string
): Promise<WorkflowGraph> {
  const { data } = await client
    .from('workflows')
    .select('graph')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  return (data?.graph as WorkflowGraph) ?? { nodes: [], edges: [] };
}
