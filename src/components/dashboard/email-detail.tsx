'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Archive,
  ExternalLink,
  Loader2,
  Mail,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  Star,
  Trash2,
  ArrowRight,
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
import { QuickRuleDialog } from '@/components/workflows/quick-rule-dialog';
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

  const executeAction = useCallback(
    async (action: EmailAction) => {
      setActionLoading(true);
      try {
        const res = await fetch(`/api/emails/${email.id}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? `Action failed (${res.status})`);
          return;
        }
        switch (action) {
          case 'trash':
            toast.success('Moved to trash');
            onRemoved(email.id);
            break;
          case 'archive':
            toast.success('Archived');
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
          case 'restore':
            toast.success('Restored to inbox');
            onRemoved(email.id);
            break;
        }
      } catch {
        toast.error('Network error');
      } finally {
        setActionLoading(false);
      }
    },
    [email.id, onRemoved, onUpdated]
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
                onClick={() => executeAction('archive')}
              >
                <Archive className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => executeAction('trash')}
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
          {email.importance_label === 'critical' && <Badge variant="critical">Critical</Badge>}
          {email.importance_label === 'high' && <Badge variant="high">High</Badge>}
          {email.importance_label === 'low' && <Badge variant="low">Low</Badge>}
          {email.importance_label === 'noise' && <Badge variant="noise">Noise</Badge>}
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
