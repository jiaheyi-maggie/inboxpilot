'use client';

import { useCallback, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Paperclip,
  Star,
  ChevronsUp,
  ChevronUp as ChevronUpIcon,
  ChevronDown as ChevronDownIcon,
  ChevronsDown,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CategoryBadge } from './category-badge';
import type { EmailWithCategory } from '@/types';

// ── Types ──

export interface EmailThread {
  /** The Gmail thread_id (null for single-message "threads") */
  threadId: string | null;
  /** All emails in this thread, sorted newest first */
  emails: EmailWithCategory[];
  /** The oldest email's subject (the original) */
  subject: string | null;
  /** The newest email's snippet */
  latestSnippet: string | null;
  /** The newest email's received_at */
  latestDate: string;
  /** Unique participants (sender_name or sender_email) */
  participants: string[];
  /** Whether any email in the thread is unread */
  hasUnread: boolean;
  /** Whether any email in the thread has an attachment */
  hasAttachment: boolean;
  /** Whether any email in the thread is starred */
  hasStarred: boolean;
  /** The highest importance label across all emails */
  maxImportanceLabel: string | null;
  /** The highest importance score across all emails */
  maxImportanceScore: number | null;
  /** The category from the most important email (or latest if equal) */
  category: string | null;
  /** The topic from the most important email */
  topic: string | null;
}

// ── Grouping Logic ──

/**
 * Groups a flat list of emails into threads by gmail thread_id.
 * Emails with null thread_id are treated as single-message threads.
 * Returns threads sorted by most recent message date (newest first).
 */
export function groupIntoThreads(emails: EmailWithCategory[]): EmailThread[] {
  const threadMap = new Map<string, EmailWithCategory[]>();
  const soloEmails: EmailWithCategory[] = [];

  for (const email of emails) {
    if (email.thread_id) {
      const existing = threadMap.get(email.thread_id);
      if (existing) {
        existing.push(email);
      } else {
        threadMap.set(email.thread_id, [email]);
      }
    } else {
      // No thread_id — treat as a single-message thread
      soloEmails.push(email);
    }
  }

  const threads: EmailThread[] = [];

  // Process grouped threads
  for (const [threadId, threadEmails] of threadMap) {
    threads.push(buildThread(threadId, threadEmails));
  }

  // Process solo emails (each becomes its own "thread")
  for (const email of soloEmails) {
    threads.push(buildThread(null, [email]));
  }

  // Sort by latest date descending
  threads.sort((a, b) => {
    const dateA = new Date(a.latestDate).getTime();
    const dateB = new Date(b.latestDate).getTime();
    return dateB - dateA;
  });

  return threads;
}

function buildThread(threadId: string | null, emails: EmailWithCategory[]): EmailThread {
  // Sort emails newest first within the thread
  const sorted = [...emails].sort((a, b) => {
    const dateA = new Date(a.received_at).getTime();
    const dateB = new Date(b.received_at).getTime();
    return dateB - dateA;
  });

  const oldest = sorted[sorted.length - 1];
  const newest = sorted[0];

  // Collect unique participants (preserve order by first appearance, oldest to newest)
  const participantSet = new Set<string>();
  const participants: string[] = [];
  // Iterate oldest-to-newest to show original sender first
  for (let i = sorted.length - 1; i >= 0; i--) {
    const email = sorted[i];
    const name = email.sender_name || email.sender_email || 'Unknown';
    if (!participantSet.has(name)) {
      participantSet.add(name);
      participants.push(name);
    }
  }

  // Find the email with the highest importance
  let maxImportanceScore: number | null = null;
  let maxImportanceLabel: string | null = null;
  let bestCategoryEmail = newest; // fallback to newest

  for (const email of sorted) {
    const score = email.importance_score;
    if (score !== null && (maxImportanceScore === null || score > maxImportanceScore)) {
      maxImportanceScore = score;
      maxImportanceLabel = email.importance_label;
      bestCategoryEmail = email;
    }
  }

  return {
    threadId,
    emails: sorted,
    subject: oldest.subject,
    latestSnippet: newest.snippet,
    latestDate: newest.received_at,
    participants,
    hasUnread: sorted.some((e) => !e.is_read),
    hasAttachment: sorted.some((e) => e.has_attachment),
    hasStarred: sorted.some((e) => e.is_starred),
    maxImportanceLabel,
    maxImportanceScore,
    category: bestCategoryEmail.category,
    topic: bestCategoryEmail.topic,
  };
}

// ── Component ──

interface ThreadListProps {
  emails: EmailWithCategory[];
  /** Render function for individual email rows inside expanded threads */
  renderEmailRow: (email: EmailWithCategory) => React.ReactNode;
  /** Map of gmail_account_id -> hex color for account dot indicators */
  accountColorMap?: Map<string, string>;
  /** Whether to show account dots (only when multiple accounts) */
  showAccountDot?: boolean;
}

