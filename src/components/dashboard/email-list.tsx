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
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CategoryPicker } from './category-picker';
import type { EmailWithCategory, EmailAction } from '@/types';

interface EmailListProps {
  emails: EmailWithCategory[];
  onEmailUpdated?: () => void;
}

export function EmailList({ emails, onEmailUpdated }: EmailListProps) {
  const [localEmails, setLocalEmails] = useState(emails);

  // Sync local state when parent emails prop changes
  useEffect(() => {
    setLocalEmails(emails);
  }, [emails]);

  const handleEmailRemoved = useCallback(
    (emailId: string) => {
      setLocalEmails((prev) => prev.filter((e) => e.id !== emailId));
      onEmailUpdated?.();
    },
    [onEmailUpdated]
  );

  const handleEmailUpdated = useCallback(
    (emailId: string, updates: Partial<EmailWithCategory>) => {
      setLocalEmails((prev) =>
        prev.map((e) => (e.id === emailId ? { ...e, ...updates } : e))
      );
      onEmailUpdated?.();
    },
    [onEmailUpdated]
  );

  if (localEmails.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No emails in this group
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {localEmails.map((email) => (
        <EmailRow
          key={email.id}
          email={email}
          onRemoved={handleEmailRemoved}
          onUpdated={handleEmailUpdated}
        />
      ))}
    </div>
  );
}

function EmailRow({
  email,
  onRemoved,
  onUpdated,
}: {
  email: EmailWithCategory;
  onRemoved: (id: string) => void;
  onUpdated: (id: string, updates: Partial<EmailWithCategory>) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const date = email.received_at
    ? format(new Date(email.received_at), 'MMM d')
    : '';
  const fullDate = email.received_at
    ? format(new Date(email.received_at), 'MMM d, yyyy h:mm a')
    : '';

  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${email.gmail_message_id}`;

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
        onUpdated(email.id, { category });
      } catch {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    },
    [email.id, email.subject, onUpdated]
  );

  const handleStarClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      executeAction(email.is_starred ? 'unstar' : 'star');
    },
    [email.is_starred, executeAction]
  );

  return (
    <>
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          exiting ? 'max-h-0 opacity-0 scale-y-95' : 'max-h-[800px] opacity-100'
        }`}
      >
        <div
          className={`px-4 py-3 hover:bg-accent/50 transition-colors cursor-pointer ${
            !email.is_read ? 'bg-primary/5' : ''
          } ${isExpanded ? 'bg-accent/50' : ''}`}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {/* Sender + actions row */}
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm truncate ${
                    !email.is_read ? 'font-semibold text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {email.sender_name || email.sender_email || 'Unknown'}
                </span>
                <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                  {email.has_attachment && (
                    <Paperclip className="h-3 w-3 text-muted-foreground" />
                  )}
                  <button
                    onClick={handleStarClick}
                    className="p-0.5 hover:bg-accent rounded transition-colors"
                  >
                    <Star
                      className={`h-3.5 w-3.5 transition-colors ${
                        email.is_starred
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-muted-foreground/50 hover:text-muted-foreground'
                      }`}
                    />
                  </button>
                  <span className="text-xs text-muted-foreground">{date}</span>
                  {/* Action menu */}
                  <div className="relative">
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="p-0.5 hover:bg-accent rounded transition-colors"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              executeAction(email.is_read ? 'mark_unread' : 'mark_read');
                            }}
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
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              executeAction('archive');
                            }}
                          >
                            <Archive className="h-3.5 w-3.5" />
                            Archive
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              executeAction(email.is_starred ? 'unstar' : 'star');
                            }}
                          >
                            <Star className="h-3.5 w-3.5" />
                            {email.is_starred ? 'Unstar' : 'Star'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowPicker(true);
                            }}
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                            Move to...
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              executeAction('trash');
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Trash
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </div>

              {/* Subject */}
              <p
                className={`text-sm mt-0.5 ${isExpanded ? '' : 'truncate'} ${
                  !email.is_read ? 'font-medium text-foreground' : 'text-muted-foreground'
                }`}
              >
                {email.subject || '(no subject)'}
              </p>

              {/* Snippet */}
              <p className={`text-xs text-muted-foreground mt-0.5 ${isExpanded ? 'whitespace-pre-wrap' : 'truncate'}`}>
                {email.snippet}
              </p>

              {/* Tags */}
              <div className="flex items-center gap-1.5 mt-1.5">
                {email.category && (
                  <Badge variant="category">{email.category}</Badge>
                )}
                {email.priority === 'high' && (
                  <Badge variant="high">High</Badge>
                )}
                {email.priority === 'low' && (
                  <Badge variant="low">Low</Badge>
                )}
                {email.topic && (
                  <span className="text-xs text-muted-foreground">{email.topic}</span>
                )}
              </div>

              {/* Expanded details */}
              <div
                className={`grid transition-all duration-200 ease-in-out ${
                  isExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1 border-t border-border">
                    <span>From: {email.sender_email}</span>
                    <span>{fullDate}</span>
                    {email.has_attachment && <span>📎 Attachment</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <a
                      href={gmailUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open in Gmail
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>

              {/* Error feedback */}
              {error && (
                <p className="text-xs text-destructive mt-1">{error}</p>
              )}
            </div>
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
    </>
  );
}
