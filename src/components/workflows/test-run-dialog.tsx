'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, SkipForward, AlertTriangle, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { WorkflowExecutionStep, WorkflowGraph } from '@/types';

interface TestRunDialogProps {
  open: boolean;
  onClose: () => void;
  workflowId: string;
  /** Current graph from the canvas — used so unsaved changes are tested */
  graph?: WorkflowGraph;
  onStepsResolved?: (steps: WorkflowExecutionStep[]) => void;
}

interface EmailOption {
  id: string;
  subject: string | null;
  sender_email: string | null;
  category: string | null;
}

export function TestRunDialog({
  open,
  onClose,
  workflowId,
  graph,
  onStepsResolved,
}: TestRunDialogProps) {
  const [emails, setEmails] = useState<EmailOption[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<WorkflowExecutionStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch recent emails when dialog opens
  useEffect(() => {
    if (!open) return;
    setLoadingEmails(true);
    setSteps(null);
    setError(null);
    setSelectedEmailId(null);

    fetch('/api/emails?level=999&limit=20')
      .then((res) => res.json())
      .then((data) => {
        if (data.type === 'emails' && Array.isArray(data.data)) {
          setEmails(
            data.data.map((e: Record<string, unknown>) => ({
              id: e.id,
              subject: e.subject,
              sender_email: e.sender_email,
              category: e.category,
            }))
          );
        }
      })
      .catch(() => setError('Failed to load emails'))
      .finally(() => setLoadingEmails(false));
  }, [open]);

  const handleRun = useCallback(async () => {
    if (!selectedEmailId) return;
    setRunning(true);
    setSteps(null);
    setError(null);

    try {
      const res = await fetch(`/api/workflows/${workflowId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailId: selectedEmailId, graph }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Test run failed');
        return;
      }
      setSteps(data.steps);
      onStepsResolved?.(data.steps);
    } catch {
      setError('Network error');
    } finally {
      setRunning(false);
    }
  }, [selectedEmailId, workflowId, onStepsResolved]);

  const resultIcon = (result: WorkflowExecutionStep['result']) => {
    switch (result) {
      case 'passed':
      case 'executed':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />;
      case 'skipped':
        return <SkipForward className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
      case 'error':
        return <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Test Run</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Email selector */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Select an email to test against
            </label>
            {loadingEmails ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading emails...
              </div>
            ) : emails.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No emails found. Sync your inbox first.
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
                {emails.map((email) => (
                  <button
                    key={email.id}
                    onClick={() => setSelectedEmailId(email.id)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      selectedEmailId === email.id
                        ? 'bg-primary/10'
                        : 'hover:bg-accent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="truncate font-medium">
                        {email.subject ?? '(no subject)'}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground ml-5.5 truncate">
                      {email.sender_email}
                      {email.category && ` · ${email.category}`}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Run button */}
          <Button
            onClick={handleRun}
            disabled={!selectedEmailId || running}
            className="w-full"
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              'Run Test'
            )}
          </Button>

          {/* Error */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* Steps output */}
          {steps && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Execution Log
              </h4>
              <div className="space-y-1.5">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    {resultIcon(step.result)}
                    <div className="min-w-0">
                      <span className="font-medium capitalize">{step.nodeType}</span>
                      {step.detail && (
                        <span className="text-muted-foreground ml-1">— {step.detail}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
