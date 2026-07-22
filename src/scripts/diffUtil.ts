/** Deterministic serialization for before/after/current row comparisons in the reapply-delta scripts. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
