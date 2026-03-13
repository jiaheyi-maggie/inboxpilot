import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { rollbackWorkflow } from '@/lib/workflows/rollback';
import type { GmailAccount } from '@/types';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/workflows/[id]/rollback — Roll back all completed runs of a workflow.
 * Reverses actions (archive, trash, star, mark_read, etc.) that were previously applied.
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
    .select('id, name, user_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (wfErr || !workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  // Fetch Gmail account (needed for Gmail API calls during rollback)
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
    const result = await rollbackWorkflow(workflow.id, account as GmailAccount);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error(`[rollback-api] Rollback failed for workflow ${id}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Rollback failed' },
      { status: 500 },
    );
  }
}
