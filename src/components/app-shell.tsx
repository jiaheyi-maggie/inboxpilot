'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Settings, LogOut, ShieldAlert } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SyncStatus } from '@/components/dashboard/sync-status';

interface AppShellProps {
  userEmail: string;
  account: {
    id: string;
    email: string;
    last_sync_at: string | null;
    sync_enabled: boolean;
    granted_scope: string;
  } | null;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Inbox' },
  { href: '/workflows', label: 'Workflows' },
] as const;

export function AppShell({ userEmail, account, children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();

  const handleSyncComplete = useCallback(() => {
    window.dispatchEvent(new Event('inboxpilot:sync-complete'));
    router.refresh();
  }, [router]);

  const handleSignOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/';
  }, []);

  return (
    <div className="h-screen flex flex-col">
      {/* Persistent header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-4">
          {/* Logo + name */}
          <Link href="/dashboard" className="flex items-center gap-2">
            <Image src="/logo.png" alt="InboxPilot" width={24} height={24} className="rounded" />
            <span className="font-bold text-foreground">InboxPilot</span>
          </Link>

          {/* Navigation */}
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1">
          <SyncStatus onSyncComplete={handleSyncComplete} />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => router.push('/settings')}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                  {userEmail?.[0]?.toUpperCase() ?? '?'}
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground truncate">
                {userEmail}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Alert banners */}
      {!account && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 text-sm text-amber-700 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-400">
          No Gmail account linked. Please sign out and sign in again with Google.
        </div>
      )}

      {account && !account.last_sync_at && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 text-sm text-blue-700 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-400">
          First time? Tap the sync button above to fetch your emails.
        </div>
      )}

      {account && account.granted_scope === 'gmail.readonly' && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 text-sm text-amber-700 flex items-center gap-2 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-400">
          <ShieldAlert className="h-4 w-4 flex-shrink-0" />
          <span>
            Limited permissions. Sign out and sign back in to enable email actions (archive, trash, star).
          </span>
        </div>
      )}

      {/* Page content — overflow-hidden so dashboard fills exactly; pages that scroll handle it themselves */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
