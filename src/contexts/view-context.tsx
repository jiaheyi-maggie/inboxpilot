'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  ViewConfig,
  ViewType,
  ViewFilter,
  ViewSort,
  GroupingLevel,
  SystemGroupKey,
} from '@/types';

// ── Context value ──────────────────────────────────────────────

/** Structured search filters from AI intent classification */
export interface SearchFilters {
  query: string;
  sender_domain?: string;
  category?: string;
  is_read?: boolean;
  sender_email?: string;
  [key: string]: unknown;
}

interface ViewContextValue {
  /** The persisted view config (source of truth for saved state) */
  viewConfig: ViewConfig;

  // ── View type ──
  viewType: ViewType;
  setViewType: (type: ViewType) => void;

  // ── Filters ──
  filters: ViewFilter[];
  addFilter: (filter: ViewFilter) => void;
  removeFilter: (index: number) => void;
  clearFilters: () => void;

  // ── Sort ──
  sort: ViewSort[];
  setSort: (sort: ViewSort[]) => void;

  // ── Group by ──
  groupBy: GroupingLevel[];
  setGroupBy: (levels: GroupingLevel[]) => void;

  // ── Navigation state (sidebar selections) ──
  selectedCategory: string | null;
  setSelectedCategory: (cat: string | null) => void;
  selectedSystemGroup: SystemGroupKey | null;
  setSelectedSystemGroup: (group: SystemGroupKey | null) => void;

  // ── Account filter (multi-inbox) ──
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;

  // ── Email selection ──
  selectedEmailId: string | null;
  setSelectedEmailId: (id: string | null) => void;

  // ── Search ──
  searchQuery: string | null;
  searchFilters: SearchFilters | null;
  setSearch: (query: string, filters?: Record<string, unknown>) => void;
  clearSearch: () => void;

  // ── Refresh trigger ──
  sidebarRefreshKey: number;
  contentRefreshKey: number;
  unreadRefreshKey: number;
  countsRefreshKey: number;
  triggerRefresh: (scope?: RefreshScope | RefreshScope[]) => void;
}

export type RefreshScope = 'sidebar' | 'content' | 'unread' | 'counts';

const ViewStateContext = createContext<any>(null);
const ViewRefreshContext = createContext<any>(null);

// ── Hook ───────────────────────────────────────────────────────

export function useView(): ViewContextValue {
  const state = useContext(ViewStateContext);
  const refresh = useContext(ViewRefreshContext);
  if (!state || !refresh) throw new Error('useView must be used within a ViewProvider');
  return useMemo(() => ({ ...state, ...refresh }), [state, refresh]);
}

export function useViewState(): ViewContextValue {
  const ctx = useContext(ViewStateContext);
  if (!ctx) throw new Error("useViewState must be used within a ViewProvider");
  return ctx;
}

