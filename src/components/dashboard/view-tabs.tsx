'use client';

import { List, Columns3, FolderTree, Crosshair } from 'lucide-react';
import { useViewState } from '@/contexts/view-context';
import type { ViewType } from '@/types';

const VIEW_TAB_CONFIG: { type: ViewType; label: string; icon: typeof List; disabled?: boolean; tooltip?: string }[] = [
  { type: 'focus', label: 'Focus', icon: Crosshair },
  { type: 'list', label: 'List', icon: List },
  { type: 'board', label: 'Board', icon: Columns3 },
  { type: 'tree', label: 'Tree', icon: FolderTree },
];

export function ViewTabs() {
  const { viewType, setViewType } = useViewState();

  return (
    <div className="flex items-center gap-1">
      {VIEW_TAB_CONFIG.map(({ type, label, icon: Icon, disabled, tooltip }) => (
        <button
          key={type}
          onClick={() => !disabled && setViewType(type)}
          disabled={disabled}
          title={tooltip}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
            ${viewType === type
              ? 'bg-primary/10 text-primary'
              : disabled
                ? 'text-muted-foreground/40 cursor-not-allowed'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }
          `}
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
