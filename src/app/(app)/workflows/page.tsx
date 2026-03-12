import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { WorkflowClient } from './workflow-client';
import type { Workflow } from '@/types';

export default async function WorkflowsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  const serviceClient = createServiceClient();

  const { data: workflows } = await serviceClient
    .from('workflows')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  return <WorkflowClient initialWorkflows={(workflows ?? []) as unknown as Workflow[]} />;
}
