'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FolderTree,
  Mail,
  User,
  Calendar,
  ChevronRight,
  Sparkles,
  Loader2,
  Plus,
  X,
  Check,
  Briefcase,
  GraduationCap,
  Inbox,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { DimensionKey, GroupingLevel } from '@/types';

// --- Types ---

interface GeneratedCategory {
  name: string;
  description: string;
}

interface GeneratedWorkflow {
  name: string;
  description: string;
  prompt: string;
}

interface GeneratedSetup {
  categories: GeneratedCategory[];
  grouping: GroupingLevel[];
  workflows: GeneratedWorkflow[];
}

// --- Constants ---

const TEMPLATES = [
  { key: 'professional', label: 'Professional', icon: Briefcase },
  { key: 'student', label: 'Student', icon: GraduationCap },
  { key: 'minimal', label: 'Minimal', icon: Inbox },
];

const PRIMARY_OPTIONS: {
  id: DimensionKey;
  label: string;
  desc: string;
  icon: typeof Mail;
}[] = [
  { id: 'category', label: 'Topic', desc: 'AI auto-sorts by what emails are about', icon: Sparkles },
  { id: 'sender', label: 'Sender', desc: 'Who sent the email', icon: User },
  { id: 'date_month', label: 'Date', desc: 'When you received it', icon: Calendar },
];

const SUB_OPTIONS: Record<string, { id: DimensionKey | 'none'; label: string }[]> = {
  category: [
    { id: 'sender', label: 'Then by sender' },
    { id: 'date_month', label: 'Then by date' },
    { id: 'none' as const, label: 'No sub-group' },
  ],
  sender: [
    { id: 'category', label: 'Then by topic' },
    { id: 'date_month', label: 'Then by date' },
    { id: 'none' as const, label: 'No sub-group' },
  ],
  date_month: [
    { id: 'category', label: 'Then by topic' },
    { id: 'sender', label: 'Then by sender' },
    { id: 'none' as const, label: 'No sub-group' },
  ],
};

const DIMENSION_LABELS: Record<string, string> = {
  category: 'Category',
  sender: 'Sender',
  sender_domain: 'Domain',
  date_month: 'Month',
  date_week: 'Week',
  topic: 'Topic',
};

// --- Component ---

type Step = 'prompt' | 'review' | 'manual';

