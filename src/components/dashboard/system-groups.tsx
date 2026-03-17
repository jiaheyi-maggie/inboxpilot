'use client';

import { useCallback, useEffect, useState } from 'react';
import { Star, Archive, Trash2, Clock } from 'lucide-react';
import type { SystemGroupKey } from '@/types';

interface SystemGroupCounts {
  starred: number;
  archived: number;
  trash: number;
  snoozed: number;
}

interface SystemGroupsProps {
  selectedGroup: SystemGroupKey | null;
  onSelectGroup: (group: SystemGroupKey) => void;
  refreshKey?: number;
  /** When set, only show counts for this account */
  selectedAccountId?: string | null;
}

const GROUP_CONFIG: { key: SystemGroupKey; label: string; icon: typeof Star }[] = [
  { key: 'starred', label: 'Starred', icon: Star },
  { key: 'snoozed', label: 'Snoozed', icon: Clock },
  { key: 'archived', label: 'Archived', icon: Archive },
  { key: 'trash', label: 'Trash', icon: Trash2 },
];

export function SystemGroups({ selectedGroup, onSelectGroup, refreshKey, selectedAccountId }: SystemGroupsProps) {
  const [counts, setCounts] = useState<SystemGroupCounts>({ starred: 0, archived: 0, trash: 0, snoozed: 0 });

  const fetchCounts = useCallback(async () => {
    setCounts({ starred: 0, archived: 0, trash: 0, snoozed: 0 }); // reset stale counts
    try {
      const url = new URL('/api/emails/system-groups', window.location.origin);
      if (selectedAccountId) {
        url.searchParams.set('accountId', selectedAccountId);
      }
      const res = await fetch(url.toString());
      if (!res.ok) return;
      const data = await res.json();
      setCounts(data.groups);
    } catch {
      // Silent fail — counts are non-critical
    }
  }, [selectedAccountId]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts, refreshKey]);

  return (
    <div className="px-3 pt-2 pb-1">
      <div className="flex items-center gap-1">
        {GROUP_CONFIG.map(({ key, label, icon: Icon }) => {
          const count = counts[key];
          const isSelected = selectedGroup === key;

          return (
            <button
              key={key}
              onClick={() => onSelectGroup(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors
                ${isSelected
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground border border-transparent'
                }
              `}
            >
              <Icon className={`h-3.5 w-3.5 ${key === 'starred' && isSelected ? 'fill-primary' : ''}`} />
              <span>{label}</span>
              <span className={`tabular-nums ${isSelected ? 'text-primary/70' : 'text-muted-foreground/60'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
