'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import type { ConditionNodeData } from '@/types';

function ConditionNodeInner({ data, selected }: NodeProps) {
  const condData = data as unknown as ConditionNodeData;

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

  const summary = condData.field
    ? `${condData.field} ${operatorLabel[condData.operator] ?? condData.operator}${
        condData.operator !== 'is_true' && condData.operator !== 'is_false'
          ? ` "${condData.value ?? ''}"`
          : ''
      }`
    : 'Configure condition...';

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 bg-card shadow-sm min-w-[200px] transition-colors ${
        selected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-blue-300 dark:border-blue-700'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background"
      />

      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded bg-blue-100 flex items-center justify-center dark:bg-blue-900/50">
          <GitBranch className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
            Condition
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
