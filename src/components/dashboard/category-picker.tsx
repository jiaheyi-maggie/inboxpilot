'use client';

import { CATEGORIES } from '@/types';

interface CategoryPickerProps {
  onSelect: (category: string) => void;
  onClose: () => void;
  excludeCategory?: string;
}

export function CategoryPicker({ onSelect, onClose, excludeCategory }: CategoryPickerProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[60vh] overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Move to category</h3>
        </div>
        <div className="p-2">
          {CATEGORIES.filter((c) => c !== excludeCategory).map((category) => (
            <button
              key={category}
              onClick={() => onSelect(category)}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {category}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
