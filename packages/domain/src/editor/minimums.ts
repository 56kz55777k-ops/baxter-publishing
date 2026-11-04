/**
 * Minimum shape size — Slice D decision D-1 (plan §1).
 *
 * 4 mm per axis, for shape resizing and for the inspector's W/H. A shape that
 * is already smaller ("grandfathered") is preserved: it is never enlarged
 * automatically, and it can never shrink below the size it had when the edit
 * began. Its effective floor is therefore `min(4 mm, value at start)`.
 *
 * Floors are compared AFTER quantization to the 0.01 mm grid (plan §3.5), so
 * the resize maths uses the integer-hundredths form; the inspector (stage 3)
 * uses the millimetre form, which is the same rule on canonical values.
 *
 * The creation tool's own 4 mm default (`use-stage-gestures.ts`) is the same
 * number; it moves to this module when stage 3 touches creation.
 */

/** D-1 minimum per axis, mm. */
export const MIN_SHAPE_MM = 4;

/** D-1 minimum per axis, integer hundredths of a millimetre. */
export const MIN_SHAPE_H = 400;

/**
 * Effective floor of an axis in mm: the minimum, or the axis's own value when
 * that is already smaller (a grandfathered axis can grow, never shrink).
 */
export function effectiveMin(currentMm: number, minimumMm: number = MIN_SHAPE_MM): number {
  return Math.min(minimumMm, currentMm);
}

/** Effective floor of an axis in integer hundredths: `min(400, start)` (plan §3.2). */
export function effectiveMinH(startH: number, minimumH: number = MIN_SHAPE_H): number {
  return Math.min(minimumH, startH);
}
