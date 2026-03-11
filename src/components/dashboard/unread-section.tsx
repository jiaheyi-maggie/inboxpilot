'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Inbox, Loader2, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
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
  const [actioningId, setActioningId] = useState<string | null>(null);
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

  const handleMarkRead = useCallback(
    async (emailId: string) => {
      setActioningId(emailId);
      setError(null);
      try {
        const res = await fetch(`/api/emails/${emailId}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark_read' }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? 'Failed to mark as read');
          return;
        }
        setEmails((prev) => prev.filter((e) => e.id !== emailId));
        onEmailRead?.();
      } catch {
        setError('Network error');
      } finally {
        setActioningId(null);
      }
    },
    [onEmailRead]
  );

  const handleCategorizeAll = useCallback(async () => {
    setCategorizingAll(true);
    setError(null);
    let failCount = 0;
    const snapshot = [...emails];
    try {
      for (const email of snapshot) {
        const res = await fetch(`/api/emails/${email.id}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark_read' }),
        });
        if (res.ok) {
          setEmails((prev) => prev.filter((e) => e.id !== email.id));
        } else {
          failCount++;
        }
      }
      if (failCount > 0) {
        setError(`${failCount} email(s) failed to categorize`);
      }
      onEmailRead?.();
    } catch {
      setError('Network error during categorization');
      // Re-fetch to get accurate state
      fetchUnread();
    } finally {
      setCategorizingAll(false);
    }
  }, [emails, onEmailRead, fetchUnread]);

  if (loading) return null;
  if (emails.length === 0 && !error) return null;

  return (
    <div className="border-b border-slate-200 bg-blue-50/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-blue-50/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-blue-600" />
          ) : (
            <ChevronRight className="h-4 w-4 text-blue-600" />
          )}
          <Inbox className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold text-blue-800">Unread</span>
          {emails.length > 0 && (
            <Badge variant="category" className="bg-blue-100 text-blue-700 border-blue-200">
              {emails.length}
            </Badge>
          )}
        </div>
        {expanded && emails.length > 1 && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-100 h-7 px-2"
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
            <p className="px-4 py-1.5 text-xs text-red-500">{error}</p>
          )}
          <div className="divide-y divide-blue-100/50">
            {emails.map((email) => (
              <div
                key={email.id}
                className="px-4 py-2.5 hover:bg-blue-50 transition-colors cursor-pointer"
                onClick={() => handleMarkRead(email.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 truncate">
                        {email.sender_name || email.sender_email || 'Unknown'}
                      </span>
                      <span className="text-xs text-slate-400 ml-auto flex-shrink-0">
                        {email.received_at
                          ? format(new Date(email.received_at), 'MMM d')
                          : ''}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-800 truncate mt-0.5">
                      {email.subject || '(no subject)'}
                    </p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">
                      {email.snippet}
                    </p>
                  </div>
                  {actioningId === email.id && (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-500 flex-shrink-0 mt-1" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
