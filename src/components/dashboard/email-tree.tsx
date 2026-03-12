'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TreeNode } from './tree-node';
import { EmailList } from './email-list';
import { UnreadSection } from './unread-section';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import type { EmailWithCategory, TreeNode as TreeNodeType, GroupingConfig } from '@/types';
import { AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface EmailTreeProps {
  config: GroupingConfig;
  /** Increment to trigger a full re-fetch (e.g. after sync completes) */
  refreshKey?: number;
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

export function EmailTree({ config, refreshKey }: EmailTreeProps) {
  const [rootNodes, setRootNodes] = useState<TreeNodeType[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<EmailWithCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [unreadRefreshKey, setUnreadRefreshKey] = useState(0);
  const [fetchError, setFetchError] = useState(false);
  const realtimeChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchNodes = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [config.id]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes, refreshKey]);

  // Debounced refresh: coalesce rapid realtime events (e.g. during bulk sync)
  const debouncedRefresh = useCallback((showToast?: { title: string; description: string }) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      if (showToast) {
        toast.info(showToast.title, { description: showToast.description });
      }
      setUnreadRefreshKey((k) => k + 1);
      fetchNodes();
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
          debouncedRefresh({
            title: 'New email received',
            description: subject ?? 'New email',
          });
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
    },
    []
  );

  // Refresh tree + unread section when emails change
  const handleEmailsChanged = useCallback(() => {
    fetchNodes();
    setUnreadRefreshKey((k) => k + 1);
  }, [fetchNodes]);

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* Tree navigator */}
      <div
        className={`${
          selectedPath ? 'hidden lg:flex' : 'flex'
        } lg:w-80 lg:flex-shrink-0 flex-col border-b lg:border-b-0 lg:border-r border-border`}
      >
        <ScrollArea className="flex-1">
          {/* Unread section pinned at top */}
          <UnreadSection onEmailRead={handleEmailsChanged} refreshKey={(refreshKey ?? 0) + unreadRefreshKey} />

          {loading ? (
            <TreeSkeleton />
          ) : fetchError ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="h-6 w-6 text-destructive mx-auto mb-2" />
              <p className="text-sm font-medium text-destructive">Failed to load emails</p>
              <button
                onClick={fetchNodes}
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
              {rootNodes.map((node) => (
                <TreeNode
                  key={node.group_key}
                  label={node.group_key}
                  count={node.count}
                  dimension={config.levels[0].dimension}
                  level={0}
                  path={[]}
                  configId={config.id}
                  totalLevels={config.levels.length}
                  levels={config.levels}
                  onSelectEmails={handleSelectEmails}
                  selectedPath={selectedPath}
                  onTreeChanged={handleEmailsChanged}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Email list */}
      <div className={`${!selectedPath ? 'hidden lg:flex' : 'flex'} flex-1 flex-col overflow-hidden`}>
        <ScrollArea className="flex-1">
          {selectedPath ? (
            <>
              <button
                onClick={() => setSelectedPath(null)}
                className="lg:hidden p-3 text-sm text-primary font-medium"
              >
                &larr; Back to tree
              </button>
              <EmailList emails={selectedEmails} onEmailUpdated={handleEmailsChanged} />
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a group to view emails
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
