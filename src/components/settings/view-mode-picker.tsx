'use client';

import { useCallback, useState } from 'react';
import { List, User, Calendar, MessageSquare, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ViewMode } from '@/types';

const VIEW_MODE_OPTIONS: {
  value: ViewMode;
  label: string;
  description: string;
  icon: typeof List;
}[] = [
  { value: 'flat', label: 'Flat', description: 'All emails in each category', icon: List },
  { value: 'by_sender', label: 'By Sender', description: 'Group by sender within each category', icon: User },
  { value: 'by_date', label: 'By Date', description: 'Group by month within each category', icon: Calendar },
  { value: 'by_topic', label: 'By Topic', description: 'Group by topic within each category', icon: MessageSquare },
];

interface ViewModePickerProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  saving?: boolean;
}

export function ViewModePicker({ value, onChange, saving }: ViewModePickerProps) {
  return (
    <div>
      <h2 className="text-sm font-semibold mb-1">Default View</h2>
      <p className="text-xs text-muted-foreground mb-3">
        How emails are organized within each category folder
      </p>
      <div className="space-y-2">
        {VIEW_MODE_OPTIONS.map((opt) => {
          const active = value === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              disabled={saving}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                active
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card hover:border-muted-foreground/30'
              } ${saving ? 'opacity-50' : ''}`}
            >
              <Icon
                className={`h-5 w-5 flex-shrink-0 ${
                  active ? 'text-primary' : 'text-muted-foreground'
                }`}
              />
              <div className="flex-1 min-w-0">
                <div
                  className={`text-sm font-semibold ${
                    active ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  {opt.label}
                </div>
                <div className="text-xs text-muted-foreground">{opt.description}</div>
              </div>
              {saving && active && (
                <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Self-contained ViewModePicker that handles its own API calls.
 * Used in settings page.
 */
export function ViewModePickerWithSave({ initialValue }: { initialValue: ViewMode }) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialValue);
  const [saving, setSaving] = useState(false);

  const handleChange = useCallback(async (mode: ViewMode) => {
    if (mode === viewMode) return;
    const previous = viewMode;
    setViewMode(mode);
    setSaving(true);
    try {
      const res = await fetch('/api/settings/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_view_mode: mode }),
      });
      if (!res.ok) {
        setViewMode(previous);
        toast.error('Failed to save view mode');
      } else {
        toast.success('View mode updated');
      }
    } catch {
      setViewMode(previous);
      toast.error('Failed to save view mode');
    } finally {
      setSaving(false);
    }
  }, [viewMode]);

  return <ViewModePicker value={viewMode} onChange={handleChange} saving={saving} />;
}
