import { describe, expect, it } from 'vitest';
import {
  CURRENT_EDITOR_SCHEMA_VERSION,
  EditorDocParseError,
  UnsupportedEditorSchemaVersionError,
  getFormatPreset,
  migrateEditorDoc,
  newEditorDoc,
  newEllipseElement,
  newImageElement,
  newLineElement,
  newRectElement,
  newTextElement,
  parseEditorDoc,
  type EditorDoc,
} from '@baxter/domain';

function validDoc(): EditorDoc {
  const doc = newEditorDoc(getFormatPreset('zine_a5')!);
  doc.pages[1]!.elements.push(
    newRectElement({ x: 10, y: 10 }),
    newEllipseElement({ x: 20, y: 20 }),
    newImageElement({ x: 30, y: 30 }),
    newTextElement({ x: 40, y: 40 }),
    newLineElement({ x: 50, y: 50 })
  );
  return doc;
}

describe('parseEditorDoc — the single gate from raw JSON to a typed document', () => {
  it('accepts a valid v1 document containing every element type, byte-faithfully', () => {
    const doc = validDoc();
    const parsed = parseEditorDoc(JSON.parse(JSON.stringify(doc)));
    expect(parsed).toEqual(doc);
  });

  it('v1 migration is the identity (same content in, same content out)', () => {
    const doc = validDoc();
    expect(migrateEditorDoc(doc, CURRENT_EDITOR_SCHEMA_VERSION)).toBe(doc);
  });

  it('rejects unknown future schema versions rather than guessing', () => {
    const doc = { ...validDoc(), schemaVersion: 2 };
    expect(() => parseEditorDoc(doc)).toThrow(UnsupportedEditorSchemaVersionError);
    expect(() => migrateEditorDoc(doc, 99)).toThrow(UnsupportedEditorSchemaVersionError);
  });

  it('rejects input with no readable schemaVersion', () => {
    expect(() => parseEditorDoc(null)).toThrow(EditorDocParseError);
    expect(() => parseEditorDoc({})).toThrow(EditorDocParseError);
    expect(() => parseEditorDoc({ schemaVersion: 'one' })).toThrow(EditorDocParseError);
    expect(() => parseEditorDoc('{}')).toThrow(EditorDocParseError);
  });

  it('rejects malformed documents (missing pages, wrong shapes)', () => {
    expect(() => parseEditorDoc({ schemaVersion: 1 })).toThrow(EditorDocParseError);
    expect(() =>
      parseEditorDoc({ schemaVersion: 1, meta: { formatPresetId: 'zine_a5', marginMm: 12, safeMm: 5 }, pages: [] })
    ).toThrow(EditorDocParseError);
  });

  it('rejects an unknown format preset id', () => {
    const doc = validDoc();
    (doc.meta as { formatPresetId: string }).formatPresetId = 'letter_us';
    expect(() => parseEditorDoc(doc)).toThrow(EditorDocParseError);
  });

  it('enforces cover-first / back-last / interiors-between structure', () => {
    const doc = validDoc();
    const [cover, i1, i2, back] = doc.pages as [
      EditorDoc['pages'][0],
      EditorDoc['pages'][0],
      EditorDoc['pages'][0],
      EditorDoc['pages'][0],
    ];
    expect(() => parseEditorDoc({ ...doc, pages: [i1, i2, cover, back] })).toThrow(EditorDocParseError);
    expect(() => parseEditorDoc({ ...doc, pages: [cover, i1, back, i2] })).toThrow(EditorDocParseError);
    expect(() => parseEditorDoc({ ...doc, pages: [cover, back, i1, i2] })).toThrow(EditorDocParseError);
  });

  it('rejects duplicate page or element ids anywhere in the document', () => {
    const doc = validDoc();
    const dupPage = { ...doc, pages: [doc.pages[0]!, doc.pages[1]!, { ...doc.pages[2]!, id: doc.pages[1]!.id }, doc.pages[3]!] };
    expect(() => parseEditorDoc(dupPage)).toThrow(EditorDocParseError);

    const doc2 = validDoc();
    const el = doc2.pages[1]!.elements[0]!;
    doc2.pages[2]!.elements.push({ ...el });
    expect(() => parseEditorDoc(doc2)).toThrow(EditorDocParseError);
  });

  it('contract #18: stroke None is null; strokeWidth 0 is valid alongside it', () => {
    const doc = validDoc();
    const rect = doc.pages[1]!.elements[0]!;
    expect(rect.type === 'rect' && rect.stroke === null && rect.strokeWidth === 0).toBe(true);
    expect(() => parseEditorDoc(doc)).not.toThrow();
  });

  it('contract #19 model floors: fontSize ≥ 4pt, lineHeight ≥ 0.8, line stroke ≥ 0.1', () => {
    const doc = validDoc();
    const text = doc.pages[1]!.elements.find((e) => e.type === 'text')!;
    const line = doc.pages[1]!.elements.find((e) => e.type === 'line')!;

    (text as { fontSize: number }).fontSize = 3.9;
    expect(() => parseEditorDoc(doc)).toThrow(EditorDocParseError);
    (text as { fontSize: number }).fontSize = 4;

    (text as { lineHeight: number }).lineHeight = 0.79;
    expect(() => parseEditorDoc(doc)).toThrow(EditorDocParseError);
    (text as { lineHeight: number }).lineHeight = 0.8;

    (line as { strokeWidth: number }).strokeWidth = 0.05;
    expect(() => parseEditorDoc(doc)).toThrow(EditorDocParseError);
    (line as { strokeWidth: number }).strokeWidth = 0.1;

    expect(() => parseEditorDoc(doc)).not.toThrow();
  });

  it('contract #2: negative x is first-class (cross-gutter/bleed positions)', () => {
    const doc = validDoc();
    (doc.pages[1]!.elements[0] as { x: number }).x = -3;
    expect(() => parseEditorDoc(doc)).not.toThrow();
  });

  it('contract #16: line deltas may be negative or zero (vector, not box)', () => {
    const doc = validDoc();
    const line = doc.pages[1]!.elements.find((e) => e.type === 'line')!;
    (line as { width: number; height: number }).width = -60;
    (line as { width: number; height: number }).height = 0;
    expect(() => parseEditorDoc(doc)).not.toThrow();
  });

  it('image frames: empty frame (assetId null) is valid; focal/cropZoom bounded', () => {
    const doc = validDoc();
    const img = doc.pages[1]!.elements.find((e) => e.type === 'image')!;
    expect(img.type === 'image' && img.assetId === null).toBe(true);

    (img as { cropZoom: number }).cropZoom = 3.01;
    expect(() => parseEditorDoc(doc)).toThrow(EditorDocParseError);
    (img as { cropZoom: number }).cropZoom = 3;

    (img as { focal: { x: number; y: number } }).focal = { x: 1.2, y: 0.5 };
    expect(() => parseEditorDoc(doc)).toThrow(EditorDocParseError);
    (img as { focal: { x: number; y: number } }).focal = { x: 1, y: 0 };
    expect(() => parseEditorDoc(doc)).not.toThrow();
  });

  it('text carries no height field (contract #15: height is rendered, never stored)', () => {
    const text = newTextElement({ x: 0, y: 0 });
    expect('height' in text).toBe(false);
    const doc = validDoc();
    const el = doc.pages[1]!.elements.find((e) => e.type === 'text')! as Record<string, unknown>;
    el.height = 40;
    // Unknown keys are stripped by zod (not rejected) — but never persisted
    // back, so a stray height cannot round-trip into the model.
    const parsed = parseEditorDoc(doc);
    const parsedText = parsed.pages[1]!.elements.find((e) => e.type === 'text')!;
    expect('height' in parsedText).toBe(false);
  });
});
