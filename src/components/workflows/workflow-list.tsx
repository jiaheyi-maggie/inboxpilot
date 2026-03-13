'use client';

import { useCallback, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Workflow,
  Loader2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { Workflow as WorkflowType } from '@/types';

interface WorkflowListProps {
  workflows: WorkflowType[];
  onEdit: (id: string) => void;
  onCreate: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleEnabled: (id: string, enabled: boolean) => Promise<{ error?: string; validationErrors?: string[] }>;
}

export function WorkflowList({
  workflows,
  onEdit,
  onCreate,
  onDelete,
  onToggleEnabled,
}: WorkflowListProps) {
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      await onCreate();
    } finally {
      setCreating(false);
    }
  }, [onCreate]);

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      setDeletingId(id);
      try {
        await onDelete(id);
        toast.success(`"${name}" deleted`);
      } catch {
        toast.error('Failed to delete workflow');
      } finally {
        setDeletingId(null);
      }
    },
    [onDelete]
  );

  const handleToggle = useCallback(
    async (id: string, newEnabled: boolean) => {
      setTogglingId(id);
      try {
        const result = await onToggleEnabled(id, newEnabled);
        if (result.validationErrors) {
          toast.error(result.validationErrors[0] ?? 'Workflow has errors');
        } else if (result.error) {
          toast.error(result.error);
        } else {
          toast.success(newEnabled ? 'Workflow enabled' : 'Workflow disabled');
        }
      } catch {
        toast.error('Failed to update workflow');
      } finally {
        setTogglingId(null);
      }
    },
    [onToggleEnabled]
  );

  const handleRollback = useCallback(async (id: string, name: string) => {
    const confirmed = window.confirm(
      `Roll back all actions performed by "${name}"?\n\nThis will reverse archive, trash, star, and read/unread changes made by this workflow. Category reassignments cannot be reversed.`
    );
    if (!confirmed) return;

    setRollingBackId(id);
    try {
      const res = await fetch(`/api/workflows/${id}/rollback`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Rollback failed');
        return;
      }
      toast.success(`Rolled back ${data.rolledBack} email${data.rolledBack !== 1 ? 's' : ''}${data.skipped > 0 ? ` (${data.skipped} skipped)` : ''}`);
    } catch {
      toast.error('Rollback request failed');
    } finally {
      setRollingBackId(null);
    }
  }, []);

  if (workflows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-sm">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Workflow className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold mb-1">No workflows yet</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first workflow to automate email processing.
            Build visual rules that trigger on new emails and execute actions automatically.
          </p>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create Workflow
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Your Workflows</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automate email processing with visual rules
          </p>
        </div>
        <Button onClick={handleCreate} disabled={creating} size="sm">
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          New Workflow
        </Button>
      </div>

      <div className="grid gap-3">
        {workflows.map((wf) => {
          const nodeCount = (wf.graph as { nodes?: unknown[] })?.nodes?.length ?? 0;
          return (
            <div
              key={wf.id}
              className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium truncate">{wf.name}</h3>
                  {wf.is_enabled && (
                    <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded dark:bg-emerald-900/40 dark:text-emerald-400">
                      Active
                    </span>
                  )}
                </div>
                {wf.description && (
                  <p className="text-sm text-muted-foreground truncate mt-0.5">
                    {wf.description}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {nodeCount} node{nodeCount !== 1 ? 's' : ''} &middot; Updated{' '}
                  {new Date(wf.updated_at).toLocaleDateString()}
                </p>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Enable/Disable toggle */}
                <button
                  role="switch"
                  aria-checked={wf.is_enabled}
                  onClick={() => handleToggle(wf.id, !wf.is_enabled)}
                  disabled={togglingId === wf.id}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    wf.is_enabled ? 'bg-emerald-500' : 'bg-muted'
                  } ${togglingId === wf.id ? 'opacity-50' : ''}`}
                  title={wf.is_enabled ? 'Disable' : 'Enable'}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm ${
                      wf.is_enabled ? 'translate-x-4' : 'translate-x-1'
                    }`}
                  />
                </button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleRollback(wf.id, wf.name)}
                  disabled={rollingBackId === wf.id}
                  title="Roll back actions"
                >
                  {rollingBackId === wf.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Undo2 className="h-3.5 w-3.5" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onEdit(wf.id)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(wf.id, wf.name)}
                  disabled={deletingId === wf.id}
                >
                  {deletingId === wf.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
