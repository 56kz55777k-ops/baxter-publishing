/**
 * Movement and set operations — pure document operations for Slice C
 * (contracts #2, #5, #7, #20, #24), in the same shape as `elements.ts`:
 *
 *     current document + semantic operation → next document
 *
 * Every function returns the SAME document reference for a no-op, so the
 * reducer's generic COMMIT drops it (no history, no autosave — #24/#25).
 *
 * **Locked members** (contract #20) are skipped structurally by every
 * operation here that changes an element: move, nudge, delete, duplicate,
 * patch. Callers cannot accidentally mutate one.
 *
 * **Precision** (contract #19, refined by decision D-035 / C-1): movement
 * rounds the SHARED DELTA, never each member. Free movement uses a delta on
 * the 0.1 mm drag grid; a snapped axis uses the snap's own delta on the
 * 0.01 mm model grid, so the committed edge is the guide that was shown.
 * Members then sit at `old + delta`, re-expressed on the 0.01 model grid
 * (an identity for on-grid values), so a moving set stays exactly rigid —
 * relative spacing is invariant. Nudge follows the same principle: the
 * nudge distance itself is the delta (Ben, 2026-10-04).
 */
import type { EditorDoc, EditorElement, EditorPage } from './document';
import { quantizeCreate, quantizeInspector } from './precision';
import type { AxisSnap } from './snapping';

