'use client';

import { ChevronRight, Inbox, Search, X } from 'lucide-react';
import { useView } from '@/contexts/view-context';

interface ViewBreadcrumbProps {
  emailCount: number;
  /** Subject of the currently selected email (detail view) */
  selectedEmailSubject?: string | null;
}

const SYSTEM_GROUP_LABELS: Record<string, string> = {
  starred: 'Starred',
  archived: 'Archived',
  trash: 'Trash',
};

export function ViewBreadcrumb({
  emailCount,
  selectedEmailSubject,
}: ViewBreadcrumbProps) {
  const {
    selectedCategory,
    setSelectedCategory,
    selectedSystemGroup,
    setSelectedSystemGroup,
    selectedEmailId,
    setSelectedEmailId,
    searchQuery,
    clearSearch,
  } = useView();

  const activeLabel = selectedCategory
    ?? (selectedSystemGroup ? SYSTEM_GROUP_LABELS[selectedSystemGroup] ?? selectedSystemGroup : null);

  const isDetailView = !!selectedEmailId && !!selectedEmailSubject;

  // Build breadcrumb segments
  // Segment: { label, onClick (if clickable), isActive (last segment) }
  const segments: { label: string; onClick?: () => void }[] = [];

  // Root segment: "All Mail"
  const hasNavContext = !!activeLabel || isDetailView;
  segments.push({
    label: 'All Mail',
    onClick: hasNavContext
      ? () => {
          setSelectedCategory(null);
          setSelectedSystemGroup(null);
          setSelectedEmailId(null);
        }
      : undefined,
  });

  // Middle segment: category or system group
  if (activeLabel) {
    segments.push({
      label: activeLabel,
      onClick: isDetailView
        ? () => {
            setSelectedEmailId(null);
          }
        : undefined,
    });
  }

  // Leaf segment: email subject (detail view)
  if (isDetailView) {
    const subject = selectedEmailSubject && selectedEmailSubject.length > 60
      ? selectedEmailSubject.slice(0, 57) + '...'
      : (selectedEmailSubject ?? 'Untitled');
    segments.push({ label: subject });
  }

  // Determine which chip to show (category or system group — mutually exclusive via context)
  const showCategoryChip = !!selectedCategory && !isDetailView && !searchQuery;
  const showSystemGroupChip = !!selectedSystemGroup && !isDetailView && !searchQuery;
  const showSearchChip = !!searchQuery && !isDetailView;

  return (
    <div className="px-4 py-1.5 border-b border-border bg-muted/30 text-sm flex-shrink-0">
      <div className="flex items-center justify-between gap-4">
        {/* Left: breadcrumb path */}
        <nav className="flex items-center gap-1 min-w-0" aria-label="Breadcrumb">
          {searchQuery ? (
            <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <Inbox className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          )}
          {searchQuery ? (
            <span className="flex items-center gap-1 min-w-0">
              <span className="text-foreground font-medium truncate">
                &quot;{searchQuery.length > 50 ? searchQuery.slice(0, 47) + '...' : searchQuery}&quot;
              </span>
            </span>
          ) : (
            segments.map((seg, i) => {
              const isLast = i === segments.length - 1;
              return (
                <span key={i} className="flex items-center gap-1 min-w-0">
                  {i > 0 && (
                    <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  )}
                  {seg.onClick ? (
                    <button
                      onClick={seg.onClick}
                      className="text-primary hover:underline cursor-pointer truncate"
                    >
                      {seg.label}
                    </button>
                  ) : (
                    <span
                      className={
                        isLast
                          ? 'text-foreground font-medium truncate'
                          : 'text-muted-foreground truncate'
                      }
                    >
                      {seg.label}
                    </span>
                  )}
                </span>
              );
            })
          )}
        </nav>

        {/* Right: email count (hidden in detail view) */}
        {!isDetailView && (
          <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
            {emailCount} {searchQuery ? (emailCount === 1 ? 'result' : 'results') : (emailCount === 1 ? 'email' : 'emails')}
          </span>
        )}
      </div>

      {/* Chip row: search, category, or system group (only when not in detail view) */}
      {(showSearchChip || showCategoryChip || showSystemGroupChip) && (
        <div className="flex items-center gap-1.5 mt-1">
          {showSearchChip && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 text-xs">
              <Search className="h-2.5 w-2.5" />
              Search
              <button
                onClick={clearSearch}
                className="hover:bg-green-500/20 rounded-full p-0.5"
                aria-label="Clear search"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
          {showCategoryChip && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
              {selectedCategory}
              <button
                onClick={() => setSelectedCategory(null)}
                className="hover:bg-primary/20 rounded-full p-0.5"
                aria-label={`Clear ${selectedCategory} filter`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
          {showSystemGroupChip && selectedSystemGroup && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
              {SYSTEM_GROUP_LABELS[selectedSystemGroup] ?? selectedSystemGroup}
              <button
                onClick={() => setSelectedSystemGroup(null)}
                className="hover:bg-primary/20 rounded-full p-0.5"
                aria-label={`Clear ${selectedSystemGroup} filter`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
