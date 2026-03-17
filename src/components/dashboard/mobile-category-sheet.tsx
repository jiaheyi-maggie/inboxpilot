'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Inbox, Star, Archive, Trash2, Folder, Mail, Check } from 'lucide-react';
import type { TreeNode, SystemGroupKey, GmailAccount } from '@/types';

/** Minimal account info for rendering */
type AccountInfo = Pick<GmailAccount, 'id' | 'email' | 'color' | 'display_name'>;

interface MobileCategorySheetProps {
  open: boolean;
  onClose: () => void;
  rootNodes: TreeNode[];
  selectedCategory: string | null;
  selectedSystemGroup: SystemGroupKey | null;
  selectedAccountId: string | null;
  accounts: AccountInfo[];
  onSelectCategory: (cat: string | null) => void;
  onSelectSystemGroup: (group: SystemGroupKey | null) => void;
  onSelectAccount: (id: string | null) => void;
}

const SYSTEM_GROUPS: { key: SystemGroupKey; label: string; icon: typeof Star }[] = [
  { key: 'starred', label: 'Starred', icon: Star },
  { key: 'archived', label: 'Archived', icon: Archive },
  { key: 'trash', label: 'Trash', icon: Trash2 },
];

export function MobileCategorySheet({
  open,
  onClose,
  rootNodes,
  selectedCategory,
  selectedSystemGroup,
  selectedAccountId,
  accounts,
  onSelectCategory,
  onSelectSystemGroup,
  onSelectAccount,
}: MobileCategorySheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);
  const touchCurrentY = useRef<number | null>(null);
  const handleBarRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [open, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Focus the sheet when it opens
  useEffect(() => {
    if (open && sheetRef.current) {
      sheetRef.current.focus();
    }
  }, [open]);

  // Swipe-to-dismiss handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Only allow swipe-to-dismiss from the handle bar area, not from scrollable content
    if (handleBarRef.current && !handleBarRef.current.contains(e.target as Node)) return;
    touchStartY.current = e.touches[0].clientY;
    touchCurrentY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    touchCurrentY.current = e.touches[0].clientY;

    const delta = touchCurrentY.current - touchStartY.current;
    // Only allow downward swipe (positive delta) and only from the handle area
    if (delta > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${delta}px)`;
      sheetRef.current.style.transition = 'none';
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (touchStartY.current === null || touchCurrentY.current === null) return;

    const delta = touchCurrentY.current - touchStartY.current;
    touchStartY.current = null;
    touchCurrentY.current = null;

    if (sheetRef.current) {
      // Reset inline transform — let CSS transition take over
      sheetRef.current.style.transform = '';
      sheetRef.current.style.transition = '';
    }

    // If swiped down more than 80px, close
    if (delta > 80) {
      onClose();
    }
  }, [onClose]);

  // Selection handlers that auto-close the sheet
  const handleSelectAllMail = useCallback(() => {
    onSelectCategory(null);
    onSelectSystemGroup(null);
    onClose();
  }, [onSelectCategory, onSelectSystemGroup, onClose]);

  const handleSelectSystemGroup = useCallback(
    (group: SystemGroupKey) => {
      // Toggle: if already selected, deselect
      if (selectedSystemGroup === group) {
        onSelectSystemGroup(null);
      } else {
        onSelectSystemGroup(group);
      }
      onClose();
    },
    [selectedSystemGroup, onSelectSystemGroup, onClose],
  );

  const handleSelectCategory = useCallback(
    (cat: string) => {
      // Toggle: if already selected, deselect (go to All Mail)
      if (selectedCategory === cat) {
        onSelectCategory(null);
      } else {
        onSelectCategory(cat);
      }
      onClose();
    },
    [selectedCategory, onSelectCategory, onClose],
  );

  const handleSelectAccount = useCallback(
    (accountId: string | null) => {
      onSelectAccount(accountId);
      onClose();
    },
    [onSelectAccount, onClose],
  );

  const totalCount = rootNodes.reduce((sum, n) => sum + n.count, 0);
  const isAllMail = !selectedCategory && !selectedSystemGroup;
  const showAccounts = accounts.length > 1;

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity lg:hidden ${
          open
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
        }`}
        style={{ transitionDuration: open ? '300ms' : '200ms' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        tabIndex={-1}
        className={`fixed inset-x-0 bottom-0 z-50 max-h-[70vh] rounded-t-2xl bg-card border-t border-border shadow-2xl outline-none lg:hidden ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          transitionProperty: 'transform',
          transitionTimingFunction: open ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'ease-in',
          transitionDuration: open ? '300ms' : '200ms',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Handle bar — swipe-to-dismiss only from this area */}
        <div ref={handleBarRef} className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto overscroll-contain px-3 pb-6" style={{ maxHeight: 'calc(70vh - 32px)' }}>
          {/* All Mail */}
          <div className="pb-2">
            <button
              onClick={handleSelectAllMail}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isAllMail
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground active:bg-accent'
              }`}
            >
              <Inbox className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 text-left">All Mail</span>
              <span className="text-xs tabular-nums text-muted-foreground">{totalCount}</span>
              {isAllMail && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
            </button>
          </div>

          {/* System groups */}
          <div className="pb-3">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 pb-1.5">
              Quick Filters
            </p>
            <div className="flex items-center gap-2 px-1">
              {SYSTEM_GROUPS.map(({ key, label, icon: Icon }) => {
                const isSelected = selectedSystemGroup === key;
                return (
                  <button
                    key={key}
                    onClick={() => handleSelectSystemGroup(key)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      isSelected
                        ? 'bg-primary/10 text-primary border border-primary/20'
                        : 'bg-muted/50 text-muted-foreground active:bg-accent border border-transparent'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${key === 'starred' && isSelected ? 'fill-primary' : ''}`} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Accounts section */}
          {showAccounts && (
            <div className="pb-3">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 pb-1.5">
                Accounts
              </p>
              <div className="space-y-0.5">
                {/* All accounts option */}
                <button
                  onClick={() => handleSelectAccount(null)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    !selectedAccountId
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground active:bg-accent'
                  }`}
                >
                  <Mail className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-left">All Accounts</span>
                  {!selectedAccountId && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
                </button>
                {accounts.map((account) => {
                  const isSelected = selectedAccountId === account.id;
                  return (
                    <button
                      key={account.id}
                      onClick={() => handleSelectAccount(account.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isSelected
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground active:bg-accent'
                      }`}
                    >
                      <span
                        className="inline-block rounded-full flex-shrink-0"
                        style={{ width: 10, height: 10, backgroundColor: account.color ?? '#3B82F6' }}
                        aria-hidden="true"
                      />
                      <span className="flex-1 text-left truncate">
                        {account.display_name ?? account.email}
                      </span>
                      {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Categories */}
          {rootNodes.length > 0 && (
            <div className="pb-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 pb-1.5">
                Categories
              </p>
              <div className="space-y-0.5">
                {rootNodes.map((node) => {
                  const isSelected = selectedCategory === node.group_key;
                  return (
                    <button
                      key={node.group_key}
                      onClick={() => handleSelectCategory(node.group_key)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                        isSelected
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground active:bg-accent'
                      }`}
                    >
                      <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <span className="flex-1 text-left truncate">{node.group_key}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{node.count}</span>
                      {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {rootNodes.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm font-medium">No categories yet</p>
              <p className="text-xs mt-1">Sync and categorize your emails to see them here</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
