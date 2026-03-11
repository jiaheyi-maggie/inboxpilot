'use client';

import { useCallback, useState } from 'react';
import { Plus, X, GripVertical, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LevelSelector } from './level-selector';
import { DateRangePicker } from './date-range-picker';
import { DIMENSIONS, getAvailableDimensions } from '@/lib/grouping/engine';
import type { DimensionKey, GroupingLevel } from '@/types';

interface GroupingBuilderProps {
  initialLevels: GroupingLevel[];
  initialDateStart: string | null;
  initialDateEnd: string | null;
  onSave: (config: {
    levels: GroupingLevel[];
    date_range_start: string | null;
    date_range_end: string | null;
  }) => Promise<void>;
}

const MAX_LEVELS = 5;

export function GroupingBuilder({
  initialLevels,
  initialDateStart,
  initialDateEnd,
  onSave,
}: GroupingBuilderProps) {
  const [levels, setLevels] = useState<GroupingLevel[]>(initialLevels);
  const [dateStart, setDateStart] = useState<string | null>(initialDateStart);
  const [dateEnd, setDateEnd] = useState<string | null>(initialDateEnd);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const selectedDimensions = levels.map((l) => l.dimension);

  const handleChangeDimension = useCallback(
    (index: number, dimensionKey: DimensionKey) => {
      setLevels((prev) => {
        const next = [...prev];
        next[index] = {
          dimension: dimensionKey,
          label: DIMENSIONS[dimensionKey].label,
        };
        return next;
      });
      setSaved(false);
    },
    []
  );

  const handleRemoveLevel = useCallback((index: number) => {
    setLevels((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  }, []);

  const handleAddLevel = useCallback(() => {
    const available = getAvailableDimensions(selectedDimensions);
    if (available.length === 0) return;
    setLevels((prev) => [
      ...prev,
      { dimension: available[0].key, label: available[0].label },
    ]);
    setSaved(false);
  }, [selectedDimensions]);

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    setLevels((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
    setSaved(false);
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setLevels((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave({
        levels,
        date_range_start: dateStart,
        date_range_end: dateEnd,
      });
      setSaved(true);
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  }, [levels, dateStart, dateEnd, onSave]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-slate-900 mb-1">
          Organize your inbox by
        </h3>
        <p className="text-sm text-slate-500">
          Choose how to group your emails, from broad to specific
        </p>
      </div>

      {/* Level list */}
      <div className="space-y-3">
        {levels.map((level, index) => (
          <div
            key={`${index}-${level.dimension}`}
            className="flex items-center gap-2 bg-slate-50 rounded-lg p-3"
          >
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => handleMoveUp(index)}
                disabled={index === 0}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-30 p-0.5"
                aria-label="Move up"
              >
                <svg width="12" height="8" viewBox="0 0 12 8">
                  <path
                    d="M6 0L12 8H0L6 0Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button
                onClick={() => handleMoveDown(index)}
                disabled={index === levels.length - 1}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-30 p-0.5"
                aria-label="Move down"
              >
                <svg width="12" height="8" viewBox="0 0 12 8">
                  <path
                    d="M6 8L0 0H12L6 8Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>

            <span className="text-xs text-slate-400 font-medium w-16">
              Level {index + 1}
            </span>

            <LevelSelector
              level={index}
              selected={level.dimension}
              availableDimensions={getAvailableDimensions(
                selectedDimensions.filter((_, i) => i !== index)
              )}
              onChange={(key) => handleChangeDimension(index, key)}
            />

            {levels.length > 1 && (
              <button
                onClick={() => handleRemoveLevel(index)}
                className="text-slate-400 hover:text-red-500 p-1"
                aria-label="Remove level"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add level button */}
      {levels.length < MAX_LEVELS &&
        getAvailableDimensions(selectedDimensions).length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddLevel}
            className="w-full"
          >
            <Plus className="h-4 w-4" />
            Add Level
          </Button>
        )}

      {/* Date range */}
      <div className="border-t border-slate-200 pt-4">
        <DateRangePicker
          startDate={dateStart}
          endDate={dateEnd}
          onStartChange={setDateStart}
          onEndChange={setDateEnd}
        />
      </div>

      {/* Save button */}
      <Button
        onClick={handleSave}
        disabled={saving || levels.length === 0}
        className="w-full"
      >
        <Save className="h-4 w-4" />
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save & Apply'}
      </Button>
    </div>
  );
}
