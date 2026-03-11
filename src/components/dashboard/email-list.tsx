'use client';

import { format } from 'date-fns';
import { Paperclip } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { EmailWithCategory } from '@/types';

interface EmailListProps {
  emails: EmailWithCategory[];
}

export function EmailList({ emails }: EmailListProps) {
  if (emails.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400 text-sm">
        No emails in this group
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {emails.map((email) => (
        <EmailRow key={email.id} email={email} />
      ))}
    </div>
  );
}

function EmailRow({ email }: { email: EmailWithCategory }) {
  const date = email.received_at
    ? format(new Date(email.received_at), 'MMM d')
    : '';
  const time = email.received_at
    ? format(new Date(email.received_at), 'h:mm a')
    : '';

  return (
    <div
      className={`px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer ${
        !email.is_read ? 'bg-blue-50/30' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Sender + date row */}
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
              <span className="text-xs text-slate-400">{date}</span>
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
  );
}
