/**
 * Millimetre ↔ point conversion — the single source for print-unit math.
 *
 * Pure rules: no I/O, no DB, no React. The editor stores geometry in mm and
 * typography in pt (editor document contract #1); PDF inspection and export
 * speak pt. New code imports these; the pre-existing local constants in
 * `apps/web/lib/pdf/inspect.ts` and `lib/shipping/easypost.ts` are left in
 * place deliberately (refactoring them is outside Slice A's boundary).
 */

/** Points per millimetre (72 pt per inch, 25.4 mm per inch). */
export const PT_PER_MM = 72 / 25.4;

/** Millimetres per point. */
export const MM_PER_PT = 25.4 / 72;

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

export function ptToMm(pt: number): number {
  return pt * MM_PER_PT;
}
