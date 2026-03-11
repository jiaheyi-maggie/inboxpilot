'use client';

import type { DimensionDef, DimensionKey } from '@/types';

interface LevelSelectorProps {
  level: number;
  selected: DimensionKey;
  availableDimensions: DimensionDef[];
  onChange: (dimensionKey: DimensionKey) => void;
}

export function LevelSelector({
  level,
  selected,
  availableDimensions,
  onChange,
}: LevelSelectorProps) {
  // Include the currently selected dimension in the options
  const currentDim = availableDimensions.find((d) => d.key === selected);
  const options = currentDim
    ? availableDimensions
    : [
        { key: selected, label: selected, description: '' } as DimensionDef,
        ...availableDimensions,
      ];

  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value as DimensionKey)}
      className="flex-1 h-9 rounded-md border border-slate-200 bg-white px-3 text-sm
        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
        appearance-none bg-no-repeat bg-right
        cursor-pointer"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
        backgroundSize: '1.5rem 1.5rem',
        backgroundPosition: 'right 0.5rem center',
        paddingRight: '2.5rem',
      }}
    >
      {options.map((dim) => (
        <option key={dim.key} value={dim.key}>
          {dim.label}
        </option>
      ))}
    </select>
  );
}
