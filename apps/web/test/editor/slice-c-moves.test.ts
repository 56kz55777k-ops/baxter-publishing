/**
 * Slice C — movement and set operations (pure layer).
 *
 * Covers the R9 union fixtures (rigid multi commit, union-box snapping with
 * edge and centre candidates, engage/hold/release, locked members as targets),
 * decision C-1/D-035 (round the shared delta, never the members), C-2
 * (stacking), re-parenting by centre (#2), and the pure half of the
 * locked-member matrix (#20) for every Slice C operation. The browser and
 * history halves live in the React/state suites and the Playwright layer.
 */
import { describe, expect, it } from 'vitest';
import {
  addElement,
  applyMoves,
  buildTargets,
  copyElements,
  dragDelta,
  duplicateElements,
  elementBounds,
  findElement,
  getFormatPreset,
  newEditorDoc,
  newEllipseElement,
  newRectElement,
  nudgeElements,
  pageForCentre,
  pasteElements,
  patchAll,
  removeElements,
  setLockAll,
  setLocked,
  snapUnion,
  unionBox,
  updateElement,
  type EditorDoc,
  type EditorElement,
  type SnapGeometry,
  type UnitLayout,
} from '@baxter/domain';

const preset = getFormatPreset('zine_a5')!; // 148 × 210

function spreadDoc(): { doc: EditorDoc; layout: UnitLayout; verso: string; recto: string } {
  const doc = newEditorDoc(preset);
  const verso = doc.pages[1]!.id;
  const recto = doc.pages[2]!.id;
  return { doc, layout: { pageIds: [verso, recto], pageOffsetsMm: [0, 148] }, verso, recto };
}

function rect(x: number, y: number, w = 20, h = 10): EditorElement {
  return { ...newRectElement({ x, y }), width: w, height: h };
}

function place(doc: EditorDoc, pageId: string, ...els: EditorElement[]): EditorDoc {
  return els.reduce((d, el) => addElement(d, pageId, el), doc);
}

const ids = (doc: EditorDoc, pageId: string) => doc.pages.find((p) => p.id === pageId)!.elements.map((e) => e.id);
const at = (doc: EditorDoc, id: string) => {
  const e = findElement(doc, id)!;
  return { x: e.x, y: e.y };
};

/* -------------------------------------------------------------------------- */

describe('C-1 / D-035 · the shared delta', () => {
  it('free movement rounds the DELTA to the 0.1 mm drag grid', () => {
    expect(dragDelta(3.14159, null)).toBe(3.1);
    expect(dragDelta(-0.04, null)).toBe(0); // −0 normalised
  });

  it('a snapped axis uses the exact snap correction on the 0.01 model grid', () => {
    // union left edge at 20.05 moved by raw 9.98 → 30.03; target 30.00
    expect(dragDelta(9.98, { delta: -0.03, guide: 30 })).toBe(9.95);
  });

  it('R9 · rigid multi commit: off-grid members keep their exact relative spacing', () => {
    const { doc: d0, layout, verso } = spreadDoc();
    const a = rect(20.05, 30.07);
    const b = rect(41.33, 52.91);
    const doc = place(d0, verso, a, b);
    const next = applyMoves(doc, layout, [a.id, b.id], dragDelta(7.26, null), dragDelta(-3.04, null));
    const A = at(next, a.id);
    const B = at(next, b.id);
    expect(A).toEqual({ x: 27.35, y: 27.07 }); // 20.05 + 7.3, 30.07 − 3.0
    expect(+(B.x - A.x).toFixed(10)).toBe(+(41.33 - 20.05).toFixed(10));
    expect(+(B.y - A.y).toFixed(10)).toBe(+(52.91 - 30.07).toFixed(10));
  });

  it('property · relative spacing is invariant under any delta (no per-member rounding)', () => {
    const { doc: d0, layout, verso } = spreadDoc();
    const members = [rect(10.01, 10.02), rect(33.37, 40.49), rect(57.83, 12.11), rect(80.99, 70.05)];
    const doc = place(d0, verso, ...members);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 40 - 20;
    for (let i = 0; i < 200; i++) {
      const dx = dragDelta(rnd(), null);
      const dy = i % 3 === 0 ? dragDelta(rnd(), { delta: 0.01 * ((i % 7) - 3), guide: 0 }) : dragDelta(rnd(), null);
      const next = applyMoves(doc, layout, members.map((m) => m.id), dx, dy);
      const p0 = at(next, members[0]!.id);
      for (const m of members.slice(1)) {
        const p = at(next, m.id);
        expect(Math.round((p.x - p0.x) * 100)).toBe(Math.round((m.x - members[0]!.x) * 100));
        expect(Math.round((p.y - p0.y) * 100)).toBe(Math.round((m.y - members[0]!.y) * 100));
        // every committed value is on the 0.01 model grid
        expect(Math.abs(p.x * 100 - Math.round(p.x * 100))).toBeLessThan(1e-6);
      }
    }
  });

  it('nudge adds exactly ±0.5 / ±5 and keeps 0.01-grid offsets (no member rounding)', () => {
    const { doc: d0, verso } = spreadDoc();
    const a = rect(20.05, 30.07);
    const doc = place(d0, verso, a);
    expect(at(nudgeElements(doc, [a.id], 0.5, 0), a.id)).toEqual({ x: 20.55, y: 30.07 });
    expect(at(nudgeElements(doc, [a.id], 0, -5), a.id)).toEqual({ x: 20.05, y: 25.07 });
  });

  it('a zero delta is a no-op (same document — no history, no autosave)', () => {
    const { doc: d0, layout, verso } = spreadDoc();
    const a = rect(10, 10);
    const doc = place(d0, verso, a);
    expect(applyMoves(doc, layout, [a.id], 0, 0)).toBe(doc);
    expect(nudgeElements(doc, [a.id], 0, 0)).toBe(doc);
  });
});

