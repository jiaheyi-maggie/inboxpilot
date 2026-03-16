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
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { toast } from 'sonner';
import { BoardColumn } from './board-column';
import { BoardCard } from './board-card';
import type { EmailWithCategory, DimensionKey, UserCategory } from '@/types';

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

// ── Drag type discriminator ──
type DragType = 'card' | 'column';

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

/**
 * Extract the group key from a dnd-kit droppable/sortable ID.
 * Handles: "column:Work" -> "Work", "card-drop:Work" -> "Work", "some-email-id" -> null
 */
function extractGroupKeyFromId(id: string): string | null {
  if (id.startsWith('column:')) return id.slice('column:'.length);
  if (id.startsWith('card-drop:')) return id.slice('card-drop:'.length);
  return null;
}

/**
 * Sort column keys by category sort_order when available.
 * Categories not in the sort map go to the end, alphabetically.
 */
function sortColumnKeysByCategoryOrder(
  keys: string[],
  categorySortMap: Map<string, number>,
): string[] {
  return [...keys].sort((a, b) => {
    const orderA = categorySortMap.get(a);
    const orderB = categorySortMap.get(b);

    // Both have sort_order: sort by it
    if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
    // Only one has sort_order: it goes first
    if (orderA !== undefined) return -1;
    if (orderB !== undefined) return 1;
    // Neither has sort_order: alphabetical
    return a.localeCompare(b);
  });
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
  // ── Category metadata (for column reordering) ──
  // Map of category name -> sort_order. Only populated when dimension is 'category'.
  const [categorySortMap, setCategorySortMap] = useState<Map<string, number>>(new Map());
  // Map of category name -> category ID. Needed to call the reorder API with IDs.
  const [categoryIdMap, setCategoryIdMap] = useState<Map<string, string>>(new Map());
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);

  // Single fetch for category sort orders and IDs
  useEffect(() => {
    if (groupByDimension !== 'category') {
      setCategoriesLoaded(false);
      setCategorySortMap(new Map());
      setCategoryIdMap(new Map());
      return;
    }

    let cancelled = false;

    async function fetchCategories() {
      try {
        const res = await fetch('/api/categories');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        const cats: UserCategory[] = data.categories ?? [];
        const sortMap = new Map<string, number>();
        const idMap = new Map<string, string>();
        for (const cat of cats) {
          sortMap.set(cat.name, cat.sort_order);
          idMap.set(cat.name, cat.id);
        }
        setCategorySortMap(sortMap);
        setCategoryIdMap(idMap);
      } catch {
        // Non-critical: columns will fall back to alphabetical order
      } finally {
        if (!cancelled) setCategoriesLoaded(true);
      }
    }

    fetchCategories();
    return () => { cancelled = true; };
  }, [groupByDimension]);

  const columnDragEnabled = groupByDimension === 'category' && categoriesLoaded;

  // Mutable ref to track the initial grouped state for revert-on-error
  const initialGroupsRef = useRef<Map<string, EmailWithCategory[]> | null>(null);

  // Local state: grouped columns (mutated optimistically on drag)
  const [columns, setColumns] = useState<Map<string, EmailWithCategory[]>>(() =>
    groupEmails(emails, groupByDimension, accountDisplayMap)
  );

  // Track what is being dragged: a card or a column
  const [activeDragType, setActiveDragType] = useState<DragType | null>(null);
  const [activeEmail, setActiveEmail] = useState<EmailWithCategory | null>(null);
  const [activeColumnKey, setActiveColumnKey] = useState<string | null>(null);

  // Column order state (separate from `columns` Map to allow reordering)
  const [columnOrder, setColumnOrder] = useState<string[]>([]);

  // Recompute columns when parent emails or dimension changes.
  // Only recompute when NOT actively dragging (activeEmail is null) to avoid
  // blowing away optimistic column state mid-drag.
  useEffect(() => {
    if (!activeEmail && !activeColumnKey) {
      setColumns(groupEmails(emails, groupByDimension, accountDisplayMap));
    }
  }, [emails, groupByDimension, activeEmail, activeColumnKey, accountDisplayMap]);

  // Recompute column order when columns or sort map changes
  useEffect(() => {
    const keys = [...columns.keys()];
    if (groupByDimension === 'category' && categorySortMap.size > 0) {
      setColumnOrder(sortColumnKeysByCategoryOrder(keys, categorySortMap));
    } else {
      keys.sort((a, b) => a.localeCompare(b));
      setColumnOrder(keys);
    }
  }, [columns, categorySortMap, groupByDimension]);

  // Column IDs for SortableContext (prefixed to match droppable/sortable IDs)
  const sortableColumnIds = useMemo(
    () => columnOrder.map((key) => `column:${key}`),
    [columnOrder],
  );

  // Sensors: require 5px movement before activating drag (prevents click conflicts)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Ref to track pre-drag column order for revert
  const initialColumnOrderRef = useRef<string[] | null>(null);

  // ── Drag handlers ──

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const dragData = event.active.data.current as { type?: DragType } | undefined;
      const type: DragType = dragData?.type === 'column' ? 'column' : 'card';

      setActiveDragType(type);

      if (type === 'column') {
        // Column drag: extract groupKey from the sortable ID
        const id = event.active.id as string;
        const groupKey = id.startsWith('column:') ? id.slice('column:'.length) : id;
        setActiveColumnKey(groupKey);
        initialColumnOrderRef.current = [...columnOrder];
        return;
      }

      // Card drag
      const emailId = event.active.id as string;
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
    [columns, columnOrder]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      // Column drags don't need dragOver handling — SortableContext handles visual reorder
      if (activeDragType === 'column') return;

      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // Move lookups inside setColumns updater to avoid stale closure on rapid drag
      setColumns((prev) => {
        // Determine target column from latest state.
        // Over target can be a column/card-drop zone or another email card.
        const groupKey = extractGroupKeyFromId(overId);
        const targetColumn = groupKey ?? findColumnForEmail(prev, overId);
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
    [activeDragType]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      const dragType = activeDragType;

      // Reset drag state
      setActiveDragType(null);
      setActiveEmail(null);
      setActiveColumnKey(null);

      // ── Column drag end ──
      if (dragType === 'column') {
        if (!over || active.id === over.id) {
          // No move or dropped in place — revert
          if (initialColumnOrderRef.current) {
            setColumnOrder(initialColumnOrderRef.current);
            initialColumnOrderRef.current = null;
          }
          return;
        }

        const activeId = active.id as string;
        const overId = over.id as string;

        // Extract group keys from sortable IDs
        const activeKey = activeId.startsWith('column:') ? activeId.slice('column:'.length) : activeId;
        const overKey = overId.startsWith('column:') ? overId.slice('column:'.length) : overId;

        const oldIndex = columnOrder.indexOf(activeKey);
        const newIndex = columnOrder.indexOf(overKey);

        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
          initialColumnOrderRef.current = null;
          return;
        }

        // Optimistic update
        const newOrder = arrayMove(columnOrder, oldIndex, newIndex);
        setColumnOrder(newOrder);

        // Update local sort map optimistically
        const newSortMap = new Map(categorySortMap);
        newOrder.forEach((key, index) => newSortMap.set(key, index));
        setCategorySortMap(newSortMap);

        // Persist via API
        const categoryIds = newOrder
          .map((name) => categoryIdMap.get(name))
          .filter((id): id is string => id !== undefined);

        if (categoryIds.length === 0) {
          // No category IDs found — categories may not be seeded. Revert.
          if (initialColumnOrderRef.current) {
            setColumnOrder(initialColumnOrderRef.current);
          }
          initialColumnOrderRef.current = null;
          return;
        }

        try {
          const res = await fetch('/api/categories/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order: categoryIds }),
          });

          if (!res.ok) {
            throw new Error(`Failed to persist column order (${res.status})`);
          }
        } catch (err) {
          toast.error(
            `Failed to save column order: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
          // Revert
          if (initialColumnOrderRef.current) {
            setColumnOrder(initialColumnOrderRef.current);
            // Also revert the sort map
            const revertMap = new Map(categorySortMap);
            initialColumnOrderRef.current.forEach((key, index) => revertMap.set(key, index));
            setCategorySortMap(revertMap);
          }
        } finally {
          initialColumnOrderRef.current = null;
        }
        return;
      }

      // ── Card drag end ──
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

      // Determine the final target column (use current columns for drop target).
      // Over target can be a column/card-drop zone or another email card.
      const overGroupKey = extractGroupKeyFromId(overId);
      const targetColumn = overGroupKey ?? findColumnForEmail(columns, overId);

      // Find where the email originally was (pre-drag)
      const originalColumn = findColumnForEmail(lookupSource, activeId);

      // Handle within-column reorder: email started and ended in the same column
      if (originalColumn && originalColumn === targetColumn && overGroupKey === null) {
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
    [activeDragType, columns, columnOrder, groupByDimension, onEmailMoved, categorySortMap, categoryIdMap]
  );

  const handleDragCancel = useCallback(() => {
    if (activeDragType === 'column' && initialColumnOrderRef.current) {
      setColumnOrder(initialColumnOrderRef.current);
      initialColumnOrderRef.current = null;
    }

    setActiveDragType(null);
    setActiveEmail(null);
    setActiveColumnKey(null);

    if (initialGroupsRef.current) {
      setColumns(initialGroupsRef.current);
      initialGroupsRef.current = null;
    }
  }, [activeDragType]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={sortableColumnIds}
        strategy={horizontalListSortingStrategy}
        disabled={!columnDragEnabled}
      >
        <div className="flex gap-3 p-3 overflow-x-auto h-full">
          {columnOrder.map((key) => (
            <BoardColumn
              key={key}
              groupKey={key}
              emails={columns.get(key) ?? []}
              onSelectEmail={onSelectEmail}
              accountColorMap={accountColorMap}
              showAccountDot={showAccountDot}
              columnDragEnabled={columnDragEnabled}
            />
          ))}
        </div>
      </SortableContext>

      {/* Drag overlay — follows cursor, rendered outside column flow */}
      <DragOverlay dropAnimation={null}>
        {activeDragType === 'card' && activeEmail ? (
          <div className="w-[280px]">
            <BoardCard
              email={activeEmail}
              onSelect={() => {}}
              overlay
              accountColor={showAccountDot ? accountColorMap?.get(activeEmail.gmail_account_id) : undefined}
            />
          </div>
        ) : null}
        {activeDragType === 'column' && activeColumnKey ? (
          <div className="w-[300px] opacity-80 rounded-xl bg-muted/60 border-2 border-primary/30 shadow-xl p-4 flex items-center justify-center">
            <span className="text-sm font-semibold text-foreground">{activeColumnKey}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
