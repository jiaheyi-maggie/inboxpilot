'use client';

import { useCallback, useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Mail } from 'lucide-react';
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
      // Fetch emails
      setLoading(true);
      try {
        const params = new URLSearchParams({
          level: String(totalLevels),
          configId,
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
  }, [expanded, isLeaf, level, totalLevels, configId, currentPath, pathKey, onSelectEmails]);

  const displayLabel = formatLabel(label, dimension);

  return (
    <div>
      <button
        onClick={toggle}
        className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm transition-colors
          ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50'}
          ${loading ? 'opacity-70' : ''}
        `}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {isLeaf ? (
          <Mail className="h-4 w-4 flex-shrink-0 text-slate-400" />
        ) : expanded ? (
          <>
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" />
            <FolderOpen className="h-4 w-4 flex-shrink-0 text-amber-500" />
          </>
        ) : (
          <>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
            <Folder className="h-4 w-4 flex-shrink-0 text-amber-500" />
          </>
        )}
        <span className="flex-1 truncate font-medium">{displayLabel}</span>
        <span className="text-xs text-slate-400 tabular-nums">{count}</span>
      </button>

      {expanded && children.length > 0 && (
        <div>
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
            />
          ))}
        </div>
      )}
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
      try {
        const [year, month] = label.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1);
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
        });
      } catch {
        return label;
      }
    }
    default:
      return label;
  }
}
