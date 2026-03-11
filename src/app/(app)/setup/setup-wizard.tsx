'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderTree, Mail, User, Calendar, ChevronRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DimensionKey, GroupingLevel } from '@/types';

const PRIMARY_OPTIONS: {
  id: DimensionKey;
  label: string;
  desc: string;
  icon: typeof Mail;
}[] = [
  {
    id: 'category',
    label: 'Topic',
    desc: 'AI auto-sorts by what emails are about',
    icon: Sparkles,
  },
  {
    id: 'sender',
    label: 'Sender',
    desc: 'Who sent the email',
    icon: User,
  },
  {
    id: 'date_month',
    label: 'Date',
    desc: 'When you received it',
    icon: Calendar,
  },
];

const SUB_OPTIONS: Record<
  string,
  { id: DimensionKey | 'none'; label: string }[]
> = {
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

export function SetupWizard() {
  const router = useRouter();
  const [level1, setLevel1] = useState<DimensionKey>('category');
  const [level2, setLevel2] = useState<DimensionKey | 'none'>('sender');
  const [saving, setSaving] = useState(false);

  const handleFinish = useCallback(async () => {
    setSaving(true);
    const levels: GroupingLevel[] = [
      { dimension: level1, label: DIMENSION_LABELS[level1] ?? level1 },
    ];
    if (level2 !== 'none') {
      levels.push({
        dimension: level2,
        label: DIMENSION_LABELS[level2] ?? level2,
      });
    }

    try {
      const res = await fetch('/api/settings/grouping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          levels,
          date_range_start: null,
          date_range_end: null,
        }),
      });

      if (res.ok) {
        // Trigger initial sync then go to dashboard
        fetch('/api/sync', { method: 'POST' }).catch(() => {});
        router.push('/dashboard');
      }
    } catch {
      // fallback — still go to dashboard
      router.push('/dashboard');
    } finally {
      setSaving(false);
    }
  }, [level1, level2, router]);

  // When changing level1, reset level2 if it conflicts
  const handleLevel1Change = (id: DimensionKey) => {
    setLevel1(id);
    const subs = SUB_OPTIONS[id] ?? [];
    if (!subs.find((s) => s.id === level2)) {
      setLevel2(subs[0]?.id ?? 'none');
    }
  };

  const subLabel =
    level2 !== 'none'
      ? DIMENSION_LABELS[level2] ?? level2
      : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="flex-1 max-w-md mx-auto w-full px-4 py-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-100 mb-4">
            <FolderTree className="h-7 w-7 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            Organize your inbox
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            Pick how to group your emails — AI handles the rest.
          </p>
        </div>

        {/* Step 1 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-3 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">
              1
            </div>
            <span className="text-sm font-semibold text-slate-900">
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
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 flex-shrink-0 ${
                      active ? 'text-indigo-600' : 'text-slate-400'
                    }`}
                  />
                  <div>
                    <div
                      className={`text-sm font-semibold ${
                        active ? 'text-indigo-700' : 'text-slate-700'
                      }`}
                    >
                      {opt.label}
                    </div>
                    <div className="text-xs text-slate-500">{opt.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-3 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">
              2
            </div>
            <span className="text-sm font-semibold text-slate-900">
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
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Preview */}
        <div className="bg-indigo-50 rounded-2xl border border-indigo-100 p-5 mb-6">
          <div className="text-xs font-bold text-indigo-500 mb-3">
            Your folder structure:
          </div>
          <div className="text-sm font-semibold text-indigo-700 space-y-1">
            <div className="flex items-center gap-1.5">
              <FolderTree className="h-4 w-4" />
              {PRIMARY_OPTIONS.find((o) => o.id === level1)?.label}
            </div>
            {subLabel && (
              <div className="flex items-center gap-1.5 ml-5 text-indigo-500">
                <FolderTree className="h-3.5 w-3.5" />
                {subLabel}
              </div>
            )}
            <div
              className={`flex items-center gap-1.5 text-indigo-400 font-medium ${
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
          onClick={handleFinish}
          disabled={saving}
          className="w-full h-12 text-base font-bold bg-indigo-600 hover:bg-indigo-700"
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
        <p className="text-xs text-slate-400 text-center mt-3">
          You can change this anytime in Settings
        </p>
      </div>
    </div>
  );
}
