'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useView } from '@/contexts/view-context';
import { EmailList } from './email-list';
import { EmailDetail } from './email-detail';
import { TreeView } from './tree-view';
import { BoardView } from './board-view';
import type { EmailWithCategory, TreeNode, SystemGroupKey, DimensionKey } from '@/types';

export function ActiveViewRouter() {
  const {
    viewType,
    filters,
    clearFilters,
    sort,
    groupBy,
    selectedCategory,
    selectedSystemGroup,
    setSelectedSystemGroup,
    selectedEmailId,
    setSelectedEmailId,
    setSelectedCategory,
    refreshKey,
    triggerRefresh,
    viewConfig,
  } = useView();

  // Data state
  const [emails, setEmails] = useState<EmailWithCategory[]>([]);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailWithCategory | null>(null);

  // For unread emails selected from sidebar
  const [unreadEmail, setUnreadEmail] = useState<EmailWithCategory | null>(null);

  // Listen for unread email selections from the sidebar
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as EmailWithCategory;
      setUnreadEmail(detail);
      setSelectedEmail(detail);
    };
    window.addEventListener('inboxpilot:unread-email-selected', handler);
    return () => window.removeEventListener('inboxpilot:unread-email-selected', handler);
  }, []);

  // When selectedEmailId changes externally (e.g., cleared), sync
  useEffect(() => {
    if (!selectedEmailId) {
      setSelectedEmail(null);
      setUnreadEmail(null);
    }
  }, [selectedEmailId]);

  // ── Fetch data based on current view state ──

  const fetchData = useCallback(async () => {
    // System group selected — fetch from system groups API
    if (selectedSystemGroup) {
      setLoading(true);
      try {
        const res = await fetch(`/api/emails/system-groups/${selectedSystemGroup}?limit=100`);
        if (!res.ok) {
          setEmails([]);
          return;
        }
        const data = await res.json();
        const normalized: EmailWithCategory[] = (data.emails ?? []).map(
          (row: Record<string, unknown>) => {
            const cat = row.email_categories as
              | Record<string, unknown>
              | Record<string, unknown>[]
              | null;
            const catObj = Array.isArray(cat) ? cat[0] : cat;
            return {
              ...row,
              email_categories: undefined,
              category: (catObj as Record<string, unknown>)?.category as string ?? null,
              topic: (catObj as Record<string, unknown>)?.topic as string ?? null,
              priority: (catObj as Record<string, unknown>)?.priority as string ?? null,
              importance_score: (catObj as Record<string, unknown>)?.importance_score as number ?? null,
              importance_label: (catObj as Record<string, unknown>)?.importance_label as string ?? null,
              confidence: (catObj as Record<string, unknown>)?.confidence as number ?? null,
            } as unknown as EmailWithCategory;
          }
        );
        setEmails(normalized);
      } catch {
        setEmails([]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Regular view — build API params from ViewConfig state
    setLoading(true);
    try {
      const params = new URLSearchParams();

      // For tree view with group_by, fetch group nodes (board view always fetches leaf emails)
      if (viewType === 'tree' && groupBy.length > 0) {
        params.set('level', '0');
        params.set('configId', viewConfig.id);
        if (selectedCategory) {
          params.set('filter.category', selectedCategory);
        }
      } else {
        // List view or tree with no grouping — fetch leaf emails
        params.set('leaf', 'true');
        params.set('level', '0');
        params.set('configId', viewConfig.id);

        if (selectedCategory) {
          params.set('filter.category', selectedCategory);
        }
      }

      // Apply toolbar filters as query params
      for (const f of filters) {
        params.set(`filter.${f.field}`, String(f.value));
      }

      // Apply sort
      if (sort.length > 0 && sort[0].field !== 'received_at') {
        params.set('sort', `${sort[0].field}:${sort[0].direction}`);
      }

      const res = await fetch(`/api/emails?${params}`);
      if (!res.ok) {
        setEmails([]);
        setTreeNodes([]);
        return;
      }

      const data = await res.json();
      if (data.type === 'groups') {
        setTreeNodes(data.data);
        setEmails([]);
      } else if (data.type === 'emails') {
        setEmails(data.data);
        setTreeNodes([]);
      }
    } catch {
      setEmails([]);
      setTreeNodes([]);
    } finally {
      setLoading(false);
    }
  }, [viewType, filters, sort, groupBy, selectedCategory, selectedSystemGroup, viewConfig.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  // ── Email event handlers ──

  const handleEmailMoved = useCallback(() => {
    triggerRefresh();
  }, [triggerRefresh]);

  const handleEmailRemoved = useCallback(
    (emailId: string) => {
      if (selectedEmail?.id === emailId) {
        setSelectedEmail(null);
        setSelectedEmailId(null);
      }
      triggerRefresh();
    },
    [selectedEmail, setSelectedEmailId, triggerRefresh]
  );

  const handleEmailUpdated = useCallback(
    (emailId: string, updates: Partial<EmailWithCategory>) => {
      setSelectedEmail((prev) =>
        prev?.id === emailId ? { ...prev, ...updates } : prev
      );
      // If in a system group and the update invalidates membership, refresh
      if (selectedSystemGroup === 'starred' && updates.is_starred === false) {
        triggerRefresh();
      }
    },
    [selectedSystemGroup, triggerRefresh]
  );

  const handleCategoryChanged = useCallback(
    (emailId: string, category: string) => {
      setSelectedEmail((prev) =>
        prev?.id === emailId ? { ...prev, category } : prev
      );
      triggerRefresh();
    },
    [triggerRefresh]
  );

  const handleBack = useCallback(() => {
    setSelectedEmail(null);
    setUnreadEmail(null);
    setSelectedEmailId(null);
  }, [setSelectedEmailId]);

  // ── Render ──

  // If an email is selected for detail view
  if (selectedEmail) {
    return (
      <EmailDetail
        email={selectedEmail}
        onBack={handleBack}
        onRemoved={handleEmailRemoved}
        onUpdated={handleEmailUpdated}
        onCategoryChanged={handleCategoryChanged}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  // System group header
  const systemGroupLabel = selectedSystemGroup
    ? { starred: 'Starred', archived: 'Archived', trash: 'Trash' }[selectedSystemGroup]
    : null;

  // Board view — kanban columns grouped by the first groupBy dimension (default: category)
  if (viewType === 'board') {
    const boardDimension: DimensionKey =
      groupBy.length > 0 ? groupBy[0].dimension : 'category';

    const handleBoardSelectEmail = (emailId: string) => {
      const email = emails.find((e) => e.id === emailId) ?? null;
      if (email) {
        setSelectedEmail(email);
        setSelectedEmailId(emailId);
      }
    };

    return (
      <div className="h-full">
        {emails.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No emails to display on the board</p>
            {filters.length > 0 && (
              <button
                onClick={clearFilters}
                className="text-sm text-primary mt-2 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <BoardView
            emails={emails}
            groupByDimension={boardDimension}
            onSelectEmail={handleBoardSelectEmail}
            onEmailMoved={handleEmailMoved}
          />
        )}
      </div>
    );
  }

  // Tree view — render when tree type is selected and groupBy is configured
  if (viewType === 'tree' && groupBy.length > 0) {
    return (
      <TreeView
        nodes={treeNodes}
        configId={viewConfig.id}
        groupBy={groupBy}
        onSelectEmails={(emails) => setEmails(emails)}
        onEmailMoved={handleEmailMoved}
        selectedCategory={selectedCategory}
      />
    );
  }

  // List view (default) — also used for system groups and filtered results
  return (
    <div>
      {systemGroupLabel && (
        <div className="px-4 py-2 border-b border-border">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-foreground">{systemGroupLabel}</h2>
            <button
              onClick={() => setSelectedSystemGroup(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
        </div>
      )}
      {selectedCategory && !selectedSystemGroup && (
        <div className="px-4 py-2 border-b border-border">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-foreground">{selectedCategory}</h2>
            <button
              onClick={() => setSelectedCategory(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Show all
            </button>
          </div>
        </div>
      )}
      {emails.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">
            {selectedCategory
              ? `No emails in ${selectedCategory}`
              : selectedSystemGroup
                ? `No ${systemGroupLabel?.toLowerCase()} emails`
                : 'No emails match your current filters'}
          </p>
          {filters.length > 0 && (
            <button
              onClick={clearFilters}
              className="text-sm text-primary mt-2 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <EmailList
          emails={emails}
          onEmailMoved={handleEmailMoved}
          systemGroup={selectedSystemGroup}
        />
      )}
    </div>
  );
}
