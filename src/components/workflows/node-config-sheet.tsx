'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { CATEGORIES } from '@/types';
import type {
  WorkflowNode,
  TriggerNodeData,
  ConditionNodeData,
  ActionNodeData,
  WorkflowTriggerType,
  WorkflowActionType,
  WorkflowConditionField,
  WorkflowConditionOperator,
} from '@/types';

/** Hook to fetch user categories from API, with hardcoded fallback. */
function useCategories() {
  const [categories, setCategories] = useState<string[]>([...CATEGORIES]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/categories');
        if (res.ok) {
          const { categories: cats } = await res.json();
          if (!cancelled && cats && cats.length > 0) {
            setCategories(cats.map((c: { name: string }) => c.name));
          }
        }
      } catch {
        // keep defaults
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return categories;
}

interface NodeConfigSheetProps {
  node: WorkflowNode | null;
  onClose: () => void;
  onUpdate: (nodeId: string, data: TriggerNodeData | ConditionNodeData | ActionNodeData) => void;
}

export function NodeConfigSheet({ node, onClose, onUpdate }: NodeConfigSheetProps) {
  const categories = useCategories();

  if (!node) return null;

  return (
    <Sheet open={!!node} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-80 sm:w-96">
        <SheetHeader>
          <SheetTitle className="capitalize">{node.type} Configuration</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {node.type === 'trigger' && (
            <TriggerConfig
              data={node.data as TriggerNodeData}
              onChange={(data) => onUpdate(node.id, data)}
              categories={categories}
            />
          )}
          {node.type === 'condition' && (
            <ConditionConfig
              data={node.data as ConditionNodeData}
              onChange={(data) => onUpdate(node.id, data)}
              categories={categories}
            />
          )}
          {node.type === 'action' && (
            <ActionConfig
              data={node.data as ActionNodeData}
              onChange={(data) => onUpdate(node.id, data)}
              categories={categories}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// --- Trigger Config ---

const TRIGGER_OPTIONS: { value: WorkflowTriggerType; label: string }[] = [
  { value: 'new_email', label: 'New email arrives' },
  { value: 'email_categorized', label: 'Email is categorized' },
  { value: 'email_from_domain', label: 'Email from specific domain' },
  { value: 'unread_timeout', label: 'Unread for N minutes' },
];

function TriggerConfig({
  data,
  onChange,
  categories,
}: {
  data: TriggerNodeData;
  onChange: (data: TriggerNodeData) => void;
  categories: string[];
}) {
  return (
    <>
      <FieldLabel label="Trigger Type">
        <select
          value={data.triggerType}
          onChange={(e) =>
            onChange({ ...data, triggerType: e.target.value as WorkflowTriggerType })
          }
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {TRIGGER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldLabel>

      {data.triggerType === 'email_from_domain' && (
        <FieldLabel label="Domain">
          <input
            type="text"
            value={data.config?.domain ?? ''}
            onChange={(e) =>
              onChange({ ...data, config: { ...data.config, domain: e.target.value } })
            }
            placeholder="e.g. github.com"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </FieldLabel>
      )}

      {data.triggerType === 'email_categorized' && (
        <FieldLabel label="Category (optional)">
          <select
            value={data.config?.category ?? ''}
            onChange={(e) =>
              onChange({ ...data, config: { ...data.config, category: e.target.value || undefined } })
            }
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Any category</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </FieldLabel>
      )}

      {data.triggerType === 'unread_timeout' && (
        <FieldLabel label="Minutes">
          <input
            type="number"
            min={1}
            value={data.config?.timeoutMinutes ?? 60}
            onChange={(e) =>
              onChange({
                ...data,
                config: { ...data.config, timeoutMinutes: parseInt(e.target.value) || 60 },
              })
            }
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </FieldLabel>
      )}
    </>
  );
}

// --- Condition Config ---

const CONDITION_FIELDS: { value: WorkflowConditionField; label: string }[] = [
  { value: 'category', label: 'Category' },
  { value: 'topic', label: 'Topic' },
  { value: 'priority', label: 'Priority' },
  { value: 'sender_email', label: 'Sender Email' },
  { value: 'sender_domain', label: 'Sender Domain' },
  { value: 'subject', label: 'Subject' },
  { value: 'has_attachment', label: 'Has Attachment' },
  { value: 'is_read', label: 'Is Read' },
  { value: 'is_starred', label: 'Is Starred' },
  { value: 'label', label: 'Label' },
];

const CONDITION_OPERATORS: { value: WorkflowConditionOperator; label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'is_true', label: 'is true' },
  { value: 'is_false', label: 'is false' },
];

function ConditionConfig({
  data,
  onChange,
  categories,
}: {
  data: ConditionNodeData;
  onChange: (data: ConditionNodeData) => void;
  categories: string[];
}) {
  const isBooleanOp = data.operator === 'is_true' || data.operator === 'is_false';

  return (
    <>
      <FieldLabel label="Field">
        <select
          value={data.field}
          onChange={(e) =>
            onChange({ ...data, field: e.target.value as WorkflowConditionField })
          }
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {CONDITION_FIELDS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </FieldLabel>

      <FieldLabel label="Operator">
        <select
          value={data.operator}
          onChange={(e) =>
            onChange({ ...data, operator: e.target.value as WorkflowConditionOperator })
          }
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {CONDITION_OPERATORS.map((op) => (
            <option key={op.value} value={op.value}>
              {op.label}
            </option>
          ))}
        </select>
      </FieldLabel>

      {!isBooleanOp && (
        <FieldLabel label="Value">
          {data.field === 'category' ? (
            <select
              value={data.value}
              onChange={(e) => onChange({ ...data, value: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select...</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          ) : data.field === 'priority' ? (
            <select
              value={data.value}
              onChange={(e) => onChange({ ...data, value: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select...</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          ) : (
            <input
              type="text"
              value={data.value}
              onChange={(e) => onChange({ ...data, value: e.target.value })}
              placeholder="Enter value..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          )}
        </FieldLabel>
      )}
    </>
  );
}

// --- Action Config ---

const ACTION_OPTIONS: { value: WorkflowActionType; label: string }[] = [
  { value: 'trash', label: 'Trash email' },
  { value: 'archive', label: 'Archive email' },
  { value: 'star', label: 'Star email' },
  { value: 'unstar', label: 'Unstar email' },
  { value: 'mark_read', label: 'Mark as read' },
  { value: 'mark_unread', label: 'Mark as unread' },
  { value: 'reassign_category', label: 'Reassign category' },
  { value: 'recategorize', label: 'AI Recategorize' },
];

function ActionConfig({
  data,
  onChange,
  categories,
}: {
  data: ActionNodeData;
  onChange: (data: ActionNodeData) => void;
  categories: string[];
}) {
  return (
    <>
      <FieldLabel label="Action">
        <select
          value={data.actionType}
          onChange={(e) =>
            onChange({ ...data, actionType: e.target.value as WorkflowActionType })
          }
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldLabel>

      {data.actionType === 'reassign_category' && (
        <FieldLabel label="Target Category">
          <select
            value={data.config?.category ?? ''}
            onChange={(e) =>
              onChange({ ...data, config: { ...data.config, category: e.target.value } })
            }
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Select category...</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </FieldLabel>
      )}

      {data.actionType === 'recategorize' && (
        <>
          <FieldLabel label="Source Category">
            <select
              value={data.config?.sourceCategory ?? ''}
              onChange={(e) =>
                onChange({ ...data, config: { ...data.config, sourceCategory: e.target.value } })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="Refinement Prompt">
            <textarea
              value={data.config?.refinementPrompt ?? ''}
              onChange={(e) =>
                onChange({ ...data, config: { ...data.config, refinementPrompt: e.target.value } })
              }
              placeholder="e.g. Separate ads and promotional content from actual shopping orders"
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
            />
          </FieldLabel>
          <NewCategoriesInput
            value={data.config?.newCategories}
            onChange={(cats) =>
              onChange({ ...data, config: { ...data.config, newCategories: cats } })
            }
          />
        </>
      )}
    </>
  );
}

// --- New Categories Input (onBlur to allow free typing with commas) ---

function NewCategoriesInput({
  value,
  onChange,
}: {
  value: string[] | undefined;
  onChange: (cats: string[] | undefined) => void;
}) {
  const [raw, setRaw] = useState((value ?? []).join(', '));

  // Sync from external updates (e.g., AI-generated config)
  useEffect(() => {
    setRaw((value ?? []).join(', '));
  }, [value]);

  return (
    <FieldLabel label="New Categories to Create">
      <input
        type="text"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          const cats = raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          onChange(cats.length ? cats : undefined);
        }}
        placeholder="e.g. Ads, Promotions (comma-separated)"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <span className="text-[10px] text-muted-foreground mt-0.5 block">
        Categories that don&apos;t exist yet will be auto-created
      </span>
    </FieldLabel>
  );
}

// --- Shared ---

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  );
}
