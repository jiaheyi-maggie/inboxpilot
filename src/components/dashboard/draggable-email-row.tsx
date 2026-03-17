'use client';

import { useCallback, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { format } from 'date-fns';
import { useLongPress } from '@/hooks/use-long-press';
import {
  Paperclip,
  Star,
  Archive,
  Trash2,
  ArrowRight,
  GripVertical,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { CategoryBadge } from './category-badge';
import { showUndoToast } from '@/lib/undo-toast';
import type { EmailWithCategory, UserCategory } from '@/types';

interface DraggableEmailRowProps {
  email: EmailWithCategory;
  onSelect: () => void;
  onEmailMoved: () => void;
  categories: UserCategory[];
}

export function DraggableEmailRow({
  email,
  onSelect,
  onEmailMoved,
  categories,
}: DraggableEmailRowProps) {
  const [loading, setLoading] = useState(false);
  const [exiting, setExiting] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `email:${email.id}`,
    data: { type: 'email', email },
  });

  // Long-press support for mobile context menus
  const longPressHandlers = useLongPress();

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  const date = email.received_at
    ? format(new Date(email.received_at), 'MMM d')
    : '';

  const handleMoveTo = useCallback(
    async (category: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/emails/${email.id}/category`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? 'Failed to move email');
          return;
        }
        toast.success(`Moved to ${category}`);
        onEmailMoved();
      } catch {
        toast.error('Network error');
      } finally {
        setLoading(false);
      }
    },
    [email.id, onEmailMoved]
  );

  const handleAction = useCallback(
    async (action: 'archive' | 'trash') => {
      setLoading(true);
      try {
        const res = await fetch(`/api/emails/${email.id}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? `${action} failed`);
          return;
        }
        setExiting(true);
        const reverseAction = action === 'archive' ? 'unarchive' : 'restore';
        showUndoToast({
          label: action === 'archive' ? 'Archived' : 'Moved to trash',
          description: email.subject || '(no subject)',
          onUndo: async () => {
            const res = await fetch(`/api/emails/${email.id}/actions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: reverseAction }),
            });
            if (!res.ok) throw new Error('Undo failed');
          },
          onUndoComplete: () => onEmailMoved(),
        });
        setTimeout(() => onEmailMoved(), 300);
      } catch {
        toast.error('Network error');
      } finally {
        setLoading(false);
      }
    },
    [email.id, email.subject, onEmailMoved]
  );

  // Long-press support for mobile: track pointer for synthetic contextmenu
  const triggerRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      // Also used as the context menu trigger ref via the wrapper
    },
    [setNodeRef]
  );

  const filteredCategories = categories.filter((c) => c.name !== email.category);

  const rowContent = (
    <div
      ref={triggerRef}
      style={style}
      className={`transition-all duration-300 ease-in-out overflow-hidden ${
        exiting ? 'max-h-0 opacity-0 scale-y-95' : 'max-h-[200px] opacity-100'
      }`}
      {...longPressHandlers}
    >
      <div
        className={`group relative flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors
          ${!email.is_read
            ? 'bg-primary/8 border-l-[3px] border-l-primary'
            : 'hover:bg-accent/50 border-l-[3px] border-l-transparent'
          }
          ${isDragging ? 'z-50 shadow-lg ring-2 ring-primary/20' : ''}
        `}
      >
        {/* Drag handle */}
        <button
          className="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Email content — clickable to select */}
        <div className="flex-1 min-w-0" onClick={onSelect}>
          {/* Sender + date row */}
          <div className="flex items-center gap-2">
            <span
              className={`text-sm truncate ${
                !email.is_read ? 'font-bold text-foreground' : 'font-normal text-muted-foreground'
              }`}
            >
              {email.sender_name || email.sender_email || 'Unknown'}
            </span>
            <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
              {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              {email.has_attachment && <Paperclip className="h-3 w-3 text-muted-foreground" />}
              {email.is_starred && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
              <span className="text-xs text-muted-foreground">{date}</span>
            </div>
          </div>

          {/* Subject */}
          <p
            className={`text-sm mt-0.5 truncate ${
              !email.is_read ? 'font-medium text-foreground' : 'text-muted-foreground'
            }`}
          >
            {email.subject || '(no subject)'}
          </p>

          {/* Tags */}
          <div className="flex items-center gap-1.5 mt-1">
            {email.category && <CategoryBadge category={email.category} />}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {rowContent}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {/* Move to submenu */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ArrowRight className="h-3.5 w-3.5" />
            Move to...
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {filteredCategories.map((cat) => (
              <ContextMenuItem
                key={cat.id}
                onClick={() => handleMoveTo(cat.name)}
              >
                {cat.name}
              </ContextMenuItem>
            ))}
            {filteredCategories.length === 0 && (
              <ContextMenuItem disabled>No other categories</ContextMenuItem>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => handleAction('archive')}>
          <Archive className="h-3.5 w-3.5" />
          Archive
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          onClick={() => handleAction('trash')}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Trash
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
