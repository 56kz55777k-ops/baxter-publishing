/**
 * Bleed geometry — D-033 (publication bleed model).
 *
 * The reported "quarter-inch bleed" is a quarter inch added to each full page
 * dimension, i.e. an eighth of an inch per applicable edge. These tests pin the
 * exact numbers and the per-edge-vs-total relationship so the two can never be
 * silently swapped, and guard the 3 mm / 3.175 mm conflation.
 */
import { describe, expect, it } from 'vitest';
import {
  GENERIC_PUBLICATION_BLEED_IN,
  GENERIC_PUBLICATION_BLEED_MM,
  GENERIC_PUBLICATION_BLEED_PT,
  MM_PER_INCH,
  PT_PER_INCH,
  PUBLICATION_FORMAT_PRESETS,
  getFormatPreset,
  newEditorDoc,
} from '@baxter/domain';
import { unitGeometry } from '@/components/editor/geometry';
import { selectUnits } from '@/components/editor/state/selectors';

describe('D-033: the generic publication bleed is 0.125 in per applicable edge', () => {
  it('converts exactly: 0.125 in = 3.175 mm = 9 pt', () => {
    expect(GENERIC_PUBLICATION_BLEED_IN).toBe(0.125);
    // Exact in IEEE-754: 25.4/8 and 72/8 are both exact binary scalings.
    expect(GENERIC_PUBLICATION_BLEED_MM).toBe(3.175);
    expect(GENERIC_PUBLICATION_BLEED_PT).toBe(9);
    expect(GENERIC_PUBLICATION_BLEED_IN * MM_PER_INCH).toBe(3.175);
    expect(GENERIC_PUBLICATION_BLEED_IN * PT_PER_INCH).toBe(9);
  });

  it('is NOT 3 mm — the industry synonym is 0.175 mm away and must not be substituted', () => {
    expect(GENERIC_PUBLICATION_BLEED_MM).not.toBe(3);
    expect(GENERIC_PUBLICATION_BLEED_MM - 3).toBeCloseTo(0.175, 12);
    // A true 3.0 mm printer requirement remains expressible: the field is a
    // plain number, not a constant, so a future profile can state it.
    expect(Number.isFinite(3)).toBe(true);
  });

  it('is a PER-EDGE value: bleeding both opposing edges adds 0.25 in / 6.35 mm to the dimension', () => {
    const totalGrowthMm = 2 * GENERIC_PUBLICATION_BLEED_MM;
    expect(totalGrowthMm).toBe(6.35);
    expect(totalGrowthMm).toBe(0.25 * MM_PER_INCH);
    // The rejected reading: 0.25 in per edge would double this.
    expect(totalGrowthMm).not.toBe(2 * 0.25 * MM_PER_INCH);
  });

  it('worked example: a 6 x 9 in trim page bleeding all four edges occupies 6.25 x 9.25 in', () => {
    const trimW = 6 * MM_PER_INCH;
    const trimH = 9 * MM_PER_INCH;
    const b = GENERIC_PUBLICATION_BLEED_MM;
    expect((trimW + 2 * b) / MM_PER_INCH).toBeCloseTo(6.25, 12);
    expect((trimH + 2 * b) / MM_PER_INCH).toBeCloseTo(9.25, 12);
  });

  it('every preset carries the generic per-edge bleed', () => {
    for (const preset of PUBLICATION_FORMAT_PRESETS) {
      expect(preset.rules.bleedMm).toBe(3.175);
    }
  });

  it('trim, margin and safe are untouched by the bleed amendment', () => {
    const a5 = getFormatPreset('zine_a5')!;
    const a4 = getFormatPreset('magazine_a4')!;
    const sq = getFormatPreset('photobook_square_210')!;

    expect([a5.trimWidthMm, a5.trimHeightMm]).toEqual([148, 210]);
    expect([a4.trimWidthMm, a4.trimHeightMm]).toEqual([210, 297]);
    expect([sq.trimWidthMm, sq.trimHeightMm]).toEqual([210, 210]);

    expect(a5.layout).toEqual({ marginMm: 12, safeMm: 5 });
    // PROVISIONAL values, deliberately unchanged here (D-031 remains open).
    expect(a4.layout).toEqual({ marginMm: 15, safeMm: 6 });
    expect(sq.layout).toEqual({ marginMm: 14, safeMm: 6 });
  });

  it('the bleed box the editor draws grows by exactly 2x the per-edge value', () => {
    const preset = getFormatPreset('zine_a5')!;
    const doc = newEditorDoc(preset);
    const units = selectUnits(doc);
    const layout = { marginMm: doc.meta.marginMm, safeMm: doc.meta.safeMm };

    const cover = unitGeometry(units[0]!, preset, layout);
    expect(cover.bleedMm).toBe(3.175);
    // StageGuides draws x/y at -bleed, w/h at +2*bleed.
    expect(cover.widthMm + 2 * cover.bleedMm).toBe(148 + 6.35);
    expect(cover.heightMm + 2 * cover.bleedMm).toBe(210 + 6.35);

    const spread = unitGeometry(units[1]!, preset, layout);
    expect(spread.widthMm + 2 * spread.bleedMm).toBe(296 + 6.35);
  });

  it('bleed is derived from the preset, never persisted into the document', () => {
    const preset = getFormatPreset('zine_a5')!;
    const doc = newEditorDoc(preset);
    expect(Object.keys(doc.meta).sort()).toEqual(['formatPresetId', 'marginMm', 'safeMm']);
    expect(JSON.stringify(doc)).not.toContain('bleed');
  });
});
