'use client';

import { useCallback, useEffect, useState } from 'react';
import { Folder, AlertCircle, Mail } from 'lucide-react';
import { UnreadSection } from './unread-section';
import { SystemGroups } from './system-groups';
import { CategoryTeachInput } from './category-teach-input';
import { Skeleton } from '@/components/ui/skeleton';
import { useView } from '@/contexts/view-context';
import type { Email, EmailWithCategory, TreeNode, UserCategory, GmailAccount } from '@/types';

/** Minimal account info passed from server */
type AccountInfo = Pick<GmailAccount, 'id' | 'email' | 'last_sync_at' | 'sync_enabled' | 'granted_scope' | 'color' | 'display_name'>;

function TreeSkeleton() {
  return (
    <div className="p-3 space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-3 w-6" />
        </div>
      ))}
    </div>
  );
}

// ── Account dot indicator ──

function AccountDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block rounded-full flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

// ── Category row with inline teach input ──

interface CategoryRowProps {
  node: TreeNode;
  meta?: { id: string; description: string | null };
  isSelected: boolean;
  onSelect: () => void;
  onDescriptionSaved: (desc: string) => void;
}

function CategoryRow({ node, meta, isSelected, onSelect, onDescriptionSaved }: CategoryRowProps) {
  const [teachExpanded, setTeachExpanded] = useState(false);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer group
          ${isSelected
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-foreground hover:bg-accent'
          }
        `}
      >
        <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="truncate flex-1 text-left">{node.group_key}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{node.count}</span>
        {meta && !teachExpanded && (
          <CategoryTeachInput
            categoryId={meta.id}
            currentDescription={meta.description}
            onSaved={onDescriptionSaved}
            onExpandChange={setTeachExpanded}
          />
        )}
      </div>
      {meta && teachExpanded && (
        <div className="px-2 pb-1">
          <CategoryTeachInput
            categoryId={meta.id}
            currentDescription={meta.description}
            onSaved={(desc) => {
              onDescriptionSaved(desc);
              setTeachExpanded(false);
            }}
            onExpandChange={setTeachExpanded}
            startExpanded
          />
        </div>
      )}
    </div>
  );
}

interface SidebarProps {
  /** Root category nodes fetched from API */
  rootNodes: TreeNode[];
  loading: boolean;
  fetchError: boolean;
  onRetry: () => void;
  /** All connected Gmail accounts (for multi-inbox support) */
  accounts: AccountInfo[];
}

export function Sidebar({ rootNodes, loading, fetchError, onRetry, accounts }: SidebarProps) {
  const {
    selectedCategory,
    setSelectedCategory,
    selectedSystemGroup,
    setSelectedSystemGroup,
    selectedAccountId,
    setSelectedAccountId,
    setSelectedEmailId,
    refreshKey,
    triggerRefresh,
  } = useView();

  // Category metadata for teach inputs (id + description)
  const [categoryMeta, setCategoryMeta] = useState<Map<string, { id: string; description: string | null }>>(new Map());

  // Fetch category metadata once and when rootNodes change
  useEffect(() => {
    let cancelled = false;
    fetch('/api/categories')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.categories) return;
        const map = new Map<string, { id: string; description: string | null }>();
        for (const cat of data.categories as UserCategory[]) {
          map.set(cat.name, { id: cat.id, description: cat.description });
        }
        setCategoryMeta(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [rootNodes]);

  // Unread section: selecting an unread email shows it in the main panel
  const handleUnreadEmailSelected = useCallback(
    (email: Email) => {
      const emailWithCat: EmailWithCategory = {
        ...email,
        category: null,
        topic: null,
        priority: null,
        importance_score: null,
        importance_label: null,
        confidence: null,
      };
      // Store the full email object so ActiveViewRouter can display it
      setSelectedEmailId(email.id);
      // Store unread email data for the detail view via a custom event
      window.dispatchEvent(
        new CustomEvent('inboxpilot:unread-email-selected', { detail: emailWithCat })
      );
    },
    [setSelectedEmailId]
  );

  const handleEmailsChanged = useCallback(() => {
    triggerRefresh();
  }, [triggerRefresh]);

  const handleSelectSystemGroup = useCallback(
    (group: typeof selectedSystemGroup extends infer T ? NonNullable<T> : never) => {
      if (selectedSystemGroup === group) {
        setSelectedSystemGroup(null);
        return;
      }
      setSelectedSystemGroup(group);
    },
    [selectedSystemGroup, setSelectedSystemGroup]
  );

  const handleSelectAccount = useCallback(
    (accountId: string) => {
      if (selectedAccountId === accountId) {
        setSelectedAccountId(null); // toggle off = unified view
      } else {
        setSelectedAccountId(accountId);
      }
    },
    [selectedAccountId, setSelectedAccountId]
  );

  const showAccountsSection = accounts.length > 1;

  return (
    <div className="flex flex-col h-full">
      {/* Unread section pinned at top */}
      <UnreadSection
        onEmailRead={handleEmailsChanged}
        onSelectEmail={handleUnreadEmailSelected}
        refreshKey={refreshKey}
        selectedAccountId={selectedAccountId}
      />

      {/* System groups: Starred / Archived / Trash */}
      <SystemGroups
        selectedGroup={selectedSystemGroup}
        onSelectGroup={handleSelectSystemGroup}
        refreshKey={refreshKey}
        selectedAccountId={selectedAccountId}
      />

      {/* Accounts section (only when multiple accounts) */}
      {showAccountsSection && (
        <div className="px-3 pt-3 pb-1 space-y-0.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 pb-1">
            Accounts
          </p>
          {accounts.map((account) => {
            const isSelected = selectedAccountId === account.id;
            return (
              <div
                key={account.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectAccount(account.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectAccount(account.id);
                  }
                }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer
                  ${isSelected
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-accent'
                  }
                `}
              >
                <AccountDot color={account.color ?? '#3B82F6'} />
                <Mail className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="truncate flex-1 text-left">
                  {account.display_name ?? account.email}
                </span>
              </div>
            );
          })}
          {selectedAccountId && (
            <button
              onClick={() => setSelectedAccountId(null)}
              className="text-xs text-muted-foreground hover:text-foreground px-2 mt-0.5"
            >
              Show all accounts
            </button>
          )}
        </div>
      )}

      {/* Category navigation */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <TreeSkeleton />
        ) : fetchError ? (
          <div className="text-center py-12 text-muted-foreground">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto mb-2" />
            <p className="text-sm font-medium text-destructive">Failed to load emails</p>
            <button
              onClick={onRetry}
              className="text-sm text-primary mt-2 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : rootNodes.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg font-medium">No emails yet</p>
            <p className="text-sm mt-1">Tap the sync button to fetch your emails</p>
          </div>
        ) : (
          <div className="p-3 space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 pb-1">
              Categories
            </p>
            {rootNodes.map((node) => {
              const meta = categoryMeta.get(node.group_key);
              return (
                <CategoryRow
                  key={node.group_key}
                  node={node}
                  meta={meta}
                  isSelected={selectedCategory === node.group_key}
                  onSelect={() => setSelectedCategory(
                    selectedCategory === node.group_key ? null : node.group_key
                  )}
                  onDescriptionSaved={(desc) => {
                    if (!meta) return;
                    setCategoryMeta((prev) => {
                      const next = new Map(prev);
                      next.set(node.group_key, { ...meta, description: desc });
                      return next;
                    });
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
