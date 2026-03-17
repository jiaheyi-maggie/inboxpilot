'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Send,
  Loader2,
  Brain,
  Zap,
  BookOpen,
  Search,
  Check,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { IntentResponse } from '@/types';

// ── Types ──

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent?: IntentResponse;
  /** Whether the user has acted on this message (Apply/Execute/Cancel) */
  resolved?: boolean;
}

interface ChatSidebarProps {
  open: boolean;
  onClose: () => void;
  /** Pre-filled message from Command Palette */
  prefillMessage?: string;
  /** Current category context from the sidebar selection */
  currentCategory?: string | null;
  /** Called after actions that change email data (e.g., recategorization) to refresh the UI */
  onRefresh?: () => void;
}

// ── Intent Icons ──

function IntentBadge({ type }: { type: IntentResponse['type'] }) {
  switch (type) {
    case 'context':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400">
          <Brain className="h-3 w-3" />
          CONTEXT
        </span>
      );
    case 'command':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          <Zap className="h-3 w-3" />
          COMMAND
        </span>
      );
    case 'rule':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-600 dark:text-purple-400">
          <BookOpen className="h-3 w-3" />
          RULE
        </span>
      );
    case 'search':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
          <Search className="h-3 w-3" />
          SEARCH
        </span>
      );
  }
}

// ── Types for AI Memory ──

interface MemoryCategory {
  name: string;
  lines: string[];
}

// ── Reorder Detection ──

/** Ordering keywords and their semantics. */
type OrderingIntent =
  | { type: 'last' }
  | { type: 'first' }
  | { type: 'before'; relativeTo: string }
  | { type: 'after'; relativeTo: string };

/**
 * Parse a context string for category-ordering intent.
 * Returns null if no ordering command is detected.
 *
 * Supported patterns:
 *   "put X last", "move X to the end", "X should be last"
 *   "put X first", "move X to the beginning", "X should be first"
 *   "put X before Y", "move X before Y"
 *   "put X after Y", "move X after Y"
 */
function parseOrderingIntent(
  text: string,
  categoryNames: string[]
): { category: string; intent: OrderingIntent } | null {
  const lower = text.toLowerCase();

  // Quick bail: no ordering keywords at all
  const hasOrderingKeyword =
    /\b(last|first|end|beginning|start|front|before|after|move|put|place|set|make|should be)\b/.test(lower);
  if (!hasOrderingKeyword) return null;

  // Sort category names longest-first to avoid partial matches
  // (e.g., "Work" matching before "Work Updates")
  const sorted = [...categoryNames].sort((a, b) => b.length - a.length);

  // Try to find a category being moved and the ordering intent
  for (const catName of sorted) {
    const catLower = catName.toLowerCase();

    // Check if this category name appears in the text
    // Use word boundary to avoid partial matches
    const catPattern = new RegExp(`\\b${escapeRegex(catLower)}\\b`);
    if (!catPattern.test(lower)) continue;

    // Check "before Y" / "after Y" first (they reference a second category)
    for (const keyword of ['before', 'after'] as const) {
      const relPattern = new RegExp(
        `\\b(?:put|move|place)\\b.*\\b${escapeRegex(catLower)}\\b.*\\b${keyword}\\b\\s+(.+?)(?:\\.|$)`,
        'i'
      );
      const altPattern = new RegExp(
        `\\b${escapeRegex(catLower)}\\b.*\\bshould\\s+(?:be|go|come)\\b.*\\b${keyword}\\b\\s+(.+?)(?:\\.|$)`,
        'i'
      );

      for (const pat of [relPattern, altPattern]) {
        const match = text.match(pat);
        if (match) {
          const targetFragment = match[1].trim().toLowerCase();
          // Find the referenced category in the fragment
          const relativeCat = sorted.find((name) => {
            const nameLower = name.toLowerCase();
            return (
              nameLower !== catLower &&
              new RegExp(`\\b${escapeRegex(nameLower)}\\b`).test(targetFragment)
            );
          });
          if (relativeCat) {
            return {
              category: catName,
              intent: { type: keyword, relativeTo: relativeCat },
            };
          }
        }
      }
    }

    // Check absolute positions: last/end, first/beginning
    // Every pattern requires an explicit ordering verb or "should be/go" construction
    // to avoid false positives like "the last email from personal"
    const lastPatterns = [
      new RegExp(`\\b(?:put|move|place|set|make)\\b.*\\b${escapeRegex(catLower)}\\b.*\\b(?:last|end)\\b`, 'i'),
      new RegExp(`\\b${escapeRegex(catLower)}\\b.*\\bshould\\s+(?:be|go)\\b.*\\b(?:last|end)\\b`, 'i'),
      new RegExp(`\\b(?:put|move|place|set|make)\\b.*\\b(?:last|end)\\b.*\\b${escapeRegex(catLower)}\\b`, 'i'),
    ];
    if (lastPatterns.some((p) => p.test(text))) {
      return { category: catName, intent: { type: 'last' } };
    }

    const firstPatterns = [
      new RegExp(`\\b(?:put|move|place|set|make)\\b.*\\b${escapeRegex(catLower)}\\b.*\\b(?:first|beginning|start|front)\\b`, 'i'),
      new RegExp(`\\b${escapeRegex(catLower)}\\b.*\\bshould\\s+(?:be|go)\\b.*\\b(?:first|beginning|start|front)\\b`, 'i'),
      new RegExp(`\\b(?:put|move|place|set|make)\\b.*\\b(?:first|beginning|start|front)\\b.*\\b${escapeRegex(catLower)}\\b`, 'i'),
    ];
    if (firstPatterns.some((p) => p.test(text))) {
      return { category: catName, intent: { type: 'first' } };
    }
  }

  return null;
}

