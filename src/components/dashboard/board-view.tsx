'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { toast } from 'sonner';
import { BoardColumn } from './board-column';
import { BoardCard } from './board-card';
import type { EmailWithCategory, DimensionKey } from '@/types';

interface BoardViewProps {
  emails: EmailWithCategory[];
  groupByDimension: DimensionKey;
  onSelectEmail: (emailId: string) => void;
  onEmailMoved: () => void;
  /** Map of gmail_account_id -> hex color for account dot indicators */
  accountColorMap?: Map<string, string>;
  /** Whether to show account dots (only when multiple accounts) */
  showAccountDot?: boolean;
  /** Map of gmail_account_id -> display name (for account dimension grouping) */
  accountDisplayMap?: Map<string, string>;
}

/** Extract the grouping value from an email for a given dimension */
function getGroupValue(
  email: EmailWithCategory,
  dimension: DimensionKey,
  accountDisplayMap?: Map<string, string>,
): string {
  switch (dimension) {
    case 'category':
      return email.category ?? 'Uncategorized';
    case 'topic':
      return email.topic ?? 'No Topic';
    case 'sender':
      return email.sender_email ?? 'Unknown';
    case 'sender_domain':
      return email.sender_domain ?? 'Unknown';
    case 'importance':
      return email.importance_label ?? 'medium';
    case 'has_attachment':
      return email.has_attachment ? 'Has Attachment' : 'No Attachment';
    case 'is_read':
      return email.is_read ? 'Read' : 'Unread';
    case 'date_month': {
      if (!email.received_at) return 'Unknown';
      const d = new Date(email.received_at);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    case 'date_week': {
      if (!email.received_at) return 'Unknown';
      const d = new Date(email.received_at);
      // ISO week calculation
      const jan4 = new Date(d.getFullYear(), 0, 4);
      const daysSinceJan4 = Math.floor((d.getTime() - jan4.getTime()) / 86400000);
      const weekNum = Math.ceil((daysSinceJan4 + jan4.getDay() + 1) / 7);
      return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    }
    case 'account':
      return accountDisplayMap?.get(email.gmail_account_id) ?? email.gmail_account_id ?? 'Unknown';
    default:
      return 'Unknown';
  }
}

/** Group emails by dimension, sorted by importance_score DESC within each group */
function groupEmails(
  emails: EmailWithCategory[],
  dimension: DimensionKey,
  accountDisplayMap?: Map<string, string>,
): Map<string, EmailWithCategory[]> {
  const groups = new Map<string, EmailWithCategory[]>();

  for (const email of emails) {
    const key = getGroupValue(email, dimension, accountDisplayMap);
    const list = groups.get(key);
    if (list) {
      list.push(email);
    } else {
      groups.set(key, [email]);
    }
  }

  // Sort each group by importance_score DESC (5=critical to 1=noise), then by received_at DESC
  for (const [, list] of groups) {
    list.sort((a, b) => {
      const scoreA = a.importance_score ?? 3;
      const scoreB = b.importance_score ?? 3;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
    });
  }

  return groups;
}

/** Find which column (group key) an email ID belongs to */
function findColumnForEmail(
  columns: Map<string, EmailWithCategory[]>,
  emailId: string
): string | null {
  for (const [key, emails] of columns) {
    if (emails.some((e) => e.id === emailId)) return key;
  }
  return null;
}

export function BoardView({
  emails,
  groupByDimension,
  onSelectEmail,
  onEmailMoved,
  accountColorMap,
  showAccountDot,
  accountDisplayMap,
}: BoardViewProps) {
  // Mutable ref to track the initial grouped state for revert-on-error
  const initialGroupsRef = useRef<Map<string, EmailWithCategory[]> | null>(null);

  // Local state: grouped columns (mutated optimistically on drag)
  const [columns, setColumns] = useState<Map<string, EmailWithCategory[]>>(() =>
    groupEmails(emails, groupByDimension, accountDisplayMap)
  );

  // Track the actively dragged email for DragOverlay
  const [activeEmail, setActiveEmail] = useState<EmailWithCategory | null>(null);

  // Recompute columns when parent emails or dimension changes.
  // Only recompute when NOT actively dragging (activeEmail is null) to avoid
  // blowing away optimistic column state mid-drag.
  useEffect(() => {
    if (!activeEmail) {
      setColumns(groupEmails(emails, groupByDimension, accountDisplayMap));
    }
  }, [emails, groupByDimension, activeEmail, accountDisplayMap]);

  // Sorted column keys — keep a stable order (alphabetical, but with known categories first)
  const columnKeys = useMemo(() => {
    const keys = [...columns.keys()];
    keys.sort((a, b) => a.localeCompare(b));
    return keys;
  }, [columns]);

  // Sensors: require 5px movement before activating drag (prevents click conflicts)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // ── Drag handlers ──

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const emailId = event.active.id as string;
      // Find the email across all columns
      for (const [, list] of columns) {
        const email = list.find((e) => e.id === emailId);
        if (email) {
          setActiveEmail(email);
          // Snapshot current state for potential revert
          initialGroupsRef.current = new Map(
            [...columns.entries()].map(([k, v]) => [k, [...v]])
          );
          break;
        }
      }
    },
    [columns]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // Move lookups inside setColumns updater to avoid stale closure on rapid drag
      setColumns((prev) => {
        // Determine target column from latest state
        let targetColumn: string | null = null;
        if (overId.startsWith('column:')) {
          targetColumn = overId.slice('column:'.length);
        } else {
          targetColumn = findColumnForEmail(prev, overId);
        }
        if (!targetColumn) return prev;

        const sourceColumn = findColumnForEmail(prev, activeId);
        if (!sourceColumn || sourceColumn === targetColumn) return prev;

        const next = new Map(prev);
        const sourceList = [...(next.get(sourceColumn) ?? [])];
        const targetList = [...(next.get(targetColumn) ?? [])];

        const emailIndex = sourceList.findIndex((e) => e.id === activeId);
        if (emailIndex === -1) return prev;

        const [email] = sourceList.splice(emailIndex, 1);
        targetList.push(email);

        next.set(sourceColumn, sourceList);
        next.set(targetColumn, targetList);
        return next;
      });
    },
    []
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveEmail(null);

      if (!over) {
        // Dropped outside — revert
        if (initialGroupsRef.current) {
          setColumns(initialGroupsRef.current);
          initialGroupsRef.current = null;
        }
        return;
      }

      const activeId = active.id as string;
      const overId = over.id as string;
      const snapshot = initialGroupsRef.current;

      // Use snapshot (pre-drag state) for column lookups — avoids stale closure issues.
      // The current `columns` state reflects optimistic moves from handleDragOver,
      // so using it here would give wrong source column.
      const lookupSource = snapshot ?? columns;

      // Determine the final target column (use current columns for drop target)
      let targetColumn: string | null = null;
      if (overId.startsWith('column:')) {
        targetColumn = overId.slice('column:'.length);
      } else {
        // For the drop target, check current columns (where card visually is now)
        targetColumn = findColumnForEmail(columns, overId);
      }

      // Find where the email originally was (pre-drag)
      const originalColumn = findColumnForEmail(lookupSource, activeId);

      // Handle within-column reorder: email started and ended in the same column
      if (originalColumn && originalColumn === targetColumn && !overId.startsWith('column:')) {
        setColumns((prev) => {
          const next = new Map(prev);
          const list = [...(next.get(originalColumn) ?? [])];
          const oldIndex = list.findIndex((e) => e.id === activeId);
          const newIndex = list.findIndex((e) => e.id === overId);
          if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
            next.set(originalColumn, arrayMove(list, oldIndex, newIndex));
          }
          return next;
        });
        initialGroupsRef.current = null;
        return;
      }

      if (!targetColumn) {
        // No valid target — revert
        if (initialGroupsRef.current) {
          setColumns(initialGroupsRef.current);
          initialGroupsRef.current = null;
        }
        return;
      }

      // Cross-column drag completed — the optimistic move already happened in handleDragOver.
      // Now persist via API (only category reassignment is supported for now).
      if (groupByDimension !== 'category') {
        // Non-category dimensions: revert (not supported yet)
        toast.info('Drag-to-reassign is only supported when grouped by category');
        if (initialGroupsRef.current) {
          setColumns(initialGroupsRef.current);
          initialGroupsRef.current = null;
        }
        return;
      }

      // If the email didn't actually change columns (originalColumn computed above), nothing to do
      if (originalColumn === targetColumn) {
        initialGroupsRef.current = null;
        return;
      }

      // Persist: PUT /api/emails/{id}/category
      try {
        const res = await fetch(`/api/emails/${activeId}/category`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: targetColumn }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Failed (${res.status})`);
        }

        toast.success(`Moved to ${targetColumn}`);
        onEmailMoved();
      } catch (err) {
        // Revert on error
        toast.error(
          `Failed to move email: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
        if (initialGroupsRef.current) {
          setColumns(initialGroupsRef.current);
        }
      } finally {
        initialGroupsRef.current = null;
      }
    },
    [columns, groupByDimension, onEmailMoved]
  );

  const handleDragCancel = useCallback(() => {
    setActiveEmail(null);
    if (initialGroupsRef.current) {
      setColumns(initialGroupsRef.current);
      initialGroupsRef.current = null;
    }
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-3 p-3 overflow-x-auto h-full">
        {columnKeys.map((key) => (
          <BoardColumn
            key={key}
            groupKey={key}
            emails={columns.get(key) ?? []}
            onSelectEmail={onSelectEmail}
            accountColorMap={accountColorMap}
            showAccountDot={showAccountDot}
          />
        ))}
      </div>

      {/* Drag overlay — follows cursor, rendered outside column flow */}
      <DragOverlay dropAnimation={null}>
        {activeEmail ? (
          <div className="w-[280px]">
            <BoardCard
              email={activeEmail}
              onSelect={() => {}}
              overlay
              accountColor={showAccountDot ? accountColorMap?.get(activeEmail.gmail_account_id) : undefined}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
