/**
 * Element semantics — pure document operations (ADR-003 §1).
 *
 * The shape of every operation is:
 *
 *     current document + semantic operation → next document
 *
 * and the caller hands that `nextDoc` to the reducer's one generic `COMMIT`.
 * There is deliberately no per-element-type reducer action, in this slice or
 * any later one: the reducer stays a transaction log and the meaning of an
 * edit lives here, where it is pure and testable without React or Konva.
 *
 * **No-ops return the SAME document reference.** That is not an optimisation —
 * it is the mechanism behind two accepted guarantees: `COMMIT` drops commits
 * where `nextDoc === state.doc` (so a no-op creates no history entry, contract
 * #24), and the commit observer only schedules autosave on a document
 * reference change (contract #25). Returning a fresh-but-equal object would
 * silently break both.
 *
 * **Locked elements** (contract #20) are excluded from every property
 * mutation structurally — `updateElement` skips them rather than trusting
 * callers — and `setLocked` is the single permitted path to the lock property
 * itself.
 */
import type { EditorDoc, EditorElement, EditorPage } from './document';

export type ArrangeOp = 'front' | 'forward' | 'backward' | 'back';

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

export function findElement(doc: EditorDoc, id: string): EditorElement | undefined {
  for (const page of doc.pages) {
    const el = page.elements.find((e) => e.id === id);
    if (el) return el;
  }
  return undefined;
}

export function pageOfElement(doc: EditorDoc, id: string): EditorPage | undefined {
  return doc.pages.find((p) => p.elements.some((e) => e.id === id));
}

export function elementExists(doc: EditorDoc, id: string): boolean {
  return findElement(doc, id) !== undefined;
}

/**
 * Filter a selection to ids that still exist in `doc`.
 *
 * Contract #4: undo/redo restores the selection captured with the history
 * entry, filtered to still-live ids — **stale ids are never recreated**.
 * Returns the same array reference when nothing is filtered out.
 */
export function liveSelection(
  doc: EditorDoc,
  selection: readonly string[]
): readonly string[] {
  const live = selection.filter((id) => elementExists(doc, id));
  return live.length === selection.length ? selection : live;
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

/** Append to the page's element array — the top of the z-order. */
export function addElement(doc: EditorDoc, pageId: string, element: EditorElement): EditorDoc {
  const index = doc.pages.findIndex((p) => p.id === pageId);
  if (index === -1) return doc;
  return replacePage(doc, index, {
    ...doc.pages[index]!,
    elements: [...doc.pages[index]!.elements, element],
  });
}

/**
 * Patch one element's properties.
 *
 * Locked elements are skipped structurally (contract #20) — callers cannot
 * accidentally mutate one, and the guarantee does not depend on the UI
 * disabling a control. Patches that change nothing return the same document.
 */
export function updateElement(
  doc: EditorDoc,
  id: string,
  patch: Partial<Omit<EditorElement, 'id' | 'type' | 'locked'>>
): EditorDoc {
  const pageIndex = doc.pages.findIndex((p) => p.elements.some((e) => e.id === id));
  if (pageIndex === -1) return doc;
  const page = doc.pages[pageIndex]!;
  const elIndex = page.elements.findIndex((e) => e.id === id);
  const current = page.elements[elIndex]!;

  if (current.locked) return doc; // contract #20 — never mutated except via setLocked

  const next = { ...current, ...patch } as EditorElement;
  if (shallowEqual(current, next)) return doc; // identical values commit nothing (#19)

  return replacePage(doc, pageIndex, {
    ...page,
    elements: replaceAt(page.elements, elIndex, next),
  });
}

/** The lock property's dedicated path — the one permitted mutation of a locked element. */
export function setLocked(doc: EditorDoc, id: string, locked: boolean): EditorDoc {
  const pageIndex = doc.pages.findIndex((p) => p.elements.some((e) => e.id === id));
  if (pageIndex === -1) return doc;
  const page = doc.pages[pageIndex]!;
  const elIndex = page.elements.findIndex((e) => e.id === id);
  const current = page.elements[elIndex]!;
  if (current.locked === locked) return doc;
  return replacePage(doc, pageIndex, {
    ...page,
    elements: replaceAt(page.elements, elIndex, { ...current, locked }),
  });
}

/**
 * Arrange — z-order is the element array's order, so arrange is a reorder
 * within the owning page. No `z` field exists, by design (Part 5).
 */
export function reorderElement(doc: EditorDoc, id: string, op: ArrangeOp): EditorDoc {
  const pageIndex = doc.pages.findIndex((p) => p.elements.some((e) => e.id === id));
  if (pageIndex === -1) return doc;
  const page = doc.pages[pageIndex]!;
  const from = page.elements.findIndex((e) => e.id === id);
  const last = page.elements.length - 1;

  const to =
    op === 'front' ? last : op === 'back' ? 0 : op === 'forward' ? Math.min(last, from + 1) : Math.max(0, from - 1);

  if (to === from) return doc; // already there — nothing to commit

  const elements = [...page.elements];
  const [moved] = elements.splice(from, 1);
  elements.splice(to, 0, moved!);
  return replacePage(doc, pageIndex, { ...page, elements });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function replacePage(doc: EditorDoc, index: number, page: EditorPage): EditorDoc {
  return { ...doc, pages: replaceAt(doc.pages, index, page) };
}

function replaceAt<T>(arr: readonly T[], index: number, value: T): T[] {
  const next = [...arr];
  next[index] = value;
  return next;
}

/** One level deep is enough: element properties are scalars except `focal`. */
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(b);
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (Object.is(av, bv)) continue;
    if (isPlainObject(av) && isPlainObject(bv)) {
      if (shallowEqual(av, bv) && shallowEqual(bv, av)) continue;
    }
    return false;
  }
  return true;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