/* -------------------------------------------------------------------------- */

const spreadGeom: SnapGeometry = { pageWidthMm: 148, pageHeightMm: 210, pageOffsetsMm: [0, 148], marginMm: 12 };

describe('R9 · union-box snapping (contract #8)', () => {
  it('the union of a set is its bounding box', () => {
    expect(unionBox([elementBounds(rect(10, 10)), elementBounds(rect(50, 40, 10, 30))])).toEqual({
      x: 10,
      y: 10,
      width: 50,
      height: 60,
    });
    expect(unionBox([])).toBeNull();
  });

  it('snaps the union LEFT edge to the margin', () => {
    const t = buildTargets(spreadGeom, []);
    const s = snapUnion({ x: 12.9, y: 100, width: 50, height: 20 }, t);
    expect(s.x).toEqual({ delta: expect.closeTo(-0.9, 10), guide: 12 });
  });

  it('snaps the union RIGHT edge (union of several, not any member)', () => {
    const t = buildTargets(spreadGeom, []);
    // union spans 70..135.2 → right edge 1.2 mm short of margin 136... page centre 74 is 4 mm from left: out of range
    const s = snapUnion({ x: 70, y: 100, width: 65.2, height: 20 }, t);
    expect(s.x?.guide).toBe(136);
    expect(s.x?.delta).toBeCloseTo(0.8, 10);
  });

  it('snaps the union CENTRE (centre candidates move at rate 1 in a drag)', () => {
    const t = buildTargets(spreadGeom, []);
    // centre at 73 → page centre 74; edges at 63/83 are nowhere near a target
    const s = snapUnion({ x: 63, y: 100, width: 20, height: 20 }, t);
    expect(s.x).toEqual({ delta: 1, guide: 74 });
  });

  it('engage within 1.6 mm, release cleanly past it', () => {
    const t = buildTargets(spreadGeom, []);
    expect(snapUnion({ x: 13.6, y: 100, width: 5, height: 5 }, t).x?.guide).toBe(12);
    expect(snapUnion({ x: 13.7, y: 100, width: 5, height: 5 }, t).x).toBeNull();
  });

  it('locked elements ARE snap targets (#20); the moving set is NOT', () => {
    const lockedBox = { x: 100, y: 100, width: 10, height: 10 };
    const t = buildTargets(spreadGeom, [lockedBox]); // caller passes others incl. locked
    const s = snapUnion({ x: 110.9, y: 150, width: 5, height: 5 }, t);
    expect(s.x?.guide).toBe(110);
  });
});

/* -------------------------------------------------------------------------- */

