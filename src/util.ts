/** Small helpers with no home in a single layer. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Clamps a value read from storage or a file; anything that is not a finite number becomes `fallback`. */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

/** The "s" that turns a noun plural, for counts other than one. */
export function plural(count: number): string {
  return count === 1 ? '' : 's';
}
