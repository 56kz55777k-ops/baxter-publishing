/**
 * Commit precision — the two grids, named so they cannot be conflated.
 *
 * Contract #19 records a deliberate cross-system difference that must not be
 * "fixed" without a decision:
 *
 *   creation / drag / nudge  → 0.1 mm   (the historic grid)
 *   inspector / resize       → 0.01 mm  (the model grid)
 *
 * Quantizing happens at the COMMIT boundary; the schema itself stores plain
 * finite numbers and does not enforce a grid. Every model value produced by
 * committing code therefore sits on one of these grids, which is what makes
 * the fixed-edge identity in contract #9's resize maths exact (Slice D).
 *
 * `-0` is normalised to `0`: it round-trips through JSON as `0` anyway, and
 * an unnormalised `-0` would make two otherwise equal documents compare
 * unequal under `Object.is`, which the display contract in #19 also forbids.
 */

/** Creation, drag and nudge commits: 0.1 mm. */
export function quantizeCreate(mm: number): number {
  return normalizeZero(Math.round(mm * 10) / 10);
}

/** Inspector and resize commits: 0.01 mm. */
export function quantizeInspector(mm: number): number {
  return normalizeZero(Math.round(mm * 100) / 100);
}

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}
