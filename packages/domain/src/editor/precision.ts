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
 * committing code therefore sits on one of these grids.
 *
 * The grids alone do not make resize arithmetic exact: subtracting doubles
 * does not (0.03 − 0.01 is 0.019999999999999997). The fixed-edge identity in
 * contract #9's resize maths is exact because Slice D computes it in integer
 * hundredths of a millimetre (`hundredths.ts`, plan §3.1) and stores
 * `h / 100`. A floating-point reconstruction from stored values, such as
 * `x + w`, is not bit-identical: for canonical values it is within 1e-9 mm
 * of the integer edge, and a legacy non-canonical value is within 0.005 mm
 * (plan §3.7, G1).
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
