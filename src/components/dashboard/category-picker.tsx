'use client';

import { useEffect, useRef } from 'react';
import { CATEGORIES } from '@/types';

interface CategoryPickerProps {
  onSelect: (category: string) => void;
  onClose: () => void;
  excludeCategory?: string;
}

export function CategoryPicker({ onSelect, onClose, excludeCategory }: CategoryPickerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape key + trap focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    // Focus the dialog on mount
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Move to category"
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[60vh] overflow-y-auto shadow-xl outline-none"
      >
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
