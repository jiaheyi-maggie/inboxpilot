'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  SkipForward,
  Star,
  Clock,
  ExternalLink,
  CheckCircle2,
  HelpCircle,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CategoryBadge } from './category-badge';
import { FocusCard } from './focus-card';
import { SnoozePicker } from './snooze-picker';
import { showUndoToast } from '@/lib/undo-toast';
import { shouldBundle } from './email-bundle';
import type { EmailWithCategory } from '@/types';

// ── Props ──

interface FocusViewProps {
  emails: EmailWithCategory[];
  /** Called when an email is archived or starred (triggers sidebar/content refresh) */
  onEmailMoved: (emailId?: string) => void;
  /** Called when the user taps a card to open the email detail */
  onSelectEmail: (emailId: string) => void;
  /** Map of gmail_account_id -> hex color */
  accountColorMap?: Map<string, string>;
  /** Whether to show account color dots */
  showAccountDot?: boolean;
}

export function FocusView({
  emails,
  onEmailMoved,
  onSelectEmail,
  accountColorMap,
  showAccountDot,
}: FocusViewProps) {
  // Separate bundled emails from focus-worthy emails.
  // Bundled categories (newsletters, promotions, etc.) are pulled out of the
  // card stack and presented as a single digest card per category at the end.
  // Also filters out emails older than 30 days — Focus mode is for current inbox triage.
  const { focusEmails, bundleDigests } = useMemo(() => {
    const FOCUS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const cutoff = Date.now() - FOCUS_MAX_AGE_MS;

    // Group by category, excluding old emails
    const byCat = new Map<string, EmailWithCategory[]>();
    const noCat: EmailWithCategory[] = [];
    for (const email of emails) {
      // Skip emails older than 30 days — nobody wants to triage ancient mail
      if (new Date(email.received_at).getTime() < cutoff) continue;

      if (!email.category) {
        noCat.push(email);
        continue;
      }
      const list = byCat.get(email.category);
      if (list) list.push(email);
      else byCat.set(email.category, [email]);
    }

    const focus: EmailWithCategory[] = [...noCat];
    const digests: { category: string; emails: EmailWithCategory[] }[] = [];

    for (const [category, catEmails] of byCat) {
      const withScore = catEmails.filter((e) => e.importance_score !== null);
      const avgImportance =
        withScore.length > 0
          ? withScore.reduce((sum, e) => sum + (e.importance_score ?? 0), 0) / withScore.length
          : null;

      if (shouldBundle(category, catEmails.length, avgImportance)) {
        digests.push({ category, emails: catEmails });
      } else {
        focus.push(...catEmails);
      }
    }

    return { focusEmails: focus, bundleDigests: digests };
  }, [emails]);

  // Smart sort: blended score of importance x recency
  // A "high" email from 5 minutes ago beats a "critical" email from 2 weeks ago.
  // Formula: focusScore = importance_score * recencyWeight
  // recencyWeight decays from 1.0 (just arrived) to 0.1 (7+ days old) using exponential decay
  const sortedEmails = useMemo(() => {
    const now = Date.now();
    const DAY_MS = 86400000;

    function focusScore(email: EmailWithCategory): number {
      const importance = email.importance_score ?? 3; // 1-5, higher = more important
      const ageMs = now - new Date(email.received_at).getTime();
      const ageDays = ageMs / DAY_MS;
      // Exponential decay: half-life of 2 days
      // 0 days -> 1.0, 1 day -> 0.71, 2 days -> 0.5, 4 days -> 0.25, 7 days -> 0.09
      const recency = Math.max(0.05, Math.exp(-0.347 * ageDays));
      // Unread emails get a 1.5x boost
      const unreadBoost = email.is_read ? 1.0 : 1.5;
      return importance * recency * unreadBoost;
    }

    return [...focusEmails].sort((a, b) => {
      return focusScore(b) - focusScore(a);
    });
  }, [focusEmails]);

  // Track which emails have been processed (archived, starred, snoozed, or skipped)
  const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);

  // The queue is sorted emails minus processed ones
  const queue = useMemo(() => {
    return sortedEmails.filter((e) => !processedIds.has(e.id));
  }, [sortedEmails, processedIds]);

  const currentEmail = queue[0] ?? null;
  const nextEmail = queue[1] ?? null;

  // Total = focus emails only (bundles are separate), progress = how many we've processed
  const totalCount = sortedEmails.length;
  const processedCount = processedIds.size;
  const progressPercent = totalCount > 0 ? (processedCount / totalCount) * 100 : 0;
  const totalBundledCount = bundleDigests.reduce((sum, d) => sum + d.emails.length, 0);

  // Reset processed IDs when the email set changes (e.g., different category/account selected)
  const emailIdsKey = useMemo(() => emails.map((e) => e.id).sort().join(','), [emails]);
  const prevEmailIdsKeyRef = useRef(emailIdsKey);
  useEffect(() => {
    if (emailIdsKey !== prevEmailIdsKeyRef.current) {
      prevEmailIdsKeyRef.current = emailIdsKey;
      setProcessedIds(new Set());
      setArchivedBundles(new Set());
    }
  }, [emailIdsKey]);

  // ── Action handlers ──

  const executeAction = useCallback(
    async (emailId: string, action: 'archive' | 'star') => {
      setActionLoading(true);
      try {
        const res = await fetch(`/api/emails/${emailId}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? `Action failed (${res.status})`);
          return false;
        }
        return true;
      } catch {
        toast.error('Network error');
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    []
  );

  const handleArchive = useCallback(async () => {
    if (!currentEmail || actionLoading) return;
    // Optimistic: immediately advance to next card so there's no flash-back
    const emailId = currentEmail.id;
    const emailSubject = currentEmail.subject;
    setProcessedIds((prev) => new Set(prev).add(emailId));
    const success = await executeAction(emailId, 'archive');
    if (success) {
      showUndoToast({
        label: 'Archived',
        description: emailSubject || '(no subject)',
        onUndo: async () => {
          const res = await fetch(`/api/emails/${emailId}/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'unarchive' }),
          });
          if (!res.ok) throw new Error('Undo failed');
        },
        onUndoComplete: () => {
          setProcessedIds((prev) => {
            const next = new Set(prev);
            next.delete(emailId);
            return next;
          });
          onEmailMoved(emailId);
        },
      });
      onEmailMoved(emailId);
    } else {
      // Roll back: remove from processed so user can retry
      setProcessedIds((prev) => {
        const next = new Set(prev);
        next.delete(emailId);
        return next;
      });
    }
  }, [currentEmail, actionLoading, executeAction, onEmailMoved]);

  const handleStar = useCallback(async () => {
    if (!currentEmail || actionLoading) return;
    // Optimistic: immediately advance to next card so there's no flash-back
    const emailId = currentEmail.id;
    const emailSubject = currentEmail.subject;
    setProcessedIds((prev) => new Set(prev).add(emailId));
    const success = await executeAction(emailId, 'star');
    if (success) {
      showUndoToast({
        label: 'Starred',
        description: emailSubject || '(no subject)',
        onUndo: async () => {
          const res = await fetch(`/api/emails/${emailId}/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'unstar' }),
          });
          if (!res.ok) throw new Error('Undo failed');
        },
        onUndoComplete: () => {
          setProcessedIds((prev) => {
            const next = new Set(prev);
            next.delete(emailId);
            return next;
          });
          onEmailMoved(emailId);
        },
      });
      onEmailMoved(emailId);
    } else {
      // Roll back: remove from processed so user can retry
      setProcessedIds((prev) => {
        const next = new Set(prev);
        next.delete(emailId);
        return next;
      });
    }
  }, [currentEmail, actionLoading, executeAction, onEmailMoved]);

  const handleSkip = useCallback(() => {
    if (!currentEmail || actionLoading) return;
    // Move to end of queue — just mark as processed
    setProcessedIds((prev) => new Set(prev).add(currentEmail.id));
  }, [currentEmail, actionLoading]);

  const handleOpen = useCallback(() => {
    if (!currentEmail) return;
    onSelectEmail(currentEmail.id);
  }, [currentEmail, onSelectEmail]);

  const handleSnooze = useCallback(
    async (until: string) => {
      setShowSnooze(false);
      if (!currentEmail || actionLoading) return;
      const emailId = currentEmail.id;
      const emailSubject = currentEmail.subject;
      setProcessedIds((prev) => new Set(prev).add(emailId));
      setActionLoading(true);
      try {
        const res = await fetch(`/api/emails/${emailId}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'snooze', until }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? 'Snooze failed');
          setProcessedIds((prev) => {
            const next = new Set(prev);
            next.delete(emailId);
            return next;
          });
          return;
        }
        const snoozeDate = new Date(until);
        const label = `Snoozed until ${snoozeDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${snoozeDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
        showUndoToast({
          label,
          description: emailSubject || '(no subject)',
          onUndo: async () => {
            const res = await fetch(`/api/emails/${emailId}/actions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'unsnooze' }),
            });
            if (!res.ok) throw new Error('Undo failed');
          },
          onUndoComplete: () => {
            setProcessedIds((prev) => {
              const next = new Set(prev);
              next.delete(emailId);
              return next;
            });
            onEmailMoved(emailId);
          },
        });
        onEmailMoved(emailId);
      } catch {
        toast.error('Network error');
        setProcessedIds((prev) => {
          const next = new Set(prev);
          next.delete(emailId);
          return next;
        });
      } finally {
        setActionLoading(false);
      }
    },
    [currentEmail, actionLoading, onEmailMoved],
  );

  // ── Bundle digest archive handler ──

  const [bundleArchiving, setBundleArchiving] = useState<string | null>(null);
  const [archivedBundles, setArchivedBundles] = useState<Set<string>>(new Set());

  const handleArchiveBundle = useCallback(
    async (category: string, bundleEmails: EmailWithCategory[]) => {
      if (bundleArchiving) return;
      setBundleArchiving(category);
      try {
        const emailIds = bundleEmails.map((e) => e.id);
        const res = await fetch('/api/emails/tree-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'archive', emailIds }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? 'Archive failed');
          return;
        }
        setArchivedBundles((prev) => new Set(prev).add(category));
        showUndoToast({
          label: `Archived ${bundleEmails.length} ${category} emails`,
          onUndo: async () => {
            const undoRes = await fetch('/api/emails/tree-actions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'unarchive', emailIds }),
            });
            if (!undoRes.ok) throw new Error('Undo failed');
          },
          onUndoComplete: () => {
            setArchivedBundles((prev) => {
              const next = new Set(prev);
              next.delete(category);
              return next;
            });
            // Pass first email ID for Realtime suppression; bulk ops are less
            // sensitive but still benefit from suppressing the first UPDATE.
            onEmailMoved(emailIds[0]);
          },
        });
        onEmailMoved(emailIds[0]);
      } catch {
        toast.error('Network error');
      } finally {
        setBundleArchiving(null);
      }
    },
    [bundleArchiving, onEmailMoved],
  );

  const activeBundleDigests = bundleDigests.filter((d) => !archivedBundles.has(d.category));

  // ── Keyboard shortcuts ──

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      switch (e.key) {
        case 'ArrowRight':
        case 'e':
          e.preventDefault();
          handleArchive();
          break;
        case 'ArrowLeft':
        case 's':
          e.preventDefault();
          handleSkip();
          break;
        case 'ArrowUp':
        case 'f':
          e.preventDefault();
          handleStar();
          break;
        case 'z':
          e.preventDefault();
          setShowSnooze(true);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          handleOpen();
          break;
        case '?':
          e.preventDefault();
          setShowHelp((prev) => !prev);
          break;
        case 'Escape':
          if (showHelp) {
            e.preventDefault();
            setShowHelp(false);
          }
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleArchive, handleSkip, handleStar, handleOpen, showHelp]);

  // ── Bundle digest section (shown in empty/caught-up states and after all cards) ──

  const bundleDigestSection = activeBundleDigests.length > 0 ? (
    <div className="w-full max-w-lg mx-auto mt-6 space-y-3">
      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium px-1">
        Bundled emails
      </p>
      {activeBundleDigests.map((digest) => (
        <div
          key={digest.category}
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-border bg-card"
        >
          <div className="flex items-center gap-3 min-w-0">
            <CategoryBadge category={digest.category} />
            <span className="text-sm text-muted-foreground">
              {digest.emails.length} email{digest.emails.length !== 1 ? 's' : ''}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0 gap-1.5"
            onClick={() => handleArchiveBundle(digest.category, digest.emails)}
            disabled={bundleArchiving === digest.category}
          >
            {bundleArchiving === digest.category ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
            Archive All
          </Button>
        </div>
      ))}
    </div>
  ) : null;

  // ── Empty state ──

  if (totalCount === 0 && totalBundledCount === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
          <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">No emails to review</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          Select a category or sync new emails to get started.
        </p>
      </div>
    );
  }

  // No focus-worthy emails, but there are bundles
  if (totalCount === 0 && totalBundledCount > 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
          <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">No important emails to review</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          You have {totalBundledCount} bundled email{totalBundledCount !== 1 ? 's' : ''} you can archive in bulk.
        </p>
        {bundleDigestSection}
      </div>
    );
  }

  // All focus emails processed — show inbox zero + any remaining bundles
  if (queue.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
          <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">All caught up!</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          You&apos;ve processed all {totalCount} email{totalCount !== 1 ? 's' : ''}. Nice work.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => setProcessedIds(new Set())}
        >
          Review again
        </Button>
        {bundleDigestSection}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Progress bar */}
      <div className="px-4 pt-3 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
          <span>
            {processedCount + 1} of {totalCount} email{totalCount !== 1 ? 's' : ''}
            {totalBundledCount > 0 && (
              <span className="text-muted-foreground/60 ml-1">
                ({totalBundledCount} bundled)
              </span>
            )}
          </span>
          <button
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            <span>Shortcuts</span>
          </button>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Card stack area */}
      <div className="flex-1 min-h-0 px-4 pb-2 flex items-center justify-center">
        <div className="relative w-full max-w-lg" style={{ height: 'min(420px, 60vh)' }}>
          {/* Peek card (next email behind current) */}
          {nextEmail && (
            <FocusCard
              key={nextEmail.id + '-peek'}
              email={nextEmail}
              onSwipeRight={() => {}}
              onSwipeLeft={() => {}}
              onSwipeUp={() => {}}
              onTap={() => {}}
              accountColor={showAccountDot ? accountColorMap?.get(nextEmail.gmail_account_id) : undefined}
              isPeek
            />
          )}

          {/* Current card */}
          {currentEmail && (
            <FocusCard
              key={currentEmail.id}
              email={currentEmail}
              onSwipeRight={handleArchive}
              onSwipeLeft={handleSkip}
              onSwipeUp={handleStar}
              onTap={handleOpen}
              accountColor={showAccountDot ? accountColorMap?.get(currentEmail.gmail_account_id) : undefined}
            />
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-4 flex-shrink-0">
        <div className="flex items-center justify-center gap-2 max-w-lg mx-auto">
          <Button
            variant="outline"
            size="lg"
            className="flex-1 gap-2"
            onClick={handleSkip}
            disabled={actionLoading}
          >
            <SkipForward className="h-4 w-4" />
            Skip
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="flex-1 gap-2"
            onClick={handleArchive}
            disabled={actionLoading}
          >
            <Archive className="h-4 w-4" />
            Archive
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="flex-1 gap-2"
            onClick={() => setShowSnooze(true)}
            disabled={actionLoading}
          >
            <Clock className="h-4 w-4" />
            Snooze
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="flex-1 gap-2"
            onClick={handleStar}
            disabled={actionLoading}
          >
            <Star className="h-4 w-4" />
            Star
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="flex-1 gap-2"
            onClick={handleOpen}
            disabled={actionLoading}
          >
            <ExternalLink className="h-4 w-4" />
            Open
          </Button>
        </div>
        {/* Swipe hints (mobile) */}
        <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-muted-foreground/60 sm:hidden">
          <span>Swipe right: Archive</span>
          <span>Swipe left: Skip</span>
          <span>Swipe up: Star</span>
        </div>
      </div>

      {/* Snooze picker modal */}
      {showSnooze && (
        <SnoozePicker
          onSelect={handleSnooze}
          onClose={() => setShowSnooze(false)}
        />
      )}

      {/* Keyboard shortcuts help overlay */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowHelp(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-card border border-border rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">Keyboard shortcuts</h3>
              <button
                onClick={() => setShowHelp(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              {[
                { keys: ['Right arrow', 'E'], action: 'Archive' },
                { keys: ['Left arrow', 'S'], action: 'Skip' },
                { keys: ['Up arrow', 'F'], action: 'Star' },
                { keys: ['Z'], action: 'Snooze' },
                { keys: ['Enter', 'Space'], action: 'Open email' },
                { keys: ['?'], action: 'Toggle this help' },
                { keys: ['Esc'], action: 'Close help' },
              ].map(({ keys, action }) => (
                <div key={action} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{action}</span>
                  <div className="flex items-center gap-1">
                    {keys.map((key) => (
                      <kbd
                        key={key}
                        className="px-1.5 py-0.5 text-xs bg-muted border border-border rounded font-mono"
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
