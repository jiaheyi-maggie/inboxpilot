'use client';

import { Inbox, Mail, AlertTriangle } from 'lucide-react';
import { PromptRuleCreator } from '@/components/workflows/prompt-rule-creator';
import type { TreeNode as TreeNodeType } from '@/types';

interface InboxOverviewProps {
  rootNodes: TreeNodeType[];
  dimensionLabel: string;
  onSelectGroup: (groupKey: string) => void;
}

export function InboxOverview({ rootNodes, dimensionLabel, onSelectGroup }: InboxOverviewProps) {
  const totalEmails = rootNodes.reduce((sum, n) => sum + n.count, 0);

  if (rootNodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-6">
        <Inbox className="h-10 w-10 mb-3 text-muted-foreground/40" />
        <p className="text-sm font-medium">No emails yet</p>
        <p className="text-xs mt-1">Sync your inbox to get started</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <h2 className="text-lg font-semibold text-foreground">Inbox Overview</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          By {dimensionLabel}
        </p>
      </div>

      {/* Stats row */}
      <div className="px-6 pb-4 flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-bold text-foreground tabular-nums">{totalEmails}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-bold text-foreground tabular-nums">{rootNodes.length}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Groups</p>
          </div>
        </div>
      </div>

      {/* Quick rule creator */}
      <div className="px-6 pb-4">
        <PromptRuleCreator compact />
      </div>

      {/* Category cards grid */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
          {rootNodes
            .sort((a, b) => b.count - a.count)
            .map((node) => (
              <button
                key={node.group_key}
                onClick={() => onSelectGroup(node.group_key)}
                className="group p-4 rounded-xl bg-card border border-border hover:border-primary/30 hover:shadow-md transition-all duration-200 text-left"
              >
                <p className="text-xl font-bold text-foreground tabular-nums">
                  {node.count}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5 truncate">
                  {formatGroupLabel(node.group_key)}
                </p>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

function formatGroupLabel(key: string): string {
  if (!key || key === 'null' || key === 'undefined') return 'Unknown';
  return key;
}
