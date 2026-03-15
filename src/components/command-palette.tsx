'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Inbox,
  Settings,
  Zap,
  RefreshCw,
  Sparkles,
  Star,
  Search,
  MessageSquare,
  ArrowRight,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useView } from '@/contexts/view-context';

interface CommandPaletteProps {
  onOpenChat: (prefill?: string) => void;
}

export function CommandPalette({ onOpenChat }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const { setSelectedSystemGroup, addFilter } = useView();

  // Register global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Reset query when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const runAndClose = useCallback(
    (fn: () => void) => {
      fn();
      setOpen(false);
    },
    []
  );

  const handleSendToAI = useCallback(() => {
    const text = query.trim();
    setOpen(false);
    // Small delay to let the dialog close animation finish
    setTimeout(() => {
      onOpenChat(text || undefined);
    }, 100);
  }, [query, onOpenChat]);

  const handleSync = useCallback(() => {
    toast.info('Syncing emails...');
    fetch('/api/sync', { method: 'POST' })
      .then((res) => {
        if (res.ok) {
          window.dispatchEvent(new Event('inboxpilot:sync-complete'));
          toast.success('Sync complete');
        } else {
          toast.error('Sync failed');
        }
      })
      .catch(() => toast.error('Sync failed — network error'));
  }, []);

  const handleCategorize = useCallback(() => {
    toast.info('Categorizing emails...');
    fetch('/api/categorize', { method: 'POST' })
      .then((res) => {
        if (res.ok) {
          toast.success('Categorization complete');
          window.dispatchEvent(new Event('inboxpilot:sync-complete'));
        } else {
          toast.error('Categorization failed');
        }
      })
      .catch(() => toast.error('Categorization failed — network error'));
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search, navigate, or ask InboxPilot..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          <div className="flex flex-col items-center gap-2 py-2">
            <p className="text-muted-foreground">No matching commands</p>
            {query.trim() && (
              <button
                onClick={handleSendToAI}
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <MessageSquare className="h-4 w-4" />
                Ask InboxPilot: &quot;{query.trim()}&quot;
              </button>
            )}
          </div>
        </CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem
            onSelect={() => runAndClose(() => router.push('/dashboard'))}
          >
            <Inbox className="h-4 w-4" />
            <span>Go to Inbox</span>
            <CommandShortcut>Dashboard</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runAndClose(() => router.push('/workflows'))}
          >
            <Zap className="h-4 w-4" />
            <span>Go to Workflows</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runAndClose(() => router.push('/settings'))}
          >
            <Settings className="h-4 w-4" />
            <span>Go to Settings</span>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runAndClose(() => {
                setSelectedSystemGroup('starred');
              })
            }
          >
            <Star className="h-4 w-4" />
            <span>Go to Starred</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => runAndClose(handleSync)}
          >
            <RefreshCw className="h-4 w-4" />
            <span>Sync emails</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runAndClose(handleCategorize)}
          >
            <Sparkles className="h-4 w-4" />
            <span>Categorize uncategorized</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runAndClose(() => onOpenChat())}
          >
            <MessageSquare className="h-4 w-4" />
            <span>Open chat</span>
          </CommandItem>
        </CommandGroup>

        {query.trim() && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Ask InboxPilot">
              <CommandItem onSelect={handleSendToAI}>
                <ArrowRight className="h-4 w-4" />
                <span>
                  Send &quot;{query.trim().length > 60 ? query.trim().slice(0, 60) + '...' : query.trim()}&quot; to AI assistant
                </span>
              </CommandItem>
              <CommandItem
                onSelect={() =>
                  runAndClose(() => {
                    addFilter({
                      field: 'subject',
                      operator: 'contains',
                      value: query.trim(),
                    });
                  })
                }
              >
                <Search className="h-4 w-4" />
                <span>Search emails for &quot;{query.trim().length > 60 ? query.trim().slice(0, 60) + '...' : query.trim()}&quot;</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
