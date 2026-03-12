'use client';

import { useCallback, useEffect, useState } from 'react';
import { Star, Archive, Trash2 } from 'lucide-react';
import type { SystemGroupKey } from '@/types';

interface SystemGroupCounts {
  starred: number;
  archived: number;
  trash: number;
}

interface SystemGroupsProps {
  selectedGroup: SystemGroupKey | null;
  onSelectGroup: (group: SystemGroupKey) => void;
  refreshKey?: number;
}

const GROUP_CONFIG: { key: SystemGroupKey; label: string; icon: typeof Star }[] = [
  { key: 'starred', label: 'Starred', icon: Star },
  { key: 'archived', label: 'Archived', icon: Archive },
  { key: 'trash', label: 'Trash', icon: Trash2 },
];

export function SystemGroups({ selectedGroup, onSelectGroup, refreshKey }: SystemGroupsProps) {
  const [counts, setCounts] = useState<SystemGroupCounts>({ starred: 0, archived: 0, trash: 0 });

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/emails/system-groups');
      if (!res.ok) return;
      const data = await res.json();
      setCounts(data.groups);
    } catch {
      // Silent fail — counts are non-critical
    }
  }, []);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts, refreshKey]);

  // Don't render if all counts are 0
  const totalCount = counts.starred + counts.archived + counts.trash;
  if (totalCount === 0) return null;

  return (
    <div className="px-3 pt-2 pb-1">
      <div className="flex items-center gap-1">
        {GROUP_CONFIG.map(({ key, label, icon: Icon }) => {
          const count = counts[key];
          if (count === 0) return null;
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
