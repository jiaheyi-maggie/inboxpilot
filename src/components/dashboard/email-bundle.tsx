'use client';

import { useCallback, useState } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Loader2,
  Package,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CategoryBadge } from './category-badge';
import { showUndoToast } from '@/lib/undo-toast';
import type { EmailWithCategory } from '@/types';

// ── Constants ──

/** Minimum number of emails in a category to trigger bundling */
export const BUNDLE_MIN_COUNT = 3;

/** Categories that are auto-bundled regardless of importance score.
 *  Case-insensitive matching. */
export const BUNDLE_CATEGORIES = new Set([
  'newsletters',
  'promotions',
  'notifications',
  'social',
  'noise',
]);

/** Maximum average importance score for a category to be auto-bundled.
 *  Categories with avg importance_score <= this threshold are bundled
 *  even if they aren't in BUNDLE_CATEGORIES. */
export const BUNDLE_IMPORTANCE_THRESHOLD = 2.5;

// ── Helpers ──

/**
 * Determines whether a group of emails with the given category name
 * and average importance should be displayed as a bundle.
 *
 * Rules:
 * 1. Category must have >= BUNDLE_MIN_COUNT emails
 * 2. Either the category name is in BUNDLE_CATEGORIES, OR the average
 *    importance_score of the group is <= BUNDLE_IMPORTANCE_THRESHOLD
 */
export function shouldBundle(
  category: string,
  emailCount: number,
  avgImportance: number | null,
): boolean {
  if (emailCount < BUNDLE_MIN_COUNT) return false;
  if (BUNDLE_CATEGORIES.has(category.toLowerCase())) return true;
  if (avgImportance !== null && avgImportance <= BUNDLE_IMPORTANCE_THRESHOLD) return true;
  return false;
}

/**
 * Given a flat list of emails, partitions them into:
 * - `bundles`: groups of emails that should be bundled (keyed by category)
 * - `individual`: emails that should be rendered as normal rows
 *
 * Individual emails are sorted to appear before bundles.
 * Bundles are sorted by count descending (biggest bundle last).
 */
export function partitionIntoBundles(emails: EmailWithCategory[]): {
  individual: EmailWithCategory[];
  bundles: { category: string; emails: EmailWithCategory[] }[];
} {
  // Group by category
  const byCat = new Map<string, EmailWithCategory[]>();
  const uncategorized: EmailWithCategory[] = [];

  for (const email of emails) {
    if (!email.category) {
      uncategorized.push(email);
      continue;
    }
    const existing = byCat.get(email.category);
    if (existing) {
      existing.push(email);
    } else {
      byCat.set(email.category, [email]);
    }
  }

  const individual: EmailWithCategory[] = [...uncategorized];
  const bundles: { category: string; emails: EmailWithCategory[] }[] = [];

  for (const [category, catEmails] of byCat) {
    // Calculate average importance score for this group
    const withScore = catEmails.filter((e) => e.importance_score !== null);
    const avgImportance =
      withScore.length > 0
        ? withScore.reduce((sum, e) => sum + (e.importance_score ?? 0), 0) / withScore.length
        : null;

    if (shouldBundle(category, catEmails.length, avgImportance)) {
      bundles.push({ category, emails: catEmails });
    } else {
      individual.push(...catEmails);
    }
  }

  // Sort individual emails by received_at descending (newest first)
  individual.sort((a, b) => {
    const dateA = new Date(a.received_at).getTime();
    const dateB = new Date(b.received_at).getTime();
    return dateB - dateA;
  });

  // Sort bundles by count descending (largest bundle last, so important emails are on top)
  bundles.sort((a, b) => a.emails.length - b.emails.length);

  return { individual, bundles };
}

// ── Component ──

interface EmailBundleProps {
  category: string;
  emails: EmailWithCategory[];
  onArchiveAll: () => void;
  onEmailMoved: () => void;
  /** Render function for individual email rows inside the expanded bundle */
  renderEmailRow: (email: EmailWithCategory) => React.ReactNode;
  accountColorMap?: Map<string, string>;
  showAccountDot?: boolean;
}

export function EmailBundle({
  category,
  emails,
  onArchiveAll,
  onEmailMoved,
  renderEmailRow,
}: EmailBundleProps) {
  const [expanded, setExpanded] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archived, setArchived] = useState(false);

  const handleArchiveAll = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (archiving || emails.length === 0) return;

      setArchiving(true);
      try {
        const emailIds = emails.map((em) => em.id);
        const res = await fetch('/api/emails/tree-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'archive',
            emailIds,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? `Archive failed (${res.status})`);
          return;
        }

        // Animate the bundle out
        setArchived(true);

        showUndoToast({
          label: `Archived ${emails.length} ${category} emails`,
          onUndo: async () => {
            const undoRes = await fetch('/api/emails/tree-actions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'unarchive',
                emailIds,
              }),
            });
            if (!undoRes.ok) throw new Error('Undo failed');
          },
          onUndoComplete: () => {
            setArchived(false);
            onEmailMoved();
          },
        });

        // Notify parent after animation delay
        setTimeout(() => {
          onArchiveAll();
          onEmailMoved();
        }, 300);
      } catch {
        toast.error('Network error during archive');
      } finally {
        setArchiving(false);
      }
    },
    [archiving, emails, category, onArchiveAll, onEmailMoved],
  );

  const unreadCount = emails.filter((e) => !e.is_read).length;

  return (
    <div
      className={`transition-all duration-300 ease-in-out overflow-hidden ${
        archived ? 'max-h-0 opacity-0 scale-y-95' : 'max-h-[5000px] opacity-100'
      }`}
    >
      {/* Collapsed header row */}
      <div
        className="group cursor-pointer hover:bg-accent/50 transition-colors border-l-[3px] border-l-transparent"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Bundle icon */}
            <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
              <Package className="h-4 w-4 text-muted-foreground" />
            </div>

            {/* Category name + count */}
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <CategoryBadge category={category} />
              <span className="text-sm font-medium text-foreground">
                ({emails.length})
              </span>
              {unreadCount > 0 && (
                <span className="text-xs text-primary font-medium">
                  {unreadCount} unread
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleArchiveAll}
                disabled={archiving}
              >
                {archiving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Archive className="h-3.5 w-3.5" />
                )}
                Archive All
              </Button>
              <div className="p-1">
                {expanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded email list — animated with grid-rows trick */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-l-[3px] border-l-muted ml-0 divide-y divide-border bg-muted/20">
            {emails.map((email) => (
              <div key={email.id} className="pl-2">
                {renderEmailRow(email)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
