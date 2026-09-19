/**
 * Snapping (contract #8) — target sets and the magnet's engage/hold/release.
 *
 * Targets are page edges, page centre-lines, margins and every other
 * element's edges and centres, in unit space. The 1.6 mm radius and the
 * nearest-wins rule are pinned here; the `rate` mechanism is tested directly
 * because it is what makes a centre snap produce a different delta than an
 * edge snap while the gesture applies only one.
 */
import { describe, expect, it } from 'vitest';
import {
  bestSnap,
  buildTargets,
  elementTargets,
  pageTargets,
  snapCreationAxis,
  SNAP_RADIUS_MM,
  type SnapGeometry,
} from '@baxter/domain';

// An A5 spread: two 148 × 210 pages, 12 mm margin (D-034's accepted value).
const spread: SnapGeometry = {
  pageWidthMm: 148,
  pageHeightMm: 210,
  pageOffsetsMm: [0, 148],
  marginMm: 12,
};

describe('page targets', () => {
  it('carries both pages’ edges, centres and margins in unit space', () => {
    const t = pageTargets(spread);
    // Page 1: 0, 148, centre 74, margins 12 and 136.
    expect(t.x).toContain(0);
    expect(t.x).toContain(148);
    expect(t.x).toContain(74);
    expect(t.x).toContain(12);
    expect(t.x).toContain(136);
    // Page 2 is offset by the trim width — the gutter edge appears once.
    expect(t.x).toContain(296);
    expect(t.x).toContain(222);
    expect(t.x).toContain(160);
    // Vertical: trim edges, centre, margins.
    expect(t.y).toEqual([0, 12, 105, 198, 210]);
  });

  it('deduplicates and sorts, so the shared gutter edge is one target', () => {
    const t = pageTargets(spread);
    expect(new Set(t.x).size).toBe(t.x.length);
    expect([...t.x]).toEqual([...t.x].sort((a, b) => a - b));
  });
});

describe('element targets', () => {
  it('contributes each box’s edges and centres', () => {
    const t = elementTargets([{ x: 20, y: 30, width: 40, height: 10 }]);
    expect(t.x).toEqual([20, 40, 60]);
    expect(t.y).toEqual([30, 35, 40]);
  });

  it('normalises negative extents so a signed box still yields sane targets', () => {
    const t = elementTargets([{ x: 60, y: 40, width: -40, height: -10 }]);
    expect(t.x).toEqual([20, 40, 60]);
    expect(t.y).toEqual([30, 35, 40]);
  });

  it('buildTargets merges page geometry with the other elements', () => {
    const merged = buildTargets(spread, [{ x: 20, y: 30, width: 40, height: 10 }]);
    expect(merged.x).toContain(74); // page centre
    expect(merged.x).toContain(40); // element centre
  });
});

describe('bestSnap — engage, hold, release', () => {
  const targets = [100];

  it('engages inside the radius', () => {
    const snap = bestSnap([{ value: 100 - SNAP_RADIUS_MM + 0.1, rate: 1 }], targets);
    expect(snap).not.toBeNull();
    expect(snap!.guide).toBe(100);
    expect(snap!.delta).toBeCloseTo(SNAP_RADIUS_MM - 0.1, 10);
  });

  it('releases cleanly past the radius', () => {
    expect(bestSnap([{ value: 100 - SNAP_RADIUS_MM - 0.01, rate: 1 }], targets)).toBeNull();
  });

  it('nearest target inside the radius wins', () => {
    expect(bestSnap([{ value: 10.4, rate: 1 }], [10, 11])!.guide).toBe(10);
    expect(bestSnap([{ value: 10.6, rate: 1 }], [10, 11])!.guide).toBe(11);
  });

  it('an exact tie resolves to the lower target, so the result is stable', () => {
    expect(bestSnap([{ value: 10.5, rate: 1 }], [10, 11])!.guide).toBe(10);
  });

  it('a centre candidate needs twice the delta of an edge candidate', () => {
    // The centre sits 1 mm from the target; moving the far edge moves the
    // centre by half as much, so the applied delta must be 2 mm.
    const snap = bestSnap([{ value: 99, rate: 0.5 }], targets);
    expect(snap!.delta).toBe(2);
    expect(snap!.guide).toBe(100);
  });

  it('pinned features (rate 0) can never snap', () => {
    expect(bestSnap([{ value: 100, rate: 0 }], targets)).toBeNull();
  });

  it('is deterministic on ties', () => {
    const a = bestSnap([{ value: 10.5, rate: 1 }], [10, 11]);
    const b = bestSnap([{ value: 10.5, rate: 1 }], [11, 10]);
    expect(a).toEqual(b);
  });
});

describe('snapCreationAxis — the anchor is pinned, the pointer moves', () => {
  it('snaps the moving edge to a nearby target', () => {
    const snap = snapCreationAxis(10, 73, pageTargets(spread).x);
    expect(snap!.guide).toBe(74);
    expect(snap!.delta).toBe(1);
  });

  it('returns null when nothing is in range', () => {
    expect(snapCreationAxis(10, 50, [0, 100])).toBeNull();
  });
});
