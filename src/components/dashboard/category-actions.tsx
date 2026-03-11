'use client';

import { useCallback, useState } from 'react';
import { MoreHorizontal, Trash2, Archive, ArrowRight, Loader2 } from 'lucide-react';
import { CategoryPicker } from './category-picker';

interface CategoryActionsProps {
  category: string;
  onActionComplete?: () => void;
}

export function CategoryActions({ category, onActionComplete }: CategoryActionsProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'trash' | 'archive' | null>(null);

  const handleAction = useCallback(
    async (action: 'trash' | 'archive', confirmed = false) => {
      if (!confirmed) {
        setConfirmAction(action);
        return;
      }

      setLoading(true);
      setConfirmAction(null);
      try {
        const res = await fetch('/api/emails/category-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, category }),
        });
        if (res.ok) {
          onActionComplete?.();
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
        setShowMenu(false);
      }
    },
    [category, onActionComplete]
  );

  const handleReassign = useCallback(
    async (newCategory: string) => {
      setLoading(true);
      setShowPicker(false);
      try {
        const res = await fetch('/api/emails/category-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reassign',
            category,
            newCategory,
          }),
        });
        if (res.ok) {
          onActionComplete?.();
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
        setShowMenu(false);
      }
    },
    [category, onActionComplete]
  );

  if (loading) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />;
  }

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowMenu(!showMenu);
          setConfirmAction(null);
        }}
        className="p-1 rounded hover:bg-slate-200 transition-colors"
      >
        <MoreHorizontal className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setShowMenu(false); setConfirmAction(null); }} />
          <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50">
            {confirmAction ? (
              <div className="px-3 py-2">
                <p className="text-xs text-slate-500 mb-2">
                  {confirmAction === 'trash' ? 'Trash' : 'Archive'} all emails in &ldquo;{category}&rdquo;?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAction(confirmAction, true); }}
                    className="flex-1 text-xs px-2 py-1.5 bg-red-50 text-red-600 rounded font-medium hover:bg-red-100"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmAction(null); }}
                    className="flex-1 text-xs px-2 py-1.5 bg-slate-50 text-slate-600 rounded hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); handleAction('trash'); }}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Trash all
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleAction('archive'); }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                >
                  <Archive className="h-3.5 w-3.5" />
                  Archive all
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    setShowPicker(true);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  Reassign all to...
                </button>
              </>
            )}
          </div>
        </>
      )}

      {showPicker && (
        <CategoryPicker
          onSelect={handleReassign}
          onClose={() => setShowPicker(false)}
          excludeCategory={category}
        />
      )}
    </div>
  );
}