/* -------------------------------------------------------------------------- */
/* Geometry                                                                    */
/* -------------------------------------------------------------------------- */

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * An element's page-relative, normalised bounds. Lines are signed vectors
 * (#16) and are normalised here; text has no stored height (#15) and is a
 * zero-height box until Slice G supplies the measured height.
 */
export function elementBounds(el: EditorElement): Bounds {
  if (el.type === 'line') {
    return {
      x: Math.min(el.x, el.x + el.width),
      y: Math.min(el.y, el.y + el.height),
      width: Math.abs(el.width),
      height: Math.abs(el.height),
    };
  }
  if (el.type === 'text') return { x: el.x, y: el.y, width: el.width, height: 0 };
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

/** The union bounding box of a set (contract #8: snapping evaluates this). */
export function unionBox(boxes: readonly Bounds[]): Bounds | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The pages of the unit being edited, in unit order, with each page's x
 * offset inside the unit (page 2 of a spread sits at `trimWidth`).
 */
export interface UnitLayout {
  pageIds: readonly string[];
  pageOffsetsMm: readonly number[];
}

/**
 * Contract #2: the page an object's CENTRE lands on owns it. Centres left of
 * the first page or right of the last clamp to the nearest page — every
 * element belongs to exactly one page.
 */
export function pageForCentre(layout: UnitLayout, unitCentreX: number): number {
  for (let i = layout.pageOffsetsMm.length - 1; i >= 0; i--) {
    if (unitCentreX >= layout.pageOffsetsMm[i]!) return i;
  }
  return 0;
}

/**
 * C-1 / D-035 — the shared delta for one axis of a drag.
 * Free: rounded to the 0.1 mm drag grid. Snapped: the raw delta plus the
 * snap correction, on the 0.01 mm model grid (exact for edge snaps; a centre
 * snap of an odd-hundredth width can sit ≤ 0.005 mm from its guide, which is
 * the model grid's own resolution).
 */
export function dragDelta(raw: number, snap: AxisSnap | null): number {
  return snap ? quantizeInspector(raw + snap.delta) : quantizeCreate(raw);
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

interface Located {
  pageIndex: number;
  index: number;
  el: EditorElement;
}

function locate(doc: EditorDoc, ids: ReadonlySet<string>): Located[] {
  const out: Located[] = [];
  doc.pages.forEach((page, pageIndex) => {
    page.elements.forEach((el, index) => {
      if (ids.has(el.id)) out.push({ pageIndex, index, el });
    });
  });
  return out; // document order: page order, then z-order
}

const shift = (el: EditorElement, dx: number, dy: number): EditorElement =>
  ({ ...el, x: quantizeInspector(el.x + dx), y: quantizeInspector(el.y + dy) }) as EditorElement;

/**
 * Contract #7 — one rigid move of every unlocked member by the shared delta,
 * re-parented per member by centre (#2), in ONE document (one history entry).
 *
 * Stacking (C-2): a member that stays on its page keeps its array index; a
 * member that changes page is appended to the top of the target page, the
 * re-parented members keeping their relative document order.
 *
 * Only members on the unit's pages move — the unit is what the user sees.
 */
export function applyMoves(
  doc: EditorDoc,
  layout: UnitLayout,
  ids: readonly string[],
  dx: number,
  dy: number
): EditorDoc {
  if (dx === 0 && dy === 0) return doc;
  const movers = locate(doc, new Set(ids)).filter((m) => !m.el.locked);
  const docIndexToUnit = new Map<number, number>();
  layout.pageIds.forEach((id, u) => {
    const di = doc.pages.findIndex((p) => p.id === id);
    if (di !== -1) docIndexToUnit.set(di, u);
  });

  const inPlace = new Map<string, EditorElement>();
  const carried: { toDocPage: number; el: EditorElement }[] = [];

  for (const m of movers) {
    const from = docIndexToUnit.get(m.pageIndex);
    if (from === undefined) continue;
    const moved = shift(m.el, dx, dy);
    const b = elementBounds(moved);
    const to = pageForCentre(layout, layout.pageOffsetsMm[from]! + b.x + b.width / 2);
    if (to === from) {
      inPlace.set(m.el.id, moved);
    } else {
      const offset = layout.pageOffsetsMm[from]! - layout.pageOffsetsMm[to]!;
      const toDocPage = doc.pages.findIndex((p) => p.id === layout.pageIds[to]);
      carried.push({
        toDocPage,
        el: { ...moved, x: quantizeInspector(moved.x + offset) } as EditorElement,
      });
    }
  }

  if (inPlace.size === 0 && carried.length === 0) return doc;
  const leaving = new Set(carried.map((c) => c.el.id));

  const pages: EditorPage[] = doc.pages.map((page, pi) => {
    const touched = page.elements.some((e) => inPlace.has(e.id) || leaving.has(e.id));
    const arriving = carried.filter((c) => c.toDocPage === pi).map((c) => c.el);
    if (!touched && arriving.length === 0) return page;
    const kept = page.elements
      .filter((e) => !leaving.has(e.id))
      .map((e) => inPlace.get(e.id) ?? e);
    return { ...page, elements: [...kept, ...arriving] };
  });
  return { ...doc, pages };
}

/**
 * Nudge (#26: arrows 0.5 mm, Shift 5 mm). The nudge distance is the shared
 * delta; members keep their exact relative offsets (Ben, 2026-10-04 —
 * D-035 applied to nudge). Nudge never re-parents: re-parenting happens only
 * on drag-drop (#2). Locked members do not move (#20).
 */
export function nudgeElements(doc: EditorDoc, ids: readonly string[], dx: number, dy: number): EditorDoc {
  if (dx === 0 && dy === 0) return doc;
  const set = new Set(ids);
  let changed = false;
  const pages = doc.pages.map((page) => {
    if (!page.elements.some((e) => set.has(e.id) && !e.locked)) return page;
    changed = true;
    return {
      ...page,
      elements: page.elements.map((e) => (set.has(e.id) && !e.locked ? shift(e, dx, dy) : e)),
    };
  });
  return changed ? { ...doc, pages } : doc;
}

/** Delete unlocked members only (#5, #20). Reports what was kept, so the UI can say so. */
export function removeElements(
  doc: EditorDoc,
  ids: readonly string[]
): { doc: EditorDoc; removed: string[]; keptLocked: string[] } {
  const found = locate(doc, new Set(ids));
  const removed = found.filter((m) => !m.el.locked).map((m) => m.el.id);
  const keptLocked = found.filter((m) => m.el.locked).map((m) => m.el.id);
  if (removed.length === 0) return { doc, removed, keptLocked };
  const gone = new Set(removed);
  const pages = doc.pages.map((page) =>
    page.elements.some((e) => gone.has(e.id))
      ? { ...page, elements: page.elements.filter((e) => !gone.has(e.id)) }
      : page
  );
  return { doc: { ...doc, pages }, removed, keptLocked };
}

/** Accepted spike offsets: duplicate +4 mm, paste +5 mm (C-3, C-4). */
export const DUPLICATE_OFFSET_MM = 4;
export const PASTE_OFFSET_MM = 5;

/**
 * Duplicate unlocked members (#20, C-4): fresh ids, +4 mm, appended to the
 * top of their own page in document order. Returns the new ids so the
 * caller can select the copies.
 */
export function duplicateElements(
  doc: EditorDoc,
  ids: readonly string[],
  newId: () => string = () => crypto.randomUUID()
): { doc: EditorDoc; newIds: string[] } {
  const found = locate(doc, new Set(ids)).filter((m) => !m.el.locked);
  if (found.length === 0) return { doc, newIds: [] };
  const byPage = new Map<number, EditorElement[]>();
  const newIds: string[] = [];
  for (const m of found) {
    const id = newId();
    newIds.push(id);
    const copy = { ...shift(m.el, DUPLICATE_OFFSET_MM, DUPLICATE_OFFSET_MM), id } as EditorElement;
    byPage.set(m.pageIndex, [...(byPage.get(m.pageIndex) ?? []), copy]);
  }
  const pages = doc.pages.map((page, pi) => {
    const adds = byPage.get(pi);
    return adds ? { ...page, elements: [...page.elements, ...adds] } : page;
  });
  return { doc: { ...doc, pages }, newIds };
}

/** One copied element plus the page it was copied from (C-3). */
export interface ClipboardItem {
  sourcePageId: string;
  element: EditorElement;
}

/** Copy takes every selected element, locked included (copying changes nothing). */
export function copyElements(doc: EditorDoc, ids: readonly string[]): ClipboardItem[] {
  return locate(doc, new Set(ids)).map((m) => ({
    sourcePageId: doc.pages[m.pageIndex]!.id,
    element: m.el,
  }));
}

/**
 * Paste (C-3): fresh ids, always UNLOCKED. An item whose source page is in
 * the current unit lands on that page at +5 mm; otherwise it lands on the
 * unit's first page at the same page-relative position. Appended to the top.
 */
export function pasteElements(
  doc: EditorDoc,
  layout: UnitLayout,
  items: readonly ClipboardItem[],
  newId: () => string = () => crypto.randomUUID()
): { doc: EditorDoc; newIds: string[] } {
  if (items.length === 0 || layout.pageIds.length === 0) return { doc, newIds: [] };
  const byPage = new Map<string, EditorElement[]>();
  const newIds: string[] = [];
  for (const item of items) {
    const local = layout.pageIds.includes(item.sourcePageId);
    const pageId = local ? item.sourcePageId : layout.pageIds[0]!;
    const off = local ? PASTE_OFFSET_MM : 0;
    const id = newId();
    newIds.push(id);
    const el = { ...shift(item.element, off, off), id, locked: false } as EditorElement;
    byPage.set(pageId, [...(byPage.get(pageId) ?? []), el]);
  }
  const pages = doc.pages.map((page) => {
    const adds = byPage.get(page.id);
    return adds ? { ...page, elements: [...page.elements, ...adds] } : page;
  });
  return { doc: { ...doc, pages }, newIds };
}

/**
 * One shared property applied to unlocked members only, as ONE document
 * (contract #5: one history action). Identical values commit nothing.
 */
export function patchAll(
  doc: EditorDoc,
  ids: readonly string[],
  patch: Partial<Pick<EditorElement, 'opacity'>>
): EditorDoc {
  const set = new Set(ids);
  let changed = false;
  const pages = doc.pages.map((page) => {
    let pageChanged = false;
    const elements = page.elements.map((e) => {
      if (!set.has(e.id) || e.locked) return e;
      const next = { ...e, ...patch } as EditorElement;
      if ((Object.keys(patch) as (keyof typeof patch)[]).every((k) => Object.is(e[k], next[k]))) return e;
      pageChanged = true;
      return next;
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements };
  });
  return changed ? { ...doc, pages } : doc;
}

/** Lock-all / unlock-all in one action (#20) — the lock property's set path. */
export function setLockAll(doc: EditorDoc, ids: readonly string[], locked: boolean): EditorDoc {
  const set = new Set(ids);
  let changed = false;
  const pages = doc.pages.map((page) => {
    if (!page.elements.some((e) => set.has(e.id) && e.locked !== locked)) return page;
    changed = true;
    return {
      ...page,
      elements: page.elements.map((e) => (set.has(e.id) && e.locked !== locked ? { ...e, locked } : e)),
    };
  });
  return changed ? { ...doc, pages } : doc;
}
