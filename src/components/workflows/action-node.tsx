'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Trash2,
  Archive,
  Star,
  StarOff,
  MailOpen,
  MailX,
  ArrowRight,
  Play,
} from 'lucide-react';
import type { ActionNodeData, WorkflowActionType } from '@/types';

const ACTION_CONFIG: Record<
  WorkflowActionType,
  { label: string; icon: typeof Play; color: string }
> = {
  trash: { label: 'Trash email', icon: Trash2, color: 'red' },
  archive: { label: 'Archive email', icon: Archive, color: 'emerald' },
  star: { label: 'Star email', icon: Star, color: 'amber' },
  unstar: { label: 'Unstar email', icon: StarOff, color: 'gray' },
  mark_read: { label: 'Mark as read', icon: MailOpen, color: 'emerald' },
  mark_unread: { label: 'Mark as unread', icon: MailX, color: 'amber' },
  reassign_category: { label: 'Reassign category', icon: ArrowRight, color: 'purple' },
};

function ActionNodeInner({ data, selected }: NodeProps) {
  const actionData = data as unknown as ActionNodeData;
  const config = ACTION_CONFIG[actionData.actionType] ?? {
    label: 'Unknown action',
    icon: Play,
    color: 'gray',
  };
  const Icon = config.icon;

  let subtitle = '';
  if (actionData.actionType === 'reassign_category' && actionData.config?.category) {
    subtitle = `→ ${actionData.config.category}`;
  }

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 bg-card shadow-sm min-w-[170px] transition-colors ${
        selected
          ? 'border-emerald-500 ring-2 ring-emerald-500/20'
          : 'border-emerald-300 dark:border-emerald-700'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background"
      />

      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded bg-emerald-100 flex items-center justify-center dark:bg-emerald-900/50">
          <Icon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
            Action
          </div>
          <div className="text-sm font-medium truncate">{config.label}</div>
          {subtitle && (
            <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export const ActionNode = memo(ActionNodeInner);
