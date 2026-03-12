'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkflowList } from '@/components/workflows/workflow-list';
import { WorkflowCanvas } from '@/components/workflows/workflow-canvas';
import type { Workflow, WorkflowGraph } from '@/types';

interface WorkflowClientProps {
  initialWorkflows: Workflow[];
}

export function WorkflowClient({ initialWorkflows }: WorkflowClientProps) {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>(initialWorkflows);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingWorkflow = editingId
    ? workflows.find((w) => w.id === editingId) ?? null
    : null;

  const handleCreate = useCallback(async () => {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Untitled Workflow' }),
    });
    const data = await res.json();
    if (data.workflow) {
      setWorkflows((prev) => [data.workflow, ...prev]);
      setEditingId(data.workflow.id);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
    if (editingId === id) setEditingId(null);
  }, [editingId]);

  const handleToggleEnabled = useCallback(async (id: string, enabled: boolean) => {
    const res = await fetch(`/api/workflows/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_enabled: enabled }),
    });
    const data = await res.json();
    if (data.workflow) {
      setWorkflows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, ...data.workflow } : w))
      );
    }
    return data;
  }, []);

  const handleSave = useCallback(
    async (id: string, updates: { name?: string; description?: string; graph?: WorkflowGraph }) => {
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.workflow) {
        setWorkflows((prev) =>
          prev.map((w) => (w.id === id ? { ...w, ...data.workflow } : w))
        );
      }
    },
    []
  );

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          {editingId ? (
            <Button variant="ghost" size="icon" onClick={() => setEditingId(null)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard')}>
              <ArrowLeft className="h-4 w-4" />
              Dashboard
            </Button>
          )}
          <span className="font-bold text-foreground">
            {editingId ? (editingWorkflow?.name ?? 'Workflow') : 'Workflows'}
          </span>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {editingId && editingWorkflow ? (
          <WorkflowCanvas
            workflow={editingWorkflow}
            onSave={(updates) => handleSave(editingId, updates)}
          />
        ) : (
          <WorkflowList
            workflows={workflows}
            onEdit={setEditingId}
            onCreate={handleCreate}
            onDelete={handleDelete}
            onToggleEnabled={handleToggleEnabled}
          />
        )}
      </main>
    </div>
  );
}
