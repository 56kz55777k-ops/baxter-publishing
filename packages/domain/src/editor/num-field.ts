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
 * - A result that reaches the declared minimum IS the minimum, exactly — it is
 *   returned before rounding, so rounding can neither lower it (2.504 → 2.5)
 *   nor raise it (2.506 → 2.51). That matters only for a minimum off the grid
 *   — a grandfathered size (D-1, Slice D) whose stored value predates the
 *   grid: typing 2 at 2.506 resolves to 2.506, the current value, a no-op.
 *   A result above the minimum that rounds below it is also held at the
 *   minimum (2.5041 at a 2.504 floor → 2.504).
 * - An unedited draft is a no-op. Focus shows `formatNum(current)`, which for
 *   an off-grid stored value is not the value itself (2.506 shows "2.51");
 *   committing that same text returns `current` unchanged, so visiting a
 *   field and leaving it writes nothing (#19/#24).
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
export function commitNum(
  draft: string,
  bounds: NumFieldBounds,
  /**
   * The current model value, when there is one (not mixed). A draft equal to
   * its formatted display is unedited and resolves to `current` itself.
   */
  current?: number
): number | null {
  if (current !== undefined && Number.isFinite(current) && draft.trim() === formatNum(current)) {
    return current;
  }
  const parsed = parseNum(draft);
  if (parsed === null) return null;
  return resolveNum(parsed, bounds);
}

/** One arrow press. Clamps, so declared bounds are always step-reachable. */
export function stepNum(
  current: number,
  bounds: NumFieldBounds,
  direction: 1 | -1,
  shift: boolean
): number {
  const delta = (shift ? bounds.shiftStep : bounds.step) * direction;
  return resolveNum(current + delta, bounds);
}

/**
 * Clamp, then round to the 0.01 grid — except at the floor.
 *
 * - A value at or below the minimum resolves to the minimum itself, before
 *   rounding: an off-grid minimum (a grandfathered 2.506 or 0.006, a 3.999)
 *   would otherwise round UP (2.51, 0.01, 4) and a shrink attempt would write
 *   a growth (Codex stage 3 review, 2026-11-12).
 * - A value above the minimum that rounds below it (2.5041 at a 2.504 floor →
 *   2.5) is held at the minimum.
 * On-grid minimums (0, 4) behave exactly as before.
 */
function resolveNum(value: number, bounds: NumFieldBounds): number {
  const clamped = clampNum(value, bounds);
  if (bounds.min !== undefined && clamped <= bounds.min) return bounds.min;
  const rounded = quantizeDisplay(clamped);
  return bounds.min !== undefined && rounded < bounds.min ? bounds.min : rounded;
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
