'use client';

import { useCallback, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { WorkflowList } from '@/components/workflows/workflow-list';
import { WorkflowCanvas } from '@/components/workflows/workflow-canvas';
import type { Workflow, WorkflowGraph } from '@/types';

interface WorkflowClientProps {
  initialWorkflows: Workflow[];
}

export function WorkflowClient({ initialWorkflows }: WorkflowClientProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>(initialWorkflows);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingWorkflow = editingId
    ? workflows.find((w) => w.id === editingId) ?? null
    : null;

  const handleCreate = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled Workflow' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to create workflow');
        return;
      }
      const data = await res.json();
      if (data.workflow) {
        setWorkflows((prev) => [data.workflow, ...prev]);
        setEditingId(data.workflow.id);
      }
    } catch {
      toast.error('Network error — could not create workflow');
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to delete workflow');
        return;
      }
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      if (editingId === id) setEditingId(null);
    } catch {
      toast.error('Network error — could not delete workflow');
    }
  }, [editingId]);

  const handleToggleEnabled = useCallback(async (id: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: enabled }),
      });
      const data = await res.json();
      if (!res.ok) {
        return data; // contains error/validationErrors for the list component to display
      }
      if (data.workflow) {
        setWorkflows((prev) =>
          prev.map((w) => (w.id === id ? { ...w, ...data.workflow } : w))
        );
      }
      return data;
    } catch {
      toast.error('Network error — could not update workflow');
      return { error: 'Network error' };
    }
  }, []);

  const handleSave = useCallback(
    async (id: string, updates: { name?: string; description?: string; graph?: WorkflowGraph }) => {
      try {
        const res = await fetch(`/api/workflows/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? 'Failed to save workflow');
          return;
        }
        const data = await res.json();
        if (data.workflow) {
          setWorkflows((prev) =>
            prev.map((w) => (w.id === id ? { ...w, ...data.workflow } : w))
          );
        }
      } catch {
        toast.error('Network error — could not save workflow');
      }
    },
    []
  );

  // When editing, show the canvas with a back button sub-header
  if (editingId && editingWorkflow) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
          <Button variant="ghost" size="icon" onClick={() => setEditingId(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-muted-foreground">Back to workflows</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <WorkflowCanvas
            workflow={editingWorkflow}
            onSave={(updates) => handleSave(editingId, updates)}
          />
        </div>
      </div>
    );
  }

  return (
    <WorkflowList
      workflows={workflows}
      onEdit={setEditingId}
      onCreate={handleCreate}
      onDelete={handleDelete}
      onToggleEnabled={handleToggleEnabled}
    />
  );
}
