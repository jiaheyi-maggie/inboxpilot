'use client';

import { useCallback, useState } from 'react';
import { TreeNode } from './tree-node';
import { EmailList } from './email-list';
import { Loader2 } from 'lucide-react';
import type { EmailWithCategory, TreeNode as TreeNodeType, GroupingLevel } from '@/types';

interface TreeViewProps {
  nodes: TreeNodeType[];
  configId: string;
  groupBy: GroupingLevel[];
  onSelectEmails: (emails: EmailWithCategory[]) => void;
  onEmailMoved: () => void;
  selectedCategory?: string | null;
}

export function TreeView({
  nodes,
  configId,
  groupBy,
  onSelectEmails,
  onEmailMoved,
  selectedCategory,
}: TreeViewProps) {
  const [selectedEmails, setSelectedEmails] = useState<EmailWithCategory[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [emailsLoading, setEmailsLoading] = useState(false);

  const levels = groupBy.length > 0
    ? groupBy
    : [{ dimension: 'category' as const, label: 'Category' }];

  const handleSelectEmails = useCallback(
    (emails: EmailWithCategory[], path: string) => {
      setSelectedEmails(emails);
      setSelectedPath(path);
      onSelectEmails(emails);
    },
    [onSelectEmails]
  );

  const filteredNodes = selectedCategory
    ? nodes.filter((n) => n.group_key === selectedCategory)
    : nodes;

  return (
    <div className="flex flex-col h-full">
      {selectedPath ? (
        <div className="flex-1 overflow-auto">
          <button
            onClick={() => {
              setSelectedPath(null);
              setSelectedEmails([]);
            }}
            className="p-3 text-sm text-primary font-medium"
          >
            &larr; Back to tree
          </button>
          {emailsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading emails...</span>
            </div>
          ) : (
            <EmailList emails={selectedEmails} onEmailMoved={onEmailMoved} />
          )}
        </div>
      ) : (
        <div className="p-3 space-y-0.5 overflow-auto">
          {filteredNodes.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm">No groups found</p>
            </div>
          )}
          {filteredNodes.map((node) => (
            <TreeNode
              key={node.group_key}
              label={node.group_key}
              count={node.count}
              dimension={levels[0]?.dimension ?? 'category'}
              level={0}
              path={[]}
              configId={configId}
              totalLevels={levels.length}
              levels={levels}
              onSelectEmails={handleSelectEmails}
              selectedPath={selectedPath}
              onTreeChanged={onEmailMoved}
            />
          ))}
        </div>
      )}
    </div>
  );
}
