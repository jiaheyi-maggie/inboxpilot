'use client';

import { useCallback, useState } from 'react';
import {
  MoreHorizontal,
  Trash2,
  Archive,
  ArrowRight,
  MailOpen,
  MailX,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CategoryPicker } from './category-picker';
import type { DimensionKey, TreeAction } from '@/types';

interface TreeNodeActionsProps {
  /** Full filter path for this node — each element is a dimension + value pair */
  path: { dimension: DimensionKey; value: string }[];
  /** Config ID to scope the action (date range, etc.) */
  configId: string;
  /** Human-readable label for confirmation prompts */
  nodeLabel: string;
  /** Callback after any action completes (to refresh tree) */
  onActionComplete?: () => void;
}

export function TreeNodeActions({
  path,
  configId,
  nodeLabel,
  onActionComplete,
}: TreeNodeActionsProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<'trash' | 'archive' | null>(null);

  const executeAction = useCallback(
    async (action: TreeAction, newCategory?: string) => {
      setLoading(true);
      setPendingAction(null);
      try {
        const res = await fetch('/api/emails/tree-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            filters: path,
            configId,
            ...(newCategory ? { newCategory } : {}),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? `${action} failed`);
          return;
        }
        const data = await res.json();

        // Build toast message based on action type
        const actionLabels: Record<TreeAction, string> = {
          trash: 'trashed',
          archive: 'archived',
          mark_read: 'marked as read',
          mark_unread: 'marked as unread',
          reassign: `reassigned to ${newCategory}`,
        };

        if (data.failed > 0) {
          toast.warning(
            `${data.affected} ${actionLabels[action]}, ${data.failed} failed`
          );
        } else if (data.affected === 0) {
          toast.info('No emails matched');
        } else {
          toast.success(`${data.affected} email(s) ${actionLabels[action]}`);
        }
        onActionComplete?.();
      } catch {
        toast.error('Network error');
      } finally {
        setLoading(false);
      }
    },
    [path, configId, onActionComplete]
  );

  const handleDestructiveAction = useCallback(
    (action: 'trash' | 'archive', confirmed = false) => {
      if (!confirmed) {
        setPendingAction(action);
        return;
      }
      executeAction(action);
    },
    [executeAction]
  );

  const handleReassign = useCallback(
    (newCategory: string) => {
      setShowPicker(false);
      executeAction('reassign', newCategory);
    },
    [executeAction]
  );

  // Determine which dimension the last filter targets — used to conditionally show reassign
  const lastDimension = path[path.length - 1]?.dimension;
  const showReassign = lastDimension === 'category' || lastDimension === 'topic' || lastDimension === 'importance';
  const excludeCategory = lastDimension === 'category' ? path[path.length - 1]?.value : undefined;

  if (loading) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className="p-1 rounded hover:bg-accent/80 transition-colors"
          >
            <MoreHorizontal className="h-4 w-4 text-foreground/60 hover:text-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {pendingAction ? (
            <div className="px-2 py-2">
              <p className="text-xs text-muted-foreground mb-2">
                {pendingAction === 'trash' ? 'Trash' : 'Archive'} all emails in
                &ldquo;{nodeLabel}&rdquo;?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDestructiveAction(pendingAction, true);
                  }}
                  className="flex-1 text-xs px-2 py-1.5 bg-destructive/10 text-destructive rounded font-medium hover:bg-destructive/20"
                >
                  Confirm
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingAction(null);
                  }}
                  className="flex-1 text-xs px-2 py-1.5 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  executeAction('mark_read');
                }}
              >
                <MailOpen className="h-3.5 w-3.5" />
                Mark all as read
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  executeAction('mark_unread');
                }}
              >
                <MailX className="h-3.5 w-3.5" />
                Mark all as unread
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleDestructiveAction('archive');
                }}
              >
                <Archive className="h-3.5 w-3.5" />
                Archive all
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDestructiveAction('trash');
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Trash all
              </DropdownMenuItem>
              {showReassign && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowPicker(true);
                    }}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                    Reassign all to...
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {showPicker && (
        <CategoryPicker
          onSelect={handleReassign}
          onClose={() => setShowPicker(false)}
          excludeCategory={excludeCategory}
        />
      )}
    </>
  );
}
