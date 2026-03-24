'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitBranch, Sparkles } from 'lucide-react';
import type { ConditionNodeData } from '@/types';

function ConditionNodeInner({ data, selected }: NodeProps) {
  const condData = data as unknown as ConditionNodeData;
  const isSmart = condData.mode === 'smart';

  const operatorLabel: Record<string, string> = {
    equals: '=',
    not_equals: '≠',
    contains: 'contains',
    not_contains: 'not contains',
    starts_with: 'starts with',
    ends_with: 'ends with',
    is_true: 'is true',
    is_false: 'is false',
  };

  const summary = isSmart
    ? (condData.prompt?.slice(0, 50) || 'Describe a condition…')
    : condData.field
      ? `${condData.field} ${operatorLabel[condData.operator] ?? condData.operator}${
          condData.operator !== 'is_true' && condData.operator !== 'is_false'
            ? ` "${condData.value ?? ''}"`
            : ''
        }`
      : 'Configure condition...';

  const Icon = isSmart ? Sparkles : GitBranch;
  const colorClass = isSmart
    ? selected
      ? 'border-violet-500 ring-2 ring-violet-500/20'
      : 'border-violet-300 dark:border-violet-700'
    : selected
      ? 'border-blue-500 ring-2 ring-blue-500/20'
      : 'border-blue-300 dark:border-blue-700';

  const accentBg = isSmart ? 'bg-violet-100 dark:bg-violet-900/50' : 'bg-blue-100 dark:bg-blue-900/50';
  const accentText = isSmart ? 'text-violet-600 dark:text-violet-400' : 'text-blue-600 dark:text-blue-400';
  const handleBg = isSmart ? '!bg-violet-500' : '!bg-blue-500';

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 bg-card shadow-sm min-w-[200px] transition-colors ${colorClass}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={`!w-3 !h-3 ${handleBg} !border-2 !border-background`}
      />

      <div className="flex items-center gap-2">
        <div className={`h-6 w-6 rounded ${accentBg} flex items-center justify-center`}>
          <Icon className={`h-3.5 w-3.5 ${accentText}`} />
        </div>
        <div className="min-w-0">
          <div className={`text-xs font-semibold ${accentText} uppercase tracking-wide`}>
            {isSmart ? 'Smart Condition' : 'Condition'}
          </div>
          <div className="text-sm font-medium truncate max-w-[180px]">{summary}</div>
        </div>
      </div>

      {/* Yes output (left) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background !left-[30%]"
      />
      {/* No output (right) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className="!w-3 !h-3 !bg-red-500 !border-2 !border-background !left-[70%]"
      />

      {/* Labels under handles */}
      <div className="flex justify-between mt-1 px-1">
        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Yes</span>
        <span className="text-[10px] font-medium text-red-600 dark:text-red-400">No</span>
      </div>
    </div>
  );
}

export const ConditionNode = memo(ConditionNodeInner);
