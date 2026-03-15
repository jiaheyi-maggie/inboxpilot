'use client';

import { useCallback, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Mail, Loader2 } from 'lucide-react';
import { TreeNodeActions } from './tree-node-actions';
import type { EmailWithCategory, TreeNode as TreeNodeType, GroupingLevel, DimensionKey } from '@/types';

interface TreeNodeProps {
  label: string;
  count: number;
  dimension: DimensionKey;
  level: number;
  path: { dimension: DimensionKey; value: string }[];
  configId: string;
  totalLevels: number;
  levels: GroupingLevel[];
  onSelectEmails: (emails: EmailWithCategory[], path: string) => void;
  selectedPath: string | null;
  onTreeChanged?: () => void;
}

export function TreeNode({
  label,
  count,
  dimension,
  level,
  path,
  configId,
  totalLevels,
  levels,
  onSelectEmails,
  selectedPath,
  onTreeChanged,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeNodeType[]>([]);
  const [loading, setLoading] = useState(false);

  const currentPath = [...path, { dimension, value: label }];
  const pathKey = currentPath.map((p) => `${p.dimension}:${p.value}`).join('/');
  const isLeaf = level + 1 >= totalLevels;
  const isSelected = selectedPath === pathKey;

  const toggle = useCallback(async () => {
    if (isLeaf) {
      // Fetch emails — force leaf mode in case effective levels differ from config
      setLoading(true);
      try {
        const params = new URLSearchParams({
          level: String(totalLevels),
          configId,
          leaf: 'true',
        });
        currentPath.forEach((p) => {
          params.append(`filter.${p.dimension}`, p.value);
        });

        const res = await fetch(`/api/emails?${params}`);
        const data = await res.json();
        if (data.type === 'emails') {
          onSelectEmails(data.data, pathKey);
        }
      } catch (err) {
        console.error('Failed to fetch emails:', err);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (expanded) {
      setExpanded(false);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        level: String(level + 1),
        configId,
      });
      // Pass the effective dimension for this level (supports per-category view mode overrides)
      const nextLevel = levels[level + 1];
      if (nextLevel) {
        params.set('dimension', nextLevel.dimension);
      }
      currentPath.forEach((p) => {
        params.append(`filter.${p.dimension}`, p.value);
      });

      const res = await fetch(`/api/emails?${params}`);
      const data = await res.json();
      if (data.type === 'groups') {
        setChildren(data.data);
        setExpanded(true);
      }
    } catch (err) {
      console.error('Failed to fetch children:', err);
    } finally {
      setLoading(false);
    }
  }, [expanded, isLeaf, level, totalLevels, configId, currentPath, pathKey, onSelectEmails, levels]);

  const displayLabel = formatLabel(label, dimension);

  return (
    <div>
      <div
        className={`group relative w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm transition-all duration-150 min-w-0
          ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-accent'}
          ${!isLeaf && expanded ? 'bg-accent/30' : ''}
          ${loading ? 'opacity-70' : ''}
        `}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        <button
          onClick={toggle}
          className="flex-1 flex items-center gap-2 min-w-0 text-left"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 flex-shrink-0 text-muted-foreground animate-spin" />
          ) : isLeaf ? (
            <Mail className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          ) : expanded ? (
            <>
              <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200" />
              <FolderOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            </>
          ) : (
            <>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200" />
              <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            </>
          )}
          <span className="flex-1 truncate font-medium">{displayLabel}</span>
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs tabular-nums flex-shrink-0">{count}</span>
        </button>
        <span className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <TreeNodeActions
            path={currentPath}
            configId={configId}
            nodeLabel={displayLabel}
            onActionComplete={onTreeChanged}
          />
        </span>
      </div>

      {/* Animated children container */}
      <div
        className={`grid transition-all duration-200 ease-in-out ${
          expanded && children.length > 0 ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          {children.map((child) => (
            <TreeNode
              key={child.group_key}
              label={child.group_key}
              count={child.count}
              dimension={levels[level + 1].dimension}
              level={level + 1}
              path={currentPath}
              configId={configId}
              totalLevels={totalLevels}
              levels={levels}
              onSelectEmails={onSelectEmails}
              selectedPath={selectedPath}
              onTreeChanged={onTreeChanged}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function formatLabel(label: string, dimension: DimensionKey): string {
  if (!label || label === 'null' || label === 'undefined') return 'Unknown';

  switch (dimension) {
    case 'has_attachment':
      return label === 'true' ? 'With Attachments' : 'No Attachments';
    case 'is_read':
      return label === 'true' ? 'Read' : 'Unread';
    case 'date_month': {
      const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
      const parts = label.split('-');
      const monthIdx = parseInt(parts[1], 10) - 1;
      if (monthIdx >= 0 && monthIdx < 12) {
        return `${MONTH_NAMES[monthIdx]} ${parts[0]}`;
      }
      return label;
    }
    default:
      return label;
  }
}
