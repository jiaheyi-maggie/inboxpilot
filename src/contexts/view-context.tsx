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

  // ── Email selection ──
  selectedEmailId: string | null;
  setSelectedEmailId: (id: string | null) => void;

  // ── Refresh trigger ──
  refreshKey: number;
  triggerRefresh: () => void;
}

const ViewContext = createContext<ViewContextValue | null>(null);

// ── Hook ───────────────────────────────────────────────────────

export function useView(): ViewContextValue {
  const ctx = useContext(ViewContext);
  if (!ctx) throw new Error('useView must be used within a ViewProvider');
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
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);

  // Refresh trigger — single counter incremented by both internal and external events
  const [refreshKey, setRefreshKey] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Sync external refresh key changes into the single counter
  useEffect(() => {
    if (externalRefreshKey > 0) {
      setRefreshKey((k) => k + 1);
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

  // When selecting a category, clear system group (and vice versa)
  const setSelectedCategory = useCallback((cat: string | null) => {
    setSelectedCategoryState(cat);
    setSelectedSystemGroupState(null);
    setSelectedEmailId(null);
  }, []);

  const setSelectedSystemGroup = useCallback((group: SystemGroupKey | null) => {
    setSelectedSystemGroupState(group);
    setSelectedCategoryState(null);
    setSelectedEmailId(null);
  }, []);

  const value = useMemo<ViewContextValue>(
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
      selectedEmailId,
      setSelectedEmailId,
      refreshKey,
      triggerRefresh,
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
      selectedEmailId,
      refreshKey,
      triggerRefresh,
    ]
  );

  return <ViewContext value={value}>{children}</ViewContext>;
}
