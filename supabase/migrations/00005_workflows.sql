-- Workflow definitions
CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Untitled Workflow',
  description text,
  is_enabled boolean NOT NULL DEFAULT false,
  graph jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own workflows"
  ON workflows FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Workflow execution history
CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  email_id uuid REFERENCES emails(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running',
  graph_snapshot jsonb NOT NULL DEFAULT '{}',
  log jsonb NOT NULL DEFAULT '[]',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own workflow runs"
  ON workflow_runs FOR ALL
  USING (workflow_id IN (SELECT id FROM workflows WHERE user_id = auth.uid()));

-- Indexes
CREATE INDEX idx_workflows_user_enabled ON workflows(user_id) WHERE is_enabled = true;
CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX idx_workflow_runs_email ON workflow_runs(email_id);
