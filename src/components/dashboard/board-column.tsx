'use client';

import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { BoardCard } from './board-card';
import { getCategoryColor } from '@/lib/category-colors';
import type { EmailWithCategory } from '@/types';

interface BoardColumnProps {
  groupKey: string;
  emails: EmailWithCategory[];
  onSelectEmail: (emailId: string) => void;
  /** Map of gmail_account_id -> hex color for account dot indicators */
  accountColorMap?: Map<string, string>;
  /** Whether to show account dots (only when multiple accounts) */
  showAccountDot?: boolean;
  /** Whether this column can be dragged to reorder (only for category dimension) */
  columnDragEnabled?: boolean;
}

export function BoardColumn({ groupKey, emails, onSelectEmail, accountColorMap, showAccountDot, columnDragEnabled }: BoardColumnProps) {
  // Droppable: allows email cards to be dropped into this column's card area.
  // Uses a distinct ID from the sortable column to avoid dnd-kit ID collision.
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `card-drop:${groupKey}`,
    data: { type: 'card-drop', groupKey },
  });

  // Sortable: allows the column itself to be reordered via its drag handle
  const {
    attributes: sortableAttributes,
    listeners: sortableListeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging: isColumnDragging,
  } = useSortable({
    id: `column:${groupKey}`,
    data: { type: 'column', groupKey },
    disabled: !columnDragEnabled,
  });

  const columnStyle = columnDragEnabled
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isColumnDragging ? 0.5 : 1,
      }
    : undefined;

  const colors = getCategoryColor(groupKey);
  const emailIds = emails.map((e) => e.id);

  return (
    <div
      ref={setSortableRef}
      style={columnStyle}
      className={`flex flex-col rounded-xl bg-muted/40 border border-border min-w-[280px] w-[300px] flex-shrink-0
        transition-[border-color,background-color] duration-150
        ${isOver ? 'border-primary/50 bg-primary/5' : ''}
        ${isColumnDragging ? 'z-50 shadow-xl ring-2 ring-primary/20' : ''}
      `}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        {columnDragEnabled && (
          <button
            type="button"
            className="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground transition-colors -ml-1"
            aria-label={`Drag to reorder ${groupKey} column`}
            style={{ touchAction: 'none' }}
            {...sortableAttributes}
            {...sortableListeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <span
          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: colors.text }}
        />
        <h3 className="text-sm font-semibold text-foreground truncate flex-1">
          {groupKey || 'Uncategorized'}
        </h3>
        <span className="text-xs text-muted-foreground font-medium tabular-nums flex-shrink-0">
          {emails.length}
        </span>
      </div>

      {/* Scrollable card list */}
      <div
        ref={setDroppableRef}
        className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]"
        style={{ maxHeight: 'calc(100vh - 200px)' }}
      >
        <SortableContext
          items={emailIds}
          strategy={verticalListSortingStrategy}
        >
          {emails.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              No emails
            </div>
          ) : (
            emails.map((email) => (
              <BoardCard
                key={email.id}
                email={email}
                onSelect={onSelectEmail}
                accountColor={showAccountDot ? accountColorMap?.get(email.gmail_account_id) : undefined}
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}
