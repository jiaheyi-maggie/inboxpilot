'use client';

import { useCallback, useState } from 'react';
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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CategoryPicker } from './category-picker';
import type { EmailWithCategory, EmailAction } from '@/types';

interface EmailListProps {
  emails: EmailWithCategory[];
  onEmailUpdated?: () => void;
}

export function EmailList({ emails, onEmailUpdated }: EmailListProps) {
  const [localEmails, setLocalEmails] = useState(emails);

  // Sync with parent when emails prop changes
  if (emails !== localEmails && emails.length !== localEmails.length) {
    setLocalEmails(emails);
  }

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
      <div className="text-center py-8 text-slate-400 text-sm">
        No emails in this group
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
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
  const [showMenu, setShowMenu] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  const date = email.received_at
    ? format(new Date(email.received_at), 'MMM d')
    : '';

  const executeAction = useCallback(
    async (action: EmailAction) => {
      setLoading(true);
      setShowMenu(false);
      try {
        const res = await fetch(`/api/emails/${email.id}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (res.ok) {
          switch (action) {
            case 'trash':
              onRemoved(email.id);
              break;
            case 'archive':
              onRemoved(email.id);
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
        }
      } catch {
        // silent
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
      try {
        const res = await fetch(`/api/emails/${email.id}/category`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category }),
        });
        if (res.ok) {
          onUpdated(email.id, { category });
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    },
    [email.id, onUpdated]
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
        className={`px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer ${
          !email.is_read ? 'bg-blue-50/30' : ''
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {/* Sender + actions row */}
            <div className="flex items-center gap-2">
              <span
                className={`text-sm truncate ${
                  !email.is_read ? 'font-semibold text-slate-900' : 'text-slate-600'
                }`}
              >
                {email.sender_name || email.sender_email || 'Unknown'}
              </span>
              <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                {email.has_attachment && (
                  <Paperclip className="h-3 w-3 text-slate-400" />
                )}
                <button
                  onClick={handleStarClick}
                  className="p-0.5 hover:bg-slate-100 rounded transition-colors"
                >
                  <Star
                    className={`h-3.5 w-3.5 ${
                      email.is_starred
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-slate-300 hover:text-slate-400'
                    }`}
                  />
                </button>
                <span className="text-xs text-slate-400">{date}</span>
                {/* Action menu */}
                <div className="relative">
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(!showMenu);
                      }}
                      className="p-0.5 hover:bg-slate-100 rounded transition-colors"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5 text-slate-400" />
                    </button>
                  )}

                  {showMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowMenu(false)}
                      />
                      <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            executeAction(email.is_read ? 'mark_unread' : 'mark_read');
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
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
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            executeAction('archive');
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <Archive className="h-3.5 w-3.5" />
                          Archive
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            executeAction(email.is_starred ? 'unstar' : 'star');
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <Star className="h-3.5 w-3.5" />
                          {email.is_starred ? 'Unstar' : 'Star'}
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
                          Move to...
                        </button>
                        <div className="border-t border-slate-100 my-1" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            executeAction('trash');
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Trash
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Subject */}
            <p
              className={`text-sm truncate mt-0.5 ${
                !email.is_read ? 'font-medium text-slate-800' : 'text-slate-600'
              }`}
            >
              {email.subject || '(no subject)'}
            </p>

            {/* Snippet */}
            <p className="text-xs text-slate-400 truncate mt-0.5">
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
                <span className="text-xs text-slate-400">{email.topic}</span>
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
