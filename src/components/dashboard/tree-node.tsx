'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useLongPress } from '@/hooks/use-long-press';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Mail,
  Loader2,
  Pencil,
  Trash2,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { TreeNodeActions } from './tree-node-actions';
import type { EmailWithCategory, TreeNode as TreeNodeType, GroupingLevel, DimensionKey, UserCategory } from '@/types';

interface TreeNodeProps {
  label: string;
  count: number;
  dimension: DimensionKey;
  level: number;
  path: { dimension: DimensionKey; value: string }[];
  configId: string;
  totalLevels: number;
  levels: GroupingLevel[];
  onSelectEmails: (emails: EmailWithCategory[], path: string) => void;
  selectedPath: string | null;
  onTreeChanged?: () => void;
  /** Category metadata for this node (if dimension is 'category') */
  categoryData?: UserCategory;
  /** Callback when a category is renamed (for optimistic update) */
  onCategoryRenamed?: (oldName: string, newName: string) => void;
  /** Callback when a category is deleted */
  onCategoryDeleted?: (name: string) => void;
  /** Callback to create a new category */
  onNewCategory?: () => void;
}

export function TreeNode({
  label,
  count,
  dimension,
  level,
  path,
  configId,
  totalLevels,
  levels,
  onSelectEmails,
  selectedPath,
  onTreeChanged,
  categoryData,
  onCategoryRenamed,
  onCategoryDeleted,
  onNewCategory,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeNodeType[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(label);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const currentPath = [...path, { dimension, value: label }];
  const pathKey = currentPath.map((p) => `${p.dimension}:${p.value}`).join('/');
  const isLeaf = level + 1 >= totalLevels;
  const isSelected = selectedPath === pathKey;
  const isCategoryDimension = dimension === 'category';

  // Long-press support for mobile context menus
  const longPressHandlers = useLongPress(!isCategoryDimension || !categoryData);

  // Drop target: all category-dimension nodes are valid drop targets.
  // Even "leaf" nodes (single-level groupBy=[category]) are conceptually folders.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `folder:${pathKey}`,
    data: { type: 'folder', category: label, dimension, path: currentPath },
    disabled: !isCategoryDimension,
  });

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const toggle = useCallback(async () => {
    if (isRenaming) return; // Don't toggle while renaming

    if (isLeaf) {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          level: String(totalLevels),
          configId,
          leaf: 'true',
        });
        currentPath.forEach((p) => {
          params.append(`filter.${p.dimension}`, p.value);
        });

        const res = await fetch(`/api/emails?${params}`);
        const data = await res.json();
        if (data.type === 'emails') {
          onSelectEmails(data.data, pathKey);
        }
      } catch (err) {
        console.error('Failed to fetch emails:', err);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (expanded) {
      setExpanded(false);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        level: String(level + 1),
        configId,
      });
      const nextLevel = levels[level + 1];
      if (nextLevel) {
        params.set('dimension', nextLevel.dimension);
      }
      currentPath.forEach((p) => {
        params.append(`filter.${p.dimension}`, p.value);
      });

      const res = await fetch(`/api/emails?${params}`);
      const data = await res.json();
      if (data.type === 'groups') {
        setChildren(data.data);
        setExpanded(true);
      }
    } catch (err) {
      console.error('Failed to fetch children:', err);
    } finally {
      setLoading(false);
    }
  }, [expanded, isLeaf, isRenaming, level, totalLevels, configId, currentPath, pathKey, onSelectEmails, levels]);

  // ---- Inline rename ----
  const startRename = useCallback(() => {
    if (!isCategoryDimension || !categoryData) return;
    setRenameValue(label);
    setIsRenaming(true);
  }, [isCategoryDimension, categoryData, label]);

  const commitRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === label) {
      setIsRenaming(false);
      return;
    }
    if (!categoryData) {
      setIsRenaming(false);
      return;
    }

    setIsRenaming(false);
    setLoading(true);
    try {
      const res = await fetch(`/api/categories/${categoryData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to rename category');
        return;
      }
      toast.success(`Renamed to "${trimmed}"`);
      onCategoryRenamed?.(label, trimmed);
      onTreeChanged?.();
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [renameValue, label, categoryData, onCategoryRenamed, onTreeChanged]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsRenaming(false);
      }
    },
    [commitRename]
  );

  // ---- Delete category ----
  const handleDelete = useCallback(async () => {
    if (!categoryData) return;
    setDeleteConfirm(false);
    setLoading(true);
    try {
      const res = await fetch(`/api/categories/${categoryData.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to delete category');
        return;
      }
      toast.success(`Deleted "${label}"`);
      onCategoryDeleted?.(label);
      onTreeChanged?.();
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [categoryData, label, onCategoryDeleted, onTreeChanged]);

  const displayLabel = formatLabel(label, dimension);

  const nodeRow = (
    <div
      ref={setDropRef}
      className={`group relative w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm transition-all duration-150 min-w-0
        ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-accent'}
        ${!isLeaf && expanded ? 'bg-accent/30' : ''}
        ${loading ? 'opacity-70' : ''}
        ${isOver ? 'bg-primary/15 ring-2 ring-primary/30 ring-inset' : ''}
      `}
      style={{ paddingLeft: `${level * 16 + 8}px` }}
      {...longPressHandlers}
    >
      <button
        onClick={toggle}
        onDoubleClick={(e) => {
          if (isCategoryDimension && categoryData) {
            e.preventDefault();
            e.stopPropagation();
            startRename();
          }
        }}
        className="flex-1 flex items-center gap-2 min-w-0 text-left"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 flex-shrink-0 text-muted-foreground animate-spin" />
        ) : isLeaf ? (
          <Mail className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        ) : expanded ? (
          <>
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200" />
            <FolderOpen className={`h-4 w-4 flex-shrink-0 ${isOver ? 'text-primary' : 'text-muted-foreground'}`} />
          </>
        ) : (
          <>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200" />
            <Folder className={`h-4 w-4 flex-shrink-0 ${isOver ? 'text-primary' : 'text-muted-foreground'}`} />
          </>
        )}

        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-transparent border border-primary/50 rounded px-1 py-0 text-sm font-medium outline-none focus:ring-1 focus:ring-primary/30"
            maxLength={50}
          />
        ) : (
          <span className="flex-1 truncate font-medium">{displayLabel}</span>
        )}
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs tabular-nums flex-shrink-0">{count}</span>
      </button>

      {/* Drop indicator text */}
      {isOver && isCategoryDimension && (
        <span className="absolute right-2 text-xs text-primary font-medium pointer-events-none">
          Drop here
        </span>
      )}

      {/* Existing tree node actions (bulk operations) */}
      {!isOver && (
        <span className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <TreeNodeActions
            path={currentPath}
            configId={configId}
            nodeLabel={displayLabel}
            onActionComplete={onTreeChanged}
          />
        </span>
      )}
    </div>
  );

  // Wrap folder nodes in context menu (only for category dimension with category data)
  const wrappedRow = isCategoryDimension && categoryData ? (
    <ContextMenu onOpenChange={(open) => { if (!open) setDeleteConfirm(false); }}>
      <ContextMenuTrigger asChild>
        {nodeRow}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={startRename}>
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </ContextMenuItem>
        {onNewCategory && (
          <ContextMenuItem onClick={onNewCategory}>
            <Plus className="h-3.5 w-3.5" />
            New Category
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {deleteConfirm ? (
          <div className="px-2 py-2">
            <p className="text-xs text-muted-foreground mb-2">
              Delete &ldquo;{displayLabel}&rdquo;? Emails won&apos;t be deleted.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                className="flex-1 text-xs px-2 py-1.5 bg-destructive/10 text-destructive rounded font-medium hover:bg-destructive/20"
              >
                Confirm
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="flex-1 text-xs px-2 py-1.5 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <ContextMenuItem
            variant="destructive"
            onClick={() => setDeleteConfirm(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  ) : nodeRow;

  return (
    <div>
      {wrappedRow}

      {/* Animated children container */}
      <div
        className={`grid transition-all duration-200 ease-in-out ${
          expanded && children.length > 0 ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          {children.map((child) => (
            <TreeNode
              key={child.group_key}
              label={child.group_key}
              count={child.count}
              dimension={levels[level + 1].dimension}
              level={level + 1}
              path={currentPath}
              configId={configId}
              totalLevels={totalLevels}
              levels={levels}
              onSelectEmails={onSelectEmails}
              selectedPath={selectedPath}
              onTreeChanged={onTreeChanged}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function formatLabel(label: string, dimension: DimensionKey): string {
  if (!label || label === 'null' || label === 'undefined') return 'Unknown';

  switch (dimension) {
    case 'has_attachment':
      return label === 'true' ? 'With Attachments' : 'No Attachments';
    case 'is_read':
      return label === 'true' ? 'Read' : 'Unread';
    case 'date_month': {
      const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
      const parts = label.split('-');
      const monthIdx = parseInt(parts[1], 10) - 1;
      if (monthIdx >= 0 && monthIdx < 12) {
        return `${MONTH_NAMES[monthIdx]} ${parts[0]}`;
      }
      return label;
    }
    default:
      return label;
  }
}
