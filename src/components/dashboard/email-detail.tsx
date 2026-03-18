'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Archive,
  Check,
  Clock,
  ExternalLink,
  Loader2,
  Mail,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Reply,
  Send,
  Star,
  Trash2,
  ArrowRight,
  ChevronsUp,
  ChevronUp,
  ChevronDown,
  ChevronsDown,
  X,
  Zap,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { CategoryBadge } from './category-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CategoryPicker } from './category-picker';
import { SnoozePicker } from './snooze-picker';
import { QuickRuleDialog } from '@/components/workflows/quick-rule-dialog';
import { showUndoToast } from '@/lib/undo-toast';
import type { EmailWithCategory, EmailAction } from '@/types';

interface EmailDetailProps {
  email: EmailWithCategory;
  onBack: () => void;
  onRemoved: (id: string) => void;
  onUpdated: (id: string, updates: Partial<EmailWithCategory>) => void;
  /** Called when category changes — structural move that triggers tree refresh */
  onCategoryChanged?: (id: string, category: string) => void;
}

export function EmailDetail({ email, onBack, onRemoved, onUpdated, onCategoryChanged }: EmailDetailProps) {
  const [bodyHtml, setBodyHtml] = useState<string | null>(null);
  const [bodyText, setBodyText] = useState<string | null>(null);
  const [bodyLoading, setBodyLoading] = useState(true);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showRuleDialog, setShowRuleDialog] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const [replyMode, setReplyMode] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);
  const [replySending, setReplySending] = useState(false);
  const [replySent, setReplySent] = useState(false);
  const replySendingRef = useRef(false); // synchronous guard against double-send
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const fullDate = email.received_at
    ? format(new Date(email.received_at), 'EEEE, MMMM d, yyyy \'at\' h:mm a')
    : '';

  const isTrashed = email.label_ids?.includes('TRASH') ?? false;
  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${email.thread_id ?? email.gmail_message_id}`;

  // Fetch body on mount
  useEffect(() => {
    let cancelled = false;
    setBodyLoading(true);
    setBodyError(null);

    fetch(`/api/emails/${email.id}/body`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setBodyError(data.error ?? 'Failed to load email');
          return;
        }
        const data = await res.json();
        setBodyHtml(data.body_html);
        setBodyText(data.body_text);
      })
      .catch(() => {
        if (!cancelled) setBodyError('Network error');
      })
      .finally(() => {
        if (!cancelled) setBodyLoading(false);
      });

    return () => { cancelled = true; };
  }, [email.id]);

  // Clean up ResizeObserver when component unmounts or email changes
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [email.id]);

  // Auto-resize iframe when body loads
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument?.body) return;

    // Clean up previous observer
    observerRef.current?.disconnect();

    const body = iframe.contentDocument.body;
    const updateHeight = () => {
      iframe.style.height = `${body.scrollHeight}px`;
    };

    updateHeight();

    // Handle late-loading images
    const imgs = body.querySelectorAll('img');
    imgs.forEach((img) => {
      if (!img.complete) {
        img.addEventListener('load', updateHeight);
        img.addEventListener('error', updateHeight);
      }
    });

    // Watch for any dynamic changes
    const observer = new ResizeObserver(updateHeight);
    observer.observe(body);
    observerRef.current = observer;
  }, []);

  const callAction = useCallback(
    async (action: EmailAction, extra?: Record<string, unknown>) => {
      const res = await fetch(`/api/emails/${email.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Action failed (${res.status})`);
      }
    },
    [email.id],
  );

  const executeAction = useCallback(
    async (action: EmailAction) => {
      setActionLoading(true);
      try {
        await callAction(action);
        switch (action) {
          case 'trash':
            showUndoToast({
              label: 'Moved to trash',
              description: email.subject || '(no subject)',
              onUndo: () => callAction('restore'),
              onUndoComplete: () => onRemoved(email.id),
            });
            onRemoved(email.id);
            break;
          case 'archive':
            showUndoToast({
              label: 'Archived',
              description: email.subject || '(no subject)',
              onUndo: () => callAction('unarchive'),
              onUndoComplete: () => onRemoved(email.id),
            });
            onRemoved(email.id);
            break;
          case 'star':
            showUndoToast({
              label: 'Starred',
              onUndo: () => callAction('unstar'),
              onUndoComplete: () => onUpdated(email.id, { is_starred: false }),
            });
            onUpdated(email.id, { is_starred: true });
            break;
          case 'unstar':
            showUndoToast({
              label: 'Unstarred',
              onUndo: () => callAction('star'),
              onUndoComplete: () => onUpdated(email.id, { is_starred: true }),
            });
            onUpdated(email.id, { is_starred: false });
            break;
          case 'mark_read':
            onUpdated(email.id, { is_read: true });
            break;
          case 'mark_unread':
            onUpdated(email.id, { is_read: false });
            break;
          case 'restore':
            toast.success('Restored to inbox');
            onRemoved(email.id);
            break;
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Network error');
      } finally {
        setActionLoading(false);
      }
    },
    [email.id, email.subject, onRemoved, onUpdated, callAction]
  );

  const handleSnooze = useCallback(
    async (until: string) => {
      setShowSnooze(false);
      setActionLoading(true);
      try {
        await callAction('snooze', { until });
        const snoozeDate = new Date(until);
        const label = `Snoozed until ${snoozeDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${snoozeDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
        showUndoToast({
          label,
          description: email.subject || '(no subject)',
          onUndo: () => callAction('unsnooze'),
          onUndoComplete: () => onRemoved(email.id),
        });
        onRemoved(email.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Snooze failed');
      } finally {
        setActionLoading(false);
      }
    },
    [email.id, email.subject, onRemoved, callAction],
  );

  const handleCategoryChange = useCallback(
    async (category: string) => {
      setShowPicker(false);
      setActionLoading(true);
      try {
        const res = await fetch(`/api/emails/${email.id}/category`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? 'Failed to move email');
          return;
        }
        toast.success(`Moved to ${category}`, {
          description: email.subject || '(no subject)',
        });
        // Category change is structural — use dedicated callback to trigger tree refresh
        if (onCategoryChanged) {
          onCategoryChanged(email.id, category);
        } else {
          onUpdated(email.id, { category });
        }
      } catch {
        toast.error('Network error');
      } finally {
        setActionLoading(false);
      }
    },
    [email.id, email.subject, onUpdated, onCategoryChanged]
  );

  // --- Reply handlers ---

  const fetchDraft = useCallback(async () => {
    setReplyLoading(true);
    setReplyDraft('');
    try {
      const res = await fetch(`/api/emails/${email.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'draft' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to generate draft');
      }
      const data = await res.json();
      setReplyDraft(data.draft ?? '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate draft');
      setReplyMode(false);
    } finally {
      setReplyLoading(false);
    }
  }, [email.id]);

  const openReply = useCallback(() => {
    if (replySent) return;
    if (replyMode) {
      // Already open — focus the textarea
      replyTextareaRef.current?.focus();
      return;
    }
    setReplyMode(true);
    setReplySent(false);
    fetchDraft();
  }, [replyMode, replySent, fetchDraft]);

  const discardReply = useCallback(() => {
    setReplyMode(false);
    setReplyDraft('');
    setReplyLoading(false);
    setReplySending(false);
  }, []);

  const sendReply = useCallback(async () => {
    if (replySendingRef.current) return; // synchronous guard against double Cmd+Enter
    if (!replyDraft.trim()) {
      toast.error('Reply body cannot be empty');
      return;
    }
    replySendingRef.current = true;
    setReplySending(true);
    try {
      const res = await fetch(`/api/emails/${email.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', body: replyDraft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to send reply');
      }
      toast.success('Reply sent', {
        description: email.subject || '(no subject)',
      });
      setReplyMode(false);
      setReplyDraft('');
      setReplySent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      replySendingRef.current = false;
      setReplySending(false);
    }
  }, [email.id, email.subject, replyDraft]);

  // Auto-focus and auto-resize the reply textarea when draft loads
  useEffect(() => {
    if (replyMode && !replyLoading && replyDraft && replyTextareaRef.current) {
      replyTextareaRef.current.focus();
      // Auto-resize to fit content
      const ta = replyTextareaRef.current;
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [replyMode, replyLoading, replyDraft]);

  // Auto-resize on content change
  const handleReplyChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyDraft(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  }, []);

  // Reset reply state when email changes
  useEffect(() => {
    setReplyMode(false);
    setReplyDraft('');
    setReplyLoading(false);
    setReplySending(false);
    setReplySent(false);
  }, [email.id]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input/textarea (except our reply textarea for Cmd+Enter)
      const target = e.target as HTMLElement;
      const isInTextarea = target.tagName === 'TEXTAREA';
      const isInInput = target.tagName === 'INPUT' || target.isContentEditable;

      // Cmd/Ctrl+Enter in the reply textarea → send
      if (isInTextarea && (e.metaKey || e.ctrlKey) && e.key === 'Enter' && replyMode && !replySending) {
        e.preventDefault();
        sendReply();
        return;
      }

      // Escape → discard reply (works even when textarea is focused)
      if (e.key === 'Escape' && replyMode) {
        e.preventDefault();
        discardReply();
        return;
      }

      // Don't process single-key shortcuts when user is typing in any input
      if (isInInput || isInTextarea) return;

      // 'r' → open reply
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        openReply();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [replyMode, replySending, sendReply, discardReply, openReply]);

  // Prepare HTML for safe iframe rendering
  const iframeSrcDoc = bodyHtml ? prepareHtmlForIframe(bodyHtml) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground">Back to list</span>

        <div className="ml-auto flex items-center gap-1">
          {actionLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : isTrashed ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => executeAction('restore')}
              >
                <RotateCcw className="h-4 w-4" />
                Restore
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => executeAction(email.is_starred ? 'unstar' : 'star')}
              >
                <Star
                  className={`h-4 w-4 ${
                    email.is_starred
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-muted-foreground'
                  }`}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={openReply}
                title="Reply (r)"
                disabled={replySent}
              >
                {replySent ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Reply className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => executeAction('archive')}
                title="Archive"
              >
                <Archive className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setShowSnooze(true)}
                title="Snooze"
              >
                <Clock className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => executeAction('trash')}
                title="Trash"
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </Button>
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
                  <DropdownMenuItem asChild>
                    <a
                      href={gmailUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open in Gmail
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* Email metadata */}
      <div className="px-6 py-4 border-b border-border flex-shrink-0">
        <h1 className="text-lg font-semibold text-foreground leading-tight">
          {email.subject || '(no subject)'}
        </h1>

        <div className="flex items-center gap-2 mt-3">
          {/* Sender avatar */}
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary flex-shrink-0">
            {(email.sender_name ?? email.sender_email ?? '?')[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">
                {email.sender_name || email.sender_email || 'Unknown'}
              </span>
              {email.sender_name && email.sender_email && (
                <span className="text-xs text-muted-foreground truncate">
                  &lt;{email.sender_email}&gt;
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{fullDate}</p>
          </div>
        </div>

        {/* Tags */}
        <div className="flex items-center gap-1.5 mt-3">
          {email.category && <CategoryBadge category={email.category} />}
          {email.importance_label === 'critical' && <Badge variant="critical" title="AI-assigned importance"><ChevronsUp className="h-3 w-3" /> Critical</Badge>}
          {email.importance_label === 'high' && <Badge variant="high" title="AI-assigned importance"><ChevronUp className="h-3 w-3" /> High</Badge>}
          {email.importance_label === 'low' && <Badge variant="low" title="AI-assigned importance"><ChevronDown className="h-3 w-3" /> Low</Badge>}
          {email.importance_label === 'noise' && <Badge variant="noise" title="AI-assigned importance"><ChevronsDown className="h-3 w-3" /> Noise</Badge>}
          {email.topic && (
            <span className="text-xs text-muted-foreground">{email.topic}</span>
          )}
          {email.has_attachment && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              Attachment
            </span>
          )}
        </div>
      </div>

      {/* Email body */}
      <div className="flex-1 overflow-auto">
        {bodyLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading email...</span>
          </div>
        ) : bodyError ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm text-destructive">{bodyError}</p>
            <p className="text-xs mt-1">
              <a
                href={gmailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Open in Gmail instead
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        ) : iframeSrcDoc ? (
          <iframe
            ref={iframeRef}
            srcDoc={iframeSrcDoc}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="w-full border-0"
            style={{ minHeight: '200px' }}
            onLoad={handleIframeLoad}
            title="Email content"
          />
        ) : bodyText ? (
          <pre className="px-6 py-4 text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
            {bodyText}
          </pre>
        ) : (
          <div className="px-6 py-4">
            <p className="text-sm text-muted-foreground italic">
              {email.snippet || 'No content available'}
            </p>
          </div>
        )}
      </div>

      {/* Reply section */}
      {replyMode && (
        <div className="border-t border-border px-6 py-4 flex-shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <Reply className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              Reply to {email.sender_name || email.sender_email || 'sender'}
            </span>
          </div>
          {replyLoading ? (
            <div className="flex items-center gap-2 py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Drafting reply...
              </span>
            </div>
          ) : (
            <>
              <textarea
                ref={replyTextareaRef}
                value={replyDraft}
                onChange={handleReplyChange}
                disabled={replySending}
                className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed resize-none overflow-hidden"
                placeholder="Write your reply..."
              />
              <div className="flex items-center gap-2 mt-3">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={sendReply}
                  disabled={replySending || !replyDraft.trim()}
                >
                  {replySending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  {replySending ? 'Sending...' : 'Send'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={discardReply}
                  disabled={replySending}
                >
                  <X className="h-3.5 w-3.5" />
                  Discard
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs text-muted-foreground"
                  onClick={fetchDraft}
                  disabled={replySending || replyLoading}
                  title="Regenerate draft"
                >
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to send
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Replied indicator */}
      {replySent && !replyMode && (
        <div className="border-t border-border px-6 py-3 flex-shrink-0 flex items-center gap-2">
          <Check className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-600">Replied</span>
        </div>
      )}

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

      {showSnooze && (
        <SnoozePicker
          onSelect={handleSnooze}
          onClose={() => setShowSnooze(false)}
        />
      )}
    </div>
  );
}

/**
 * Prepare HTML email content for safe iframe rendering.
 * - Forces all links to open in new tabs
 * - Adds baseline styles for consistent rendering
 * - Constrains image widths to prevent overflow
 */
function prepareHtmlForIframe(html: string): string {
  const baseTag = /<base\s/i.test(html) ? '' : '<base target="_blank">';
  const style = `<style>
    body {
      margin: 0;
      padding: 24px;
      background: #fff;
      color: #1a1a1a;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    img { max-width: 100%; height: auto; }
    a { color: #2563eb; }
    pre, code { white-space: pre-wrap; word-wrap: break-word; }
    table { max-width: 100%; }
  </style>`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, `$&${baseTag}${style}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, `$&<head>${baseTag}${style}</head>`);
  }
  return `<!DOCTYPE html><html><head>${baseTag}${style}</head><body>${html}</body></html>`;
}
