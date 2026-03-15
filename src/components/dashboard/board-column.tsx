'use client';

import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { BoardCard } from './board-card';
import { getCategoryColor } from '@/lib/category-colors';
import type { EmailWithCategory } from '@/types';

interface BoardColumnProps {
  groupKey: string;
  emails: EmailWithCategory[];
  onSelectEmail: (emailId: string) => void;
}

export function BoardColumn({ groupKey, emails, onSelectEmail }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${groupKey}`,
    data: { type: 'column', groupKey },
  });

  const colors = getCategoryColor(groupKey);
  const emailIds = emails.map((e) => e.id);

  return (
    <div
      className={`flex flex-col rounded-xl bg-muted/40 border border-border min-w-[280px] w-[300px] flex-shrink-0
        transition-[border-color,background-color] duration-150
        ${isOver ? 'border-primary/50 bg-primary/5' : ''}
      `}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
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
        ref={setNodeRef}
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
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}
