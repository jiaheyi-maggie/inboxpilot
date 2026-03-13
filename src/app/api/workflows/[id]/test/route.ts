import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { executeWorkflow, type EmailWithCategoryData } from '@/lib/workflows/engine';
import type { GmailAccount, WorkflowGraph, Email } from '@/types';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/workflows/[id]/test — dry-run a workflow against a specific email
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id: workflowId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { emailId, graph: requestGraph } = body;

  if (!emailId) {
    return NextResponse.json({ error: 'emailId is required' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Fetch workflow (verify ownership)
  const { data: workflow, error: wfErr } = await serviceClient
    .from('workflows')
    .select('*')
    .eq('id', workflowId)
    .eq('user_id', user.id)
    .single();

  if (wfErr || !workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  // Fetch email with categories join
  const { data: emailRow, error: emailErr } = await serviceClient
    .from('emails')
    .select('*, email_categories(category, topic, priority, confidence)')
    .eq('id', emailId)
    .single();

  if (emailErr || !emailRow) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 });
  }

  // Verify the email belongs to the user's account
  const { data: account } = await serviceClient
    .from('gmail_accounts')
    .select('*')
    .eq('id', emailRow.gmail_account_id)
    .eq('user_id', user.id)
    .single();

  if (!account) {
    return NextResponse.json({ error: 'Email does not belong to your account' }, { status: 403 });
  }

  // Normalize email with category data
  const cat = getCategory(emailRow.email_categories);
  const emailData: EmailWithCategoryData = {
    ...(emailRow as unknown as Email),
    category: cat?.category as string ?? null,
    topic: cat?.topic as string ?? null,
    priority: cat?.priority as string ?? null,
    confidence: cat?.confidence as number ?? null,
  };

  // Use graph from request (current canvas state) if provided, else fall back to DB
  const graph = (requestGraph ?? workflow.graph) as WorkflowGraph;
  const result = await executeWorkflow(graph, emailData, account as GmailAccount, { dryRun: true });

  // Record the test run
  const { data: run } = await serviceClient
    .from('workflow_runs')
    .insert({
      workflow_id: workflowId,
      email_id: emailId,
      status: result.status,
      graph_snapshot: graph,
      log: result.steps,
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  return NextResponse.json({
    runId: run?.id,
    status: result.status,
    steps: result.steps,
    email: {
      id: emailData.id,
      subject: emailData.subject,
      sender_email: emailData.sender_email,
      category: emailData.category,
    },
  });
}

function getCategory(
  emailCategories: Record<string, unknown> | Record<string, unknown>[] | null | undefined
): Record<string, unknown> | null {
  if (emailCategories == null) return null;
  if (Array.isArray(emailCategories)) return emailCategories[0] ?? null;
  return emailCategories;
}
