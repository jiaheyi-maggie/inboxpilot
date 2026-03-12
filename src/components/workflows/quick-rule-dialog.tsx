'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Zap, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { EmailWithCategory, WorkflowGraph, WorkflowTriggerType, WorkflowActionType, WorkflowConditionField, WorkflowConditionOperator } from '@/types';

interface QuickRuleDialogProps {
  email: EmailWithCategory;
  onClose: () => void;
}

interface RuleSuggestion {
  label: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
}

function buildSimpleGraph(
  triggerType: WorkflowTriggerType,
  triggerConfig: Record<string, unknown>,
  actionType: WorkflowActionType,
  actionConfig: Record<string, unknown> = {},
  condition?: { field: WorkflowConditionField; operator: string; value: string },
): WorkflowGraph {
  const nodes: WorkflowGraph['nodes'] = [];
  const edges: WorkflowGraph['edges'] = [];
  let x = 0;

  const triggerId = 'trigger-1';
  nodes.push({
    id: triggerId,
    type: 'trigger',
    position: { x, y: 0 },
    data: { triggerType, config: triggerConfig as { domain?: string; category?: string; timeoutMinutes?: number } },
  });
  x += 300;

  let lastId = triggerId;

  if (condition) {
    const condId = 'condition-1';
    nodes.push({
      id: condId,
      type: 'condition',
      position: { x, y: 0 },
      data: { field: condition.field, operator: condition.operator as WorkflowConditionOperator, value: condition.value },
    });
    edges.push({ id: 'e-t-c', source: triggerId, target: condId, sourceHandle: null });

    // No false branch — the engine gracefully skips when no edge exists.
    // Previously this had a mark_read "stop" node which would execute on
    // every non-matching email, silently marking them all as read.

    lastId = condId;
    x += 300;
  }

  const actionId = 'action-1';
  nodes.push({
    id: actionId,
    type: 'action',
    position: { x, y: 0 },
    data: { actionType, config: actionConfig as { category?: string } },
  });
  edges.push({
    id: `e-${lastId}-a`,
    source: lastId,
    target: actionId,
    sourceHandle: lastId.startsWith('condition') ? 'true' : null,
  });

  return { nodes, edges };
}

function generateSuggestions(email: EmailWithCategory): RuleSuggestion[] {
  const suggestions: RuleSuggestion[] = [];
  const domain = email.sender_domain;
  const category = email.category;

  // Domain-based rules
  if (domain) {
    suggestions.push({
      label: `Always archive emails from ${domain}`,
      name: `Archive ${domain}`,
      description: `Auto-archive all emails from ${domain}`,
      graph: buildSimpleGraph('email_from_domain', { domain }, 'archive'),
    });

    suggestions.push({
      label: `Always trash emails from ${domain}`,
      name: `Trash ${domain}`,
      description: `Auto-trash all emails from ${domain}`,
      graph: buildSimpleGraph('email_from_domain', { domain }, 'trash'),
    });

    if (category) {
      suggestions.push({
        label: `Always categorize ${domain} emails as "${category}"`,
        name: `${domain} → ${category}`,
        description: `Categorize all ${domain} emails as ${category}`,
        graph: buildSimpleGraph('email_from_domain', { domain }, 'reassign_category', { category }),
      });
    }
  }

  // Sender domain star rule (uses domain trigger — safe, no condition needed)
  if (domain) {
    suggestions.push({
      label: `Star all emails from ${domain}`,
      name: `Star ${domain}`,
      description: `Auto-star emails from ${domain}`,
      graph: buildSimpleGraph('email_from_domain', { domain }, 'star'),
    });
  }

  // Category-based rules
  if (category) {
    suggestions.push({
      label: `Mark all "${category}" emails as read`,
      name: `Auto-read ${category}`,
      description: `Automatically mark ${category} emails as read`,
      graph: buildSimpleGraph('email_categorized', { category }, 'mark_read'),
    });
  }

  return suggestions;
}

export function QuickRuleDialog({ email, onClose }: QuickRuleDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activatingIdx, setActivatingIdx] = useState<number | null>(null);
  const suggestions = generateSuggestions(email);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleActivate = useCallback(async (idx: number) => {
    const rule = suggestions[idx];
    if (!rule) return;
    setActivatingIdx(idx);
    try {
      // Create workflow
      const createRes = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: rule.name,
          description: rule.description,
          graph: rule.graph,
        }),
      });
      if (!createRes.ok) {
        toast.error('Failed to create rule');
        return;
      }
      const { workflow } = await createRes.json();

      // Enable it
      const enableRes = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: true }),
      });

      if (!enableRes.ok) {
        toast.warning('Rule created but could not be enabled — open it to check for issues');
      } else {
        toast.success(`Rule "${rule.name}" activated`);
      }
      onClose();
    } catch {
      toast.error('Failed to create rule');
    } finally {
      setActivatingIdx(null);
    }
  }, [suggestions, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Create rule"
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative bg-popover text-popover-foreground rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[70vh] overflow-y-auto shadow-xl outline-none border"
      >
        <div className="sticky top-0 bg-popover border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Create a rule
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            One click to automate. Based on this email.
          </p>
        </div>
        <div className="p-2">
          {suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No rule suggestions for this email.
            </p>
          ) : (
            suggestions.map((rule, idx) => (
              <button
                key={idx}
                onClick={() => handleActivate(idx)}
                disabled={activatingIdx !== null}
                className="w-full text-left px-3 py-3 rounded-lg hover:bg-accent transition-colors flex items-center gap-3 disabled:opacity-50"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{rule.label}</p>
                </div>
                {activatingIdx === idx ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
                ) : (
                  <Check className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
