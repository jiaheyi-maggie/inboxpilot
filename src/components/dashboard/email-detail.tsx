'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Archive,
  Check,
  Clock,
  ExternalLink,
  Forward,
  Loader2,
  Mail,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Reply,
  ReplyAll,
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
  ChevronRight,
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

type ComposeMode = 'reply' | 'reply-all' | 'forward';

// Basic email validation for client-side checks
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // Compose state
  const [composeMode, setComposeMode] = useState<ComposeMode | null>(null);
  const [composeDraft, setComposeDraft] = useState('');
  const [composeLoading, setComposeLoading] = useState(false);
  const [composeSending, setComposeSending] = useState(false);
  const [composeSent, setComposeSent] = useState<ComposeMode | null>(null);
  const composeSendingRef = useRef(false);
  const composeTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Forward-specific state
  const [forwardTo, setForwardTo] = useState('');
  const [forwardedContent, setForwardedContent] = useState('');

  // CC/BCC fields
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [ccField, setCcField] = useState('');
  const [bccField, setBccField] = useState('');

  // Reply-all recipients (populated from API)
  const [replyAllTo, setReplyAllTo] = useState('');
  const [replyAllCc, setReplyAllCc] = useState('');

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

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

    observerRef.current?.disconnect();

    const body = iframe.contentDocument.body;
    const updateHeight = () => {
      iframe.style.height = `${body.scrollHeight}px`;
    };

    updateHeight();

    const imgs = body.querySelectorAll('img');
    imgs.forEach((img) => {
      if (!img.complete) {
        img.addEventListener('load', updateHeight);
        img.addEventListener('error', updateHeight);
      }
    });

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

  // --- Compose handlers ---

  const fetchDraft = useCallback(async (mode: ComposeMode) => {
    setComposeLoading(true);
    setComposeDraft('');
    setForwardedContent('');
    setReplyAllTo('');
    setReplyAllCc('');
    try {
      const res = await fetch(`/api/emails/${email.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'draft',
          forward: mode === 'forward',
          replyAll: mode === 'reply-all',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to generate draft');
      }
      const data = await res.json();
      setComposeDraft(data.draft ?? '');

      if (mode === 'forward' && data.forwardedContent) {
        setForwardedContent(data.forwardedContent);
      }

      if (mode === 'reply-all' && data.replyAllRecipients) {
        setReplyAllTo(data.replyAllRecipients.to ?? '');
        setReplyAllCc(data.replyAllRecipients.cc ?? '');
        // Pre-fill CC with reply-all recipients
        if (data.replyAllRecipients.cc) {
          setCcField(data.replyAllRecipients.cc);
          setShowCcBcc(true);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate draft');
      setComposeMode(null);
    } finally {
      setComposeLoading(false);
    }
  }, [email.id]);

  const openCompose = useCallback((mode: ComposeMode) => {
    if (composeSent) return;
    if (composeMode === mode) {
      composeTextareaRef.current?.focus();
      return;
    }
    // Reset all compose state for new mode
    setComposeMode(mode);
    setComposeSent(null);
    setForwardTo('');
    setCcField('');
    setBccField('');
    setShowCcBcc(false);
    fetchDraft(mode);
  }, [composeMode, composeSent, fetchDraft]);

  const discardCompose = useCallback(() => {
    setComposeMode(null);
    setComposeDraft('');
    setComposeLoading(false);
    setComposeSending(false);
    setForwardTo('');
    setForwardedContent('');
    setCcField('');
    setBccField('');
    setShowCcBcc(false);
    setReplyAllTo('');
    setReplyAllCc('');
  }, []);

  const sendMessage = useCallback(async () => {
    if (composeSendingRef.current || !composeMode) return;

    // Validate forward recipient
    if (composeMode === 'forward') {
      if (!forwardTo.trim()) {
        toast.error('Enter a recipient email address');
        return;
      }
      if (!EMAIL_RE.test(forwardTo.trim())) {
        toast.error('Invalid recipient email address');
        return;
      }
    }

    // Validate CC/BCC if provided
    if (ccField.trim()) {
      const addrs = ccField.split(',').map((e) => e.trim()).filter(Boolean);
      for (const addr of addrs) {
        if (!EMAIL_RE.test(addr)) {
          toast.error(`Invalid CC address: ${addr}`);
          return;
        }
      }
    }
    if (bccField.trim()) {
      const addrs = bccField.split(',').map((e) => e.trim()).filter(Boolean);
      for (const addr of addrs) {
        if (!EMAIL_RE.test(addr)) {
          toast.error(`Invalid BCC address: ${addr}`);
          return;
        }
      }
    }

    // For forward, combine user note with forwarded content
    const messageBody = composeMode === 'forward'
      ? (composeDraft.trim() + forwardedContent)
      : composeDraft;

    if (!messageBody.trim()) {
      toast.error('Message body cannot be empty');
      return;
    }

    composeSendingRef.current = true;
    setComposeSending(true);
    try {
      const payload: Record<string, unknown> = {
        action: 'send',
        body: messageBody,
      };

      if (composeMode === 'forward') {
        payload.forward = true;
        payload.forwardTo = forwardTo.trim();
      }
      if (composeMode === 'reply-all') {
        payload.replyAll = true;
      }
      if (ccField.trim()) {
        payload.cc = ccField.trim();
      }
      if (bccField.trim()) {
        payload.bcc = bccField.trim();
      }

      const res = await fetch(`/api/emails/${email.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to send');
      }

      const labels: Record<ComposeMode, string> = {
        reply: 'Reply sent',
        'reply-all': 'Reply sent to all',
        forward: 'Forwarded',
      };

      toast.success(labels[composeMode], {
        description: email.subject || '(no subject)',
      });
      const sentMode = composeMode;
      setComposeMode(null);
      setComposeDraft('');
      setForwardTo('');
      setForwardedContent('');
      setCcField('');
      setBccField('');
      setShowCcBcc(false);
      setComposeSent(sentMode);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      composeSendingRef.current = false;
      setComposeSending(false);
    }
  }, [composeMode, composeDraft, forwardTo, forwardedContent, ccField, bccField, email.id, email.subject]);

  // Auto-focus and auto-resize the compose textarea when draft loads
  useEffect(() => {
    if (composeMode && !composeLoading && composeDraft && composeTextareaRef.current) {
      composeTextareaRef.current.focus();
      const ta = composeTextareaRef.current;
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [composeMode, composeLoading, composeDraft]);

  // Auto-resize on content change
  const handleComposeChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setComposeDraft(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  }, []);

  // Reset compose state when email changes
  useEffect(() => {
    setComposeMode(null);
    setComposeDraft('');
    setComposeLoading(false);
    setComposeSending(false);
    setComposeSent(null);
    setForwardTo('');
    setForwardedContent('');
    setCcField('');
    setBccField('');
    setShowCcBcc(false);
    setReplyAllTo('');
    setReplyAllCc('');
  }, [email.id]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInTextarea = target.tagName === 'TEXTAREA';
      const isInInput = target.tagName === 'INPUT' || target.isContentEditable;

      // Cmd/Ctrl+Enter in the compose textarea → send
      if ((isInTextarea || isInInput) && (e.metaKey || e.ctrlKey) && e.key === 'Enter' && composeMode && !composeSending) {
        e.preventDefault();
        sendMessage();
        return;
      }

      // Escape → discard compose (works even when textarea/input is focused)
      if (e.key === 'Escape' && composeMode) {
        e.preventDefault();
        discardCompose();
        return;
      }

      // Don't process single-key shortcuts when user is typing in any input
      if (isInInput || isInTextarea) return;

      // 'r' → open reply
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        openCompose('reply');
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [composeMode, composeSending, sendMessage, discardCompose, openCompose]);

  // Compose section label/icon
  const composeLabel = composeMode === 'forward'
    ? `Forward`
    : composeMode === 'reply-all'
      ? `Reply all`
      : `Reply to ${email.sender_name || email.sender_email || 'sender'}`;

  const ComposeIcon = composeMode === 'forward'
    ? Forward
    : composeMode === 'reply-all'
      ? ReplyAll
      : Reply;

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
              {/* Reply button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => openCompose('reply')}
                title="Reply (r)"
                disabled={!!composeSent}
              >
                {composeSent === 'reply' ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Reply className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
              {/* Reply All button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => openCompose('reply-all')}
                title="Reply All"
                disabled={!!composeSent}
              >
                {composeSent === 'reply-all' ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <ReplyAll className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
              {/* Forward button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => openCompose('forward')}
                title="Forward"
                disabled={!!composeSent}
              >
                {composeSent === 'forward' ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Forward className="h-4 w-4 text-muted-foreground" />
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

      {/* Compose section (Reply / Reply All / Forward) */}
      {composeMode && (
        <div className="border-t border-border px-6 py-4 flex-shrink-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <ComposeIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {composeLabel}
            </span>
            {composeMode === 'reply-all' && replyAllTo && (
              <span className="text-xs text-muted-foreground truncate ml-1">
                to {replyAllTo}
              </span>
            )}
          </div>

          {composeLoading ? (
            <div className="flex items-center gap-2 py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {composeMode === 'forward' ? 'Preparing forward...' : 'Drafting reply...'}
              </span>
            </div>
          ) : (
            <>
              {/* Forward To field */}
              {composeMode === 'forward' && (
                <div className="mb-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">To</label>
                  <input
                    type="email"
                    value={forwardTo}
                    onChange={(e) => setForwardTo(e.target.value)}
                    disabled={composeSending}
                    className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="recipient@example.com"
                    autoFocus
                  />
                </div>
              )}

              {/* CC/BCC toggle and fields */}
              {!showCcBcc ? (
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 transition-colors"
                  onClick={() => setShowCcBcc(true)}
                >
                  <ChevronRight className="h-3 w-3" />
                  CC / BCC
                </button>
              ) : (
                <div className="mb-2 space-y-2">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">CC</label>
                    <input
                      type="text"
                      value={ccField}
                      onChange={(e) => setCcField(e.target.value)}
                      disabled={composeSending}
                      className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder="Comma-separated emails"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">BCC</label>
                    <input
                      type="text"
                      value={bccField}
                      onChange={(e) => setBccField(e.target.value)}
                      disabled={composeSending}
                      className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder="Comma-separated emails"
                    />
                  </div>
                </div>
              )}

              {/* Message textarea */}
              <textarea
                ref={composeTextareaRef}
                value={composeDraft}
                onChange={handleComposeChange}
                disabled={composeSending}
                className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed resize-none overflow-hidden"
                placeholder={composeMode === 'forward' ? 'Add a note...' : 'Write your reply...'}
              />

              {/* Forwarded content preview (read-only) */}
              {composeMode === 'forward' && forwardedContent && (
                <pre className="mt-2 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap font-sans bg-muted/50 rounded-md border border-border max-h-40 overflow-auto">
                  {forwardedContent}
                </pre>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2 mt-3">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={sendMessage}
                  disabled={composeSending || (!composeDraft.trim() && composeMode !== 'forward')}
                >
                  {composeSending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  {composeSending ? 'Sending...' : composeMode === 'forward' ? 'Forward' : 'Send'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={discardCompose}
                  disabled={composeSending}
                >
                  <X className="h-3.5 w-3.5" />
                  Discard
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs text-muted-foreground"
                  onClick={() => composeMode && fetchDraft(composeMode)}
                  disabled={composeSending || composeLoading}
                  title="Regenerate draft"
                >
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter to send
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Sent indicator */}
      {composeSent && !composeMode && (
        <div className="border-t border-border px-6 py-3 flex-shrink-0 flex items-center gap-2">
          <Check className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-600">
            {composeSent === 'forward' ? 'Forwarded' : composeSent === 'reply-all' ? 'Replied to all' : 'Replied'}
          </span>
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
