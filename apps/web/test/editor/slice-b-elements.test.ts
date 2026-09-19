/**
 * Element semantics (Slice B) — the pure operations that produce `nextDoc`.
 *
 * The reference-identity assertions are the load-bearing ones: `COMMIT` drops
 * a commit where `nextDoc === state.doc`, and the autosave observer only
 * reacts to a document reference change. A helper that returned a
 * fresh-but-equal object on a no-op would silently create history entries and
 * save traffic for edits that changed nothing (contracts #24, #25).
 */
import { describe, expect, it } from 'vitest';
import {
  addElement,
  elementExists,
  findElement,
  getFormatPreset,
  liveSelection,
  newEllipseElement,
  newRectElement,
  newEditorDoc,
  pageOfElement,
  reorderElement,
  setLocked,
  updateElement,
  type EditorDoc,
} from '@baxter/domain';

const preset = getFormatPreset('zine_a5')!;

function docWith(n: number): { doc: EditorDoc; pageId: string; ids: string[] } {
  let doc = newEditorDoc(preset);
  const pageId = doc.pages[1]!.id;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const el = newRectElement({ x: 10 * i, y: 10 });
    ids.push(el.id);
    doc = addElement(doc, pageId, el);
  }
  return { doc, pageId, ids };
}

describe('addElement', () => {
  it('appends to the page, which is the z-order contract', () => {
    const { doc, ids } = docWith(3);
    expect(doc.pages[1]!.elements.map((e) => e.id)).toEqual(ids);
  });

  it('returns the SAME document when the page does not exist', () => {
    const doc = newEditorDoc(preset);
    expect(addElement(doc, 'no-such-page', newRectElement({ x: 0, y: 0 }))).toBe(doc);
  });

  it('leaves other pages untouched by reference', () => {
    const doc = newEditorDoc(preset);
    const next = addElement(doc, doc.pages[1]!.id, newRectElement({ x: 0, y: 0 }));
    expect(next.pages[0]).toBe(doc.pages[0]);
    expect(next.pages[2]).toBe(doc.pages[2]);
  });
});

describe('updateElement', () => {
  it('patches one element and leaves the rest by reference', () => {
    const { doc, ids } = docWith(2);
    const next = updateElement(doc, ids[0]!, { x: 42 });
    expect(findElement(next, ids[0]!)!.x).toBe(42);
    expect(findElement(next, ids[1]!)).toBe(findElement(doc, ids[1]!));
  });

  it('is a no-op — same reference — when every patched value is identical', () => {
    const { doc, ids } = docWith(1);
    const current = findElement(doc, ids[0]!)!;
    expect(updateElement(doc, ids[0]!, { x: current.x, y: current.y })).toBe(doc);
  });

  it('returns the same document for an unknown id', () => {
    const { doc } = docWith(1);
    expect(updateElement(doc, 'missing', { x: 1 })).toBe(doc);
  });

  it('SKIPS locked elements structurally (contract #20)', () => {
    const { doc, ids } = docWith(1);
    const locked = setLocked(doc, ids[0]!, true);
    const attempted = updateElement(locked, ids[0]!, { x: 999 });
    expect(attempted).toBe(locked); // nothing changed, nothing to commit
    expect(findElement(locked, ids[0]!)!.x).toBe(0);
  });
});

describe('setLocked — the single permitted mutation of a locked element', () => {
  it('locks and unlocks', () => {
    const { doc, ids } = docWith(1);
    const locked = setLocked(doc, ids[0]!, true);
    expect(findElement(locked, ids[0]!)!.locked).toBe(true);
    expect(findElement(setLocked(locked, ids[0]!, false), ids[0]!)!.locked).toBe(false);
  });

  it('is a no-op when the state already matches', () => {
    const { doc, ids } = docWith(1);
    expect(setLocked(doc, ids[0]!, false)).toBe(doc);
  });
});

describe('reorderElement — arrange is an array reorder, not a z field', () => {
  it('moves to front, back, forward and backward', () => {
    const { doc, ids } = docWith(3);
    const [a, b, c] = ids as [string, string, string];
    expect(reorderElement(doc, a, 'front').pages[1]!.elements.map((e) => e.id)).toEqual([b, c, a]);
    expect(reorderElement(doc, c, 'back').pages[1]!.elements.map((e) => e.id)).toEqual([c, a, b]);
    expect(reorderElement(doc, a, 'forward').pages[1]!.elements.map((e) => e.id)).toEqual([b, a, c]);
    expect(reorderElement(doc, c, 'backward').pages[1]!.elements.map((e) => e.id)).toEqual([a, c, b]);
  });

  it('is a no-op at the ends — already-front commits nothing', () => {
    const { doc, ids } = docWith(3);
    expect(reorderElement(doc, ids[2]!, 'front')).toBe(doc);
    expect(reorderElement(doc, ids[2]!, 'forward')).toBe(doc);
    expect(reorderElement(doc, ids[0]!, 'back')).toBe(doc);
    expect(reorderElement(doc, ids[0]!, 'backward')).toBe(doc);
  });
});

describe('lookups and selection filtering', () => {
  it('finds elements and their owning page', () => {
    const { doc, pageId, ids } = docWith(2);
    expect(findElement(doc, ids[1]!)!.id).toBe(ids[1]);
    expect(pageOfElement(doc, ids[1]!)!.id).toBe(pageId);
    expect(elementExists(doc, ids[0]!)).toBe(true);
    expect(elementExists(doc, 'ghost')).toBe(false);
  });

  it('liveSelection drops stale ids and never recreates them (contract #4)', () => {
    const { doc, ids } = docWith(2);
    expect(liveSelection(doc, [ids[0]!, 'ghost', ids[1]!])).toEqual([ids[0], ids[1]]);
  });

  it('liveSelection returns the same array reference when nothing is stale', () => {
    const { doc, ids } = docWith(2);
    const selection = [ids[0]!, ids[1]!];
    expect(liveSelection(doc, selection)).toBe(selection);
  });
});

describe('ellipse and rect share the element contract', () => {
  it('both carry the None stroke as null, distinct from width 0', () => {
    const rect = newRectElement({ x: 0, y: 0 });
    const ellipse = newEllipseElement({ x: 0, y: 0 });
    expect(rect.stroke).toBeNull();
    expect(ellipse.stroke).toBeNull();
    expect(rect.strokeWidth).toBe(0);
  });
});