/** Escape regex special characters in a string. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute a new ordering of category IDs given the parsed intent.
 * Returns null if the operation is a no-op or invalid.
 */
function computeNewOrder(
  categories: { id: string; name: string }[],
  moveCategoryName: string,
  intent: OrderingIntent
): string[] | null {
  const moveIdx = categories.findIndex(
    (c) => c.name.toLowerCase() === moveCategoryName.toLowerCase()
  );
  if (moveIdx === -1) return null;

  const ids = categories.map((c) => c.id);
  const moveId = ids[moveIdx];

  // Remove the category from its current position
  const without = ids.filter((_, i) => i !== moveIdx);

  switch (intent.type) {
    case 'last': {
      if (moveIdx === ids.length - 1) return null; // already last
      return [...without, moveId];
    }
    case 'first': {
      if (moveIdx === 0) return null; // already first
      return [moveId, ...without];
    }
    case 'before': {
      const targetIdx = categories.findIndex(
        (c) => c.name.toLowerCase() === intent.relativeTo.toLowerCase()
      );
      if (targetIdx === -1) return null;
      // Already immediately before the target — no-op
      if (moveIdx === targetIdx - 1) return null;
      // Adjust target index since we removed the move item
      const adjustedTargetIdx =
        targetIdx > moveIdx ? targetIdx - 1 : targetIdx;
      const result = [...without];
      result.splice(adjustedTargetIdx, 0, moveId);
      return result;
    }
    case 'after': {
      const targetIdx = categories.findIndex(
        (c) => c.name.toLowerCase() === intent.relativeTo.toLowerCase()
      );
      if (targetIdx === -1) return null;
      // Already immediately after the target — no-op
      if (moveIdx === targetIdx + 1) return null;
      const adjustedTargetIdx =
        targetIdx > moveIdx ? targetIdx - 1 : targetIdx;
      const result = [...without];
      result.splice(adjustedTargetIdx + 1, 0, moveId);
      return result;
    }
  }
}

// ── Main Component ──

