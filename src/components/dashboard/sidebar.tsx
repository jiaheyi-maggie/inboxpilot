'use client';

import { useCallback, useEffect, useState } from 'react';
import { Folder, Loader2, AlertCircle } from 'lucide-react';
import { UnreadSection } from './unread-section';
import { SystemGroups } from './system-groups';
import { Skeleton } from '@/components/ui/skeleton';
import { useView } from '@/contexts/view-context';
import type { Email, EmailWithCategory, TreeNode } from '@/types';

function TreeSkeleton() {
  return (
    <div className="p-3 space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-3 w-6" />
        </div>
      ))}
    </div>
  );
}

interface SidebarProps {
  /** Root category nodes fetched from API */
  rootNodes: TreeNode[];
  loading: boolean;
  fetchError: boolean;
  onRetry: () => void;
}

export function Sidebar({ rootNodes, loading, fetchError, onRetry }: SidebarProps) {
  const {
    selectedCategory,
    setSelectedCategory,
    selectedSystemGroup,
    setSelectedSystemGroup,
    setSelectedEmailId,
    refreshKey,
    triggerRefresh,
  } = useView();

  // Unread section: selecting an unread email shows it in the main panel
  const handleUnreadEmailSelected = useCallback(
    (email: Email) => {
      const emailWithCat: EmailWithCategory = {
        ...email,
        category: null,
        topic: null,
        priority: null,
        importance_score: null,
        importance_label: null,
        confidence: null,
      };
      // Store the full email object so ActiveViewRouter can display it
      setSelectedEmailId(email.id);
      // Store unread email data for the detail view via a custom event
      window.dispatchEvent(
        new CustomEvent('inboxpilot:unread-email-selected', { detail: emailWithCat })
      );
    },
    [setSelectedEmailId]
  );

  const handleEmailsChanged = useCallback(() => {
    triggerRefresh();
  }, [triggerRefresh]);

  const handleSelectSystemGroup = useCallback(
    (group: typeof selectedSystemGroup extends infer T ? NonNullable<T> : never) => {
      if (selectedSystemGroup === group) {
        setSelectedSystemGroup(null);
        return;
      }
      setSelectedSystemGroup(group);
    },
    [selectedSystemGroup, setSelectedSystemGroup]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Unread section pinned at top */}
      <UnreadSection
        onEmailRead={handleEmailsChanged}
        onSelectEmail={handleUnreadEmailSelected}
        refreshKey={refreshKey}
      />

      {/* System groups: Starred / Archived / Trash */}
      <SystemGroups
        selectedGroup={selectedSystemGroup}
        onSelectGroup={handleSelectSystemGroup}
        refreshKey={refreshKey}
      />

      {/* Category navigation */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <TreeSkeleton />
        ) : fetchError ? (
          <div className="text-center py-12 text-muted-foreground">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto mb-2" />
            <p className="text-sm font-medium text-destructive">Failed to load emails</p>
            <button
              onClick={onRetry}
              className="text-sm text-primary mt-2 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : rootNodes.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg font-medium">No emails yet</p>
            <p className="text-sm mt-1">Tap the sync button to fetch your emails</p>
          </div>
        ) : (
          <div className="p-3 space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 pb-1">
              Categories
            </p>
            {rootNodes.map((node) => (
              <button
                key={node.group_key}
                onClick={() => setSelectedCategory(
                  selectedCategory === node.group_key ? null : node.group_key
                )}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors
                  ${selectedCategory === node.group_key
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-accent'
                  }
                `}
              >
                <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="truncate flex-1 text-left">{node.group_key}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{node.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