describe('re-parenting by centre (contract #2) and stacking (C-2)', () => {
  it('pageForCentre picks the page under the centre and clamps the pasteboard', () => {
    const layout = { pageIds: ['v', 'r'], pageOffsetsMm: [0, 148] };
    expect(pageForCentre(layout, 147.99)).toBe(0);
    expect(pageForCentre(layout, 148)).toBe(1);
    expect(pageForCentre(layout, -40)).toBe(0);
    expect(pageForCentre(layout, 400)).toBe(1);
  });

  it('crossing the gutter by the centre re-parents with a page-relative x', () => {
    const { doc: d0, layout, verso, recto } = spreadDoc();
    const a = rect(120, 50); // centre 130
    const doc = place(d0, verso, a);
    const next = applyMoves(doc, layout, [a.id], 30, 0); // centre 160 → recto
    expect(ids(next, verso)).toEqual([]);
    expect(ids(next, recto)).toEqual([a.id]);
    expect(at(next, a.id)).toEqual({ x: 2, y: 50 }); // 150 − 148
  });

  it('a move whose centre stays put keeps ownership even when the box spans the gutter', () => {
    const { doc: d0, layout, verso } = spreadDoc();
    const a = rect(120, 50, 40, 10); // centre 140
    const doc = place(d0, verso, a);
    const next = applyMoves(doc, layout, [a.id], 5, 0); // centre 145, box to 165
    expect(ids(next, verso)).toEqual([a.id]);
    expect(at(next, a.id).x).toBe(125);
  });

  it('C-2 · a same-page move keeps every array index (no bring-to-front)', () => {
    const { doc: d0, layout, verso } = spreadDoc();
    const a = rect(10, 10);
    const b = rect(40, 10);
    const c = rect(70, 10);
    const doc = place(d0, verso, a, b, c);
    const next = applyMoves(doc, layout, [a.id], 3, 3);
    expect(ids(next, verso)).toEqual([a.id, b.id, c.id]);
  });

  it('C-2 · re-parented members go to the top of the target page in their relative order', () => {
    const { doc: d0, layout, verso, recto } = spreadDoc();
    const a = rect(100, 10);
    const b = rect(110, 30);
    const r1 = rect(20, 20);
    let doc = place(d0, verso, a, b);
    doc = place(doc, recto, r1);
    const next = applyMoves(doc, layout, [b.id, a.id], 60, 0);
    expect(ids(next, recto)).toEqual([r1.id, a.id, b.id]);
  });

  it('members outside the unit never move', () => {
    const { doc: d0, layout } = spreadDoc();
    const other = d0.pages[3]!.id;
    const a = rect(10, 10);
    const doc = place(d0, other, a);
    expect(applyMoves(doc, layout, [a.id], 5, 5)).toBe(doc);
  });
});

/* -------------------------------------------------------------------------- */

