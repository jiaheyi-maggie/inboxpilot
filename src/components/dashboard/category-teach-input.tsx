'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GraduationCap, Loader2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CategoryTeachInputProps {
  /** Database ID of the user_categories row */
  categoryId: string;
  /** Current description (may be null) */
  currentDescription: string | null;
  /** Called after a successful save so parent can update local state */
  onSaved?: (newDescription: string) => void;
  /** Notify parent of expand/collapse so it can adjust layout */
  onExpandChange?: (expanded: boolean) => void;
  /** Start in expanded state (used when parent renders the expanded form separately) */
  startExpanded?: boolean;
}

export function CategoryTeachInput({
  categoryId,
  currentDescription,
  onSaved,
  onExpandChange,
  startExpanded = false,
}: CategoryTeachInputProps) {
  const [expanded, setExpanded] = useState(startExpanded);
  const [value, setValue] = useState(currentDescription ?? '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sync from prop when it changes externally
  useEffect(() => {
    setValue(currentDescription ?? '');
  }, [currentDescription]);

  // Focus input when expanding
  useEffect(() => {
    if (expanded) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [expanded]);

  const setExpandedAndNotify = useCallback(
    (val: boolean) => {
      setExpanded(val);
      onExpandChange?.(val);
    },
    [onExpandChange]
  );

  const handleSave = useCallback(async () => {
    const trimmed = value.trim();

    // Don't save if unchanged
    if (trimmed === (currentDescription ?? '')) {
      setExpandedAndNotify(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/categories/${categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: trimmed || null }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to save');
        return;
      }

      toast.success('Category description updated');
      onSaved?.(trimmed);
      setExpandedAndNotify(false);
    } catch {
      toast.error('Failed to save description');
    } finally {
      setSaving(false);
    }
  }, [categoryId, value, currentDescription, onSaved, setExpandedAndNotify]);

  const handleCancel = useCallback(() => {
    setValue(currentDescription ?? '');
    setExpandedAndNotify(false);
  }, [currentDescription, setExpandedAndNotify]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      }
      if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  // Collapsed: show only the teach icon
  if (!expanded) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setExpandedAndNotify(true);
        }}
        className="p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent transition-colors flex-shrink-0"
        title="Teach InboxPilot about this category"
      >
        <GraduationCap className="h-3 w-3" />
      </button>
    );
  }

  // Expanded: show the textarea form
  return (
    <div
      className="w-full space-y-1"
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Teach InboxPilot about this category..."
        maxLength={200}
        rows={2}
        disabled={saving}
        className={cn(
          'w-full text-xs bg-muted/50 border border-border rounded-md px-2 py-1.5',
          'placeholder:text-muted-foreground/60 resize-none outline-none',
          'focus:ring-1 focus:ring-ring',
          'disabled:opacity-50'
        )}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/60">
          {value.length}/200
        </span>
        <div className="flex gap-1">
          <button
            onClick={handleCancel}
            disabled={saving}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            title="Cancel"
          >
            <X className="h-3 w-3" />
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-0.5 rounded text-primary hover:text-primary/80 hover:bg-primary/10 transition-colors disabled:opacity-50"
            title="Save"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
