'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap } from 'lucide-react';
import type { TriggerNodeData, WorkflowTriggerType } from '@/types';

const TRIGGER_LABELS: Record<WorkflowTriggerType, string> = {
  new_email: 'New email arrives',
  email_categorized: 'Email categorized',
  email_from_domain: 'Email from domain',
  unread_timeout: 'Unread timeout',
};

function TriggerNodeInner({ data, selected }: NodeProps) {
  const triggerData = data as unknown as TriggerNodeData;
  const label = TRIGGER_LABELS[triggerData.triggerType] ?? 'Unknown trigger';

  let subtitle = '';
  if (triggerData.triggerType === 'email_from_domain' && triggerData.config?.domain) {
    subtitle = triggerData.config.domain;
  } else if (triggerData.triggerType === 'email_categorized' && triggerData.config?.category) {
    subtitle = `as ${triggerData.config.category}`;
  } else if (triggerData.triggerType === 'unread_timeout' && triggerData.config?.timeoutMinutes) {
    subtitle = `after ${triggerData.config.timeoutMinutes} min`;
  }

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 bg-card shadow-sm min-w-[180px] transition-colors ${
        selected ? 'border-purple-500 ring-2 ring-purple-500/20' : 'border-purple-300 dark:border-purple-700'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded bg-purple-100 flex items-center justify-center dark:bg-purple-900/50">
          <Zap className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">
            Trigger
          </div>
          <div className="text-sm font-medium truncate">{label}</div>
          {subtitle && (
            <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
          )}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background"
      />
    </div>
  );
}

export const TriggerNode = memo(TriggerNodeInner);