describe('locked-member matrix — pure layer (#20)', () => {
  function fixture(kind: 'unlocked' | 'mixed' | 'locked') {
    const { doc: d0, layout, verso } = spreadDoc();
    const a = rect(10, 10);
    const b = rect(40, 10);
    let doc = place(d0, verso, a, b);
    if (kind !== 'unlocked') doc = setLocked(doc, b.id, true);
    if (kind === 'locked') doc = setLocked(doc, a.id, true);
    return { doc, layout, verso, a, b, sel: [a.id, b.id] };
  }

  it.each(['unlocked', 'mixed', 'locked'] as const)('move · %s', (kind) => {
    const f = fixture(kind);
    const next = applyMoves(f.doc, f.layout, f.sel, 5, 0);
    if (kind === 'locked') return expect(next).toBe(f.doc);
    expect(at(next, f.a.id).x).toBe(15);
    expect(at(next, f.b.id).x).toBe(kind === 'mixed' ? 40 : 45);
  });

  it.each(['unlocked', 'mixed', 'locked'] as const)('nudge · %s', (kind) => {
    const f = fixture(kind);
    const next = nudgeElements(f.doc, f.sel, 0, 0.5);
    if (kind === 'locked') return expect(next).toBe(f.doc);
    expect(at(next, f.a.id).y).toBe(10.5);
    expect(at(next, f.b.id).y).toBe(kind === 'mixed' ? 10 : 10.5);
  });

  it.each(['unlocked', 'mixed', 'locked'] as const)('delete · %s', (kind) => {
    const f = fixture(kind);
    const r = removeElements(f.doc, f.sel);
    if (kind === 'locked') {
      expect(r.doc).toBe(f.doc);
      expect(r.keptLocked).toEqual([f.a.id, f.b.id]);
      return;
    }
    expect(r.removed).toEqual(kind === 'mixed' ? [f.a.id] : [f.a.id, f.b.id]);
    expect(r.keptLocked).toEqual(kind === 'mixed' ? [f.b.id] : []);
    expect(ids(r.doc, f.verso)).toEqual(kind === 'mixed' ? [f.b.id] : []);
  });

  it.each(['unlocked', 'mixed', 'locked'] as const)('duplicate · %s (C-4: locked excluded)', (kind) => {
    const f = fixture(kind);
    let n = 0;
    const r = duplicateElements(f.doc, f.sel, () => `00000000-0000-4000-8000-00000000000${++n}`);
    if (kind === 'locked') return expect(r.doc).toBe(f.doc);
    expect(r.newIds).toHaveLength(kind === 'mixed' ? 1 : 2);
    const copy = findElement(r.doc, r.newIds[0]!)!;
    expect({ x: copy.x, y: copy.y, locked: copy.locked }).toEqual({ x: 14, y: 14, locked: false });
    expect(ids(r.doc, f.verso).slice(-r.newIds.length)).toEqual(r.newIds); // top of the page
  });

  it.each(['unlocked', 'mixed', 'locked'] as const)('opacity (patchAll) · %s', (kind) => {
    const f = fixture(kind);
    const next = patchAll(f.doc, f.sel, { opacity: 0.4 });
    if (kind === 'locked') return expect(next).toBe(f.doc);
    expect(findElement(next, f.a.id)!.opacity).toBe(0.4);
    expect(findElement(next, f.b.id)!.opacity).toBe(kind === 'mixed' ? 1 : 0.4);
  });

  it.each(['unlocked', 'mixed', 'locked'] as const)('copy · %s takes every member, locked included', (kind) => {
    const f = fixture(kind);
    expect(copyElements(f.doc, f.sel).map((c) => c.element.id)).toEqual([f.a.id, f.b.id]);
  });

  it('lock-all / unlock-all is one document; repeating it is a no-op', () => {
    const f = fixture('mixed');
    const all = setLockAll(f.doc, f.sel, true);
    expect([findElement(all, f.a.id)!.locked, findElement(all, f.b.id)!.locked]).toEqual([true, true]);
    expect(setLockAll(all, f.sel, true)).toBe(all);
    const none = setLockAll(all, f.sel, false);
    expect([findElement(none, f.a.id)!.locked, findElement(none, f.b.id)!.locked]).toEqual([false, false]);
  });

  it('identical opacity commits nothing', () => {
    const f = fixture('unlocked');
    expect(patchAll(f.doc, f.sel, { opacity: 1 })).toBe(f.doc);
  });
});

describe('paste (C-3)', () => {
  it('source page in the unit → that page at +5 mm, unlocked, fresh ids, on top', () => {
    const { doc: d0, layout, recto } = spreadDoc();
    const a = rect(10, 20);
    let doc = place(d0, recto, a);
    doc = setLocked(doc, a.id, true);
    const clip = copyElements(doc, [a.id]);
    const r = pasteElements(doc, layout, clip, () => '00000000-0000-4000-8000-0000000000aa');
    const p = findElement(r.doc, r.newIds[0]!)!;
    expect(ids(r.doc, recto)).toEqual([a.id, p.id]);
    expect({ x: p.x, y: p.y, locked: p.locked }).toEqual({ x: 15, y: 25, locked: false });
  });

  it('source page outside the unit → the unit’s first page at the same position', () => {
    const { doc: d0, layout, verso } = spreadDoc();
    const elsewhere = d0.pages[3]!.id;
    const a = newEllipseElement({ x: 33, y: 44 });
    const doc = place(d0, elsewhere, a);
    const r = pasteElements(doc, layout, copyElements(doc, [a.id]), () => '00000000-0000-4000-8000-0000000000bb');
    expect(ids(r.doc, verso)).toEqual(r.newIds);
    expect(at(r.doc, r.newIds[0]!)).toEqual({ x: 33, y: 44 });
  });

  it('pasting an empty clipboard is a no-op', () => {
    const { doc, layout } = spreadDoc();
    expect(pasteElements(doc, layout, []).doc).toBe(doc);
  });

  it('a pasted copy is independent of its source (editing it leaves the original)', () => {
    const { doc: d0, layout, verso } = spreadDoc();
    const a = rect(10, 20);
    const doc = place(d0, verso, a);
    const r = pasteElements(doc, layout, copyElements(doc, [a.id]));
    const edited = updateElement(r.doc, r.newIds[0]!, { opacity: 0.2 });
    expect(findElement(edited, a.id)!.opacity).toBe(1);
  });
});
