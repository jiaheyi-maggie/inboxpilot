'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { ViewProvider, useView, type RefreshScope } from '@/contexts/view-context';
import { Sidebar } from '@/components/dashboard/sidebar';
import { MobileScopeBar } from '@/components/dashboard/mobile-scope-bar';
import { MobileCategorySheet } from '@/components/dashboard/mobile-category-sheet';
import { ViewTabs } from '@/components/dashboard/view-tabs';
import { ViewToolbar } from '@/components/dashboard/view-toolbar';
import { ActiveViewRouter } from '@/components/dashboard/active-view-router';
import { CommandPalette } from '@/components/command-palette';
import { ChatSidebar } from '@/components/chat-sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import type { Layout } from 'react-resizable-panels';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { ViewConfig, GmailAccount, TreeNode } from '@/types';

/** Minimal account info passed from server to client */
export type AccountInfo = Pick<GmailAccount, 'id' | 'email' | 'last_sync_at' | 'sync_enabled' | 'granted_scope' | 'color' | 'display_name'>;

interface DashboardClientProps {
  viewConfig: ViewConfig;
  account: AccountInfo | null;
  accounts: AccountInfo[];
}

// Realtime: fields whose changes are user-visible and warrant a UI refresh.
// Internal bookkeeping fields (categorization_status, is_categorized, label_ids, etc.)
// change frequently during background sync/categorize and should NOT cause re-renders.
// Declared at module scope to avoid recreating the array on every render.
const VISIBLE_FIELDS = ['is_read', 'is_starred', 'subject', 'snippet'] as const;

const LAYOUT_KEY = 'inboxpilot-sidebar-layout';

export function DashboardClient({ viewConfig, account, accounts }: DashboardClientProps) {
  const autoSyncTriggered = useRef(false);
  const [externalRefreshKey, setExternalRefreshKey] = useState(0);

  // Ref shared with DashboardLayout to suppress Realtime events during sync.
  // When sync is in progress, every synced email fires a Realtime INSERT event.
  // Without suppression, 50 emails = ~20 debounced sidebar refetches over 10s.
  // The sync dispatches its own refresh on completion, so Realtime events are redundant noise.
  const isSyncingRef = useRef(false);

  // Listen for sync lifecycle events from AppShell's SyncStatus + CommandPalette.
  // sync-start: suppress Realtime events (they're redundant during sync).
  // sync-complete: re-enable Realtime, trigger a single bulk refresh.
  useEffect(() => {
    const handleStart = () => {
      isSyncingRef.current = true;
    };
    const handleComplete = () => {
      isSyncingRef.current = false;
      setExternalRefreshKey((k) => k + 1);
    };
    window.addEventListener('inboxpilot:sync-start', handleStart);
    window.addEventListener('inboxpilot:sync-complete', handleComplete);
    return () => {
      window.removeEventListener('inboxpilot:sync-start', handleStart);
      window.removeEventListener('inboxpilot:sync-complete', handleComplete);
    };
  }, []);

  // Auto-sync on mount if last sync was >5 min ago
  useEffect(() => {
    if (autoSyncTriggered.current || !account?.sync_enabled) return;
    const STALE_MS = 5 * 60 * 1000;
    const lastSyncTime = account?.last_sync_at
      ? new Date(account.last_sync_at).getTime()
      : 0;
    if (Date.now() - lastSyncTime > STALE_MS) {
      autoSyncTriggered.current = true;
      isSyncingRef.current = true;
      fetch('/api/sync', { method: 'POST' })
        .then(() => {
          isSyncingRef.current = false;
          setExternalRefreshKey((k) => k + 1);
        })
        .catch(() => {
          isSyncingRef.current = false;
        });
    }
  }, [account]);

  return (
    <ViewProvider key={viewConfig.id} initialView={viewConfig} externalRefreshKey={externalRefreshKey}>
      <DashboardLayout accounts={accounts} isSyncingRef={isSyncingRef} />
    </ViewProvider>
  );
}

