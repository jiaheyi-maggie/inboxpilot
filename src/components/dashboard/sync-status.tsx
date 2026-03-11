'use client';

import { useCallback, useState } from 'react';
import { RefreshCw, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SyncStatus() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    setResult(null);

    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        setResult({
          success: true,
          message: `Synced ${data.fetched} emails, categorized ${data.categorized}`,
        });
      } else {
        setResult({
          success: false,
          message: data.details || data.error || 'Sync failed',
        });
      }
    } catch {
      setResult({
        success: false,
        message: 'Network error',
      });
    } finally {
      setSyncing(false);
    }
  }, []);

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span
          className={`text-xs ${
            result.success ? 'text-green-600' : 'text-red-500'
          } flex items-center gap-1`}
        >
          {result.success ? (
            <Check className="h-3 w-3" />
          ) : (
            <AlertCircle className="h-3 w-3" />
          )}
          <span className="text-xs max-w-[200px] truncate">{result.message}</span>
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={triggerSync}
        disabled={syncing}
        title="Sync emails"
      >
        <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  );
}
