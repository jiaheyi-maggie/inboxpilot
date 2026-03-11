'use client';

import { useCallback, useEffect, useState } from 'react';
import { TreeNode } from './tree-node';
import { EmailList } from './email-list';
import { UnreadSection } from './unread-section';
import type { EmailWithCategory, TreeNode as TreeNodeType, GroupingConfig } from '@/types';
import { AlertCircle, Loader2 } from 'lucide-react';

interface EmailTreeProps {
  config: GroupingConfig;
  /** Increment to trigger a full re-fetch (e.g. after sync completes) */
  refreshKey?: number;
}

export function EmailTree({ config, refreshKey }: EmailTreeProps) {
  const [rootNodes, setRootNodes] = useState<TreeNodeType[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<EmailWithCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [unreadRefreshKey, setUnreadRefreshKey] = useState(0);
  const [fetchError, setFetchError] = useState(false);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-500">Loading your inbox...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-full gap-0 lg:gap-4">
      {/* Tree navigator */}
      <div
        className={`${
          selectedPath ? 'hidden lg:block' : ''
        } lg:w-80 lg:flex-shrink-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-slate-200`}
      >
        {/* Unread section pinned at top */}
        <UnreadSection onEmailRead={handleEmailsChanged} refreshKey={(refreshKey ?? 0) + unreadRefreshKey} />

        {fetchError ? (
          <div className="text-center py-12 text-slate-500">
            <AlertCircle className="h-6 w-6 text-red-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-red-600">Failed to load emails</p>
            <button
              onClick={fetchNodes}
              className="text-sm text-blue-600 mt-2 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : rootNodes.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
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
      </div>

      {/* Email list */}
      <div className={`${!selectedPath ? 'hidden lg:block' : ''} flex-1 overflow-y-auto`}>
        {selectedPath ? (
          <>
            <button
              onClick={() => setSelectedPath(null)}
              className="lg:hidden p-3 text-sm text-blue-600 font-medium"
            >
              &larr; Back to tree
            </button>
            <EmailList emails={selectedEmails} onEmailUpdated={handleEmailsChanged} />
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            Select a group to view emails
          </div>
        )}
      </div>
    </div>
  );
}