export function ChatSidebar({
  open,
  onClose,
  prefillMessage,
  currentCategory,
  onRefresh,
}: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [memories, setMemories] = useState<MemoryCategory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prefillProcessedRef = useRef<string | undefined>(undefined);

  // Fetch category teachings when sidebar opens (for empty-state display)
  useEffect(() => {
    if (!open || messages.length > 0) return;
    let cancelled = false;
    setMemoriesLoading(true);
    fetch('/api/categories')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.categories) return;
        const cats: MemoryCategory[] = [];
        for (const cat of data.categories) {
          const desc = (cat.description ?? '').trim();
          if (!desc) continue;
          const lines = desc.split('\n').filter((l: string) => l.trim());
          if (lines.length > 0) {
            cats.push({ name: cat.name, lines });
          }
        }
        setMemories(cats);
      })
      .catch(() => {
        // Non-critical — fall through to default empty state
      })
      .finally(() => {
        if (!cancelled) setMemoriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, messages.length]);

  // Auto-send prefilled message from command palette
  useEffect(() => {
    if (
      open &&
      prefillMessage &&
      prefillMessage.trim() &&
      prefillProcessedRef.current !== prefillMessage
    ) {
      prefillProcessedRef.current = prefillMessage;
      // Use a timeout so the sidebar is visible before sending
      setTimeout(() => {
        sendMessage(prefillMessage.trim());
      }, 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillMessage]);

  // Focus input when sidebar opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Escape key closes sidebar
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text.trim(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setSending(true);

      try {
        const res = await fetch('/api/ai/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text.trim(),
            context: currentCategory ? { category: currentCategory } : undefined,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }));
          const errorMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: err.error || 'Something went wrong. Please try again.',
          };
          setMessages((prev) => [...prev, errorMsg]);
          return;
        }

        const intent: IntentResponse = await res.json();
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: intent.summary,
          intent,
          resolved: false,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Network error. Please check your connection and try again.',
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setSending(false);
      }
    },
    [sending, currentCategory]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      sendMessage(input);
    },
    [input, sendMessage]
  );

  // ── Action handlers ──

  const handleApplyContext = useCallback(
    async (msgId: string, intent: IntentResponse, originalUserMessage?: string) => {
      // Optimistically mark resolved to prevent double-clicks
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, resolved: true } : m))
      );

      const target = (intent.details.target as string) ?? '';
      const contextText = (intent.details.context_text as string) ?? intent.summary;

      // Helper to revert optimistic resolved state on error
      const revertResolved = () =>
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, resolved: false } : m))
        );

      // Fetch categories first — needed for both targeted and general context
      let categories: { id: string; name: string; description: string | null }[];
      try {
        const catRes = await fetch('/api/categories');
        if (!catRes.ok) {
          toast.error('Failed to fetch categories');
          revertResolved();
          return;
        }
        const data = await catRes.json();
        categories = data.categories ?? [];
      } catch {
        toast.error('Failed to apply context');
        revertResolved();
        return;
      }

      // Try to resolve the target category
      let matchedCategory: (typeof categories)[number] | undefined;

      // 1. Try explicit "category:Name" format
      const categoryMatch = target.match(/^category:(.+)$/);
      if (categoryMatch) {
        const categoryName = categoryMatch[1];
        matchedCategory = categories.find(
          (c) => c.name.toLowerCase() === categoryName.toLowerCase()
        );
      }

      // 2. If target is "general" or didn't match, try fuzzy-matching the context
      //    text against category names (e.g., "google security alerts" → "Security")
      //    Only match names >= 3 chars to avoid false positives on short names like "AI"
      if (!matchedCategory && categories.length > 0) {
        const lowerContext = contextText.toLowerCase();
        matchedCategory = categories.find(
          (c) => c.name.length >= 3 && lowerContext.includes(c.name.toLowerCase())
        );
      }

      // 3. If still no match but user is viewing a category, use that
      if (!matchedCategory && currentCategory) {
        matchedCategory = categories.find(
          (c) => c.name.toLowerCase() === currentCategory.toLowerCase()
        );
      }

      // ── Check for ordering commands first ──
      // Ordering commands ("put Personal last", "move Work before Finance") should
      // reorder categories, NOT save the text as a category description.
      const categoryNames = categories.map((c) => c.name);
      // Try ordering detection on the user's original message first (it has the
      // actionable verbs like "put", "move", "last" that the AI's summary strips out),
      // then fall back to the AI's reformulated contextText.
      const orderingParsed =
        (originalUserMessage
          ? parseOrderingIntent(originalUserMessage, categoryNames)
          : null) ?? parseOrderingIntent(contextText, categoryNames);

      if (orderingParsed) {
        // This is a layout/ordering command — execute reorder, skip description save
        try {
          const newOrder = computeNewOrder(
            categories.map((c) => ({ id: c.id, name: c.name })),
            orderingParsed.category,
            orderingParsed.intent
          );

          if (!newOrder) {
            // No-op (already in position) or invalid
            toast.info(`"${orderingParsed.category}" is already in that position`);
            return;
          }

          const reorderRes = await fetch('/api/categories/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order: newOrder }),
          });

          if (!reorderRes.ok) {
            const err = await reorderRes.json().catch(() => ({}));
            toast.error(
              (err as { error?: string }).error || 'Failed to reorder categories'
            );
            revertResolved();
            return;
          }

          // Describe the action for the toast
          const positionDesc =
            orderingParsed.intent.type === 'last'
              ? 'to last position'
              : orderingParsed.intent.type === 'first'
                ? 'to first position'
                : orderingParsed.intent.type === 'before'
                  ? `before ${orderingParsed.intent.relativeTo}`
                  : `after ${orderingParsed.intent.relativeTo}`;

          toast.success(
            `Moved "${orderingParsed.category}" ${positionDesc}`,
            { description: 'Board columns will update on next refresh.' }
          );

          // Refresh the UI so board view picks up the new order
          onRefresh?.();
        } catch {
          toast.error('Failed to reorder categories');
          revertResolved();
        }
        return;
      }

      // ── Standard context flow: save description + recategorize ──

      if (!matchedCategory) {
        toast.error(
          'Could not determine which category to update. Try mentioning a specific category name.',
          { duration: 5000 }
        );
        revertResolved();
        return;
      }

      // Update category description — append if not already present
      try {
        const existingDesc = matchedCategory.description?.trim() ?? '';

        // Dedup: skip if this exact context is already in the description
        if (existingDesc.includes(contextText.trim())) {
          toast.info(`"${matchedCategory.name}" already has this context`);
          return;
        }

        const newDesc = existingDesc
          ? `${existingDesc}\n${contextText}`
          : contextText;

        const updateRes = await fetch(`/api/categories/${matchedCategory.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: newDesc }),
        });

        if (!updateRes.ok) {
          const err = await updateRes.json().catch(() => ({}));
          toast.error(err.error || 'Failed to update category');
          revertResolved();
          return;
        }

        toast.success(`Updated "${matchedCategory.name}" — re-categorizing existing emails...`);

        // Fire non-blocking recategorization with the new context
        fetch('/api/categorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recategorize: true,
            refinementPrompt: contextText,
            sourceCategory: matchedCategory.name,
          }),
        })
          .then(async (recatRes) => {
            if (recatRes.ok) {
              const recatData = await recatRes.json();
              const count = recatData.pending ?? 0;
              if (count > 0) {
                toast.success(`Re-categorizing ${count} emails with new context`, {
                  description: 'The dashboard will update as emails are processed.',
                  duration: 5000,
                });
                // Wait a bit for the background task to process, then refresh UI
                // Background categorization runs via Next.js `after()`, typically completes
                // within a few seconds for 100 emails (4 batches of 25).
                setTimeout(() => onRefresh?.(), 8000);
              } else {
                toast.info('No existing emails matched for re-categorization');
              }
            } else {
              toast.error('Failed to start re-categorization');
            }
          })
          .catch(() => {
            toast.error('Re-categorization request failed');
          });
      } catch {
        toast.error('Failed to apply context');
        revertResolved();
      }
    },
    [currentCategory, onRefresh]
  );

  const handleExecuteCommand = useCallback(
    async (msgId: string, intent: IntentResponse) => {
      const action = intent.details.action as string;
      const description = (intent.details.description as string) ?? intent.summary;

      // For now, show a toast confirming the action
      // Full execution would require building filter-to-API-call translation
      toast.info(`Executing: ${description}`, {
        description: `Action: ${action}. This feature is coming soon.`,
      });

      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, resolved: true } : m))
      );
    },
    []
  );

  const handleCreateRule = useCallback(
    async (msgId: string, intent: IntentResponse) => {
      const suggestion =
        (intent.details.workflow_suggestion as string) ?? intent.summary;

      // Navigate to workflows page — the workflow generation system is already built
      try {
        const res = await fetch('/api/workflows/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: suggestion }),
        });

        if (!res.ok) {
          toast.error('Failed to generate workflow rule');
          return;
        }

        const generated = await res.json();
        toast.success(`Generated rule: "${generated.name}"`, {
          description: 'Go to Workflows to review and activate.',
          action: {
            label: 'Open Workflows',
            onClick: () => (window.location.href = '/workflows'),
          },
        });

        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, resolved: true } : m))
        );
      } catch {
        toast.error('Failed to create rule');
      }
    },
    []
  );

  const handleDismiss = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, resolved: true } : m))
    );
  }, []);

  // ── Render ──

  return (
    <>
      {/* Mobile: full-screen overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
          role="presentation"
        />
      )}

      <div
        className={cn(
          // Base styles
          'flex flex-col bg-background border-l border-border transition-all duration-300 ease-in-out z-50',
          // Mobile: full-screen overlay
          'fixed inset-0 lg:relative lg:inset-auto',
          // Desktop: side panel
          'lg:h-full',
          // Open/close
          open
            ? 'translate-x-0 lg:w-[380px] lg:min-w-[320px]'
            : 'translate-x-full lg:w-0 lg:min-w-0 lg:overflow-hidden'
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Chat with InboxPilot"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-semibold text-foreground">
            Chat with InboxPilot
          </h2>
          <Button variant="ghost" size="icon-xs" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 space-y-4"
        >
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-8 space-y-3">
              <Brain className="h-8 w-8 mx-auto text-muted-foreground/50" />
              {memoriesLoading ? (
                <Loader2 className="h-4 w-4 mx-auto animate-spin text-muted-foreground/50" />
              ) : memories.length > 0 ? (
                <>
                  <p className="text-xs font-medium text-muted-foreground/70">
                    I remember what you&apos;ve taught me:
                  </p>
                  <div className="text-left space-y-2 px-2">
                    {memories.map((mem) => (
                      <div key={mem.name}>
                        <p className="text-xs font-semibold text-foreground/70">{mem.name}</p>
                        {mem.lines.map((line, i) => (
                          <p
                            key={i}
                            className="text-xs text-muted-foreground/60 pl-2 leading-relaxed"
                          >
                            &ldquo;{line}&rdquo;
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p>Ask InboxPilot anything.</p>
                  <p className="text-xs">
                    Teach it about categories, execute commands, or create rules.
                  </p>
                </>
              )}
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'flex flex-col gap-1.5',
                msg.role === 'user' ? 'items-end' : 'items-start'
              )}
            >
              {/* Message bubble */}
              <div
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                )}
              >
                {msg.role === 'assistant' && msg.intent && (
                  <div className="mb-1.5">
                    <IntentBadge type={msg.intent.type} />
                  </div>
                )}
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>

              {/* Action buttons for assistant messages with intents */}
              {msg.role === 'assistant' && msg.intent && !msg.resolved && (
                <div className="flex gap-1.5 max-w-[85%]">
                  {msg.intent.type === 'context' && (
                    <Button
                      size="xs"
                      onClick={() => {
                        // Find the preceding user message to get the original text
                        // (the AI's summary strips ordering verbs like "put"/"move"/"last")
                        const msgIdx = messages.findIndex((m) => m.id === msg.id);
                        const precedingUserMsg =
                          msgIdx > 0 && messages[msgIdx - 1].role === 'user'
                            ? messages[msgIdx - 1].content
                            : undefined;
                        handleApplyContext(msg.id, msg.intent!, precedingUserMsg);
                      }}
                    >
                      <Check className="h-3 w-3" />
                      Apply
                    </Button>
                  )}
                  {msg.intent.type === 'command' && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => handleCreateRule(msg.id, msg.intent!)}
                    >
                      <Zap className="h-3 w-3" />
                      Save as Rule
                    </Button>
                  )}
                  {msg.intent.type === 'search' && (
                    <Button
                      size="xs"
                      onClick={() => {
                        const query = (msg.intent!.details.query as string) ?? msg.intent!.summary;
                        toast.info(`Search: "${query}"`, { description: 'Use the toolbar filter to search' });
                        handleDismiss(msg.id);
                      }}
                    >
                      <Search className="h-3 w-3" />
                      Search
                    </Button>
                  )}
                  {msg.intent.type === 'rule' && (
                    <Button
                      size="xs"
                      onClick={() => handleCreateRule(msg.id, msg.intent!)}
                    >
                      <BookOpen className="h-3 w-3" />
                      Create Rule
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => handleDismiss(msg.id)}
                  >
                    <XCircle className="h-3 w-3" />
                    Dismiss
                  </Button>
                </div>
              )}

              {/* Resolved indicator */}
              {msg.role === 'assistant' && msg.resolved && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  Done
                </span>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {sending && (
            <div className="flex items-start">
              <div className="bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Thinking...
              </div>
            </div>
          )}
        </div>

        {/* Input area */}
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 px-4 py-3 border-t border-border flex-shrink-0"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={sending}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <Button
            type="submit"
            size="icon-xs"
            disabled={sending || !input.trim()}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>
      </div>
    </>
  );
}