// ── Inner layout component that can use useView() ──

function DashboardLayout({ accounts, isSyncingRef }: { accounts: AccountInfo[]; isSyncingRef: React.RefObject<boolean> }) {
  const { sidebarRefreshKey, unreadRefreshKey, countsRefreshKey, triggerRefresh, viewConfig, selectedCategory, selectedAccountId, selectedSystemGroup, setSelectedCategory, setSelectedSystemGroup, setSelectedAccountId, setSelectedEmailId, searchQuery, clearSearch } = useView();

  // Escape key clears search first, then category/system group selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        // Don't interfere with modals/inputs
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        // Clear search first if active, then navigation
        if (searchQuery) {
          clearSearch();
          return;
        }
        setSelectedCategory(null);
        setSelectedSystemGroup(null);
        setSelectedEmailId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setSelectedCategory, setSelectedSystemGroup, setSelectedEmailId, searchQuery, clearSearch]);

  // Build account color map: gmail_account_id -> color (stable across renders)
  const accountColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) {
      map.set(a.id, a.color ?? '#3B82F6');
    }
    return map;
  }, [accounts]);

  // Build account display map: gmail_account_id -> display name (for board view grouping)
  const accountDisplayMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) {
      map.set(a.id, a.display_name ?? a.email);
    }
    return map;
  }, [accounts]);

  // Chat sidebar state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPrefill, setChatPrefill] = useState<string | undefined>(undefined);

  const handleOpenChat = useCallback((prefill?: string) => {
    setChatPrefill(prefill);
    setChatOpen(true);
  }, []);

  const handleCloseChat = useCallback(() => {
    setChatOpen(false);
    // Don't clear prefill immediately — ChatSidebar needs it during close animation
    setTimeout(() => setChatPrefill(undefined), 400);
  }, []);

  // Mobile bottom sheet state
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch unread count for mobile scope bar
  const fetchUnreadCount = useCallback(async () => {
    try {
      const url = new URL('/api/emails/unread', window.location.origin);
      if (selectedAccountId) {
        url.searchParams.set('accountId', selectedAccountId);
      }
      const res = await fetch(url.toString());
      if (!res.ok) return;
      const data = await res.json();
      setUnreadCount(data.emails?.length ?? 0);
    } catch {
      // Non-critical — scope bar just won't show a count
    }
  }, [selectedAccountId]);

  // Root nodes for sidebar category list
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [sidebarError, setSidebarError] = useState(false);

  // Realtime
  const realtimeChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDoneRef = useRef(false);
  const hasLoadedRef = useRef(false);

  // Track email IDs the user just acted on (star, archive, snooze) to suppress
  // self-inflicted Realtime UPDATE events. Without this, starring an email causes:
  // user stars -> DB updates is_starred -> Realtime UPDATE fires (is_starred in VISIBLE_FIELDS)
  // -> content refetches -> FocusView re-renders with new emails array -> flash/reload.
  // IDs are auto-cleared after 5 seconds to avoid memory leaks.
  const recentActionsRef = useRef<Set<string>>(new Set());

  const fetchRootNodes = useCallback(async (showSkeleton = true) => {
    if (showSkeleton) setSidebarLoading(true);
    setSidebarError(false);
    try {
      const params = new URLSearchParams({
        level: '0',
        configId: viewConfig.id,
      });
      // Apply account filter for per-inbox category counts
      if (selectedAccountId) {
        params.set('filter.account', selectedAccountId);
      }
      const res = await fetch(`/api/emails?${params}`);
      if (!res.ok) {
        setSidebarError(true);
        return;
      }
      const data = await res.json();
      if (data.type === 'groups') {
        setRootNodes(data.data);
      }
    } catch {
      setSidebarError(true);
    } finally {
      if (showSkeleton) setSidebarLoading(false);
    }
  }, [viewConfig.id, selectedAccountId]);

  // Initial load (runs once per fetchRootNodes/fetchUnreadCount identity change, e.g. account switch)
  useEffect(() => {
    fetchRootNodes(true).then(() => {
      setTimeout(() => {
        initialLoadDoneRef.current = true;
        hasLoadedRef.current = true;
      }, 3000);
    });
    fetchUnreadCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRootNodes, fetchUnreadCount]);

  // Scoped refresh: sidebar categories
  useEffect(() => {
    if (hasLoadedRef.current) fetchRootNodes(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarRefreshKey]);

  // Scoped refresh: unread count
  useEffect(() => {
    if (hasLoadedRef.current) fetchUnreadCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadRefreshKey]);

  // Debounced refresh for realtime events — triggerRefresh() increments all scoped keys,
  // which causes the scoped effects above to re-fetch sidebar/unread/content automatically.
  const debouncedRefresh = useCallback((opts?: { toast?: { title: string; description: string }; scope?: RefreshScope | RefreshScope[] }) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      if (opts?.toast) {
        toast.info(opts.toast.title, { description: opts.toast.description });
      }
      triggerRefresh(opts?.scope);
    }, 500);
  }, [triggerRefresh]);

  // Supabase Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('emails-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'emails' },
        (payload) => {
          // Suppress Realtime INSERT events during sync. The sync process
          // fires an INSERT for every newly synced email. Without suppression,
          // 50 emails synced over 10s = ~20 debounced sidebar refetches.
          // The sync dispatches a single bulk refresh when complete.
          // Tradeoff: a genuinely new email arriving mid-sync appears ~10-20s
          // late (after the sync-complete refresh) instead of instantly.
          // UPDATEs are NOT suppressed — the VISIBLE_FIELDS filter handles those.
          if (isSyncingRef.current) return;

          const subject = (payload.new as Record<string, unknown>)?.subject as string;
          if (initialLoadDoneRef.current) {
            debouncedRefresh({
              toast: { title: 'New email received', description: subject ?? 'New email' },
              scope: ['sidebar', 'unread', 'counts'],
            });
          } else {
            debouncedRefresh({ scope: ['sidebar', 'unread', 'counts'] });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'emails' },
        (payload) => {
          // UPDATEs are NOT suppressed during sync because:
          // 1. Categorization UPDATEs only touch categorization_status/is_categorized,
          //    which are NOT in VISIBLE_FIELDS — the filter below already skips them.
          // 2. User-initiated UPDATEs (star, archive) should still be handled
          //    (the recentActionsRef filter prevents self-inflicted loops).

          // Only refresh when a user-visible field actually changed.
          // Background categorization updates (categorization_status, is_categorized)
          // fire many UPDATE events that would cause periodic re-renders while idle.
          const oldRow = payload.old as Record<string, unknown> | undefined;
          const newRow = payload.new as Record<string, unknown> | undefined;
          if (oldRow && newRow) {
            const hasVisibleChange = VISIBLE_FIELDS.some(
              (field) => oldRow[field] !== newRow[field]
            );
            if (!hasVisibleChange) return;
          }

          // Suppress self-inflicted updates from user actions (star, archive, etc.).
          // Without this, starring in FocusView triggers:
          // user stars -> DB updates is_starred -> Realtime fires -> content refetches
          // -> FocusView re-renders -> visible flash/reload.
          const emailId = (newRow as Record<string, unknown> | undefined)?.id as string | undefined;
          if (emailId && recentActionsRef.current.has(emailId)) return;

          debouncedRefresh({ scope: ['content', 'counts'] });
        },
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [debouncedRefresh, isSyncingRef]);

  // Register an email ID as recently acted on by the user, suppressing
  // Realtime UPDATE events for it for 5 seconds. Used by FocusView/EmailList
  // action handlers (star, archive, snooze) to prevent self-inflicted re-renders.
  const registerRecentAction = useCallback((emailId: string) => {
    recentActionsRef.current.add(emailId);
    setTimeout(() => {
      recentActionsRef.current.delete(emailId);
    }, 5000);
  }, []);

  // Persist sidebar layout to localStorage
  const [savedLayout] = useState<Layout | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Layout;
        const values = Object.values(parsed);
        if (values.length >= 2 && values.every((v) => typeof v === 'number' && v >= 5 && v <= 95)) {
          return parsed;
        }
        localStorage.removeItem(LAYOUT_KEY);
      }
    } catch { /* ignore corrupt data */ }
    return undefined;
  });

  const handleLayoutChanged = useCallback((layout: Layout) => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch { /* storage full */ }
  }, []);

  const sidebarContent = (
    <Sidebar
      rootNodes={rootNodes}
      loading={sidebarLoading}
      fetchError={sidebarError}
      onRetry={() => fetchRootNodes(true)}
      accounts={accounts}
      unreadRefreshKey={unreadRefreshKey}
      countsRefreshKey={countsRefreshKey}
    />
  );

  const mainContent = (
    <div className="flex flex-col h-full">
      {/* View tabs + toolbar header */}
      <div className="flex-shrink-0 border-b border-border px-4 py-2 space-y-2">
        <div className="flex items-center justify-between">
          <ViewTabs />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleOpenChat()}
                className="flex-shrink-0"
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Chat with InboxPilot</TooltipContent>
          </Tooltip>
        </div>
        <ViewToolbar />
      </div>
      {/* Active view content — use native overflow instead of ScrollArea so board view can scroll horizontally */}
      <div className="flex-1 min-h-0 overflow-auto">
        <ActiveViewRouter accountColorMap={accountColorMap} showAccountDot={accounts.length > 1} accountDisplayMap={accountDisplayMap} onUserAction={registerRecentAction} />
      </div>
    </div>
  );

  return (
    <>
      {/* Global command palette (Cmd+K) */}
      <CommandPalette onOpenChat={handleOpenChat} />

      {/* Mobile: scope bar + bottom sheet + chat overlay */}
      <div className="flex flex-col h-full min-h-0 lg:hidden">
        <MobileScopeBar
          selectedCategory={selectedCategory}
          selectedSystemGroup={selectedSystemGroup}
          unreadCount={unreadCount}
          selectedAccountId={selectedAccountId}
          accountColor={selectedAccountId ? accountColorMap.get(selectedAccountId) : undefined}
          onOpenSheet={() => setMobileSheetOpen(true)}
        />
        <div className="flex-1 min-h-0 overflow-hidden">{mainContent}</div>
        <MobileCategorySheet
          open={mobileSheetOpen}
          onClose={() => setMobileSheetOpen(false)}
          rootNodes={rootNodes}
          selectedCategory={selectedCategory}
          selectedSystemGroup={selectedSystemGroup}
          selectedAccountId={selectedAccountId}
          accounts={accounts}
          onSelectCategory={setSelectedCategory}
          onSelectSystemGroup={setSelectedSystemGroup}
          onSelectAccount={setSelectedAccountId}
        />
        <ChatSidebar
          open={chatOpen}
          onClose={handleCloseChat}
          prefillMessage={chatPrefill}
          currentCategory={selectedCategory}
          onRefresh={triggerRefresh}
        />
      </div>

      {/* Desktop: resizable panels + chat sidebar */}
      <div className="hidden lg:flex h-full">
        <div className="flex-1 min-w-0">
          <ResizablePanelGroup
            orientation="horizontal"
            id="inboxpilot-sidebar"
            onLayoutChanged={handleLayoutChanged}
            {...(savedLayout ? { defaultLayout: savedLayout } : {})}
          >
            <ResizablePanel id="sidebar" defaultSize="25%" minSize="15%" maxSize="40%">
              <ScrollArea className="h-full">{sidebarContent}</ScrollArea>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="main" defaultSize="75%" minSize="40%" maxSize="85%">
              {mainContent}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        {/* Chat sidebar inside flex container so it appears side-by-side */}
        <ChatSidebar
          open={chatOpen}
          onClose={handleCloseChat}
          prefillMessage={chatPrefill}
          currentCategory={selectedCategory}
          onRefresh={triggerRefresh}
        />
      </div>
    </>
  );
}
