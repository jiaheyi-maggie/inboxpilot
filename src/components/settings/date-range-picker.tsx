'use client';

import { Calendar } from 'lucide-react';

interface DateRangePickerProps {
  startDate: string | null;
  endDate: string | null;
  onStartChange: (date: string | null) => void;
  onEndChange: (date: string | null) => void;
}

export function DateRangePicker({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
}: DateRangePickerProps) {
  const hasRange = startDate || endDate;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-700">
            Date Range
          </span>
          <span className="text-xs text-slate-400">(optional)</span>
        </div>
        {hasRange && (
          <button
            onClick={() => {
              onStartChange(null);
              onEndChange(null);
            }}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            Clear
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">From</label>
          <input
            type="date"
            value={startDate ? startDate.split('T')[0] : ''}
            onChange={(e) =>
              onStartChange(
                e.target.value
                  ? new Date(e.target.value).toISOString()
                  : null
              )
            }
            className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">To</label>
          <input
            type="date"
            value={endDate ? endDate.split('T')[0] : ''}
            onChange={(e) =>
              onEndChange(
                e.target.value
                  ? new Date(e.target.value + 'T23:59:59').toISOString()
                  : null
              )
            }
            className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {!hasRange && (
        <p className="text-xs text-slate-400">
          Leave empty to organize all emails
        </p>
      )}
    </div>
  );
}
