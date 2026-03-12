'use client';

import { useCallback, useState } from 'react';
import { MoreHorizontal, Trash2, Archive, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CategoryPicker } from './category-picker';

interface CategoryActionsProps {
  category: string;
  onActionComplete?: () => void;
}

export function CategoryActions({ category, onActionComplete }: CategoryActionsProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<'trash' | 'archive' | null>(null);

  const handleAction = useCallback(
    async (action: 'trash' | 'archive', confirmed = false) => {
      if (!confirmed) {
        setPendingAction(action);
        return;
      }

      setLoading(true);
      setPendingAction(null);
      try {
        const res = await fetch('/api/emails/category-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, category }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? `${action} failed`);
          return;
        }
        const data = await res.json();
        if (data.failed > 0) {
          toast.warning(`${data.affected} ${action === 'trash' ? 'trashed' : 'archived'}, ${data.failed} failed`);
        } else {
          toast.success(`${data.affected} email(s) ${action === 'trash' ? 'trashed' : 'archived'}`);
        }
        onActionComplete?.();
      } catch {
        toast.error('Network error');
      } finally {
        setLoading(false);
      }
    },
    [category, onActionComplete]
  );

  const handleReassign = useCallback(
    async (newCategory: string) => {
      setLoading(true);
      setShowPicker(false);
      try {
        const res = await fetch('/api/emails/category-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reassign',
            category,
            newCategory,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? 'Reassign failed');
          return;
        }
        toast.success(`Reassigned to ${newCategory}`);
        onActionComplete?.();
      } catch {
        toast.error('Network error');
      } finally {
        setLoading(false);
      }
    },
    [category, onActionComplete]
  );

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
            className="p-1 rounded hover:bg-accent transition-colors"
          >
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {pendingAction ? (
            <div className="px-2 py-2">
              <p className="text-xs text-muted-foreground mb-2">
                {pendingAction === 'trash' ? 'Trash' : 'Archive'} all emails in &ldquo;{category}&rdquo;?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleAction(pendingAction, true); }}
                  className="flex-1 text-xs px-2 py-1.5 bg-destructive/10 text-destructive rounded font-medium hover:bg-destructive/20"
                >
                  Confirm
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setPendingAction(null); }}
                  className="flex-1 text-xs px-2 py-1.5 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => { e.stopPropagation(); handleAction('trash'); }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Trash all
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); handleAction('archive'); }}
              >
                <Archive className="h-3.5 w-3.5" />
                Archive all
              </DropdownMenuItem>
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
        </DropdownMenuContent>
      </DropdownMenu>

      {showPicker && (
        <CategoryPicker
          onSelect={handleReassign}
          onClose={() => setShowPicker(false)}
          excludeCategory={category}
        />
      )}
    </>
  );
}
