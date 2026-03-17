'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useView } from '@/contexts/view-context';
import { EmailList } from './email-list';
import { EmailDetail } from './email-detail';
import { TreeView } from './tree-view';
import { BoardView } from './board-view';
import { FocusView } from './focus-view';
import { ViewBreadcrumb } from './view-breadcrumb';
import type { EmailWithCategory, TreeNode, DimensionKey } from '@/types';

interface ActiveViewRouterProps {
  /** Map of gmail_account_id -> hex color (for account dot indicators) */
  accountColorMap?: Map<string, string>;
  /** Whether to show account dots on emails (only when multiple accounts) */
  showAccountDot?: boolean;
  /** Map of gmail_account_id -> display name (for account dimension grouping) */
  accountDisplayMap?: Map<string, string>;
}

export function ActiveViewRouter({ accountColorMap, showAccountDot, accountDisplayMap }: ActiveViewRouterProps) {
  const {
    viewType,
    filters,
    clearFilters,
    sort,
    groupBy,
    selectedCategory,
    selectedSystemGroup,
    selectedAccountId,
    selectedEmailId,
    setSelectedEmailId,
    searchQuery,
    searchFilters,
    clearSearch,
    contentRefreshKey,
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
    // Search mode — fetch emails with text search + structured filters
    if (searchQuery) {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('leaf', 'true');
        params.set('level', '0');
        params.set('configId', viewConfig.id);
        params.set('search', searchQuery);
        params.set('limit', '100');

        // Apply account filter
        if (selectedAccountId) {
          params.set('filter.account', selectedAccountId);
        }

        // Apply structured filters from AI intent (category, sender_domain, is_read, etc.)
        if (searchFilters) {
          if (searchFilters.category) {
            params.set('filter.category', searchFilters.category);
          }
          if (searchFilters.sender_domain) {
            params.set('filter.sender_domain', searchFilters.sender_domain);
          }
          if (searchFilters.sender_email) {
            params.set('filter.sender', searchFilters.sender_email);
          }
          if (searchFilters.is_read !== undefined) {
            params.set('filter.is_read', String(searchFilters.is_read));
          }
        }

        const res = await fetch(`/api/emails?${params}`);
        if (!res.ok) {
          setEmails([]);
          return;
        }
        const data = await res.json();
        if (data.type === 'emails') {
          setEmails(data.data);
        } else {
          setEmails([]);
        }
        setTreeNodes([]);
      } catch {
        setEmails([]);
        setTreeNodes([]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // System group selected — fetch from system groups API
    if (selectedSystemGroup) {
      setLoading(true);
      try {
        const sgUrl = new URL(`/api/emails/system-groups/${selectedSystemGroup}`, window.location.origin);
        sgUrl.searchParams.set('limit', '100');
        if (selectedAccountId) {
          sgUrl.searchParams.set('accountId', selectedAccountId);
        }
        const res = await fetch(sgUrl.toString());
        if (!res.ok) {
          setEmails([]);
          return;
        }
        const data = await res.json();
        let normalized: EmailWithCategory[] = (data.emails ?? []).map(
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

      // For tree view with group_by, fetch group nodes
      if (viewType === 'tree' && groupBy.length > 0) {
        params.set('level', '0');
        params.set('configId', viewConfig.id);
        if (selectedCategory) {
          params.set('filter.category', selectedCategory);
        }
      } else {
        // List/board view or tree with no grouping — fetch leaf emails
        params.set('leaf', 'true');
        params.set('level', '0');
        params.set('configId', viewConfig.id);

        // Board view needs ALL emails to show complete columns across all categories.
        // Default limit of 50 only returns recent emails which may span 2-3 categories.
        // Focus view also benefits from a larger batch to provide a meaningful processing queue.
        if (viewType === 'board' || viewType === 'focus') {
          params.set('limit', '500');
        }

        if (selectedCategory) {
          params.set('filter.category', selectedCategory);
        }
      }

      // Apply account filter (multi-inbox)
      if (selectedAccountId) {
        params.set('filter.account', selectedAccountId);
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
  }, [viewType, filters, sort, groupBy, selectedCategory, selectedSystemGroup, selectedAccountId, viewConfig.id, searchQuery, searchFilters]);

  useEffect(() => {
    fetchData();
  }, [fetchData, contentRefreshKey]);

  // ── Email event handlers ──

  const handleEmailMoved = useCallback(() => {
    triggerRefresh(['sidebar', 'content', 'counts']);
  }, [triggerRefresh]);

  const handleEmailRemoved = useCallback(
    (emailId: string) => {
      if (selectedEmail?.id === emailId) {
        setSelectedEmail(null);
        setSelectedEmailId(null);
      }
      triggerRefresh(['sidebar', 'content', 'counts']);
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
        triggerRefresh('counts');
      }
    },
    [selectedSystemGroup, triggerRefresh]
  );

  const handleCategoryChanged = useCallback(
    (emailId: string, category: string) => {
      setSelectedEmail((prev) =>
        prev?.id === emailId ? { ...prev, category } : prev
      );
      triggerRefresh(['sidebar', 'content']);
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
      <div className="h-full flex flex-col">
        <ViewBreadcrumb
          emailCount={emails.length}
          selectedEmailSubject={selectedEmail.subject}
        />
        <div className="flex-1 min-h-0">
          <EmailDetail
            email={selectedEmail}
            onBack={handleBack}
            onRemoved={handleEmailRemoved}
            onUpdated={handleEmailUpdated}
            onCategoryChanged={handleCategoryChanged}
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <ViewBreadcrumb emailCount={0} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  // Search results — always rendered as a flat list regardless of current view type
  if (searchQuery) {
    return (
      <div>
        <ViewBreadcrumb emailCount={emails.length} />
        {emails.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No emails match &quot;{searchQuery}&quot;</p>
            <button
              onClick={clearSearch}
              className="text-sm text-primary mt-2 hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <EmailList
            emails={emails}
            onEmailMoved={handleEmailMoved}
            accountColorMap={accountColorMap}
            showAccountDot={showAccountDot}
          />
        )}
      </div>
    );
  }

  // Focus view — swipe-to-process card stack sorted by importance
  if (viewType === 'focus') {
    const handleFocusSelectEmail = (emailId: string) => {
      const email = emails.find((e) => e.id === emailId) ?? null;
      if (email) {
        setSelectedEmail(email);
        setSelectedEmailId(emailId);
      }
    };

    return (
      <div className="h-full flex flex-col">
        <ViewBreadcrumb emailCount={emails.length} />
        <div className="flex-1 min-h-0">
          <FocusView
            emails={emails}
            onEmailMoved={handleEmailMoved}
            onSelectEmail={handleFocusSelectEmail}
            accountColorMap={accountColorMap}
            showAccountDot={showAccountDot}
          />
        </div>
      </div>
    );
  }

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
      <div className="h-full flex flex-col">
        <ViewBreadcrumb emailCount={emails.length} />
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
          <div className="flex-1 min-h-0">
            <BoardView
              emails={emails}
              groupByDimension={boardDimension}
              onSelectEmail={handleBoardSelectEmail}
              onEmailMoved={handleEmailMoved}
              accountColorMap={accountColorMap}
              showAccountDot={showAccountDot}
              accountDisplayMap={accountDisplayMap}
            />
          </div>
        )}
      </div>
    );
  }

  // Tree view — render when tree type is selected and groupBy is configured
  if (viewType === 'tree' && groupBy.length > 0) {
    return (
      <div className="h-full flex flex-col">
        <ViewBreadcrumb emailCount={treeNodes.reduce((sum, n) => sum + (n.count ?? 0), 0)} />
        <div className="flex-1 min-h-0">
          <TreeView
            nodes={treeNodes}
            configId={viewConfig.id}
            groupBy={groupBy}
            onSelectEmails={(emails) => setEmails(emails)}
            onEmailMoved={handleEmailMoved}
            selectedCategory={selectedCategory}
          />
        </div>
      </div>
    );
  }

  // List view (default) — also used for system groups and filtered results
  return (
    <div>
      <ViewBreadcrumb emailCount={emails.length} />
      {emails.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">
            {selectedCategory
              ? `No emails in ${selectedCategory}`
              : selectedSystemGroup
                ? `No ${
                    { starred: 'starred', archived: 'archived', trash: 'trash', snoozed: 'snoozed' }[selectedSystemGroup]
                  } emails`
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
          accountColorMap={accountColorMap}
          showAccountDot={showAccountDot}
        />
      )}
    </div>
  );
}
