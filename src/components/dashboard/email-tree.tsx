'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TreeNode } from './tree-node';
import { EmailList } from './email-list';
import { UnreadSection } from './unread-section';
import { InboxOverview } from './inbox-overview';
import { SystemGroups } from './system-groups';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import type { Layout } from 'react-resizable-panels';
import { createClient } from '@/lib/supabase/client';
import { EmailDetail } from './email-detail';
import { viewModeToLevels } from '@/lib/grouping/engine';
import type { Email, EmailWithCategory, TreeNode as TreeNodeType, GroupingConfig, SystemGroupKey, ViewMode } from '@/types';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface EmailTreeProps {
  config: GroupingConfig;
  /** Increment to trigger a full re-fetch (e.g. after sync completes) */
  refreshKey?: number;
  /** Global default view mode */
  defaultViewMode?: ViewMode;
  /** Per-category view mode overrides */
  viewModeOverrides?: Record<string, ViewMode>;
}

function TreeSkeleton() {
  return (
    <div className="p-3 space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-3 w-6" />
        </div>
      ))}
    </div>
  );
}

export function EmailTree({ config, refreshKey, defaultViewMode = 'by_sender', viewModeOverrides = {} }: EmailTreeProps) {
  const [rootNodes, setRootNodes] = useState<TreeNodeType[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<EmailWithCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // When an unread email is clicked from the UnreadSection, show it directly in the right panel
  const [unreadSelectedEmail, setUnreadSelectedEmail] = useState<EmailWithCategory | null>(null);
  const [unreadRefreshKey, setUnreadRefreshKey] = useState(0);
  // System group selection (starred/archived/trash)
  const [selectedSystemGroup, setSelectedSystemGroup] = useState<SystemGroupKey | null>(null);
  const [systemGroupEmails, setSystemGroupEmails] = useState<EmailWithCategory[]>([]);
  const [systemGroupLoading, setSystemGroupLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const realtimeChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Suppress realtime INSERT toasts until after initial data load completes.
  // Without this, existing emails replayed by Supabase Realtime on subscription
  // cause "New email received" toast spam on first page load.
  const initialLoadDoneRef = useRef(false);

  const fetchNodes = useCallback(async (showSkeleton = true) => {
    if (showSkeleton) setLoading(true);
    setFetchError(false);
    try {
      const params = new URLSearchParams({
        level: '0',
        configId: config.id,
      });
      const res = await fetch(`/api/emails?${params}`);
      if (!res.ok) {
        setFetchError(true);
        return;
      }
      const data = await res.json();
      if (data.type === 'groups') {
        setRootNodes(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch tree nodes:', err);
      setFetchError(true);
    } finally {
      if (showSkeleton) setLoading(false);
    }
  }, [config.id]);

  useEffect(() => {
    fetchNodes(true).then(() => {
      // Mark initial load as done after a short delay to let Supabase Realtime
      // replay any existing rows. Realtime replays happen within ~1-2s of subscription.
      setTimeout(() => { initialLoadDoneRef.current = true; }, 3000);
    });
  }, [fetchNodes, refreshKey]);

  // Debounced refresh: coalesce rapid realtime events (e.g. during bulk sync)
  const debouncedRefresh = useCallback((showToast?: { title: string; description: string }) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      if (showToast) {
        toast.info(showToast.title, { description: showToast.description });
      }
      setUnreadRefreshKey((k) => k + 1);
      fetchNodes(false);
    }, 500); // 500ms debounce — coalesces burst events from sync
  }, [fetchNodes]);

  // --- Supabase Realtime: listen for new emails ---
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel('emails-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'emails',
        },
        (payload) => {
          const subject = (payload.new as Record<string, unknown>)?.subject as string;
          console.log('[realtime] New email inserted:', subject);
          if (initialLoadDoneRef.current) {
            // Only toast for truly new emails arriving after the user is already in the app
            debouncedRefresh({
              title: 'New email received',
              description: subject ?? 'New email',
            });
          } else {
            // Silently refresh — these are replayed events from initial subscription
            debouncedRefresh();
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'emails',
        },
        () => {
          // Email updated (e.g., marked as read, categorized) — silently refresh tree
          debouncedRefresh();
        },
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [debouncedRefresh]);

  const handleSelectEmails = useCallback(
    (emails: EmailWithCategory[], path: string) => {
      setSelectedEmails(emails);
      setSelectedPath(path);
      setSelectedSystemGroup(null); // Clear system group when tree node selected
    },
    []
  );

  // Structural change (archive, trash, reassign) — silently refresh tree + unread
  const handleEmailMoved = useCallback(() => {
    fetchNodes(false);
    setUnreadRefreshKey((k) => k + 1);
  }, [fetchNodes]);

  // For unread section: also a structural change
  const handleEmailsChanged = useCallback(() => {
    fetchNodes(false);
    setUnreadRefreshKey((k) => k + 1);
  }, [fetchNodes]);

  // When an unread email is clicked, show it in the right panel
  const handleUnreadEmailSelected = useCallback((email: Email) => {
    // Cast Email → EmailWithCategory (unread emails have null category fields)
    const emailWithCat: EmailWithCategory = {
      ...email,
      category: null,
      topic: null,
      priority: null,
      importance_score: null,
      importance_label: null,
      confidence: null,
    };
    setUnreadSelectedEmail(emailWithCat);
    setSelectedPath('__unread__');
    setSelectedSystemGroup(null); // Clear system group when unread email selected
  }, []);

  // When an unread email is removed/categorized from the detail view
  const handleUnreadEmailRemoved = useCallback((emailId: string) => {
    setUnreadSelectedEmail(null);
    setSelectedPath(null);
    handleEmailsChanged();
    // Also remove from unread list
    void emailId; // used by the caller
  }, [handleEmailsChanged]);

  const handleUnreadEmailUpdated = useCallback((emailId: string, updates: Partial<EmailWithCategory>) => {
    setUnreadSelectedEmail((prev) => prev && prev.id === emailId ? { ...prev, ...updates } : prev);
  }, []);

  const handleUnreadEmailCategoryChanged = useCallback((emailId: string, category: string) => {
    setUnreadSelectedEmail((prev) => prev && prev.id === emailId ? { ...prev, category } : prev);
    handleEmailsChanged();
  }, [handleEmailsChanged]);

  // Fetch emails for a system group (no toggle logic — pure data fetch)
  const fetchSystemGroupEmails = useCallback(async (group: SystemGroupKey) => {
    setSystemGroupLoading(true);
    try {
      const res = await fetch(`/api/emails/system-groups/${group}?limit=100`);
      if (!res.ok) {
        setSystemGroupEmails([]);
        return;
      }
      const data = await res.json();
      // Normalize email_categories join data
      const emails: EmailWithCategory[] = (data.emails ?? []).map((row: Record<string, unknown>) => {
        const cat = row.email_categories as Record<string, unknown> | Record<string, unknown>[] | null;
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
      });
      setSystemGroupEmails(emails);
    } catch {
      setSystemGroupEmails([]);
    } finally {
      setSystemGroupLoading(false);
    }
  }, []);

  // System group selection — toggle on/off, then fetch
  const handleSelectSystemGroup = useCallback(async (group: SystemGroupKey) => {
    // If clicking the same group, deselect
    if (selectedSystemGroup === group) {
      setSelectedSystemGroup(null);
      setSystemGroupEmails([]);
      setSelectedPath(null);
      return;
    }

    setSelectedSystemGroup(group);
    setSelectedPath('__system__');
    setUnreadSelectedEmail(null);
    fetchSystemGroupEmails(group);
  }, [selectedSystemGroup, fetchSystemGroupEmails]);

  // When emails are moved from within a system group, refresh the group
  const handleSystemGroupEmailMoved = useCallback(() => {
    fetchNodes(false);
    setUnreadRefreshKey((k) => k + 1);
    // Re-fetch the current system group (uses selectedSystemGroup via ref-like state read)
    setSelectedSystemGroup((current) => {
      if (current) fetchSystemGroupEmails(current);
      return current;
    });
  }, [fetchNodes, fetchSystemGroupEmails]);

  // Persist sidebar layout to localStorage
  const LAYOUT_KEY = 'inboxpilot-sidebar-layout';
  const [savedLayout] = useState<Layout | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Layout;
        // Validate: each panel value should be a reasonable percentage (0-100)
        const values = Object.values(parsed);
        if (values.length >= 2 && values.every((v) => typeof v === 'number' && v >= 5 && v <= 95)) {
          return parsed;
        }
        // Corrupt/outdated layout — clear it
        localStorage.removeItem(LAYOUT_KEY);
      }
    } catch { /* ignore corrupt data */ }
    return undefined;
  });

  const handleLayoutChanged = useCallback((layout: Layout) => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch { /* storage full or unavailable */ }
  }, []);

  const treeContent = (
    <>
      {/* Unread section pinned at top */}
      <UnreadSection onEmailRead={handleEmailsChanged} onSelectEmail={handleUnreadEmailSelected} refreshKey={(refreshKey ?? 0) + unreadRefreshKey} />

      {/* System groups: Starred / Archived / Trash */}
      <SystemGroups
        selectedGroup={selectedSystemGroup}
        onSelectGroup={handleSelectSystemGroup}
        refreshKey={(refreshKey ?? 0) + unreadRefreshKey}
      />

      {loading ? (
        <TreeSkeleton />
      ) : fetchError ? (
        <div className="text-center py-12 text-muted-foreground">
          <AlertCircle className="h-6 w-6 text-destructive mx-auto mb-2" />
          <p className="text-sm font-medium text-destructive">Failed to load emails</p>
          <button
            onClick={() => fetchNodes(true)}
            className="text-sm text-primary mt-2 hover:underline"
          >
            Retry
          </button>
        </div>
      ) : rootNodes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">No emails yet</p>
          <p className="text-sm mt-1">
            Tap the sync button to fetch your emails
          </p>
        </div>
      ) : (
        <div className="p-3 space-y-0.5">
          {rootNodes.map((node) => {
            // Compute effective view mode and levels for this category
            const effectiveMode = viewModeOverrides[node.group_key] ?? defaultViewMode;
            const effectiveLevels = viewModeToLevels(effectiveMode);
            return (
              <TreeNode
                key={node.group_key}
                label={node.group_key}
                count={node.count}
                dimension={config.levels[0]?.dimension ?? 'category'}
                level={0}
                path={[]}
                configId={config.id}
                totalLevels={effectiveLevels.length}
                levels={effectiveLevels}
                onSelectEmails={handleSelectEmails}
                selectedPath={selectedPath}
                onTreeChanged={handleEmailsChanged}
              />
            );
          })}
        </div>
      )}
    </>
  );

  const emailContent = selectedPath === '__system__' && selectedSystemGroup ? (
    systemGroupLoading ? (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
      </div>
    ) : (
      <>
        <button
          onClick={() => { setSelectedSystemGroup(null); setSelectedPath(null); }}
          className="p-3 text-sm text-primary font-medium"
        >
          &larr; Back to overview
        </button>
        <EmailList emails={systemGroupEmails} onEmailMoved={handleSystemGroupEmailMoved} systemGroup={selectedSystemGroup} />
      </>
    )
  ) : unreadSelectedEmail && selectedPath === '__unread__' ? (
    <>
      <button
        onClick={() => { setUnreadSelectedEmail(null); setSelectedPath(null); }}
        className="p-3 text-sm text-primary font-medium"
      >
        &larr; Back to overview
      </button>
      <EmailDetail
        email={unreadSelectedEmail}
        onBack={() => { setUnreadSelectedEmail(null); setSelectedPath(null); }}
        onRemoved={handleUnreadEmailRemoved}
        onUpdated={handleUnreadEmailUpdated}
        onCategoryChanged={handleUnreadEmailCategoryChanged}
      />
    </>
  ) : selectedPath && selectedPath !== '__unread__' ? (
    <>
      <button
        onClick={() => setSelectedPath(null)}
        className="p-3 text-sm text-primary font-medium"
      >
        &larr; Back to overview
      </button>
      {emailsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading emails...</span>
        </div>
      ) : selectedEmails.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">No emails in this group</p>
        </div>
      ) : (
        <EmailList emails={selectedEmails} onEmailMoved={handleEmailMoved} />
      )}
    </>
  ) : (
    <InboxOverview
      rootNodes={rootNodes}
      dimensionLabel={config.levels[0]?.label ?? config.levels[0]?.dimension ?? 'Group'}
      onSelectGroup={(groupKey) => {
        // Find the matching root node and trigger email selection
        const node = rootNodes.find((n) => n.group_key === groupKey);
        if (node && config.levels[0]) {
          // Build the path key like TreeNode does
          const pathKey = `${config.levels[0].dimension}:${groupKey}`;
          setSelectedPath(pathKey);
          setSelectedEmails([]); // Clear stale emails
          setEmailsLoading(true);
          // Always fetch leaf-level emails — overview is a shortcut to see
          // all emails in a group, not to drill into sub-levels
          const params = new URLSearchParams({
            level: String(config.levels.length),
            configId: config.id,
            leaf: 'true',
            [`filter.${config.levels[0].dimension}`]: groupKey,
          });
          fetch(`/api/emails?${params}`)
            .then((res) => res.json())
            .then((data) => {
              if (data.type === 'emails') {
                setSelectedEmails(data.data);
              }
            })
            .catch(console.error)
            .finally(() => setEmailsLoading(false));
        }
      }}
    />
  );

  // Mobile layout: stack vertically, show one panel at a time
  // Desktop layout: resizable horizontal panels
  return (
    <>
      {/* Mobile: stacked layout with conditional visibility */}
      <div className="flex flex-col h-full lg:hidden">
        <div className={`${selectedPath ? 'hidden' : 'flex'} flex-col flex-1 border-b border-border`}>
          <ScrollArea className="flex-1">{treeContent}</ScrollArea>
        </div>
        <div className={`${!selectedPath ? 'hidden' : 'flex'} flex-col flex-1 overflow-hidden`}>
          <ScrollArea className="flex-1">{emailContent}</ScrollArea>
        </div>
      </div>

      {/* Desktop: resizable panels */}
      <div className="hidden lg:flex h-full">
        <ResizablePanelGroup
          orientation="horizontal"
          id="inboxpilot-sidebar"
          onLayoutChanged={handleLayoutChanged}
          {...(savedLayout ? { defaultLayout: savedLayout } : {})}
        >
          <ResizablePanel id="tree" defaultSize="40%" minSize="20%" maxSize="80%">
            <ScrollArea className="h-full">{treeContent}</ScrollArea>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="emails" defaultSize="60%" minSize="20%" maxSize="80%">
            <ScrollArea className="h-full">{emailContent}</ScrollArea>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </>
  );
}
