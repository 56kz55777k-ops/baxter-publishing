/**
 * Editor margins and safe guides — D-034.
 *
 * D-034 settled the values that were left PROVISIONAL by D-031 and
 * deliberately untouched by D-033. It rules that:
 *
 *   - the scalar `marginMm` / `safeMm` model is retained through the present
 *     editor slices, with per-edge BINDING-RELATIVE margins a dated
 *     prerequisite before M2.4/export;
 *   - the accepted margins are 12 / 15 / 19 mm (the square revised 14 → 19);
 *   - the safe guides stay 5 / 6 / 6 mm and are NOT standardised to 6.35 mm,
 *     because `safeMm` is an editorial layout guide, not a printer-safety
 *     guarantee;
 *   - nothing about persistence changes: no schema change, no migration, no
 *     schema-version bump, and existing documents keep their frozen values.
 *
 * These tests pin the values AND the semantics, so a later "tidy-up" cannot
 * quietly standardise the safe guides or reflow existing work.
 */
import { describe, expect, it } from 'vitest';
import * as domain from '@baxter/domain';
import {
  CURRENT_EDITOR_SCHEMA_VERSION,
  MM_PER_INCH,
  PUBLICATION_FORMAT_PRESETS,
  getFormatPreset,
  newEditorDoc,
  parseEditorDoc,
} from '@baxter/domain';

const a5 = () => getFormatPreset('zine_a5')!;
const a4 = () => getFormatPreset('magazine_a4')!;
const sq = () => getFormatPreset('photobook_square_210')!;

describe('D-034: the accepted margin defaults', () => {
  it('pins all three presets: 12 / 15 / 19 mm', () => {
    expect(a5().layout.marginMm).toBe(12);
    expect(a4().layout.marginMm).toBe(15);
    expect(sq().layout.marginMm).toBe(19);
  });

  it('the square margin is the revised value, not the superseded 14 mm', () => {
    expect(sq().layout.marginMm).not.toBe(14);
  });

  it('A5 and A4 are unchanged by the amendment', () => {
    expect(a5().layout).toEqual({ marginMm: 12, safeMm: 5 });
    expect(a4().layout).toEqual({ marginMm: 15, safeMm: 6 });
  });
});

describe('D-034: safe guides are editorial, not a printer guarantee', () => {
  it('pins 5 / 6 / 6 mm', () => {
    expect(a5().layout.safeMm).toBe(5);
    expect(a4().layout.safeMm).toBe(6);
    expect(sq().layout.safeMm).toBe(6);
  });

  it('is NOT standardised to the 0.25 in / 6.35 mm printer figure', () => {
    const printerSafeFigureMm = 0.25 * MM_PER_INCH;
    expect(printerSafeFigureMm).toBe(6.35);
    for (const preset of PUBLICATION_FORMAT_PRESETS) {
      expect(preset.layout.safeMm).not.toBe(printerSafeFigureMm);
    }
  });

  it('the domain exports no safe-area constant — safe is a per-preset editorial value', () => {
    const safeConstants = Object.keys(domain).filter((k) => /^SAFE|_SAFE_MM$|^GENERIC_.*SAFE/.test(k));
    expect(safeConstants).toEqual([]);
  });
});

describe('D-034: bleed and page range are untouched', () => {
  it('bleed remains 0.125 in / 3.175 mm / 9 pt per applicable edge (D-033)', () => {
    expect(domain.GENERIC_PUBLICATION_BLEED_IN).toBe(0.125);
    expect(domain.GENERIC_PUBLICATION_BLEED_MM).toBe(3.175);
    expect(domain.GENERIC_PUBLICATION_BLEED_PT).toBe(9);
    for (const preset of PUBLICATION_FORMAT_PRESETS) {
      expect(preset.rules.bleedMm).toBe(3.175);
    }
  });

  it('the square keeps its full 240-page range — the product was not narrowed to suit a scalar margin', () => {
    expect(sq().rules.maxPages).toBe(240);
    expect(sq().rules.minPages).toBe(20);
    expect(sq().rules.requiresMultipleOfFour).toBe(false);
  });

  it('trim dimensions are unchanged', () => {
    expect([a5().trimWidthMm, a5().trimHeightMm]).toEqual([148, 210]);
    expect([a4().trimWidthMm, a4().trimHeightMm]).toEqual([210, 297]);
    expect([sq().trimWidthMm, sq().trimHeightMm]).toEqual([210, 210]);
  });
});

describe('D-034: persistence is unchanged (D-031 preserved)', () => {
  it('new documents freeze the accepted defaults at creation', () => {
    expect(newEditorDoc(sq()).meta).toMatchObject({
      formatPresetId: 'photobook_square_210',
      marginMm: 19,
      safeMm: 6,
    });
    expect(newEditorDoc(a4()).meta).toMatchObject({ marginMm: 15, safeMm: 6 });
    expect(newEditorDoc(a5()).meta).toMatchObject({ marginMm: 12, safeMm: 5 });
  });

  it('the meta shape is unchanged — no new persisted field', () => {
    expect(Object.keys(newEditorDoc(sq()).meta).sort()).toEqual([
      'formatPresetId',
      'marginMm',
      'safeMm',
    ]);
  });

  it('no schema-version bump: documents are still born and read at version 1', () => {
    expect(CURRENT_EDITOR_SCHEMA_VERSION).toBe(1);
    expect(newEditorDoc(sq()).schemaVersion).toBe(1);
  });

  it('an existing square document keeps its frozen 14 mm — never re-derived, never mutated', () => {
    const legacy = {
      schemaVersion: 1,
      meta: { formatPresetId: 'photobook_square_210', marginMm: 14, safeMm: 6 },
      pages: [
        { id: crypto.randomUUID(), kind: 'cover', elements: [] },
        { id: crypto.randomUUID(), kind: 'interior', elements: [] },
        { id: crypto.randomUUID(), kind: 'back', elements: [] },
      ],
    };
    const before = JSON.stringify(legacy);
    const parsed = parseEditorDoc(legacy);

    expect(parsed.meta.marginMm).toBe(14);
    expect(parsed.meta.safeMm).toBe(6);
    // The preset moved; the document did not.
    expect(parsed.meta.marginMm).not.toBe(sq().layout.marginMm);
    // Reading is side-effect free: the input object is not rewritten in place.
    expect(JSON.stringify(legacy)).toBe(before);
  });
});
