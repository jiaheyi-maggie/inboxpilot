'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { GroupingBuilder } from '@/components/settings/grouping-builder';
import { CategoryManager } from '@/components/settings/category-manager';
import type { GroupingLevel } from '@/types';

interface SettingsClientProps {
  initialLevels: GroupingLevel[];
  initialDateStart: string | null;
  initialDateEnd: string | null;
  initialAutoCategorizeUnread: boolean;
}

export function SettingsClient({
  initialLevels,
  initialDateStart,
  initialDateEnd,
  initialAutoCategorizeUnread,
}: SettingsClientProps) {
  const router = useRouter();
  const [autoCategorize, setAutoCategorize] = useState(initialAutoCategorizeUnread);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const handleSave = useCallback(
    async (config: {
      levels: GroupingLevel[];
      date_range_start: string | null;
      date_range_end: string | null;
    }) => {
      const res = await fetch('/api/settings/grouping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        throw new Error('Failed to save');
      }

      router.refresh();
    },
    [router]
  );

  const handleToggleAutoCategorize = useCallback(async () => {
    const newValue = !autoCategorize;
    setAutoCategorize(newValue);
    setSavingPrefs(true);
    try {
      await fetch('/api/settings/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_categorize_unread: newValue }),
      });
    } catch {
      setAutoCategorize(!newValue); // revert on error
    } finally {
      setSavingPrefs(false);
    }
  }, [autoCategorize]);

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure your inbox organization and preferences
        </p>
      </div>

      <GroupingBuilder
        initialLevels={initialLevels}
        initialDateStart={initialDateStart}
        initialDateEnd={initialDateEnd}
        onSave={handleSave}
      />

      {/* Categories section */}
      <div>
        <h2 className="text-sm font-semibold mb-1">Categories</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Customize how your emails are categorized. Add descriptions to help the AI understand each category.
        </p>
        <CategoryManager />
      </div>

      {/* Behavior section */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Behavior</h2>
        <div className="border border-border rounded-lg p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium">
                Auto-categorize unread emails
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                When off, unread emails stay in the Unread section until you read them
              </p>
            </div>
            <button
              onClick={handleToggleAutoCategorize}
              disabled={savingPrefs}
              className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${
                autoCategorize ? 'bg-primary' : 'bg-muted'
              } ${savingPrefs ? 'opacity-50' : ''}`}
            >
              {savingPrefs ? (
                <Loader2 className="absolute top-1 left-1 h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    autoCategorize ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
