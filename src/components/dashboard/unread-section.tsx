'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Inbox,
  Loader2,
  MailOpen,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Email } from '@/types';

interface UnreadSectionProps {
  onEmailRead?: () => void;
  /** Increment to trigger a re-fetch (e.g. when emails change externally) */
  refreshKey?: number;
}

export function UnreadSection({ onEmailRead, refreshKey }: UnreadSectionProps) {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [categorizingAll, setCategorizingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/emails/unread');
      if (!res.ok) {
        setError('Failed to load unread emails');
        return;
      }
      const data = await res.json();
      setEmails(data.emails ?? []);
      setError(null);
    } catch {
      setError('Failed to load unread emails');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnread();
  }, [fetchUnread, refreshKey]);

  const handleCategorizeAll = useCallback(async () => {
    setCategorizingAll(true);
    setError(null);
    try {
      const res = await fetch('/api/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markRead: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Categorization failed');
        return;
      }
      const result = await res.json();
      if (result.pending > 0) {
        toast.success(`Categorizing ${result.pending} emails in background`);
      } else {
        toast.info('All emails already categorized');
      }
      // Refresh after a short delay to let background processing start
      setTimeout(() => {
        fetchUnread();
        onEmailRead?.();
      }, 1000);
    } catch {
      setError('Network error during categorization');
      fetchUnread();
    } finally {
      setCategorizingAll(false);
    }
  }, [onEmailRead, fetchUnread]);

  // Remove an email from the local list with animation
  const handleEmailProcessed = useCallback(
    (emailId: string) => {
      setEmails((prev) => prev.filter((e) => e.id !== emailId));
      onEmailRead?.();
    },
    [onEmailRead],
  );

  if (loading) return null;
  if (emails.length === 0 && !error) return null;

  return (
    <div className="border-b border-border bg-primary/5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-primary/8 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-primary" />
          ) : (
            <ChevronRight className="h-4 w-4 text-primary" />
          )}
          <Inbox className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Unread</span>
          {emails.length > 0 && (
            <Badge variant="category" className="bg-primary/10 text-primary border-primary/20">
              {emails.length}
            </Badge>
          )}
        </div>
        {expanded && emails.length > 1 && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-primary hover:text-primary hover:bg-primary/10 h-7 px-2"
            onClick={(e) => {
              e.stopPropagation();
              handleCategorizeAll();
            }}
            disabled={categorizingAll}
          >
            {categorizingAll ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1" />
            )}
            Categorize all
          </Button>
        )}
      </button>

      {expanded && (
        <>
          {error && (
            <p className="px-4 py-1.5 text-xs text-destructive">{error}</p>
          )}
          <div className="divide-y divide-border/50">
            {emails.map((email) => (
              <UnreadEmailCard
                key={email.id}
                email={email}
                disabled={categorizingAll}
                onProcessed={handleEmailProcessed}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// --- Individual email card with expand/categorize behavior ---

interface UnreadEmailCardProps {
  email: Email;
  disabled: boolean;
  onProcessed: (emailId: string) => void;
}

function UnreadEmailCard({ email, disabled, onProcessed }: UnreadEmailCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [exiting, setExiting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(() => {
    if (disabled || actioning) return;
    setIsOpen((prev) => !prev);
  }, [disabled, actioning]);

  const EXIT_ANIMATION_MS = 300;

  const markReadAndExit = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setActioning(true);
      try {
        const res = await fetch(`/api/emails/${email.id}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark_read' }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? 'Failed to process');
          return;
        }
        const data = await res.json();

        // Optimistic exit — don't wait for background categorization
        setExiting(true);

        if (data.category) {
          // Already categorized (was previously read+categorized)
          toast.success(`Moved to ${data.category}`, {
            description: email.subject || '(no subject)',
          });
        } else if (data.categorization_status === 'pending') {
          // Background categorization started
          toast.success('Marked as read — categorizing...', {
            description: email.subject || '(no subject)',
          });
        } else {
          toast.success('Marked as read');
        }

        // Wait for exit animation, then remove from list
        setTimeout(() => onProcessed(email.id), EXIT_ANIMATION_MS);
      } catch {
        toast.error('Network error');
      } finally {
        setActioning(false);
      }
    },
    [email.id, email.subject, onProcessed],
  );

  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${email.thread_id ?? email.gmail_message_id}`;

  return (
    <div
      ref={cardRef}
      className={`transition-all duration-300 ease-in-out overflow-hidden ${
        exiting ? 'max-h-0 opacity-0 scale-y-95' : 'max-h-[500px] opacity-100 scale-y-100'
      }`}
    >
      <div
        className={`transition-colors ${
          disabled || actioning
            ? 'opacity-60 pointer-events-none'
            : 'hover:bg-accent/50 cursor-pointer'
        } ${isOpen ? 'bg-accent/50' : ''}`}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        {/* Collapsed row */}
        <div className="px-4 py-2.5">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground truncate">
                  {email.sender_name || email.sender_email || 'Unknown'}
                </span>
                <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                  {email.received_at
                    ? format(new Date(email.received_at), 'MMM d, h:mm a')
                    : ''}
                </span>
              </div>
              <p className="text-sm font-medium text-foreground truncate mt-0.5">
                {email.subject || '(no subject)'}
              </p>
              {!isOpen && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {email.snippet}
                </p>
              )}
            </div>
            {actioning && (
              <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0 mt-1" />
            )}
          </div>
        </div>

        {/* Expanded details */}
        <div
          className={`grid transition-all duration-200 ease-in-out ${
            isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div className="px-4 pb-3 space-y-2">
              {/* Full snippet */}
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {email.snippet}
              </p>

              {/* Metadata row */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>From: {email.sender_email}</span>
                {email.has_attachment && <span>📎 Attachment</span>}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                  onClick={markReadAndExit}
                  disabled={actioning}
                >
                  {actioning ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <MailOpen className="h-3 w-3 mr-1" />
                  )}
                  Read & Categorize
                </Button>
                <a
                  href={gmailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 hover:underline ml-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open in Gmail
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
