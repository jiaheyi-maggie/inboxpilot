'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  Paperclip,
  Star,
  MoreHorizontal,
  Mail,
  MailOpen,
  Archive,
  Trash2,
  ArrowRight,
  Loader2,
  ChevronsUp,
  ChevronUp,
  ChevronDown,
  ChevronsDown,
  Zap,
  RotateCcw,
  CheckSquare,
  Square,
  X,
  MinusSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CategoryBadge } from './category-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CategoryPicker } from './category-picker';
import { EmailDetail } from './email-detail';
import { QuickRuleDialog } from '@/components/workflows/quick-rule-dialog';
import type { EmailWithCategory, EmailAction, SystemGroupKey } from '@/types';

interface EmailListProps {
  emails: EmailWithCategory[];
  /** Called when an email is structurally moved (archive, trash, reassign category) — triggers tree refresh */
  onEmailMoved?: () => void;
  /** When set, updates that invalidate group membership are treated as removals (e.g. unstar in Starred group) */
  systemGroup?: SystemGroupKey | null;
}

export function EmailList({ emails, onEmailMoved, systemGroup }: EmailListProps) {
  const [localEmails, setLocalEmails] = useState(emails);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Sync local state when parent emails prop changes
  useEffect(() => {
    setLocalEmails(emails);
    // Clear stale checked IDs when emails change
    setCheckedIds((prev) => {
      const validIds = new Set(emails.map((e) => e.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [emails]);

  const toggleChecked = useCallback((emailId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(emailId)) next.delete(emailId);
      else next.add(emailId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setCheckedIds((prev) =>
      prev.size === localEmails.length
        ? new Set()
        : new Set(localEmails.map((e) => e.id))
    );
  }, [localEmails]);

  const clearChecked = useCallback(() => setCheckedIds(new Set()), []);

  const executeBulkAction = useCallback(
    async (action: EmailAction) => {
      if (checkedIds.size === 0) return;
      setBulkLoading(true);
      try {
        const res = await fetch('/api/emails/tree-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            emailIds: [...checkedIds],
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? `Bulk action failed (${res.status})`);
          return;
        }
        const count = checkedIds.size;
        switch (action) {
          case 'trash':
            toast.success(`Trashed ${count} email${count > 1 ? 's' : ''}`);
            setLocalEmails((prev) => prev.filter((e) => !checkedIds.has(e.id)));
            onEmailMoved?.();
            break;
          case 'archive':
            toast.success(`Archived ${count} email${count > 1 ? 's' : ''}`);
            setLocalEmails((prev) => prev.filter((e) => !checkedIds.has(e.id)));
            onEmailMoved?.();
            break;
          case 'star':
            toast.success(`Starred ${count} email${count > 1 ? 's' : ''}`);
            setLocalEmails((prev) => prev.map((e) => checkedIds.has(e.id) ? { ...e, is_starred: true } : e));
            onEmailMoved?.();
            break;
          case 'unstar':
            toast.success(`Unstarred ${count} email${count > 1 ? 's' : ''}`);
            setLocalEmails((prev) => prev.map((e) => checkedIds.has(e.id) ? { ...e, is_starred: false } : e));
            if (systemGroup === 'starred') {
              setLocalEmails((prev) => prev.filter((e) => !checkedIds.has(e.id)));
            }
            onEmailMoved?.();
            break;
          case 'mark_read':
            toast.success(`Marked ${count} as read`);
            setLocalEmails((prev) => prev.map((e) => checkedIds.has(e.id) ? { ...e, is_read: true } : e));
            onEmailMoved?.();
            break;
          case 'mark_unread':
            toast.success(`Marked ${count} as unread`);
            setLocalEmails((prev) => prev.map((e) => checkedIds.has(e.id) ? { ...e, is_read: false } : e));
            onEmailMoved?.();
            break;
        }
        setCheckedIds(new Set());
      } catch {
        toast.error('Network error during bulk action');
      } finally {
        setBulkLoading(false);
      }
    },
    [checkedIds, onEmailMoved, systemGroup]
  );

  // Structural removal (archive, trash) — update local state + notify tree
  const handleEmailRemoved = useCallback(
    (emailId: string) => {
      setLocalEmails((prev) => prev.filter((e) => e.id !== emailId));
      if (selectedEmailId === emailId) setSelectedEmailId(null);
      onEmailMoved?.();
    },
    [onEmailMoved, selectedEmailId]
  );

  // Non-structural update (star, mark_read) — local state only, no tree refresh.
  // Exceptions:
  //   1. If the update invalidates system group membership (e.g. unstar in Starred group),
  //      treat it as a removal so the email disappears from the filtered list.
  //   2. If is_read changed, refresh unread section (mark_unread should show in unread).
  const handleEmailUpdated = useCallback(
    (emailId: string, updates: Partial<EmailWithCategory>) => {
      const invalidatesGroup =
        (systemGroup === 'starred' && updates.is_starred === false);

      if (invalidatesGroup) {
        setLocalEmails((prev) => prev.filter((e) => e.id !== emailId));
        setSelectedEmailId((current) => current === emailId ? null : current);
        onEmailMoved?.();
      } else {
        setLocalEmails((prev) =>
          prev.map((e) => (e.id === emailId ? { ...e, ...updates } : e))
        );
        // is_read/is_starred changes affect system groups — trigger refresh
        if ('is_read' in updates || 'is_starred' in updates) {
          onEmailMoved?.();
        }
      }
    },
    [systemGroup, onEmailMoved]
  );

  // Category change — structural, triggers tree refresh
  const handleCategoryChanged = useCallback(
    (emailId: string, category: string) => {
      setLocalEmails((prev) =>
        prev.map((e) => (e.id === emailId ? { ...e, category } : e))
      );
      onEmailMoved?.();
    },
    [onEmailMoved]
  );

  const selectedEmail = selectedEmailId
    ? localEmails.find((e) => e.id === selectedEmailId) ?? null
    : null;

  if (selectedEmail) {
    return (
      <EmailDetail
        email={selectedEmail}
        onBack={() => setSelectedEmailId(null)}
        onRemoved={handleEmailRemoved}
        onUpdated={handleEmailUpdated}
        onCategoryChanged={handleCategoryChanged}
      />
    );
  }

  if (localEmails.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No emails in this group
      </div>
    );
  }

  const hasChecked = checkedIds.size > 0;
  const allChecked = checkedIds.size === localEmails.length && localEmails.length > 0;

  return (
    <div>
      {/* Bulk action bar — appears when any emails are checked */}
      {hasChecked && (
        <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-primary/5 border-b border-border backdrop-blur-sm">
          <button
            onClick={toggleAll}
            className="p-0.5 hover:bg-accent rounded transition-colors"
            title={allChecked ? 'Deselect all' : 'Select all'}
          >
            {allChecked ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : (
              <MinusSquare className="h-4 w-4 text-primary" />
            )}
          </button>
          <span className="text-xs font-medium text-foreground">
            {checkedIds.size} selected
          </span>
          <div className="flex items-center gap-1 ml-2">
            {bulkLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => executeBulkAction('archive')}>
                  <Archive className="h-3.5 w-3.5" />
                  Archive
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => executeBulkAction('trash')}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Trash
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => executeBulkAction('star')}>
                  <Star className="h-3.5 w-3.5" />
                  Star
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => executeBulkAction('mark_read')}>
                  <MailOpen className="h-3.5 w-3.5" />
                  Read
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => executeBulkAction('mark_unread')}>
                  <Mail className="h-3.5 w-3.5" />
                  Unread
                </Button>
              </>
            )}
          </div>
          <button
            onClick={clearChecked}
            className="ml-auto p-1 hover:bg-accent rounded transition-colors"
            title="Clear selection"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      )}

      <div className="divide-y divide-border">
        {localEmails.map((email) => (
          <EmailRow
            key={email.id}
            email={email}
            checked={checkedIds.has(email.id)}
            onToggleChecked={() => toggleChecked(email.id)}
            onSelect={() => setSelectedEmailId(email.id)}
            onRemoved={handleEmailRemoved}
            onUpdated={handleEmailUpdated}
            onCategoryChanged={handleCategoryChanged}
          />
        ))}
      </div>
    </div>
  );
}

