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
  SmartConditionContext,
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

/** Account info used for the workflow condition dropdown. */
interface AccountOption {
  id: string;
  email: string;
  display_name: string | null;
  color: string;
}

/** Hook to fetch user's connected Gmail accounts. */
function useAccounts() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/accounts');
        if (res.ok) {
          const { accounts: accts } = await res.json();
          if (!cancelled && accts) {
            setAccounts(accts);
          }
        }
      } catch {
        // keep empty
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return accounts;
}

interface NodeConfigSheetProps {
  node: WorkflowNode | null;
  onClose: () => void;
  onUpdate: (nodeId: string, data: TriggerNodeData | ConditionNodeData | ActionNodeData) => void;
}

export function NodeConfigSheet({ node, onClose, onUpdate }: NodeConfigSheetProps) {
  const categories = useCategories();
  const accounts = useAccounts();

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
              accounts={accounts}
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
  { value: 'importance', label: 'Importance' },
  { value: 'sender_email', label: 'Sender Email' },
  { value: 'sender_domain', label: 'Sender Domain' },
  { value: 'subject', label: 'Subject' },
  { value: 'has_attachment', label: 'Has Attachment' },
  { value: 'is_read', label: 'Is Read' },
  { value: 'is_starred', label: 'Is Starred' },
  { value: 'label', label: 'Label' },
  { value: 'account', label: 'Account' },
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

const SMART_EXAMPLES = [
  'Is this a promotional email without a promo code?',
  'Does this email require a response from me?',
  'Is this a shipping or delivery notification?',
  'Does this contain financial data or sensitive info?',
  'Is this a meeting request I should accept?',
];

function ConditionConfig({
  data,
  onChange,
  categories,
  accounts,
}: {
  data: ConditionNodeData;
  onChange: (data: ConditionNodeData) => void;
  categories: string[];
  accounts: AccountOption[];
}) {
  const isSmart = data.mode === 'smart';

  return (
    <>
      {/* Mode toggle */}
      <div className="flex gap-2 mb-1">
        <button
          type="button"
          onClick={() => onChange({ ...data, mode: 'field' })}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            !isSmart
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          Field Match
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...data, mode: 'smart', prompt: data.prompt ?? '' })}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            isSmart
              ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          Smart (AI)
        </button>
      </div>

      {isSmart ? (
        <SmartConditionConfig data={data} onChange={onChange} />
      ) : (
        <FieldConditionConfig data={data} onChange={onChange} categories={categories} accounts={accounts} />
      )}
    </>
  );
}

function SmartConditionConfig({
  data,
  onChange,
}: {
  data: ConditionNodeData;
  onChange: (data: ConditionNodeData) => void;
}) {
  const ctx = data.contextFields ?? {
    includeSubject: true,
    includeSnippet: true,
    includeBody: false,
    includeSender: false,
    includeCategory: false,
  };

  const updateCtx = (partial: Partial<SmartConditionContext>) => {
    onChange({ ...data, contextFields: { ...ctx, ...partial } });
  };

  return (
    <>
      <FieldLabel label="Describe your condition">
        <textarea
          value={data.prompt ?? ''}
          onChange={(e) => onChange({ ...data, prompt: e.target.value })}
          placeholder="e.g. Is this a promotional email that does NOT contain a promo code?"
          rows={3}
          maxLength={500}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
        />
        <span className="text-[10px] text-muted-foreground mt-0.5 block">
          AI will evaluate this for each email and return Yes or No
        </span>
      </FieldLabel>

      <FieldLabel label="Include in context">
        <div className="space-y-1.5 mt-1">
          {[
            { key: 'includeSubject' as const, label: 'Email subject' },
            { key: 'includeSnippet' as const, label: 'Email snippet' },
            { key: 'includeSender' as const, label: 'Sender info' },
            { key: 'includeCategory' as const, label: 'Current category' },
            { key: 'includeBody' as const, label: 'Full body (slower)' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={ctx[key]}
                onChange={(e) => updateCtx({ [key]: e.target.checked })}
                className="rounded border-input"
              />
              {label}
            </label>
          ))}
        </div>
      </FieldLabel>

      <div className="space-y-1 mt-2">
        <span className="text-[10px] font-medium text-muted-foreground block">Examples (click to use)</span>
        {SMART_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onChange({ ...data, prompt: ex })}
            className="block text-xs text-violet-600 dark:text-violet-400 hover:underline truncate w-full text-left"
          >
            {ex}
          </button>
        ))}
      </div>
    </>
  );
}

function FieldConditionConfig({
  data,
  onChange,
  categories,
  accounts,
}: {
  data: ConditionNodeData;
  onChange: (data: ConditionNodeData) => void;
  categories: string[];
  accounts: AccountOption[];
}) {
  const isBooleanOp = data.operator === 'is_true' || data.operator === 'is_false';

  // Filter operators based on field type
  const DROPDOWN_FIELDS = new Set(['account', 'category', 'importance', 'priority']);
  const BOOLEAN_FIELDS = new Set(['has_attachment', 'is_read', 'is_starred']);
  const filteredOperators = BOOLEAN_FIELDS.has(data.field)
    ? CONDITION_OPERATORS.filter((op) => op.value === 'is_true' || op.value === 'is_false')
    : DROPDOWN_FIELDS.has(data.field)
      ? CONDITION_OPERATORS.filter((op) => op.value === 'equals' || op.value === 'not_equals')
      : CONDITION_OPERATORS;

  return (
    <>
      <FieldLabel label="Field">
        <select
          value={data.field}
          onChange={(e) => {
            const newField = e.target.value as WorkflowConditionField;
            const defaultOp = BOOLEAN_FIELDS.has(newField) ? 'is_true' : 'equals';
            onChange({ ...data, field: newField, operator: defaultOp as WorkflowConditionOperator, value: '' });
          }}
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
          {filteredOperators.map((op) => (
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
          ) : data.field === 'importance' || data.field === 'priority' ? (
            <select
              value={data.value}
              onChange={(e) => onChange({ ...data, value: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select...</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="noise">Noise</option>
            </select>
          ) : data.field === 'account' ? (
            <select
              value={data.value}
              onChange={(e) => onChange({ ...data, value: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select account...</option>
              {accounts.map((acct) => (
                <option key={acct.id} value={acct.id}>
                  {acct.display_name ? `${acct.display_name} (${acct.email})` : acct.email}
                </option>
              ))}
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