export function SetupWizard() {
  const router = useRouter();

  // Step 0: Prompt
  const [step, setStep] = useState<Step>('prompt');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);

  // Generated setup (from AI)
  const [generatedSetup, setGeneratedSetup] = useState<GeneratedSetup | null>(null);
  const [editCategories, setEditCategories] = useState<GeneratedCategory[]>([]);
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<number>>(new Set());

  // Manual fallback (step 1/2 picker)
  const [level1, setLevel1] = useState<DimensionKey>('category');
  const [level2, setLevel2] = useState<DimensionKey | 'none'>('sender');

  const [saving, setSaving] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');

  // --- Step 0: Generate from prompt ---

  const handleGenerate = useCallback(async (input: string) => {
    if (!input.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/setup/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: input.trim() }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Failed' }));
        toast.error(error);
        return;
      }
      const setup: GeneratedSetup = await res.json();
      setGeneratedSetup(setup);
      setEditCategories(setup.categories);
      setSelectedWorkflows(new Set(setup.workflows.map((_, i) => i)));
      // Pre-fill manual fallback from generated grouping
      if (setup.grouping[0]) setLevel1(setup.grouping[0].dimension);
      if (setup.grouping[1]) setLevel2(setup.grouping[1].dimension);
      else setLevel2('none');
      setStep('review');
    } catch {
      toast.error('Failed to generate setup');
    } finally {
      setGenerating(false);
    }
  }, []);

  // --- Apply generated setup ---

  const handleApplySetup = useCallback(async () => {
    if (!generatedSetup) return;
    setSaving(true);
    try {
      // 1. Create categories (ignore 409 duplicates)
      for (const cat of editCategories) {
        const res = await fetch('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: cat.name, description: cat.description }),
        });
        if (!res.ok && res.status !== 409) {
          console.warn(`[setup] Failed to create category "${cat.name}"`);
        }
      }

      // 2. Save grouping (use level1/level2 state, which reflects user's edits)
      const levels: GroupingLevel[] = [
        { dimension: level1, label: DIMENSION_LABELS[level1] ?? level1 },
      ];
      if (level2 !== 'none') {
        levels.push({ dimension: level2, label: DIMENSION_LABELS[level2] ?? level2 });
      }
      const groupRes = await fetch('/api/settings/grouping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levels, date_range_start: null, date_range_end: null }),
      });
      if (!groupRes.ok) {
        toast.error('Failed to save organization settings');
        return;
      }

      // 3. Create selected workflows (parallel with error isolation)
      const workflowEntries = Array.from(selectedWorkflows)
        .map((idx) => generatedSetup.workflows[idx])
        .filter(Boolean);

      await Promise.allSettled(
        workflowEntries.map(async (wf) => {
          const genRes = await fetch('/api/workflows/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: wf.prompt }),
          });
          if (!genRes.ok) return;
          const generated = await genRes.json();
          const createRes = await fetch('/api/workflows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: generated.name,
              description: generated.description,
              graph: generated.graph,
            }),
          });
          if (!createRes.ok) return;
          const { workflow } = await createRes.json();
          await fetch(`/api/workflows/${workflow.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_enabled: true }),
          });
        })
      );

      // 4. Trigger initial sync then go to dashboard
      fetch('/api/sync', { method: 'POST' }).catch(() => {});
      router.push('/dashboard');
    } catch {
      toast.error('Setup failed');
    } finally {
      setSaving(false);
    }
  }, [generatedSetup, editCategories, selectedWorkflows, level1, level2, router]);

  // --- Manual finish (skip AI) ---

  const handleManualFinish = useCallback(async () => {
    setSaving(true);
    const levels: GroupingLevel[] = [
      { dimension: level1, label: DIMENSION_LABELS[level1] ?? level1 },
    ];
    if (level2 !== 'none') {
      levels.push({ dimension: level2, label: DIMENSION_LABELS[level2] ?? level2 });
    }

    try {
      const res = await fetch('/api/settings/grouping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levels, date_range_start: null, date_range_end: null }),
      });
      if (!res.ok) {
        toast.error('Failed to save settings');
        return;
      }
      fetch('/api/sync', { method: 'POST' }).catch(() => {});
      router.push('/dashboard');
    } catch {
      toast.error('Network error — could not save settings');
    } finally {
      setSaving(false);
    }
  }, [level1, level2, router]);

  const handleLevel1Change = (id: DimensionKey) => {
    setLevel1(id);
    const subs = SUB_OPTIONS[id] ?? [];
    if (!subs.find((s) => s.id === level2)) {
      setLevel2(subs[0]?.id ?? 'none');
    }
  };

  const removeCategory = (idx: number) => {
    setEditCategories((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleWorkflow = (idx: number) => {
    setSelectedWorkflows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // ============= RENDER =============

  // Step 0: Prompt
  if (step === 'prompt') {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 max-w-md mx-auto w-full px-4 py-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
              <Sparkles className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              How do you want your inbox organized?
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Describe your ideal inbox and we&apos;ll set everything up — categories, organization, and automation rules.
            </p>
          </div>

          {/* Prompt input */}
          <div className="bg-card rounded-2xl border border-border p-5 mb-4 shadow-sm">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. I want to separate work from personal, auto-archive promotions, and have a reading list for newsletters..."
              className="w-full bg-transparent text-sm outline-none resize-none placeholder:text-muted-foreground min-h-[80px]"
              disabled={generating}
            />
            <div className="flex justify-end mt-3">
              <Button
                onClick={() => handleGenerate(prompt)}
                disabled={generating || !prompt.trim()}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    Generate my setup
                    <ChevronRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Templates */}
          <div className="mb-6">
            <p className="text-xs text-muted-foreground mb-2 text-center">
              Or start with a template
            </p>
            <div className="flex gap-2 justify-center">
              {TEMPLATES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.key}
                    onClick={() => handleGenerate(t.key)}
                    disabled={generating}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-card hover:bg-accent text-sm transition-colors disabled:opacity-50"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Skip to manual */}
          <div className="text-center">
            <button
              onClick={() => setStep('manual')}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings className="h-3 w-3 inline mr-1" />
              Skip — I&apos;ll configure manually
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Step 1: Review generated setup
  if (step === 'review' && generatedSetup) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 max-w-md mx-auto w-full px-4 py-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
              <Sparkles className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              Your personalized setup
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Review and customize before applying.
            </p>
          </div>

          {/* Categories */}
          <div className="bg-card rounded-2xl border border-border p-5 mb-3 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <FolderTree className="h-4 w-4 text-primary" />
              Categories
            </h3>
            <div className="flex flex-wrap gap-2">
              {editCategories.map((cat, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-sm"
                  title={cat.description}
                >
                  {cat.name}
                  <button
                    onClick={() => removeCategory(idx)}
                    className="hover:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {addingCategory ? (
                <div className="flex items-center gap-1.5 w-full mt-1">
                  <input
                    autoFocus
                    type="text"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="Name"
                    className="px-2 py-1 rounded-lg border border-border bg-background text-sm outline-none w-24"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newCatName.trim()) {
                        setEditCategories((prev) => [...prev, { name: newCatName.trim(), description: newCatDesc.trim() }]);
                        setNewCatName('');
                        setNewCatDesc('');
                        setAddingCategory(false);
                      }
                      if (e.key === 'Escape') {
                        setAddingCategory(false);
                        setNewCatName('');
                        setNewCatDesc('');
                      }
                    }}
                  />
                  <input
                    type="text"
                    value={newCatDesc}
                    onChange={(e) => setNewCatDesc(e.target.value)}
                    placeholder="Description"
                    className="px-2 py-1 rounded-lg border border-border bg-background text-sm outline-none flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newCatName.trim()) {
                        setEditCategories((prev) => [...prev, { name: newCatName.trim(), description: newCatDesc.trim() }]);
                        setNewCatName('');
                        setNewCatDesc('');
                        setAddingCategory(false);
                      }
                      if (e.key === 'Escape') {
                        setAddingCategory(false);
                        setNewCatName('');
                        setNewCatDesc('');
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newCatName.trim()) {
                        setEditCategories((prev) => [...prev, { name: newCatName.trim(), description: newCatDesc.trim() }]);
                        setNewCatName('');
                        setNewCatDesc('');
                        setAddingCategory(false);
                      }
                    }}
                    className="text-primary hover:text-primary/80 transition-colors"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => { setAddingCategory(false); setNewCatName(''); setNewCatDesc(''); }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingCategory(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              )}
            </div>
          </div>

          {/* Organization */}
          <div className="bg-card rounded-2xl border border-border p-5 mb-3 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <FolderTree className="h-4 w-4 text-primary" />
              Organization
            </h3>
            <p className="text-sm text-muted-foreground">
              {generatedSetup.grouping.map((g) => g.label).join(' → ')}
            </p>
            <button
              onClick={() => setStep('manual')}
              className="text-xs text-primary hover:underline mt-1"
            >
              Customize
            </button>
          </div>

          {/* Workflows */}
          {generatedSetup.workflows.length > 0 && (
            <div className="bg-card rounded-2xl border border-border p-5 mb-6 shadow-sm">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Starter Rules
              </h3>
              <div className="space-y-2">
                {generatedSetup.workflows.map((wf, idx) => (
                  <label key={idx} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedWorkflows.has(idx)}
                      onChange={() => toggleWorkflow(idx)}
                      className="mt-0.5 rounded"
                    />
                    <div>
                      <span className="font-medium">{wf.name}</span>
                      <span className="text-muted-foreground ml-1">— {wf.description}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Apply */}
          <Button
            onClick={handleApplySetup}
            disabled={saving}
            className="w-full h-12 text-base font-bold"
          >
            {saving ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Setting up...
              </>
            ) : (
              <>
                Organize my inbox
                <ChevronRight className="h-5 w-5 ml-1" />
              </>
            )}
          </Button>

          <div className="flex justify-center gap-4 mt-3">
            <button
              onClick={() => setStep('prompt')}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Back
            </button>
            <p className="text-xs text-muted-foreground">
              You can change this anytime in Settings
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Manual setup (original step 1/2 picker — with CSS variable colors)
  const subLabel = level2 !== 'none' ? DIMENSION_LABELS[level2] ?? level2 : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 max-w-md mx-auto w-full px-4 py-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <FolderTree className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Organize your inbox
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Pick how to group your emails — AI handles the rest.
          </p>
        </div>

        {/* Step 1 */}
        <div className="bg-card rounded-2xl border border-border p-5 mb-3 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              1
            </div>
            <span className="text-sm font-semibold text-foreground">
              First, organize by...
            </span>
          </div>
          <div className="space-y-2">
            {PRIMARY_OPTIONS.map((opt) => {
              const active = level1 === opt.id;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  onClick={() => handleLevel1Change(opt.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                    active
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:border-muted-foreground/30'
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 flex-shrink-0 ${
                      active ? 'text-primary' : 'text-muted-foreground'
                    }`}
                  />
                  <div>
                    <div
                      className={`text-sm font-semibold ${
                        active ? 'text-primary' : 'text-foreground'
                      }`}
                    >
                      {opt.label}
                    </div>
                    <div className="text-xs text-muted-foreground">{opt.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2 */}
        <div className="bg-card rounded-2xl border border-border p-5 mb-3 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              2
            </div>
            <span className="text-sm font-semibold text-foreground">
              Then within each group...
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(SUB_OPTIONS[level1] ?? []).map((opt) => {
              const active = level2 === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setLevel2(opt.id)}
                  className={`px-4 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                    active
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/30'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Preview */}
        <div className="bg-primary/5 rounded-2xl border border-primary/10 p-5 mb-6">
          <div className="text-xs font-bold text-primary mb-3">
            Your folder structure:
          </div>
          <div className="text-sm font-semibold text-primary space-y-1">
            <div className="flex items-center gap-1.5">
              <FolderTree className="h-4 w-4" />
              {PRIMARY_OPTIONS.find((o) => o.id === level1)?.label}
            </div>
            {subLabel && (
              <div className="flex items-center gap-1.5 ml-5 text-primary/70">
                <FolderTree className="h-3.5 w-3.5" />
                {subLabel}
              </div>
            )}
            <div
              className={`flex items-center gap-1.5 text-primary/50 font-medium ${
                subLabel ? 'ml-10' : 'ml-5'
              }`}
            >
              <Mail className="h-3.5 w-3.5" />
              Emails
            </div>
          </div>
        </div>

        {/* CTA */}
        <Button
          onClick={handleManualFinish}
          disabled={saving}
          className="w-full h-12 text-base font-bold"
        >
          {saving ? (
            'Setting up...'
          ) : (
            <>
              Organize my inbox
              <ChevronRight className="h-5 w-5 ml-1" />
            </>
          )}
        </Button>

        <div className="flex justify-center gap-4 mt-3">
          <button
            onClick={() => setStep('prompt')}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to AI setup
          </button>
          <p className="text-xs text-muted-foreground">
            You can change this anytime in Settings
          </p>
        </div>
      </div>
    </div>
  );
}
