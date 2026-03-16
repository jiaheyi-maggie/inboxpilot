'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Folder, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { TreeNode } from './tree-node';
import { DraggableEmailRow } from './draggable-email-row';
import type { EmailWithCategory, TreeNode as TreeNodeType, GroupingLevel, UserCategory } from '@/types';

interface TreeViewProps {
  nodes: TreeNodeType[];
  configId: string;
  groupBy: GroupingLevel[];
  onSelectEmails: (emails: EmailWithCategory[]) => void;
  onEmailMoved: () => void;
  selectedCategory?: string | null;
}

export function TreeView({
  nodes,
  configId,
  groupBy,
  onSelectEmails,
  onEmailMoved,
  selectedCategory,
}: TreeViewProps) {
  const [selectedEmails, setSelectedEmails] = useState<EmailWithCategory[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [emailsLoading, setEmailsLoading] = useState(false);

  // Category metadata for context menu + rename + delete + drag target
  const [categories, setCategories] = useState<UserCategory[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);

  // New category inline input state
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryLoading, setNewCategoryLoading] = useState(false);
  const newCategoryInputRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [activeEmail, setActiveEmail] = useState<EmailWithCategory | null>(null);

  const levels = groupBy.length > 0
    ? groupBy
    : [{ dimension: 'category' as const, label: 'Category' }];

  const isCategoryDimension = levels[0]?.dimension === 'category';

  // Fetch categories when dimension is 'category'
  useEffect(() => {
    if (!isCategoryDimension) {
      setCategories([]);
      setCategoriesLoaded(false);
      return;
    }

    let cancelled = false;

    async function fetchCategories() {
      try {
        const res = await fetch('/api/categories');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setCategories(data.categories ?? []);
      } catch {
        // Non-critical
      } finally {
        if (!cancelled) setCategoriesLoaded(true);
      }
    }

    fetchCategories();
    return () => { cancelled = true; };
  }, [isCategoryDimension]);

  // Build category lookup map: name -> UserCategory
  const categoryMap = new Map<string, UserCategory>();
  for (const cat of categories) {
    categoryMap.set(cat.name, cat);
  }

  // dnd-kit sensors: require 5px movement before activating (prevents click conflicts)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const handleSelectEmails = useCallback(
    (emails: EmailWithCategory[], path: string) => {
      setSelectedEmails(emails);
      setSelectedPath(path);
      onSelectEmails(emails);
    },
    [onSelectEmails]
  );

  // ---- Drag handlers ----

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const dragData = event.active.data.current as { type?: string; email?: EmailWithCategory } | undefined;
    if (dragData?.type === 'email' && dragData.email) {
      setActiveEmail(dragData.email);
    }
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveEmail(null);

      if (!over) return;

      const activeData = active.data.current as { type?: string; email?: EmailWithCategory } | undefined;
      const overData = over.data.current as { type?: string; category?: string; dimension?: string } | undefined;

      if (activeData?.type !== 'email' || !activeData.email) return;
      if (overData?.type !== 'folder' || overData.dimension !== 'category') return;

      const email = activeData.email;
      const targetCategory = overData.category;

      if (!targetCategory || targetCategory === email.category) return;

      // Persist the category change
      try {
        const res = await fetch(`/api/emails/${email.id}/category`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: targetCategory }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? 'Failed to move email');
          return;
        }

        toast.success(`Moved to ${targetCategory}`, {
          description: email.subject || '(no subject)',
        });
        onEmailMoved();
      } catch {
        toast.error('Network error while moving email');
      }
    },
    [onEmailMoved]
  );

  const handleDragCancel = useCallback(() => {
    setActiveEmail(null);
  }, []);

  // ---- Category CRUD handlers ----

  const handleCategoryRenamed = useCallback(
    (oldName: string, newName: string) => {
      setCategories((prev) =>
        prev.map((c) => (c.name === oldName ? { ...c, name: newName } : c))
      );
    },
    []
  );

  const handleCategoryDeleted = useCallback(
    (_name: string) => {
      // Refresh categories + tree
      setCategories((prev) => prev.filter((c) => c.name !== _name));
    },
    []
  );

  const handleNewCategory = useCallback(() => {
    setShowNewCategoryInput(true);
    setNewCategoryName('');
    // Focus after render
    setTimeout(() => newCategoryInputRef.current?.focus(), 50);
  }, []);

  const commitNewCategory = useCallback(async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      setShowNewCategoryInput(false);
      return;
    }

    setNewCategoryLoading(true);
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to create category');
        return;
      }

      const data = await res.json();
      toast.success(`Created "${trimmed}"`);
      setCategories((prev) => [...prev, data.category]);
      setShowNewCategoryInput(false);
      setNewCategoryName('');
      onEmailMoved(); // Triggers tree refresh
    } catch {
      toast.error('Network error');
    } finally {
      setNewCategoryLoading(false);
    }
  }, [newCategoryName, onEmailMoved]);

  const handleNewCategoryKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitNewCategory();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowNewCategoryInput(false);
      }
    },
    [commitNewCategory]
  );

  const filteredNodes = selectedCategory
    ? nodes.filter((n) => n.group_key === selectedCategory)
    : nodes;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex flex-col h-full">
        {/* Folder tree — always rendered so droppable targets stay in the DOM */}
        <div
          className={`p-3 space-y-0.5 overflow-auto ${
            selectedPath
              ? 'flex-shrink-0 max-h-[40%] border-b border-border'
              : 'flex-1'
          }`}
        >
          {selectedPath && (
            <button
              onClick={() => {
                setSelectedPath(null);
                setSelectedEmails([]);
              }}
              className="mb-1 text-sm text-primary font-medium hover:underline"
            >
              &larr; Back to full tree
            </button>
          )}

          {filteredNodes.length === 0 && !selectedPath && (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm">No groups found</p>
            </div>
          )}
          {filteredNodes.map((node) => (
            <TreeNode
              key={node.group_key}
              label={node.group_key}
              count={node.count}
              dimension={levels[0]?.dimension ?? 'category'}
              level={0}
              path={[]}
              configId={configId}
              totalLevels={levels.length}
              levels={levels}
              onSelectEmails={handleSelectEmails}
              selectedPath={selectedPath}
              onTreeChanged={onEmailMoved}
              categoryData={isCategoryDimension ? categoryMap.get(node.group_key) : undefined}
              onCategoryRenamed={handleCategoryRenamed}
              onCategoryDeleted={handleCategoryDeleted}
              onNewCategory={handleNewCategory}
            />
          ))}

          {/* New Category inline input */}
          {showNewCategoryInput && (
            <div className="flex items-center gap-2 px-2 py-2">
              <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <input
                ref={newCategoryInputRef}
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={handleNewCategoryKeyDown}
                onBlur={commitNewCategory}
                placeholder="Category name..."
                className="flex-1 min-w-0 bg-transparent border border-primary/50 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/30"
                maxLength={50}
                disabled={newCategoryLoading}
              />
              {newCategoryLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
              )}
            </div>
          )}

          {/* New Category button (only for category dimension) */}
          {isCategoryDimension && categoriesLoaded && !showNewCategoryInput && (
            <button
              onClick={handleNewCategory}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>New Category</span>
            </button>
          )}
        </div>

        {/* Email list — shown below the tree when a folder is selected */}
        {selectedPath && (
          <div className="flex-1 min-h-0 overflow-auto">
            {emailsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading emails...</span>
              </div>
            ) : (
              <div className="space-y-0.5 px-3 py-2">
                {selectedEmails.map((email) => (
                  <DraggableEmailRow
                    key={email.id}
                    email={email}
                    onSelect={() => {
                      window.dispatchEvent(
                        new CustomEvent('inboxpilot:unread-email-selected', { detail: email })
                      );
                    }}
                    onEmailMoved={onEmailMoved}
                    categories={categories}
                  />
                ))}
                {selectedEmails.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No emails in this group
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Drag overlay — follows cursor */}
      <DragOverlay dropAnimation={null}>
        {activeEmail ? (
          <div className="w-[300px] rounded-lg border border-primary/30 bg-card p-3 shadow-xl ring-2 ring-primary/20 rotate-[2deg]">
            <p className="text-sm font-medium truncate text-foreground">
              {activeEmail.subject || '(no subject)'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {activeEmail.sender_name || activeEmail.sender_email || 'Unknown'}
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
