'use client';

import { type DragEvent } from 'react';
import {
  Zap,
  GitBranch,
  Trash2,
  Archive,
  Star,
  StarOff,
  MailOpen,
  MailX,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import type { WorkflowNodeType, TriggerNodeData, ConditionNodeData, ActionNodeData } from '@/types';

interface PaletteItem {
  nodeType: WorkflowNodeType;
  label: string;
  icon: typeof Zap;
  defaultData: TriggerNodeData | ConditionNodeData | ActionNodeData;
  color: string;
}

const PALETTE_ITEMS: { section: string; items: PaletteItem[] }[] = [
  {
    section: 'Triggers',
    items: [
      {
        nodeType: 'trigger',
        label: 'New Email',
        icon: Zap,
        defaultData: { triggerType: 'new_email', config: {} } as TriggerNodeData,
        color: 'purple',
      },
      {
        nodeType: 'trigger',
        label: 'Categorized',
        icon: Zap,
        defaultData: { triggerType: 'email_categorized', config: {} } as TriggerNodeData,
        color: 'purple',
      },
      {
        nodeType: 'trigger',
        label: 'From Domain',
        icon: Zap,
        defaultData: { triggerType: 'email_from_domain', config: { domain: '' } } as TriggerNodeData,
        color: 'purple',
      },
    ],
  },
  {
    section: 'Conditions',
    items: [
      {
        nodeType: 'condition',
        label: 'If / Else',
        icon: GitBranch,
        defaultData: { field: 'category', operator: 'equals', value: '' } as ConditionNodeData,
        color: 'blue',
      },
    ],
  },
  {
    section: 'Actions',
    items: [
      {
        nodeType: 'action',
        label: 'Archive',
        icon: Archive,
        defaultData: { actionType: 'archive', config: {} } as ActionNodeData,
        color: 'emerald',
      },
      {
        nodeType: 'action',
        label: 'Trash',
        icon: Trash2,
        defaultData: { actionType: 'trash', config: {} } as ActionNodeData,
        color: 'emerald',
      },
      {
        nodeType: 'action',
        label: 'Star',
        icon: Star,
        defaultData: { actionType: 'star', config: {} } as ActionNodeData,
        color: 'emerald',
      },
      {
        nodeType: 'action',
        label: 'Unstar',
        icon: StarOff,
        defaultData: { actionType: 'unstar', config: {} } as ActionNodeData,
        color: 'emerald',
      },
      {
        nodeType: 'action',
        label: 'Mark Read',
        icon: MailOpen,
        defaultData: { actionType: 'mark_read', config: {} } as ActionNodeData,
        color: 'emerald',
      },
      {
        nodeType: 'action',
        label: 'Mark Unread',
        icon: MailX,
        defaultData: { actionType: 'mark_unread', config: {} } as ActionNodeData,
        color: 'emerald',
      },
      {
        nodeType: 'action',
        label: 'Reassign Category',
        icon: ArrowRight,
        defaultData: { actionType: 'reassign_category', config: { category: '' } } as ActionNodeData,
        color: 'emerald',
      },
      {
        nodeType: 'action',
        label: 'AI Recategorize',
        icon: Sparkles,
        defaultData: { actionType: 'recategorize', config: { sourceCategory: '', refinementPrompt: '' } } as ActionNodeData,
        color: 'emerald',
      },
    ],
  },
];

function onDragStart(e: DragEvent, item: PaletteItem) {
  e.dataTransfer.setData(
    'application/reactflow',
    JSON.stringify({
      nodeType: item.nodeType,
      data: item.defaultData,
    })
  );
  e.dataTransfer.effectAllowed = 'move';
}

export function NodePalette() {
  return (
    <div className="w-52 border-r border-border bg-card overflow-y-auto p-3 flex-shrink-0">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        Nodes
      </h3>

      {PALETTE_ITEMS.map((section) => (
        <div key={section.section} className="mb-4">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            {section.section}
          </h4>
          <div className="space-y-1">
            {section.items.map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={`${item.nodeType}-${i}`}
                  draggable
                  onDragStart={(e) => onDragStart(e, item)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing hover:bg-accent text-sm transition-colors"
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
