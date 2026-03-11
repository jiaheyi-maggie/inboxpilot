'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GroupingBuilder } from '@/components/settings/grouping-builder';
import type { GroupingLevel } from '@/types';

interface SettingsClientProps {
  initialLevels: GroupingLevel[];
  initialDateStart: string | null;
  initialDateEnd: string | null;
}

export function SettingsClient({
  initialLevels,
  initialDateStart,
  initialDateEnd,
}: SettingsClientProps) {
  const router = useRouter();

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

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/dashboard')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Inbox className="h-5 w-5 text-blue-600" />
          <span className="font-bold text-slate-900">Settings</span>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 py-6">
        <GroupingBuilder
          initialLevels={initialLevels}
          initialDateStart={initialDateStart}
          initialDateEnd={initialDateEnd}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
