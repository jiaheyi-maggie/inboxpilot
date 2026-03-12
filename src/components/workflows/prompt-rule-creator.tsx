'use client';

import { useCallback, useState } from 'react';
import { Loader2, Sparkles, Check, Pencil, X, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { WorkflowGraph, Workflow } from '@/types';

interface GeneratedRule {
  name: string;
  description: string;
  graph: WorkflowGraph;
  summary: string;
}

interface PromptRuleCreatorProps {
  /** Called after a workflow is successfully created + activated */
  onWorkflowCreated?: (workflow: Workflow) => void;
  /** Called when user clicks "Edit in Canvas" */
  onEditInCanvas?: (workflow: Workflow) => void;
  /** Compact mode for embedding in overview */
  compact?: boolean;
}

const EXAMPLES = [
  'Archive emails from linkedin.com',
  'Star high-priority work emails',
  'Trash promotional emails from retail stores',
  'Move newsletters to Reading List',
];

export function PromptRuleCreator({
  onWorkflowCreated,
  onEditInCanvas,
  compact = false,
}: PromptRuleCreatorProps) {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedRule | null>(null);
  const [activating, setActivating] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setGenerated(null);
    try {
      const res = await fetch('/api/workflows/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Generation failed' }));
        toast.error(error);
        return;
      }
      const result: GeneratedRule = await res.json();
      setGenerated(result);
    } catch {
      toast.error('Failed to generate rule');
    } finally {
      setGenerating(false);
    }
  }, [prompt]);

  const handleActivate = useCallback(async () => {
    if (!generated) return;
    setActivating(true);
    try {
      // Create the workflow
      const createRes = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: generated.name,
          description: generated.description,
          graph: generated.graph,
        }),
      });
      if (!createRes.ok) {
        toast.error('Failed to create workflow');
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
        // Created but couldn't enable — still success but warn
        toast.warning('Workflow created but could not be enabled. Open it to check for issues.');
        onWorkflowCreated?.(workflow);
        setGenerated(null);
        setPrompt('');
        return;
      }

      const { workflow: enabledWorkflow } = await enableRes.json();
      toast.success(`"${generated.name}" is now active`);
      onWorkflowCreated?.(enabledWorkflow ?? workflow);
      setGenerated(null);
      setPrompt('');
    } catch {
      toast.error('Failed to activate workflow');
    } finally {
      setActivating(false);
    }
  }, [generated, onWorkflowCreated]);

  const handleEditInCanvas = useCallback(async () => {
    if (!generated) return;
    setActivating(true);
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: generated.name,
          description: generated.description,
          graph: generated.graph,
        }),
      });
      if (!res.ok) {
        toast.error('Failed to create workflow');
        return;
      }
      const { workflow } = await res.json();
      onEditInCanvas?.(workflow);
      setGenerated(null);
      setPrompt('');
    } catch {
      toast.error('Failed to create workflow');
    } finally {
      setActivating(false);
    }
  }, [generated, onEditInCanvas]);

  const handleDiscard = useCallback(() => {
    setGenerated(null);
    setPrompt('');
  }, []);

  // Preview card for generated rule
  if (generated) {
    return (
      <div className={`${compact ? '' : 'max-w-2xl mx-auto'}`}>
        <div className="border border-border rounded-xl p-5 bg-card space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-foreground">{generated.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">{generated.summary}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleActivate}
              disabled={activating}
              size="sm"
            >
              {activating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Activate
            </Button>
            {onEditInCanvas && (
              <Button
                variant="outline"
                onClick={handleEditInCanvas}
                disabled={activating}
                size="sm"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit in Canvas
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={handleDiscard}
              disabled={activating}
              size="sm"
            >
              <X className="h-3.5 w-3.5" />
              Discard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${compact ? '' : 'max-w-2xl mx-auto'}`}>
      <div className="border border-border rounded-xl p-4 bg-card">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !generating) handleGenerate();
            }}
            placeholder="Describe a rule... e.g. &quot;Archive emails from linkedin.com&quot;"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            disabled={generating}
          />
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              'Go'
            )}
          </Button>
        </div>

        {!compact && !generating && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setPrompt(ex)}
                className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
