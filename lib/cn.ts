/**
 * Minimal class-name combiner. Joins truthy strings, dedupes.
 * Swap for `clsx` + `tailwind-merge` if you need conflict resolution later.
 */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(" ");
}
