/**
 * The numeric field contract (#19), as pure functions.
 *
 * "Typing and stepping agree about everything." The React component owns
 * focus, the draft string and the commit boundary; every *rule* about what a
 * draft means, what a value displays as, and what a step produces lives here,
 * where it is testable without a DOM.
 *
 * The accepted rules this module encodes:
 *
 * - While focused the draft string is free. `""`, `"-"` and `"12."` are
 *   transitional: never parsed, never committed, never clamped.
 * - An invalid draft restores the last valid value — it never writes.
 * - Clamping happens only at real declared bounds. X/Y are unbounded;
 *   negative page-relative values are first-class (contract #2).
 * - Every typed-reachable bound is step-reachable: stepping clamps, so a
 *   0.5 mm stroke steps down to exactly 0 (which nulls the stroke, #18).
 * - Display equals the model exactly: ≤ 2 dp, trailing zeros stripped,
 *   `-0` normalised.
 *
 * `step` and `shiftStep` are declared per field rather than derived from a
 * global multiplier, because the contract states both rates literally —
 * ordinary fields ±1 / ±5, fine fields ±0.1 / ±1 — and those are not the same
 * ratio. Deriving one from the other would quietly change a fine field's
 * Shift behaviour.
 */

export interface NumFieldBounds {
  /** Omitted = unbounded (X/Y/endpoints — contract #19). */
  min?: number;
  max?: number;
  /** Arrow press. */
  step: number;
  /** Shift + arrow press. */
  shiftStep: number;
}

/** A complete, finite decimal. Rejects the transitional drafts by construction. */
const COMPLETE_NUMBER = /^-?(\d+(\.\d+)?|\.\d+)$/;

/**
 * Parse a draft string to a number, or `null` when the draft is transitional
 * or malformed. `null` never means zero.
 */
export function parseNum(draft: string): number | null {
  const trimmed = draft.trim();
  if (!COMPLETE_NUMBER.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function clampNum(value: number, bounds: NumFieldBounds): number {
  let n = value;
  if (bounds.min !== undefined) n = Math.max(bounds.min, n);
  if (bounds.max !== undefined) n = Math.min(bounds.max, n);
  return n;
}

/**
 * Resolve a commit attempt.
 *
 * Returns the value to write, or `null` when the draft is invalid and the
 * field must restore its last valid value. The caller compares the result
 * with the current model value: equality is the no-op signal, and an
 * identical-value commit creates nothing (#19/#24).
 */
export function commitNum(draft: string, bounds: NumFieldBounds): number | null {
  const parsed = parseNum(draft);
  if (parsed === null) return null;
  return quantizeDisplay(clampNum(parsed, bounds));
}

/** One arrow press. Clamps, so declared bounds are always step-reachable. */
export function stepNum(
  current: number,
  bounds: NumFieldBounds,
  direction: 1 | -1,
  shift: boolean
): number {
  const delta = (shift ? bounds.shiftStep : bounds.step) * direction;
  return quantizeDisplay(clampNum(current + delta, bounds));
}

/**
 * Display = model exactly: at most two decimal places, trailing zeros
 * stripped, `-0` normalised to `0`.
 */
export function formatNum(value: number): string {
  if (!Number.isFinite(value)) return '';
  const rounded = quantizeDisplay(value);
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

/**
 * Round to the 0.01 grid and normalise `-0`. Shared by commit and display so
 * a committed value and its rendering can never disagree.
 */
function quantizeDisplay(value: number): number {
  const n = Math.round(value * 100) / 100;
  return n === 0 ? 0 : n;
}
