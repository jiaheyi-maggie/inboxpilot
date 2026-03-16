'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { ViewProvider, useView } from '@/contexts/view-context';
import { Sidebar } from '@/components/dashboard/sidebar';
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

export function DashboardClient({ viewConfig, account, accounts }: DashboardClientProps) {
  const router = useRouter();
  const autoSyncTriggered = useRef(false);
  const [externalRefreshKey, setExternalRefreshKey] = useState(0);

  // Listen for sync-complete events from AppShell's SyncStatus
  useEffect(() => {
    const handler = () => setExternalRefreshKey((k) => k + 1);
    window.addEventListener('inboxpilot:sync-complete', handler);
    return () => window.removeEventListener('inboxpilot:sync-complete', handler);
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
      fetch('/api/sync', { method: 'POST' })
        .then(() => {
          setExternalRefreshKey((k) => k + 1);
          router.refresh();
        })
        .catch(() => {});
    }
  }, [account, router]);

  return (
    <ViewProvider key={viewConfig.id} initialView={viewConfig} externalRefreshKey={externalRefreshKey}>
      <DashboardLayout accounts={accounts} />
    </ViewProvider>
  );
}

// ── Inner layout component that can use useView() ──

function DashboardLayout({ accounts }: { accounts: AccountInfo[] }) {
  const { refreshKey, triggerRefresh, viewConfig, selectedCategory, selectedAccountId } = useView();

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

  // Root nodes for sidebar category list
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [sidebarError, setSidebarError] = useState(false);

  // Realtime
  const realtimeChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDoneRef = useRef(false);

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

  // Initial load
  useEffect(() => {
    fetchRootNodes(true).then(() => {
      setTimeout(() => { initialLoadDoneRef.current = true; }, 3000);
    });
  }, [fetchRootNodes, refreshKey]);

  // Debounced refresh for realtime events
  const debouncedRefresh = useCallback((showToast?: { title: string; description: string }) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      if (showToast) {
        toast.info(showToast.title, { description: showToast.description });
      }
      triggerRefresh();
      fetchRootNodes(false);
    }, 500);
  }, [fetchRootNodes, triggerRefresh]);

  // Supabase Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('emails-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'emails' },
        (payload) => {
          const subject = (payload.new as Record<string, unknown>)?.subject as string;
          if (initialLoadDoneRef.current) {
            debouncedRefresh({ title: 'New email received', description: subject ?? 'New email' });
          } else {
            debouncedRefresh();
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'emails' },
        () => { debouncedRefresh(); },
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [debouncedRefresh]);

  // Persist sidebar layout to localStorage
  const LAYOUT_KEY = 'inboxpilot-sidebar-layout';
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
      {/* Active view content */}
      <ScrollArea className="flex-1">
        <ActiveViewRouter accountColorMap={accountColorMap} showAccountDot={accounts.length > 1} accountDisplayMap={accountDisplayMap} />
      </ScrollArea>
    </div>
  );

  return (
    <>
      {/* Global command palette (Cmd+K) */}
      <CommandPalette onOpenChat={handleOpenChat} />

      {/* Mobile: stacked layout + chat overlay */}
      <div className="flex flex-col h-full lg:hidden">
        <div className="border-b border-border">
          <ScrollArea className="max-h-[40vh]">{sidebarContent}</ScrollArea>
        </div>
        <div className="flex-1 overflow-hidden">{mainContent}</div>
        <ChatSidebar
          open={chatOpen}
          onClose={handleCloseChat}
          prefillMessage={chatPrefill}
          currentCategory={selectedCategory}
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
        />
      </div>
    </>
  );
}
