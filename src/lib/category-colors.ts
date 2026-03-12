/**
 * Deterministic category → color mapping using djb2 hash.
 * Same category always gets the same color across sessions and users.
 */

const CATEGORY_HUES = [
  210, // blue
  160, // teal
  280, // purple
  340, // pink
  30,  // orange
  120, // green
  190, // cyan
  250, // indigo
  50,  // gold
  0,   // red
  300, // magenta
  80,  // lime
];

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Returns an HSL color for a category name.
 * The hue is deterministic — same name always maps to same color.
 */
export function getCategoryColor(category: string): {
  bg: string;
  text: string;
  border: string;
} {
  const hash = djb2Hash(category.toLowerCase());
  const hue = CATEGORY_HUES[hash % CATEGORY_HUES.length];

  return {
    bg: `hsl(${hue} 60% 95%)`,
    text: `hsl(${hue} 60% 30%)`,
    border: `hsl(${hue} 50% 85%)`,
  };
}