function EmailRow({
  email,
  checked,
  onToggleChecked,
  onSelect,
  onRemoved,
  onUpdated,
  onCategoryChanged,
}: {
  email: EmailWithCategory;
  checked: boolean;
  onToggleChecked: () => void;
  onSelect: () => void;
  onRemoved: (id: string) => void;
  onUpdated: (id: string, updates: Partial<EmailWithCategory>) => void;
  onCategoryChanged: (id: string, category: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [showRuleDialog, setShowRuleDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTrashed = email.label_ids?.includes('TRASH') ?? false;

  const date = email.received_at
    ? format(new Date(email.received_at), 'MMM d')
    : '';

  const executeAction = useCallback(
    async (action: EmailAction) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/emails/${email.id}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? `Action failed (${res.status})`);
          return;
        }
        switch (action) {
          case 'trash':
            setExiting(true);
            toast.success('Moved to trash');
            setTimeout(() => onRemoved(email.id), 300);
            break;
          case 'archive':
            setExiting(true);
            toast.success('Archived');
            setTimeout(() => onRemoved(email.id), 300);
            break;
          case 'star':
            onUpdated(email.id, { is_starred: true });
            break;
          case 'unstar':
            onUpdated(email.id, { is_starred: false });
            break;
          case 'mark_read':
            onUpdated(email.id, { is_read: true });
            break;
          case 'mark_unread':
            onUpdated(email.id, { is_read: false });
            break;
          case 'restore':
            setExiting(true);
            toast.success('Restored to inbox');
            setTimeout(() => onRemoved(email.id), 300);
            break;
        }
      } catch {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    },
    [email.id, onRemoved, onUpdated]
  );

  const handleCategoryChange = useCallback(
    async (category: string) => {
      setShowPicker(false);
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/emails/${email.id}/category`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? 'Failed to move email');
          return;
        }
        toast.success(`Moved to ${category}`, {
          description: email.subject || '(no subject)',
        });
        onCategoryChanged(email.id, category);
      } catch {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    },
    [email.id, email.subject, onCategoryChanged]
  );

  return (
    <>
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          exiting ? 'max-h-0 opacity-0 scale-y-95' : 'max-h-[800px] opacity-100'
        }`}
      >
        {/* Row: group for hover-reveal, relative for action overlay */}
        <div
          className={`group relative overflow-hidden cursor-pointer transition-colors
            ${!email.is_read
              ? 'bg-primary/8 border-l-[3px] border-l-primary'
              : 'hover:bg-accent/50 border-l-[3px] border-l-transparent'
            }
          `}
          onClick={onSelect}
        >
          <div className="px-4 py-3">
            <div className="flex items-start gap-3 min-w-0">
              {/* Checkbox */}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleChecked(); }}
                className="mt-0.5 p-0.5 flex-shrink-0 hover:bg-accent rounded transition-colors"
              >
                {checked ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Square className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                {/* Sender + date row */}
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm truncate ${
                      !email.is_read ? 'font-bold text-foreground' : 'font-normal text-muted-foreground'
                    }`}
                  >
                    {email.sender_name || email.sender_email || 'Unknown'}
                  </span>
                  <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                    {email.has_attachment && (
                      <Paperclip className="h-3 w-3 text-muted-foreground" />
                    )}
                    {email.is_starred && (
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    )}
                    <span className="text-xs text-muted-foreground">{date}</span>
                  </div>
                </div>

                {/* Subject */}
                <p
                  className={`text-sm mt-0.5 truncate ${
                    !email.is_read ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {email.subject || '(no subject)'}
                </p>

                {/* Snippet */}
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {email.snippet}
                </p>

                {/* Tags */}
                <div className="flex items-center gap-1.5 mt-1.5">
                  {email.category && (
                    <CategoryBadge category={email.category} />
                  )}
                  {email.importance_label === 'critical' && (
                    <Badge variant="critical" title="AI-assigned importance"><ChevronsUp className="h-3 w-3" /> Critical</Badge>
                  )}
                  {email.importance_label === 'high' && (
                    <Badge variant="high" title="AI-assigned importance"><ChevronUp className="h-3 w-3" /> High</Badge>
                  )}
                  {email.importance_label === 'low' && (
                    <Badge variant="low" title="AI-assigned importance"><ChevronDown className="h-3 w-3" /> Low</Badge>
                  )}
                  {email.importance_label === 'noise' && (
                    <Badge variant="noise" title="AI-assigned importance"><ChevronsDown className="h-3 w-3" /> Noise</Badge>
                  )}
                  {email.topic && (
                    <span className="text-xs text-muted-foreground">{email.topic}</span>
                  )}
                </div>

                {/* Error feedback */}
                {error && (
                  <p className="text-xs text-destructive mt-1">{error}</p>
                )}
              </div>
            </div>
          </div>

          {/* Hover-reveal action overlay */}
          <div
            className="absolute right-3 top-1/2 -translate-y-1/2
              flex items-center gap-1 px-2 py-1 rounded-lg
              bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm
              opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : isTrashed ? (
              <>
                <button
                  onClick={() => executeAction('restore')}
                  className="p-1 hover:bg-accent rounded transition-colors"
                  title="Restore to inbox"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => executeAction(email.is_starred ? 'unstar' : 'star')}
                  className="p-1 hover:bg-accent rounded transition-colors"
                  title={email.is_starred ? 'Unstar' : 'Star'}
                >
                  <Star
                    className={`h-3.5 w-3.5 ${
                      email.is_starred
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-muted-foreground'
                    }`}
                  />
                </button>
                <button
                  onClick={() => executeAction('archive')}
                  className="p-1 hover:bg-accent rounded transition-colors"
                  title="Archive"
                >
                  <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <button
                  onClick={() => executeAction('trash')}
                  className="p-1 hover:bg-accent rounded transition-colors"
                  title="Trash"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="p-1 hover:bg-accent rounded transition-colors">
                      <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={() =>
                        executeAction(email.is_read ? 'mark_unread' : 'mark_read')
                      }
                    >
                      {email.is_read ? (
                        <>
                          <Mail className="h-3.5 w-3.5" />
                          Mark as unread
                        </>
                      ) : (
                        <>
                          <MailOpen className="h-3.5 w-3.5" />
                          Mark as read
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setShowPicker(true)}>
                      <ArrowRight className="h-3.5 w-3.5" />
                      Move to...
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setShowRuleDialog(true)}>
                      <Zap className="h-3.5 w-3.5" />
                      Create rule...
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => executeAction('trash')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Trash
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>
      </div>

      {showPicker && (
        <CategoryPicker
          onSelect={handleCategoryChange}
          onClose={() => setShowPicker(false)}
          excludeCategory={email.category ?? undefined}
        />
      )}

      {showRuleDialog && (
        <QuickRuleDialog
          email={email}
          onClose={() => setShowRuleDialog(false)}
        />
      )}
    </>
  );
}