export function useViewRefresh() {
  const ctx = useContext(ViewRefreshContext);
  if (!ctx) throw new Error("useViewRefresh must be used within a ViewProvider");
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────

interface ViewProviderProps {
  initialView: ViewConfig;
  /** External refresh key (e.g., from sync-complete events) */
  externalRefreshKey?: number;
  children: ReactNode;
}

export function ViewProvider({
  initialView,
  externalRefreshKey = 0,
  children,
}: ViewProviderProps) {
  const [viewConfig] = useState(initialView);

  // Local UI state (mirrors viewConfig fields but allows instant updates)
  const [viewType, setViewTypeState] = useState<ViewType>(initialView.view_type);
  const [filters, setFilters] = useState<ViewFilter[]>(initialView.filters ?? []);
  const [sort, setSort] = useState<ViewSort[]>(
    initialView.sort ?? [{ field: 'received_at', direction: 'desc' }]
  );
  const [groupBy, setGroupBy] = useState<GroupingLevel[]>(initialView.group_by ?? []);

  // Navigation state
  const [selectedCategory, setSelectedCategoryState] = useState<string | null>(null);
  const [selectedSystemGroup, setSelectedSystemGroupState] = useState<SystemGroupKey | null>(null);
  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [searchFilters, setSearchFilters] = useState<SearchFilters | null>(null);

  // Refresh trigger — combined key (backward compat) + scoped keys
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [contentRefreshKey, setContentRefreshKey] = useState(0);
  const [unreadRefreshKey, setUnreadRefreshKey] = useState(0);
  const [countsRefreshKey, setCountsRefreshKey] = useState(0);

  const triggerRefresh = useCallback((scope?: RefreshScope | RefreshScope[]) => {
    if (!scope) {
      // No scope = refresh everything
      setSidebarRefreshKey((k) => k + 1);
      setContentRefreshKey((k) => k + 1);
      setUnreadRefreshKey((k) => k + 1);
      setCountsRefreshKey((k) => k + 1);
      return;
    }

    const scopes = Array.isArray(scope) ? scope : [scope];
    for (const s of scopes) {
      switch (s) {
        case 'sidebar':
          setSidebarRefreshKey((k) => k + 1);
          break;
        case 'content':
          setContentRefreshKey((k) => k + 1);
          break;
        case 'unread':
          setUnreadRefreshKey((k) => k + 1);
          break;
        case 'counts':
          setCountsRefreshKey((k) => k + 1);
          break;
      }
    }
  }, []);

  // Sync external refresh key changes into all counters
  useEffect(() => {
    if (externalRefreshKey > 0) {
      setSidebarRefreshKey((k) => k + 1);
      setContentRefreshKey((k) => k + 1);
      setUnreadRefreshKey((k) => k + 1);
      setCountsRefreshKey((k) => k + 1);
    }
  }, [externalRefreshKey]);

  // Debounced persist to API
  const persistTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  const persistViewConfig = useCallback(
    (updates: Partial<ViewConfig>) => {
      if (persistTimeout.current) clearTimeout(persistTimeout.current);
      persistTimeout.current = setTimeout(() => {
        fetch(`/api/settings/view-configs/${viewConfig.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }).catch(() => {
          // Silent fail — local state is source of truth during session
        });
      }, 500);
    },
    [viewConfig.id]
  );

  // ── Setters that persist ──

  const setViewType = useCallback(
    (type: ViewType) => {
      setViewTypeState(type);
      persistViewConfig({ view_type: type });
    },
    [persistViewConfig]
  );

  const addFilter = useCallback(
    (filter: ViewFilter) => {
      setFilters((prev) => {
        const next = [...prev, filter];
        persistViewConfig({ filters: next });
        return next;
      });
    },
    [persistViewConfig]
  );

  const removeFilter = useCallback(
    (index: number) => {
      setFilters((prev) => {
        const next = prev.filter((_, i) => i !== index);
        persistViewConfig({ filters: next });
        return next;
      });
    },
    [persistViewConfig]
  );

  const clearFilters = useCallback(() => {
    setFilters([]);
    persistViewConfig({ filters: [] });
  }, [persistViewConfig]);

  const setSortAndPersist = useCallback(
    (newSort: ViewSort[]) => {
      setSort(newSort);
      persistViewConfig({ sort: newSort });
    },
    [persistViewConfig]
  );

  const setGroupByAndPersist = useCallback(
    (levels: GroupingLevel[]) => {
      setGroupBy(levels);
      persistViewConfig({ group_by: levels });
    },
    [persistViewConfig]
  );

  // When selecting a category, clear system group and search (and vice versa)
  const setSelectedCategory = useCallback((cat: string | null) => {
    setSelectedCategoryState(cat);
    setSelectedSystemGroupState(null);
    setSelectedEmailId(null);
    // Clear search when navigating to a category
    setSearchQuery(null);
    setSearchFilters(null);
  }, []);

  const setSelectedSystemGroup = useCallback((group: SystemGroupKey | null) => {
    setSelectedSystemGroupState(group);
    setSelectedCategoryState(null);
    setSelectedEmailId(null);
    // Clear search when navigating to a system group
    setSearchQuery(null);
    setSearchFilters(null);
  }, []);

  const setSelectedAccountId = useCallback((id: string | null) => {
    setSelectedAccountIdState(id);
    setSelectedEmailId(null);
  }, []);

  // Search: activating a search clears category/system group selection to show results
  const setSearch = useCallback((query: string, filters?: Record<string, unknown>) => {
    // Guard against empty/whitespace-only queries — treat as no-op
    const trimmed = query.trim();
    if (!trimmed) return;
    const searchF: SearchFilters = { query: trimmed, ...filters };
    setSearchQuery(trimmed);
    setSearchFilters(searchF);
    // Clear navigation so the main content area shows search results
    setSelectedCategoryState(null);
    setSelectedSystemGroupState(null);
    setSelectedEmailId(null);
    // Trigger a content refresh to fetch search results
    setContentRefreshKey((k) => k + 1);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery(null);
    setSearchFilters(null);
    // Trigger a content refresh to go back to normal view
    setContentRefreshKey((k) => k + 1);
  }, []);

  const value = useMemo(
    () => ({
      viewConfig,
      viewType,
      setViewType,
      filters,
      addFilter,
      removeFilter,
      clearFilters,
      sort,
      setSort: setSortAndPersist,
      groupBy,
      setGroupBy: setGroupByAndPersist,
      selectedCategory,
      setSelectedCategory,
      selectedSystemGroup,
      setSelectedSystemGroup,
      selectedAccountId,
      setSelectedAccountId,
      selectedEmailId,
      setSelectedEmailId,
      searchQuery,
      searchFilters,
      setSearch,
      clearSearch,
    }),
    [
      viewConfig,
      viewType,
      setViewType,
      filters,
      addFilter,
      removeFilter,
      clearFilters,
      sort,
      setSortAndPersist,
      groupBy,
      setGroupByAndPersist,
      selectedCategory,
      setSelectedCategory,
      selectedSystemGroup,
      setSelectedSystemGroup,
      selectedAccountId,
      setSelectedAccountId,
      selectedEmailId,
      searchQuery,
      searchFilters,
      setSearch,
      clearSearch,
    ]
  );

  const refreshValue = useMemo(
    () => ({sidebarRefreshKey,contentRefreshKey,unreadRefreshKey,countsRefreshKey,triggerRefresh}),
    [sidebarRefreshKey,contentRefreshKey,unreadRefreshKey,countsRefreshKey,triggerRefresh]
  );

  return (
    <ViewStateContext value={value}>
      <ViewRefreshContext value={refreshValue}>
        {children}
      </ViewRefreshContext>
    </ViewStateContext>
  );
}
