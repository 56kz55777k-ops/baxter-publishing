import { describe, expect, it } from 'vitest';
import { getFormatPreset, newEditorDoc } from '@baxter/domain';
import {
  FIT_PADDING_PX,
  MAX_ZOOM,
  MIN_ZOOM,
  PX_PER_MM,
  clampScale,
  fitPageView,
  fitUnitView,
  hundredView,
  panBy,
  unitGeometry,
  zoomAt,
  zoomOf,
} from '@/components/editor/geometry';
import { selectUnits } from '@/components/editor/state/selectors';

const preset = getFormatPreset('zine_a5')!;
const doc = newEditorDoc(preset);
const units = selectUnits(doc);
const layout = { marginMm: doc.meta.marginMm, safeMm: doc.meta.safeMm };

describe('viewport geometry — contract #27 (0.15–8× of 3.4 px/mm, pointer-centred zoom)', () => {
  it('unit geometry: cover single 148×210, spread 296×210, page offsets at trim widths', () => {
    const cover = unitGeometry(units[0]!, preset, layout);
    expect(cover.widthMm).toBe(148);
    expect(cover.heightMm).toBe(210);
    expect(cover.pageOffsetsMm).toEqual([0]);

    const spread = unitGeometry(units[1]!, preset, layout);
    expect(spread.widthMm).toBe(296);
    expect(spread.pageOffsetsMm).toEqual([0, 148]);
    expect(spread.bleedMm).toBe(3);
    expect(spread.marginMm).toBe(12);
    expect(spread.safeMm).toBe(5);
  });

  it('scale clamps to the documented zoom range', () => {
    expect(clampScale(0.0001)).toBeCloseTo(MIN_ZOOM * PX_PER_MM, 10);
    expect(clampScale(9999)).toBeCloseTo(MAX_ZOOM * PX_PER_MM, 10);
    expect(zoomOf({ x: 0, y: 0, scale: PX_PER_MM })).toBe(1);
  });

  it('zoomAt keeps the mm point under the pointer fixed (pointer-centred)', () => {
    const view = { x: 120, y: 80, scale: PX_PER_MM };
    const pointer = { x: 400, y: 300 };
    const before = {
      x: (pointer.x - view.x) / view.scale,
      y: (pointer.y - view.y) / view.scale,
    };
    const zoomed = zoomAt(view, 1.7, pointer);
    const after = {
      x: (pointer.x - zoomed.x) / zoomed.scale,
      y: (pointer.y - zoomed.y) / zoomed.scale,
    };
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomed.scale).toBeCloseTo(PX_PER_MM * 1.7, 9);
  });

  it('zoomAt at the clamp boundary returns the same view (no offset drift)', () => {
    const atMax = { x: 10, y: 10, scale: MAX_ZOOM * PX_PER_MM };
    expect(zoomAt(atMax, 1.5, { x: 100, y: 100 })).toBe(atMax);
    const atMin = { x: 10, y: 10, scale: MIN_ZOOM * PX_PER_MM };
    expect(zoomAt(atMin, 0.5, { x: 100, y: 100 })).toBe(atMin);
  });

  it('panBy is additive in screen px and identity-stable for zero deltas', () => {
    const view = { x: 5, y: 6, scale: PX_PER_MM };
    expect(panBy(view, 10, -4)).toEqual({ x: 15, y: 2, scale: PX_PER_MM });
    expect(panBy(view, 0, 0)).toBe(view);
  });

  it('fitUnitView centres the bleed box with breathing room, never above 100%', () => {
    const geom = unitGeometry(units[1]!, preset, layout);
    const vp = { w: 1200, h: 800 };
    const view = fitUnitView(geom, vp.w, vp.h);

    // The fitted content (bleed box) must sit inside the padded viewport.
    const contentW = (geom.widthMm + 2 * geom.bleedMm) * view.scale;
    const contentH = (geom.heightMm + 2 * geom.bleedMm) * view.scale;
    expect(contentW).toBeLessThanOrEqual(vp.w - 2 * FIT_PADDING_PX + 0.001);
    expect(contentH).toBeLessThanOrEqual(vp.h - 2 * FIT_PADDING_PX + 0.001);
    expect(view.scale).toBeLessThanOrEqual(PX_PER_MM + 1e-9);

    // Centred: left bleed edge inset equals right bleed edge inset.
    const leftInset = view.x - geom.bleedMm * view.scale * -1 - 0; // bleed origin at -bleed mm
    const bleedLeftPx = view.x + -geom.bleedMm * view.scale;
    const bleedRightPx = view.x + (geom.widthMm + geom.bleedMm) * view.scale;
    expect(bleedLeftPx).toBeCloseTo(vp.w - bleedRightPx, 6);
    expect(leftInset).toBeGreaterThan(0);
  });

  it('a huge viewport fits at exactly 100%, a small one below it', () => {
    const geom = unitGeometry(units[0]!, preset, layout);
    expect(fitUnitView(geom, 4000, 3000).scale).toBeCloseTo(PX_PER_MM, 9);
    expect(fitUnitView(geom, 500, 500).scale).toBeLessThan(PX_PER_MM);
  });

  it('fitPageView fits one page of a spread; hundredView is exactly 3.4 px/mm centred', () => {
    const geom = unitGeometry(units[1]!, preset, layout);
    const page = fitPageView(geom, 900, 700);
    const unit = fitUnitView(geom, 900, 700);
    expect(page.scale).toBeGreaterThan(unit.scale); // one page fills more than two

    const hundred = hundredView(geom, 900, 700);
    expect(hundred.scale).toBe(PX_PER_MM);
    expect(hundred.x).toBeCloseTo((900 - geom.widthMm * PX_PER_MM) / 2, 9);
    expect(hundred.y).toBeCloseTo((700 - geom.heightMm * PX_PER_MM) / 2, 9);
  });
});
