'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmailTree } from '@/components/dashboard/email-tree';
import type { GroupingConfig, GmailAccount } from '@/types';

interface DashboardClientProps {
  config: GroupingConfig | null;
  account: Pick<GmailAccount, 'id' | 'email' | 'last_sync_at' | 'sync_enabled' | 'granted_scope'> | null;
}

export function DashboardClient({
  config,
  account,
}: DashboardClientProps) {
  const router = useRouter();
  const autoSyncTriggered = useRef(false);

  // Key to force re-fetch of EmailTree when sync completes
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);

  // Listen for sync-complete events from AppShell's SyncStatus
  useEffect(() => {
    const handler = () => setTreeRefreshKey((k) => k + 1);
    window.addEventListener('inboxpilot:sync-complete', handler);
    return () => window.removeEventListener('inboxpilot:sync-complete', handler);
  }, []);

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
        .then(() => {
          setTreeRefreshKey((k) => k + 1);
          router.refresh();
        })
        .catch(() => {}); // silent — user can manually retry
    }
  }, [account, router]);

  return (
    <div className="h-full">
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
    </div>
  );
}
