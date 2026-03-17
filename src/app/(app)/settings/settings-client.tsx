'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, X, Pencil, Mail, Info, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'next/navigation';
import { CategoryManager } from '@/components/settings/category-manager';

/** Preset colors for account color picker. */
const ACCOUNT_COLORS = [
  '#3B82F6', // blue
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
  '#84CC16', // lime
  '#6366F1', // indigo
];

interface AccountInfo {
  id: string;
  email: string;
  display_name: string | null;
  color: string;
  sync_enabled: boolean;
  last_sync_at: string | null;
  granted_scope: string;
}

interface SettingsClientProps {
  initialAutoCategorizeUnread: boolean;
  accounts: AccountInfo[];
}

export function SettingsClient({
  initialAutoCategorizeUnread,
  accounts: initialAccounts,
}: SettingsClientProps) {
  const [autoCategorize, setAutoCategorize] = useState(initialAutoCategorizeUnread);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [accounts, setAccounts] = useState(initialAccounts);
  const searchParams = useSearchParams();

  // Show toast for connect-account results from OAuth callback redirect
  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    const email = searchParams.get('email');

    if (success === 'account_connected') {
      toast.success(`Connected ${email ?? 'account'}`, {
        description: 'Gmail account linked. Sync to fetch emails.',
      });
    } else if (success === 'account_refreshed') {
      toast.info(`Refreshed ${email ?? 'account'}`, {
        description: 'Gmail tokens updated.',
      });
    } else if (error === 'oauth_cancelled') {
      toast.error('Account connection cancelled');
    } else if (error) {
      toast.error(`Failed to connect account: ${error}`);
    }

    // Clean query params to prevent toast re-firing on re-render
    if (success || error) {
      window.history.replaceState({}, '', '/settings');
    }
  }, [searchParams]);

  const handleToggleAutoCategorize = useCallback(async () => {
    const newValue = !autoCategorize;
    setAutoCategorize(newValue);
    setSavingPrefs(true);
    try {
      await fetch('/api/settings/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_categorize_unread: newValue }),
      });
    } catch {
      setAutoCategorize(!newValue);
    } finally {
      setSavingPrefs(false);
    }
  }, [autoCategorize]);

  const handleAccountUpdated = useCallback((updated: AccountInfo) => {
    setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }, []);

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-lg mx-auto px-4 py-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure your inbox organization and preferences
        </p>
      </div>

      {/* View configuration note */}
      <div className="border border-border rounded-lg p-4 bg-muted/30">
        <p className="text-sm text-muted-foreground">
          View modes (List, Board, Tree) and grouping are now configured directly in the dashboard toolbar using the Filter, Sort, and Group controls.
        </p>
      </div>

      {/* Accounts section — always shown */}
      <div>
        <h2 className="text-sm font-semibold mb-1">Connected Accounts</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Manage your Gmail accounts. Connect multiple inboxes to see them in a unified view.
        </p>
        <AccountManager accounts={accounts} onAccountUpdated={handleAccountUpdated} />
      </div>

      {/* Categories section */}
      <div>
        <h2 className="text-sm font-semibold mb-1">Categories</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Customize how your emails are categorized. Add descriptions to help the AI understand each category.
        </p>
        <CategoryManager />
      </div>

      {/* Behavior section */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Behavior</h2>
        <div className="border border-border rounded-lg p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium">
                Auto-categorize unread emails
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                When off, unread emails stay in the Unread section until you read them
              </p>
            </div>
            <button
              onClick={handleToggleAutoCategorize}
              disabled={savingPrefs}
              className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${
                autoCategorize ? 'bg-primary' : 'bg-muted'
              } ${savingPrefs ? 'opacity-50' : ''}`}
            >
              {savingPrefs ? (
                <Loader2 className="absolute top-1 left-1 h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    autoCategorize ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

// ── Account Manager ──

interface AccountManagerProps {
  accounts: AccountInfo[];
  onAccountUpdated: (account: AccountInfo) => void;
}

function AccountManager({ accounts, onAccountUpdated }: AccountManagerProps) {
  const [connecting, setConnecting] = useState(false);

  const handleConnectAccount = useCallback(() => {
    setConnecting(true);
    // Redirect to the server-side Google OAuth flow
    window.location.href = '/api/accounts/connect';
  }, []);

  return (
    <div className="space-y-3">
      <div className="border border-border rounded-lg divide-y divide-border">
        {accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            onUpdated={onAccountUpdated}
          />
        ))}
      </div>

      {/* Connect another Gmail account */}
      <button
        onClick={handleConnectAccount}
        disabled={connecting}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-border
          text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-accent/50
          transition-colors disabled:opacity-50"
      >
        {connecting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {connecting ? 'Connecting...' : 'Connect Another Gmail'}
      </button>

      <div className="flex items-start gap-2 px-1">
        <Info className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Each connected Gmail is synced independently. Your primary login stays the same.
        </p>
      </div>
    </div>
  );
}

// ── Individual Account Row ──

interface AccountRowProps {
  account: AccountInfo;
  onUpdated: (account: AccountInfo) => void;
}

function AccountRow({ account, onUpdated }: AccountRowProps) {
  const [editing, setEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState(account.display_name ?? '');
  const [editColor, setEditColor] = useState(account.color);
  const [saving, setSaving] = useState(false);

  const startEdit = useCallback(() => {
    setEditing(true);
    setEditDisplayName(account.display_name ?? '');
    setEditColor(account.color);
  }, [account.display_name, account.color]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditDisplayName(account.display_name ?? '');
    setEditColor(account.color);
  }, [account.display_name, account.color]);

  const saveEdit = useCallback(async () => {
    if (saving) return; // guard against double-submit
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: editDisplayName.trim() || '',
          color: editColor,
        }),
      });
      if (res.ok) {
        const { account: updated } = await res.json();
        onUpdated(updated);
        setEditing(false);
        toast.success('Account updated');
      } else {
        const { error } = await res.json();
        toast.error(error || 'Failed to update account');
      }
    } catch {
      toast.error('Failed to update account');
    } finally {
      setSaving(false);
    }
  }, [saving, account.id, editDisplayName, editColor, onUpdated]);

  return (
    <div className="px-4 py-3">
      {editing ? (
        <div className="space-y-3">
          {/* Email (read-only) */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            <span className="truncate">{account.email}</span>
          </div>

          {/* Display name input */}
          <input
            type="text"
            value={editDisplayName}
            onChange={(e) => setEditDisplayName(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            placeholder="Display name (e.g., Work, Personal)"
            maxLength={50}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveEdit();
              if (e.key === 'Escape') cancelEdit();
            }}
          />

          {/* Color picker */}
          <div>
            <span className="text-xs font-medium text-muted-foreground mb-1.5 block">Color</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {ACCOUNT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setEditColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${
                    editColor === c
                      ? 'border-foreground scale-110'
                      : 'border-transparent hover:border-muted-foreground/30'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Save / Cancel buttons */}
          <div className="flex gap-1">
            <button
              onClick={saveEdit}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md hover:bg-accent disabled:opacity-50"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {/* Color dot */}
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: account.color }}
          />

          {/* Account info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {account.display_name ?? account.email}
            </p>
            {account.display_name && (
              <p className="text-xs text-muted-foreground truncate">{account.email}</p>
            )}
          </div>

          {/* Edit button */}
          <button
            onClick={startEdit}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Edit account"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
