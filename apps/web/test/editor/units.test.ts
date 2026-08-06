import { describe, expect, it } from 'vitest';
import { MM_PER_PT, PT_PER_MM, mmToPt, ptToMm } from '@baxter/domain';

describe('units — mm↔pt conversion (contract #1: mm geometry, pt typography)', () => {
  it('constants are exact reciprocals of the 72pt/25.4mm inch', () => {
    expect(PT_PER_MM).toBeCloseTo(72 / 25.4, 12);
    expect(MM_PER_PT).toBeCloseTo(25.4 / 72, 12);
    expect(PT_PER_MM * MM_PER_PT).toBeCloseTo(1, 12);
  });

  it('round-trips values within floating-point tolerance', () => {
    for (const mm of [0, 0.01, 1, 3, 148, 210, 297]) {
      expect(ptToMm(mmToPt(mm))).toBeCloseTo(mm, 10);
    }
  });

  it('matches the PDF inspector’s established conversion (A5 trim in pt)', () => {
    // 148 mm = 419.53… pt; the preflight tolerance is ±1 mm, our math must
    // agree with lib/pdf/inspect.ts’s local constant to well under that.
    expect(mmToPt(148)).toBeCloseTo(419.5275590551181, 9);
    expect(ptToMm(595.276)).toBeCloseTo(210.0001, 3); // A4 width in pt
  });
});
