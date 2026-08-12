import { describe, expect, it } from 'vitest';
import {
  EditorDocV1Schema,
  PUBLICATION_FORMAT_PRESETS,
  computeUnits,
  getFormatPreset,
  newEditorDoc,
} from '@baxter/domain';

describe('newEditorDoc — preset-derived initialization (blueprint §2.1, deviation D1)', () => {
  it.each(PUBLICATION_FORMAT_PRESETS.map((p) => [p.id] as const))(
    '%s: born document validates against the v1 schema',
    (id) => {
      const doc = newEditorDoc(getFormatPreset(id)!);
      expect(() => EditorDocV1Schema.parse(doc)).not.toThrow();
    }
  );

  it.each(PUBLICATION_FORMAT_PRESETS.map((p) => [p.id, p.rules] as const))(
    '%s: total page count equals minPages and satisfies multiple-of-four where required',
    (_id, rules) => {
      const doc = newEditorDoc(getFormatPreset(_id)!);
      expect(doc.pages).toHaveLength(rules.minPages);
      if (rules.requiresMultipleOfFour) {
        expect(doc.pages.length % 4).toBe(0);
      }
    }
  );

  it('zine_a5: cover + 2 interiors + back (total 4)', () => {
    const doc = newEditorDoc(getFormatPreset('zine_a5')!);
    expect(doc.pages.map((p) => p.kind)).toEqual(['cover', 'interior', 'interior', 'back']);
  });

  it('freezes resolved margin/safe copies from the preset layout', () => {
    const preset = getFormatPreset('zine_a5')!;
    const doc = newEditorDoc(preset);
    expect(doc.meta).toEqual({
      formatPresetId: 'zine_a5',
      marginMm: 12,
      safeMm: 5,
    });
  });

  it('every page has a unique id and no elements', () => {
    const doc = newEditorDoc(getFormatPreset('magazine_a4')!);
    const ids = new Set(doc.pages.map((p) => p.id));
    expect(ids.size).toBe(doc.pages.length);
    expect(doc.pages.every((p) => p.elements.length === 0)).toBe(true);
  });

  it('units of a born zine: Front cover, Spread 1, Back cover', () => {
    const doc = newEditorDoc(getFormatPreset('zine_a5')!);
    expect(computeUnits(doc.pages).map((u) => u.label)).toEqual([
      'Front cover',
      'Spread 1',
      'Back cover',
    ]);
  });
});
