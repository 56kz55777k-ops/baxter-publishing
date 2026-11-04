/**
 * Integer hundredths of a millimetre ("H") — the representation Slice D's
 * resize maths runs on (plan §3.1).
 *
 * Every value on the 0.01 mm model grid (contract #19, `quantizeInspector`)
 * is `h / 100` for an integer h. Doing the grid arithmetic on those integers
 * instead of on the doubles is what makes "a fixed edge stays fixed" and
 * "the dependent size is within 0.005 mm" exact statements rather than float
 * hopes: `0.03 − 0.01` is `0.019999999999999997`, `3 − 1` is `2`.
 *
 * Floating point enters at exactly three places, each with its own rule:
 * raw pointer input (through `toH`, once), stored values (`fromH`), and
 * geometric reconstruction by other code such as `x + w` (tolerance stated in
 * plan §3.7). Nothing here subtracts floats to build an edge.
 *
 * Snap and centre targets are held in DOUBLED hundredths ("H2") because an
 * element centre can fall on a half-hundredth; `halfUp` converts H2 back to H.
 *
 * All helpers are pure and normalise `-0` to `0`, for the same reason
 * `precision.ts` does: `-0` would make otherwise equal documents compare
 * unequal under `Object.is`.
 */

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}

/** Millimetres → integer hundredths: `Math.round(mm · 100)`. Exact for every canonical stored value. */
export function toH(mm: number): number {
  return normalizeZero(Math.round(mm * 100));
}

/**
 * Integer hundredths → the canonical stored number `h / 100`. It is the same
 * double `quantizeInspector` would store, and `formatNum` prints its digits.
 */
export function fromH(h: number): number {
  return normalizeZero(h / 100);
}

/**
 * Floor division of integers, `b > 0`. The float quotient is corrected by the
 * exact integer remainder, so it is exact for |a| < 2^53 (plan §3.1 keeps
 * every intermediate far below that for documents up to 1 m).
 */
export function floorDiv(a: number, b: number): number {
  let q = Math.trunc(a / b);
  const r = a - q * b;
  if (r < 0) q -= 1;
  else if (r >= b) q += 1;
  return normalizeZero(q);
}

/** Ceiling division of integers, `b > 0`. */
export function ceilDiv(a: number, b: number): number {
  return normalizeZero(-floorDiv(-a, b));
}

/** Integer division rounding half up (toward +∞), `b > 0`: `floor((2a + b) / 2b)`. */
export function roundHalfUpDiv(a: number, b: number): number {
  return floorDiv(2 * a + b, 2 * b);
}

/** Doubled hundredths (H2) → hundredths (H), ties toward +∞. */
export function halfUp(h2: number): number {
  return floorDiv(h2 + 1, 2);
}
