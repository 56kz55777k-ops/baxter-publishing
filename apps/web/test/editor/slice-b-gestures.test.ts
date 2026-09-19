/**
 * Gesture geometry and thresholds (contracts #3, #6) — the pure parts.
 *
 * The state machine itself is exercised in the browser smoke, where real
 * pointer events are the point. What is worth pinning here is the maths the
 * machine depends on: which page owns a creation, how unit and page
 * coordinates convert, marquee intersection (not enclosure), and the two
 * thresholds, which are different numbers for different gestures and must not
 * drift into each other.
 */
import { describe, expect, it } from 'vitest';
import { getFormatPreset, newEditorDoc, newRectElement, addElement } from '@baxter/domain';
import {
  pageBoxToUnit,
  pageIndexForUnitX,
  pageWidthMm,
  screenToUnitMm,
  unitGeometry,
  unitToPageMm,
} from '@/components/editor/geometry';
import {
  CREATE_CLICK_THRESHOLD_MM,
  MARQUEE_CLICK_THRESHOLD_MM,
  MIN_SHAPE_MM,
  elementBoxes,
  rectsIntersect,
} from '@/components/editor/use-stage-gestures';
import { selectUnits } from '@/components/editor/state/selectors';

const preset = getFormatPreset('zine_a5')!;
const doc = newEditorDoc(preset);
const layout = { marginMm: doc.meta.marginMm, safeMm: doc.meta.safeMm };
const spread = selectUnits(doc)[1]!; // cover is single; the first spread has two pages
const geom = unitGeometry(spread, preset, layout);

describe('thresholds are distinct and named', () => {
  it('creation treats < 3 mm as a click; marquee treats < 2 mm as a click', () => {
    expect(CREATE_CLICK_THRESHOLD_MM).toBe(3);
    expect(MARQUEE_CLICK_THRESHOLD_MM).toBe(2);
    expect(CREATE_CLICK_THRESHOLD_MM).not.toBe(MARQUEE_CLICK_THRESHOLD_MM);
  });

  it('shapes carry the accepted 4 mm per-axis minimum', () => {
    expect(MIN_SHAPE_MM).toBe(4);
  });
});

describe('page ownership and coordinates', () => {
  it('a spread has two pages side by side', () => {
    expect(geom.pageOffsetsMm).toEqual([0, 148]);
    expect(pageWidthMm(geom)).toBe(148);
  });

  it('assigns the page whose x-range contains the point', () => {
    expect(pageIndexForUnitX(geom, 0)).toBe(0);
    expect(pageIndexForUnitX(geom, 147.9)).toBe(0);
    expect(pageIndexForUnitX(geom, 148)).toBe(1);
    expect(pageIndexForUnitX(geom, 290)).toBe(1);
  });

  it('clamps pasteboard points to the nearest page — everything owns one page (#2)', () => {
    expect(pageIndexForUnitX(geom, -30)).toBe(0);
    expect(pageIndexForUnitX(geom, 400)).toBe(1);
  });

  it('round-trips unit ↔ page coordinates', () => {
    const asPage = unitToPageMm(geom, 1, { x: 160, y: 20 });
    expect(asPage).toEqual({ x: 12, y: 20 });
    const back = pageBoxToUnit(geom, 1, { x: 12, y: 20, width: 10, height: 10 });
    expect(back.x).toBe(160);
  });

  it('a cross-gutter element keeps one owner and a page-relative x beyond the trim', () => {
    // Created on the verso, dragged past the gutter: x exceeds the page width,
    // which the schema allows and the renderer draws across the gutter.
    const asPage = unitToPageMm(geom, 0, { x: 200, y: 10 });
    expect(asPage.x).toBeGreaterThan(pageWidthMm(geom));
  });

  it('screenToUnitMm inverts the view transform', () => {
    const view = { x: 100, y: 50, scale: 3.4 };
    expect(screenToUnitMm(view, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(screenToUnitMm(view, { x: 134, y: 84 })).toEqual({ x: 10, y: 10 });
  });
});

describe('elementBoxes — unit-space boxes for hit-testing and snapping', () => {
  it('offsets each page’s elements into unit space', () => {
    const a = newRectElement({ x: 10, y: 10 });
    const b = newRectElement({ x: 10, y: 10 });
    let d = addElement(doc, spread.pages[0]!.id, a);
    d = addElement(d, spread.pages[1]!.id, b);
    const pages = selectUnits(d)[1]!.pages;
    const boxes = elementBoxes(pages, geom);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.box.x).toBe(10); // verso
    expect(boxes[1]!.box.x).toBe(158); // recto — offset by the trim width
  });

  it('reports lock state so the cursor can look it up live', () => {
    const a = newRectElement({ x: 0, y: 0 });
    const d = addElement(doc, spread.pages[0]!.id, { ...a, locked: true });
    const boxes = elementBoxes(selectUnits(d)[1]!.pages, geom);
    expect(boxes[0]!.locked).toBe(true);
  });
});

describe('marquee selects by INTERSECTION, not enclosure (contract #6)', () => {
  const target = { x: 50, y: 50, width: 20, height: 20 };

  it('selects a box the marquee merely clips', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 55, height: 55 }, target)).toBe(true);
  });

  it('selects a box the marquee fully contains', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 200, height: 200 }, target)).toBe(true);
  });

  it('does not select a box it misses', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 49, height: 200 }, target)).toBe(false);
    expect(rectsIntersect({ x: 71, y: 0, width: 50, height: 200 }, target)).toBe(false);
  });

  it('counts edge contact as intersection', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 50, height: 50 }, target)).toBe(true);
  });
});