export function ThreadList({
  emails,
  renderEmailRow,
  accountColorMap,
  showAccountDot,
}: ThreadListProps) {
  const threads = useMemo(() => groupIntoThreads(emails), [emails]);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  const toggleThread = useCallback((threadKey: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(threadKey)) {
        next.delete(threadKey);
      } else {
        next.add(threadKey);
      }
      return next;
    });
  }, []);

  if (threads.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No emails in this group
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {threads.map((thread) => {
        // Use threadId as key, or fallback to the single email's id
        const threadKey = thread.threadId ?? thread.emails[0].id;
        const isExpanded = expandedThreads.has(threadKey);

        return (
          <ThreadRow
            key={threadKey}
            thread={thread}
            isExpanded={isExpanded}
            onToggle={() => toggleThread(threadKey)}
            renderEmailRow={renderEmailRow}
            accountColorMap={accountColorMap}
            showAccountDot={showAccountDot}
          />
        );
      })}
    </div>
  );
}

// ── Thread Row ──

interface ThreadRowProps {
  thread: EmailThread;
  isExpanded: boolean;
  onToggle: () => void;
  renderEmailRow: (email: EmailWithCategory) => React.ReactNode;
  accountColorMap?: Map<string, string>;
  showAccountDot?: boolean;
}

function ThreadRow({
  thread,
  isExpanded,
  onToggle,
  renderEmailRow,
}: ThreadRowProps) {
  const date = thread.latestDate
    ? format(new Date(thread.latestDate), 'MMM d')
    : '';

  // For single-message threads, just render the email row directly
  if (thread.emails.length <= 1) {
    return <>{renderEmailRow(thread.emails[0])}</>;
  }

  // Multi-message thread: render a summary row + expandable detail
  const participantDisplay =
    thread.participants.length <= 3
      ? thread.participants.join(', ')
      : `${thread.participants.slice(0, 2).join(', ')} +${thread.participants.length - 2}`;

  // Find the latest email's sender for the snippet attribution
  const latestSender = thread.emails[0].sender_name
    || thread.emails[0].sender_email?.split('@')[0]
    || 'Unknown';

  return (
    <div>
      {/* Thread summary row */}
      <div
        className={`group relative cursor-pointer transition-colors
          ${thread.hasUnread
            ? 'bg-primary/8 border-l-[3px] border-l-primary'
            : 'hover:bg-accent/50 border-l-[3px] border-l-transparent'
          }
        `}
        onClick={onToggle}
      >
        <div className="px-4 py-3">
          <div className="flex items-start gap-3 min-w-0">
            {/* Thread icon */}
            <div className="mt-0.5 flex-shrink-0">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              {/* Participants + count + date row */}
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm truncate ${
                    thread.hasUnread ? 'font-bold text-foreground' : 'font-normal text-muted-foreground'
                  }`}
                >
                  {participantDisplay}
                </span>
                {/* Thread count badge */}
                <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-muted text-muted-foreground text-xs font-medium flex-shrink-0">
                  {thread.emails.length}
                </span>
                <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                  {thread.hasAttachment && (
                    <Paperclip className="h-3 w-3 text-muted-foreground" />
                  )}
                  {thread.hasStarred && (
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  )}
                  <span className="text-xs text-muted-foreground">{date}</span>
                  {/* Expand/collapse chevron */}
                  <div className="p-0.5">
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </div>

              {/* Subject */}
              <p
                className={`text-sm mt-0.5 truncate ${
                  thread.hasUnread ? 'font-medium text-foreground' : 'text-muted-foreground'
                }`}
              >
                {thread.subject || '(no subject)'}
              </p>

              {/* Latest snippet with sender attribution */}
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                <span className="font-medium">{latestSender}:</span>{' '}
                {thread.latestSnippet}
              </p>

              {/* Tags */}
              <div className="flex items-center gap-1.5 mt-1.5">
                {thread.category && (
                  <CategoryBadge category={thread.category} />
                )}
                {thread.maxImportanceLabel === 'critical' && (
                  <Badge variant="critical" title="Highest importance in thread"><ChevronsUp className="h-3 w-3" /> Critical</Badge>
                )}
                {thread.maxImportanceLabel === 'high' && (
                  <Badge variant="high" title="Highest importance in thread"><ChevronUpIcon className="h-3 w-3" /> High</Badge>
                )}
                {thread.maxImportanceLabel === 'low' && (
                  <Badge variant="low" title="Highest importance in thread"><ChevronDownIcon className="h-3 w-3" /> Low</Badge>
                )}
                {thread.maxImportanceLabel === 'noise' && (
                  <Badge variant="noise" title="Highest importance in thread"><ChevronsDown className="h-3 w-3" /> Noise</Badge>
                )}
                {thread.topic && (
                  <span className="text-xs text-muted-foreground">{thread.topic}</span>
                )}
                {thread.hasUnread && (
                  <span className="text-xs text-primary font-medium">
                    {thread.emails.filter((e) => !e.is_read).length} unread
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded thread messages — animated with grid-rows trick */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-l-[3px] border-l-primary/20 ml-0 divide-y divide-border bg-muted/10">
            {thread.emails.map((email) => (
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
