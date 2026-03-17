'use client';

import { ChevronDown, Inbox, Star, Archive, Trash2, Clock, Folder } from 'lucide-react';
import type { SystemGroupKey } from '@/types';

interface MobileScopeBarProps {
  selectedCategory: string | null;
  selectedSystemGroup: SystemGroupKey | null;
  unreadCount: number;
  selectedAccountId: string | null;
  accountColor?: string;
  onOpenSheet: () => void;
}

const SYSTEM_GROUP_META: Record<SystemGroupKey, { label: string; icon: typeof Star }> = {
  starred: { label: 'Starred', icon: Star },
  snoozed: { label: 'Snoozed', icon: Clock },
  archived: { label: 'Archived', icon: Archive },
  trash: { label: 'Trash', icon: Trash2 },
};

export function MobileScopeBar({
  selectedCategory,
  selectedSystemGroup,
  unreadCount,
  selectedAccountId,
  accountColor,
  onOpenSheet,
}: MobileScopeBarProps) {
  // Determine what to display as the current scope
  let scopeLabel: string;
  let ScopeIcon = Inbox;

  if (selectedSystemGroup) {
    const meta = SYSTEM_GROUP_META[selectedSystemGroup];
    scopeLabel = meta.label;
    ScopeIcon = meta.icon;
  } else if (selectedCategory) {
    scopeLabel = selectedCategory;
    ScopeIcon = Folder;
  } else {
    scopeLabel = 'All Mail';
  }

  return (
    <button
      onClick={onOpenSheet}
      className="w-full px-3 py-2.5 border-b border-border flex items-center justify-between bg-background active:bg-accent/50 transition-colors"
      aria-label={`Current scope: ${scopeLabel}. Tap to change.`}
      aria-haspopup="dialog"
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Account color dot */}
        {selectedAccountId && accountColor && (
          <span
            className="inline-block rounded-full flex-shrink-0"
            style={{ width: 8, height: 8, backgroundColor: accountColor }}
            aria-hidden="true"
          />
        )}
        <ScopeIcon
          className={`h-4 w-4 flex-shrink-0 text-muted-foreground ${
            selectedSystemGroup === 'starred' ? 'fill-primary text-primary' : ''
          }`}
        />
        <span className="text-sm font-medium text-foreground truncate">
          {scopeLabel}
        </span>
        {unreadCount > 0 && (
          <span className="text-xs font-medium text-primary bg-primary/10 rounded-full px-1.5 py-0.5 tabular-nums flex-shrink-0">
            {unreadCount}
          </span>
        )}
      </div>
      <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
    </button>
  );
}
