/**
 * Helper to show an undo-enabled toast after a destructive email action.
 *
 * Usage:
 *   showUndoToast('Archived', emailSubject, async () => {
 *     await fetch(`/api/emails/${id}/actions`, { ... body: { action: 'unarchive' } });
 *   });
 *
 * The toast shows for 5 seconds with an "Undo" button.
 * If the user clicks Undo, the reverseAction is executed.
 */

import { toast } from 'sonner';

interface UndoToastOptions {
  /** Primary label shown in the toast, e.g. "Archived" */
  label: string;
  /** Secondary description, e.g. email subject */
  description?: string;
  /** Async function that reverses the action */
  onUndo: () => Promise<void>;
  /** Optional callback after undo succeeds (e.g., re-insert email into local state) */
  onUndoComplete?: () => void;
}

export function showUndoToast({ label, description, onUndo, onUndoComplete }: UndoToastOptions) {
  toast.success(label, {
    description: description || undefined,
    duration: 5000,
    action: {
      label: 'Undo',
      onClick: async () => {
        try {
          await onUndo();
          toast.success(`${label} undone`);
          onUndoComplete?.();
        } catch {
          toast.error('Undo failed');
        }
      },
    },
  });
}
