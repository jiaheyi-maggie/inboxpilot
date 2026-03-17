'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import {
  addHours,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
  nextSaturday,
  nextMonday,
  addDays,
  isBefore,
  format,
} from 'date-fns';
import {
  Clock,
  Sun,
  Moon,
  Calendar,
  CalendarClock,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SnoozePickerProps {
  onSelect: (until: string) => void;
  onClose: () => void;
}

interface SnoozePreset {
  label: string;
  description: string;
  icon: typeof Clock;
  getTime: () => Date;
}

function setTimeOnDate(date: Date, hours: number, minutes: number): Date {
  return setMilliseconds(setSeconds(setMinutes(setHours(date, hours), minutes), 0), 0);
}

function getPresets(): SnoozePreset[] {
  const now = new Date();

  return [
    {
      label: 'Later today',
      description: format(addHours(now, 3), 'h:mm a'),
      icon: Clock,
      getTime: () => addHours(now, 3),
    },
    {
      label: 'Tomorrow morning',
      description: format(setTimeOnDate(addDays(now, 1), 9, 0), 'EEE h:mm a'),
      icon: Sun,
      getTime: () => setTimeOnDate(addDays(now, 1), 9, 0),
    },
    {
      label: 'Tomorrow evening',
      description: format(setTimeOnDate(addDays(now, 1), 18, 0), 'EEE h:mm a'),
      icon: Moon,
      getTime: () => setTimeOnDate(addDays(now, 1), 18, 0),
    },
    {
      label: 'This weekend',
      description: format(setTimeOnDate(nextSaturday(now), 9, 0), 'EEE, MMM d'),
      icon: Calendar,
      getTime: () => {
        const sat = nextSaturday(now);
        return setTimeOnDate(sat, 9, 0);
      },
    },
    {
      label: 'Next week',
      description: format(setTimeOnDate(nextMonday(now), 9, 0), 'EEE, MMM d'),
      icon: CalendarClock,
      getTime: () => {
        const mon = nextMonday(now);
        return setTimeOnDate(mon, 9, 0);
      },
    },
  ];
}

export function SnoozePicker({ onSelect, onClose }: SnoozePickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Focus trap: close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handlePresetClick = useCallback(
    (getTime: () => Date) => {
      const time = getTime();
      onSelect(time.toISOString());
    },
    [onSelect],
  );

  const handleCustomSubmit = useCallback(() => {
    if (!customValue) {
      setError('Please select a date and time');
      return;
    }
    const parsed = new Date(customValue);
    if (isNaN(parsed.getTime())) {
      setError('Invalid date');
      return;
    }
    if (isBefore(parsed, new Date())) {
      setError('Must be in the future');
      return;
    }
    onSelect(parsed.toISOString());
  }, [customValue, onSelect]);

  const presets = getPresets();

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Snooze picker"
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-xs mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-foreground">Snooze until...</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Presets */}
        <div className="px-2 pb-2">
          {presets.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={preset.label}
                onClick={() => handlePresetClick(preset.getTime)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-accent transition-colors text-left"
              >
                <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">{preset.label}</span>
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {preset.description}
                </span>
              </button>
            );
          })}
        </div>

        {/* Custom picker */}
        <div className="border-t border-border px-4 py-3">
          {showCustom ? (
            <div className="space-y-2">
              <input
                type="datetime-local"
                value={customValue}
                onChange={(e) => {
                  setCustomValue(e.target.value);
                  setError(null);
                }}
                min={new Date().toISOString().slice(0, 16)}
                className="w-full text-sm px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handleCustomSubmit}
                >
                  Snooze
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowCustom(false);
                    setError(null);
                  }}
                >
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCustom(true)}
              className="w-full flex items-center gap-3 px-1 py-1 rounded-lg hover:bg-accent transition-colors text-left"
            >
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-foreground">Pick date &amp; time</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
