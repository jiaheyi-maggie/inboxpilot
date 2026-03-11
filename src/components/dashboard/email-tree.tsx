'use client';

import { useCallback, useEffect, useState } from 'react';
import { TreeNode } from './tree-node';
import { EmailList } from './email-list';
import type { EmailWithCategory, TreeNode as TreeNodeType, GroupingConfig } from '@/types';
import { Loader2 } from 'lucide-react';

interface EmailTreeProps {
  config: GroupingConfig;
}

export function EmailTree({ config }: EmailTreeProps) {
  const [rootNodes, setRootNodes] = useState<TreeNodeType[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<EmailWithCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const fetchNodes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        level: '0',
        configId: config.id,
      });
      const res = await fetch(`/api/emails?${params}`);
      const data = await res.json();
      if (data.type === 'groups') {
        setRootNodes(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch tree nodes:', err);
    } finally {
      setLoading(false);
    }
  }, [config.id]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  const handleSelectEmails = useCallback(
    (emails: EmailWithCategory[], path: string) => {
      setSelectedEmails(emails);
      setSelectedPath(path);
    },
    []
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-500">Loading your inbox...</span>
      </div>
    );
  }

  if (rootNodes.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p className="text-lg font-medium">No emails yet</p>
        <p className="text-sm mt-1">
          Tap the sync button to fetch your emails
        </p>
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
            />
          ))}
        </div>
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
            <EmailList emails={selectedEmails} />
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
