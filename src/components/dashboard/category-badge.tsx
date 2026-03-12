'use client';

import { getCategoryColor } from '@/lib/category-colors';

interface CategoryBadgeProps {
  category: string;
  className?: string;
}

/**
 * A color-coded category badge. Color is deterministic based on category name.
 */
export function CategoryBadge({ category, className = '' }: CategoryBadgeProps) {
  const colors = getCategoryColor(category);

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${className}`}
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
        borderColor: colors.border,
      }}
    >
      {category}
    </span>
  );
}
