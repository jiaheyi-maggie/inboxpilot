'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Inbox, Settings, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { EmailTree } from '@/components/dashboard/email-tree';
import { SyncStatus } from '@/components/dashboard/sync-status';
import type { GroupingConfig, GmailAccount, SyncJob } from '@/types';

interface DashboardClientProps {
  config: GroupingConfig | null;
  account: Pick<GmailAccount, 'id' | 'email' | 'last_sync_at' | 'sync_enabled'> | null;
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
  const [showMenu, setShowMenu] = useState(false);

  const handleSignOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  }, [router]);

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Inbox className="h-5 w-5 text-blue-600" />
          <span className="font-bold text-slate-900">InboxPilot</span>
        </div>

        <div className="flex items-center gap-1">
          <SyncStatus />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/settings')}
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowMenu(!showMenu)}
              title={userEmail}
            >
              <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-700">
                {userEmail?.[0]?.toUpperCase() ?? '?'}
              </div>
            </Button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50">
                <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-100">
                  {userEmail}
                </div>
                <button
                  onClick={handleSignOut}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <LogOut className="h-3 w-3" />
                  Sign out
                </button>
              </div>
            )}
          </div>
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

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {config ? (
          <EmailTree config={config} />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm px-4 text-center">
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
