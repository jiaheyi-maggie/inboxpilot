'use client';

import { useState } from 'react';
import {
  Filter,
  ArrowUpDown,
  Layers,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { useView } from '@/contexts/view-context';
import { DIMENSIONS } from '@/lib/grouping/engine';
import type { DimensionKey, ViewFilter, ViewSort } from '@/types';

// ── Filter options ──

const FILTER_OPTIONS: { field: string; label: string; values: { value: string; label: string }[] }[] = [
  {
    field: 'is_read',
    label: 'Read status',
    values: [
      { value: 'false', label: 'Unread' },
      { value: 'true', label: 'Read' },
    ],
  },
  {
    field: 'importance',
    label: 'Importance',
    values: [
      { value: 'critical', label: 'Critical' },
      { value: 'high', label: 'High' },
      { value: 'medium', label: 'Medium' },
      { value: 'low', label: 'Low' },
      { value: 'noise', label: 'Noise' },
    ],
  },
  {
    field: 'has_attachment',
    label: 'Attachments',
    values: [
      { value: 'true', label: 'Has attachment' },
      { value: 'false', label: 'No attachment' },
    ],
  },
  {
    field: 'is_starred',
    label: 'Starred',
    values: [
      { value: 'true', label: 'Starred' },
      { value: 'false', label: 'Not starred' },
    ],
  },
];

// ── Sort options ──

const SORT_OPTIONS: { field: string; label: string }[] = [
  { field: 'received_at', label: 'Date' },
  { field: 'sender_email', label: 'Sender' },
  { field: 'importance_score', label: 'Importance' },
  { field: 'subject', label: 'Subject' },
];

// ── Group by options ──

const GROUP_BY_OPTIONS: { key: DimensionKey; label: string }[] = Object.values(DIMENSIONS).map(
  (d) => ({ key: d.key, label: d.label })
);

// ── Chip display helpers ──

function filterChipLabel(filter: ViewFilter): string {
  const option = FILTER_OPTIONS.find((o) => o.field === filter.field);
  if (!option) return `${filter.field}: ${filter.value}`;
  const valueLabel = option.values.find((v) => v.value === String(filter.value))?.label ?? String(filter.value);
  return `${option.label}: ${valueLabel}`;
}

function sortChipLabel(s: ViewSort): string {
  const option = SORT_OPTIONS.find((o) => o.field === s.field);
  const fieldLabel = option?.label ?? s.field;
  return `${fieldLabel} ${s.direction === 'asc' ? '↑' : '↓'}`;
}

// ── Component ──

export function ViewToolbar() {
  const {
    filters,
    addFilter,
    removeFilter,
    clearFilters,
    sort,
    setSort,
    groupBy,
    setGroupBy,
    viewType,
  } = useView();

  const hasActiveControls = filters.length > 0 || sort.length > 1 ||
    (sort.length === 1 && sort[0].field !== 'received_at');

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Filter button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
            <Filter className="h-3.5 w-3.5" />
            Filter
            {filters.length > 0 && (
              <span className="ml-0.5 bg-primary/20 text-primary rounded-full px-1.5 text-[10px] font-bold">
                {filters.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {FILTER_OPTIONS.map((option) => (
            <div key={option.field}>
              <DropdownMenuLabel className="text-xs">{option.label}</DropdownMenuLabel>
              {option.values.map((val) => {
                const isActive = filters.some(
                  (f) => f.field === option.field && String(f.value) === val.value
                );
                return (
                  <DropdownMenuItem
                    key={val.value}
                    disabled={isActive}
                    onClick={() => addFilter({ field: option.field, operator: 'eq', value: val.value })}
                  >
                    {val.label}
                    {isActive && <span className="ml-auto text-primary text-xs">active</span>}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sort button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
            <ArrowUpDown className="h-3.5 w-3.5" />
            Sort
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          {SORT_OPTIONS.map((option) => {
            const isActive = sort[0]?.field === option.field;
            const currentDir = isActive ? sort[0].direction : 'desc';
            return (
              <DropdownMenuItem
                key={option.field}
                onClick={() => {
                  // Toggle direction if already active, otherwise set new field
                  const newDir = isActive && currentDir === 'desc' ? 'asc' : 'desc';
                  setSort([{ field: option.field, direction: newDir }]);
                }}
              >
                {option.label}
                {isActive && (
                  <span className="ml-auto text-primary text-xs">
                    {currentDir === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Group by button — only for list and tree views */}
      {(viewType === 'list' || viewType === 'tree') && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
              <Layers className="h-3.5 w-3.5" />
              Group
              {groupBy.length > 0 && (
                <span className="ml-0.5 bg-primary/20 text-primary rounded-full px-1.5 text-[10px] font-bold">
                  {groupBy.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel className="text-xs">Group by dimension</DropdownMenuLabel>
            {GROUP_BY_OPTIONS.map((option) => {
              const isActive = groupBy.some((g) => g.dimension === option.key);
              return (
                <DropdownMenuItem
                  key={option.key}
                  onClick={() => {
                    if (isActive) {
                      setGroupBy(groupBy.filter((g) => g.dimension !== option.key));
                    } else {
                      setGroupBy([...groupBy, { dimension: option.key, label: option.label }]);
                    }
                  }}
                >
                  {option.label}
                  {isActive && <span className="ml-auto text-primary text-xs">✓</span>}
                </DropdownMenuItem>
              );
            })}
            {groupBy.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setGroupBy([])}>
                  Clear grouping
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Active filter/sort chips */}
      {hasActiveControls && (
        <div className="flex items-center gap-1 ml-1">
          <div className="w-px h-4 bg-border" />
          {filters.map((filter, i) => (
            <span
              key={`filter-${i}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs"
            >
              {filterChipLabel(filter)}
              <button
                onClick={() => removeFilter(i)}
                className="hover:bg-primary/20 rounded-full p-0.5"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          {sort.length > 0 && sort[0].field !== 'received_at' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-foreground text-xs">
              {sortChipLabel(sort[0])}
              <button
                onClick={() => setSort([{ field: 'received_at', direction: 'desc' }])}
                className="hover:bg-accent-foreground/10 rounded-full p-0.5"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          )}
          {(filters.length > 1 || (filters.length > 0 && sort[0]?.field !== 'received_at')) && (
            <button
              onClick={() => {
                clearFilters();
                setSort([{ field: 'received_at', direction: 'desc' }]);
              }}
              className="text-xs text-muted-foreground hover:text-foreground ml-1"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
