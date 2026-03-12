'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
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
import { EmailTree } from '@/components/dashboard/email-tree';
import { SyncStatus } from '@/components/dashboard/sync-status';
import type { GroupingConfig, GmailAccount, SyncJob } from '@/types';

interface DashboardClientProps {
  config: GroupingConfig | null;
  account: Pick<GmailAccount, 'id' | 'email' | 'last_sync_at' | 'sync_enabled' | 'granted_scope'> | null;
  lastSync: SyncJob | null;
  userEmail: string;
}

export function DashboardClient({
  config,
  account,
  lastSync,
  userEmail,
}: DashboardClientProps) {
  const router = useRouter();
  const autoSyncTriggered = useRef(false);

  // Key to force re-fetch of EmailTree when sync completes
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);

  const handleSyncComplete = useCallback(() => {
    setTreeRefreshKey((k) => k + 1);
    router.refresh(); // also re-fetch server component data
  }, [router]);

  // Auto-sync on mount if last sync was >5 min ago (or never synced)
  useEffect(() => {
    if (autoSyncTriggered.current || !account?.sync_enabled) return;
    const STALE_MS = 5 * 60 * 1000; // 5 minutes
    const lastSyncTime = account?.last_sync_at
      ? new Date(account.last_sync_at).getTime()
      : 0;
    if (Date.now() - lastSyncTime > STALE_MS) {
      autoSyncTriggered.current = true;
      fetch('/api/sync', { method: 'POST' })
        .then(() => handleSyncComplete())
        .catch(() => {}); // silent — user can manually retry
    }
  }, [account, handleSyncComplete]);

  const handleSignOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Hard navigation to bypass Next.js router cache and let middleware
    // re-evaluate the (now cleared) session cookies
    window.location.href = '/';
  }, []);

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Image src="/logo.png" alt="InboxPilot" width={24} height={24} className="rounded" />
          <span className="font-bold text-foreground">InboxPilot</span>
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

      {/* Sync info banner */}
      {!account && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 text-sm text-amber-700">
          No Gmail account linked. Please sign out and sign in again with Google.
        </div>
      )}

      {account && !account.last_sync_at && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 text-sm text-blue-700">
          First time? Tap the sync button above to fetch your emails.
        </div>
      )}

      {account && account.granted_scope === 'gmail.readonly' && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 text-sm text-amber-700 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 flex-shrink-0" />
          <span>
            Limited permissions. Sign out and sign back in to enable email actions (archive, trash, star).
          </span>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {config ? (
          <EmailTree config={config} refreshKey={treeRefreshKey} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm px-4 text-center">
            <div>
              <p>No grouping configuration set up.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => router.push('/settings')}
              >
                <Settings className="h-4 w-4" />
                Configure Grouping
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
