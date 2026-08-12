/**
 * Units of view — group a document's pages into what the editor shows.
 *
 * The cover and back cover stand alone; interior pages pair into spreads
 * (verso | recto), an odd interior count leaving a trailing single page.
 * Spreads are always DERIVED from page order — never stored (contract #1).
 *
 * Ported behaviour-for-behaviour from Spike C v2's computeUnits (the accepted
 * baseline): sequential page numbering across all units, spread labels
 * numbered in reading order, singles labelled by role.
 */
import type { EditorPage } from './document';

export interface UnitOfView {
  type: 'single' | 'spread';
  label: string;
  /** One page for singles; [verso, recto] for spreads. */
  pages: EditorPage[];
  /** Sequential page numbers (1-based) across the whole document. */
  pageNumbers: number[];
}

export function computeUnits(pages: readonly EditorPage[]): UnitOfView[] {
  const units: UnitOfView[] = [];
  const interior: EditorPage[] = [];
  let cover: EditorPage | null = null;
  let back: EditorPage | null = null;

  for (const p of pages) {
    if (p.kind === 'cover') cover = p;
    else if (p.kind === 'back') back = p;
    else interior.push(p);
  }

  let num = 1;
  if (cover) {
    units.push({ type: 'single', pages: [cover], label: 'Front cover', pageNumbers: [num++] });
  }
  for (let i = 0; i < interior.length; i += 2) {
    const pair = interior.slice(i, i + 2);
    units.push({
      type: pair.length === 2 ? 'spread' : 'single',
      pages: pair,
      label: pair.length === 2 ? 'Spread' : 'Page',
      pageNumbers: pair.map(() => num++),
    });
  }
  if (back) {
    units.push({ type: 'single', pages: [back], label: 'Back cover', pageNumbers: [num++] });
  }

  let s = 1;
  for (const u of units) {
    if (u.type === 'spread') u.label = `Spread ${s++}`;
  }
  return units;
}
