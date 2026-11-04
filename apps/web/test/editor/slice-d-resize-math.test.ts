/**
 * Slice D stage 2 — the resize maths (plan §3, §7 `slice-d-resize-math.test.ts`).
 *
 * Pure: `hundredths.ts`, `minimums.ts`, `resize.ts`, driven directly and
 * through the test-only Konva port (`support/slice-d-konva-port.ts`). Every
 * geometry assertion is stated per layer (plan §3.7): integer equality in H,
 * `Object.is` on payload fields, string equality on text, an explicit
 * tolerance for float reconstruction.
 *
 * The evidence script's own model is loaded verbatim
 * (`support/slice-d-evidence-model.ts`) and compared with the production
 * maths move by move: the B examples, the E crossing paths and the 4,000
 * seeded gestures of its section F. Property tests use the script's own
 * seeded PRNG (no new dependency); a failure names its seed.
 */
import { describe, expect, it } from 'vitest';
import {
  anchorAxes,
  anchorCursor,
  boundResize,
  ceilDiv,
  createResizeState,
  effectiveMin,
  effectiveMinH,
  floorDiv,
  formatNum,
  fromH,
  halfUp,
  isCornerAnchor,
  MIN_SHAPE_H,
  MIN_SHAPE_MM,
  newEllipseElement,
  newRectElement,
  quantizeInspector,
  RESIZE_ANCHORS,
  ratioMinimumBox,
  resizePayload,
  resizeTargetsH2,
  roundHalfUpDiv,
  sameBoxH,
  startBoxH,
  toH,
  type BoxH,
  type ResizeAnchor,
  type TargetsH2,
} from '@baxter/domain';
import {
  driveMove,
  driveMovePx,
  konvaStep,
  newGesture,
  runPath,
  V100,
  type DrivenMove,
  type KonvaCall,
  type View,
} from './support/slice-d-konva-port';
import { loadEvidenceModel, type EvidenceBox } from './support/slice-d-evidence-model';

const NO_TARGETS: TargetsH2 = { x: [], y: [] };
const box = (x: number, y: number, w: number, h: number): BoxH => ({ x, y, w, h });
const arr = (B: BoxH) => [B.x, B.y, B.w, B.h];

/** Integer formatting of hundredths, independent of `formatNum` (the evidence script's `formatHInt`). */
function formatHInt(h: number): string {
  const neg = h < 0;
  const a = Math.abs(h);
  const i = Math.floor(a / 100);
  const f = a % 100;
  let s = String(i);
  if (f !== 0) s += '.' + String(f).padStart(2, '0').replace(/0$/, '');
  return (neg ? '-' : '') + s;
}

/** The evidence script's PRNG (mulberry32), so section F's gestures can be regenerated exactly. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A direct call of the maths with a raw box (mm) — the evidence script's `bound(s, raw, ...)` without Konva. */
function direct(start: BoxH, targets: TargetsH2) {
  let state = createResizeState(start, targets);
  return (raw: { l: number; t: number; r: number; b: number }, anchor: ResizeAnchor, ratio = false, alt = false) => {
    const { xs, ys } = anchorAxes(anchor);
    const anchorPoint = { x: xs > 0 ? raw.r : raw.l, y: ys > 0 ? raw.b : raw.t };
    const res = boundResize(state, {
      anchor,
      ratio,
      alt,
      raw: { left: raw.l, top: raw.t, right: raw.r, bottom: raw.b },
      anchorPoint,
    });
    state = res.state;
    return res;
  };
}

/* ========================================================================== */

describe('Slice D — representation in integer hundredths (plan §3.1)', () => {
  it('toH ∘ fromH is the identity, fromH is canonical, and formatNum prints the integer digits, for ±2,000 mm', () => {
    let bad = 0;
    for (let h = -200000; h <= 200000; h++) {
      const v = fromH(h);
      if (toH(v) !== h || quantizeInspector(v) !== v || formatNum(v) !== formatHInt(h) || v !== Number(formatHInt(h))) bad++;
    }
    expect(bad).toBe(0);
    expect(Object.is(fromH(0), 0) && Object.is(toH(-0.001), 0)).toBe(true);
  });

  it('edges built from H never subtract floats (0.03 − 0.01)', () => {
    expect(0.03 - 0.01).not.toBe(0.02);
    expect(fromH(toH(0.03) - toH(0.01))).toBe(0.02);
  });

  it('canonical sums: toH(x + w) === toH(x) + toH(w) for 200,000 random canonical pairs (G1, layer G within 1e-9 mm)', () => {
    const R = rng(7);
    let bad = 0;
    let maxDiff = 0;
    for (let i = 0; i < 200000; i++) {
      const a = Math.floor(R() * 60000) - 10000;
      const b = Math.floor(R() * 30000) + 1;
      if (toH(fromH(a) + fromH(b)) !== a + b) bad++;
      maxDiff = Math.max(maxDiff, Math.abs(fromH(a) + fromH(b) - fromH(a + b)));
    }
    expect(bad).toBe(0);
    expect(maxDiff).toBeLessThan(1e-9);
  });

  it('floorDiv, ceilDiv, roundHalfUpDiv and halfUp agree with BigInt references well beyond the magnitudes the maths uses', () => {
    const R = rng(11);
    const bigFloor = (a: bigint, b: bigint) => (a >= 0n ? a / b : -((-a + b - 1n) / b));
    for (let i = 0; i < 50000; i++) {
      // the maths stays below ~1e11 (sizes ≤ 2e5 H, products ≤ 4e10); test up to 2^50
      const a = Math.round((R() * 2 - 1) * 2 ** (R() < 0.5 ? 50 : 30));
      const b = 1 + Math.floor(R() * 2 ** (R() < 0.5 ? 25 : 12));
      const A = BigInt(a);
      const B = BigInt(b);
      expect(floorDiv(a, b)).toBe(Number(bigFloor(A, B)));
      expect(ceilDiv(a, b)).toBe(Number(-bigFloor(-A, B)));
      if (Math.abs(a) < 2 ** 48) expect(roundHalfUpDiv(a, b)).toBe(Number(bigFloor(2n * A + B, 2n * B)));
    }
    expect([halfUp(5001), halfUp(5000), halfUp(-1), halfUp(-2), halfUp(-3)]).toEqual([2501, 2500, 0, -1, -1]);
  });
});

describe('Slice D — minimums (D-1) and anchors', () => {
  it('the effective floor is min(4 mm, start), in mm and in H', () => {
    expect([MIN_SHAPE_MM, MIN_SHAPE_H]).toEqual([4, 400]);
    expect([effectiveMin(10), effectiveMin(2.5), effectiveMin(4)]).toEqual([4, 2.5, 4]);
    expect([effectiveMinH(1000), effectiveMinH(250), effectiveMinH(400)]).toEqual([400, 250, 400]);
    expect(createResizeState(box(0, 0, 250, 2000), NO_TARGETS).floors).toEqual({ w: 250, h: 400 });
  });

  it('anchor axes, corners and directional cursors', () => {
    const table = RESIZE_ANCHORS.map((a) => [a, anchorAxes(a).xs, anchorAxes(a).ys, isCornerAnchor(a), anchorCursor(a)]);
    expect(table).toEqual([
      ['top-left', -1, -1, true, 'nwse-resize'],
      ['top-center', 0, -1, false, 'ns-resize'],
      ['top-right', 1, -1, true, 'nesw-resize'],
      ['middle-right', 1, 0, false, 'ew-resize'],
      ['middle-left', -1, 0, false, 'ew-resize'],
      ['bottom-left', -1, 1, true, 'nesw-resize'],
      ['bottom-center', 0, 1, false, 'ns-resize'],
      ['bottom-right', 1, 1, true, 'nwse-resize'],
    ]);
  });

  it('the ratio minimum box: kMin is the exact ceiling that keeps both axes on their floors (§3.5 step 5.5)', () => {
    expect(ratioMinimumBox(createResizeState(box(0, 0, 4000, 3000), NO_TARGETS))).toEqual({ w: 534, h: 401 });
    expect(ratioMinimumBox(createResizeState(box(0, 0, 250, 2000), NO_TARGETS))).toEqual({ w: 250, h: 2000 });
    expect(ratioMinimumBox(createResizeState(box(0, 0, 100, 2000), NO_TARGETS))).toEqual({ w: 100, h: 2000 });
    const R = rng(23);
    for (let i = 0; i < 20000; i++) {
      const gh = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1));
      const S0 = box(0, 0, R() < 0.25 ? gh(50, 399) : gh(400, 30000), R() < 0.25 ? gh(50, 399) : gh(400, 30000));
      const st = createResizeState(S0, NO_TARGETS);
      const m = ratioMinimumBox(st);
      expect(m.w >= st.floors.w && m.h >= st.floors.h, `seed 23 #${i}`).toBe(true);
      const big = S0.w >= S0.h;
      const [kMin, S0k, S0o, flk, flo] = big ? [m.w, S0.w, S0.h, st.floors.w, st.floors.h] : [m.h, S0.h, S0.w, st.floors.h, st.floors.w];
      expect(kMin * S0o >= flo * S0k).toBe(true); // the derived size meets its floor exactly
      expect(kMin === flk || (kMin - 1) * S0o < flo * S0k).toBe(true); // and kMin is the smallest that does
      if (S0.w < 400 || S0.h < 400) expect(m.w >= S0.w || m.h >= S0.h).toBe(true);
    }
  });
});

describe('Slice D — start box, targets and payload (§3.2, §3.9)', () => {
  it('startBoxH converts edge-wise, page offset included', () => {
    expect(startBoxH({ x: 20, y: 30, width: 40, height: 50 }, 14800)).toEqual(box(16800, 3000, 4000, 5000));
    // legacy non-canonical stored value: each edge within 0.005 mm of its stored geometry
    expect(startBoxH({ x: 20.004, y: 0, width: 30, height: 10 }, 0)).toEqual(box(2000, 0, 3000, 1000));
  });

  it('resize targets in H2: page edges, centres and margins; element edges and exact half-hundredth centres', () => {
    const t = resizeTargetsH2(
      { pageWidthMm: 148, pageHeightMm: 210, pageOffsetsMm: [0, 148], marginMm: 12 },
      [{ x: 20, y: 30, width: 10.01, height: 5 }]
    );
    expect(t.x).toEqual([0, 2400, 4000, 5001, 6002, 14800, 27200, 29600, 32000, 44400, 56800, 59200].sort((a, b) => a - b));
    expect(t.y).toEqual([0, 2400, 6000, 6500, 7000, 21000, 39600, 42000]);
  });

  it('payload: unchanged fields keep their original stored number; changed fields are canonical (G1, G2)', () => {
    const stored = { x: 20.05, y: 7, width: 30, height: 10 };
    const start = startBoxH(stored, 14800);
    const p0 = resizePayload(stored, start, start, 14800);
    expect(Object.is(p0.x, stored.x) && Object.is(p0.y, stored.y) && Object.is(p0.width, stored.width) && Object.is(p0.height, stored.height)).toBe(true);
    expect(sameBoxH(start, { ...start })).toBe(true);
    const p1 = resizePayload(stored, start, { ...start, w: 4995 }, 14800);
    expect(Object.is(p1.x, 20.05)).toBe(true);
    expect(p1.width).toBe(49.95);
    expect(quantizeInspector(p1.width)).toBe(p1.width);
  });
});

/* ========================================================================== */

describe('Slice D — worked examples B1–B9 (§3.8; the evidence script\'s numbers)', () => {
  it('B1 centred (Alt) right handle on x 0 w 10: widths 10.01–10.04, centre within 0.005 mm, no drift', () => {
    const G = newGesture(box(0, 0, 1000, 1000), NO_TARGETS, 'middle-right', V100);
    const got = [10.005, 10.01, 10.015, 10.02].map((e) => {
      const m = driveMove(G, { x: e, y: 5 }, false, true);
      return [m.box.x, m.box.w];
    });
    expect(got).toEqual([[-1, 1001], [-1, 1002], [-2, 1003], [-2, 1004]]);
  });

  it('B2 free → Alt pressed (centre captured from prev) → Alt held → Alt released (fixed edge from prev)', () => {
    const G = newGesture(box(2000, 1000, 3000, 2000), NO_TARGETS, 'middle-right', V100);
    const a = driveMove(G, { x: 55.37, y: 20 }, false, false).box;
    const b = driveMove(G, { x: 57.0, y: 20 }, false, true).box;
    const c = driveMove(G, { x: 57.5, y: 20 }, false, true).box;
    const d = driveMove(G, { x: 60.0, y: 20 }, false, false).box;
    expect([a, b, c, d].map(arr)).toEqual([
      [2000, 1000, 3537, 2000],
      [1837, 1000, 3863, 2000],
      [1787, 1000, 3963, 2000],
      [1787, 1000, 4213, 2000],
    ]);
  });

  it('B3 ratio 4.03 × 4, scale 1.0087: controlling x, 4.07 × 4.04 (error 0.0003 mm)', () => {
    const r = direct(box(0, 0, 403, 400), NO_TARGETS)({ l: 0, t: 0, r: 4.03 * 1.0087, b: 4.0 * 1.0087 }, 'bottom-right', true);
    expect([r.controllingAxis, ...arr(r.box)]).toEqual(['x', 0, 0, 407, 404]);
    expect(Math.abs(r.box.h / 100 - (r.box.w * 400) / 403 / 100)).toBeLessThanOrEqual(0.005);
  });

  it('B4 (R9 T10) ratio 4:3, target x = 60: 50 × 37.5 exactly, guide x 60, fixed corner (10, 10)', () => {
    const r = direct(box(1000, 1000, 4000, 3000), { x: [12000], y: [] })({ l: 10, t: 10, r: 10 + 40 * 1.248, b: 10 + 30 * 1.248 }, 'bottom-right', true);
    expect([r.controllingAxis, ...arr(r.box), r.guideX2, r.guideY2]).toEqual(['x', 1000, 1000, 5000, 3750, 12000, null]);
  });

  it('B5 ratio, both axes in range: the smaller correction (y, 0.04) controls; B5b equal → larger start axis → x', () => {
    const r = direct(box(1000, 1000, 4000, 3000), { x: [12000], y: [9520] })({ l: 10, t: 10, r: 10 + 40 * 1.252, b: 10 + 30 * 1.252 }, 'bottom-right', true);
    expect([r.controllingAxis, ...arr(r.box), r.guideX2, r.guideY2]).toEqual(['y', 1000, 1000, 5013, 3760, null, 9520]);
    const s = direct(box(0, 0, 4000, 4000), { x: [10100], y: [10100] })({ l: 0, t: 0, r: 50, b: 50 }, 'bottom-right', true);
    expect([s.controllingAxis, ...arr(s.box)]).toEqual(['x', 0, 0, 5050, 5050]);
  });

  it('B6 floors after quantization; grandfathered axes enlarge but never shrink; ratio on a grandfathered shape scales up only', () => {
    expect(direct(box(0, 0, 1000, 1000), NO_TARGETS)({ l: 0, t: 0, r: 3.994, b: 10 }, 'middle-right').box.w).toBe(400);
    const g = direct(box(0, 0, 250, 2000), NO_TARGETS);
    expect([g({ l: 0, t: 0, r: 2.4, b: 20 }, 'middle-right').box.w, g({ l: 0, t: 0, r: 3.2, b: 20 }, 'middle-right').box.w]).toEqual([250, 320]);
    const q = direct(box(0, 0, 250, 2000), NO_TARGETS);
    const q1 = q({ l: 0, t: 0, r: 2.5 * 0.9, b: 20 * 0.9 }, 'bottom-right', true).box;
    const q2 = q({ l: 0, t: 0, r: 2.5 * 1.1, b: 20 * 1.1 }, 'bottom-right', true).box;
    expect([q1.w, q1.h, q2.w, q2.h]).toEqual([250, 2000, 275, 2200]);
  });

  it('B7 ratio + Alt on 30.01 × 20, pointer (33.30, 22.10): 36.5 × 24.33 about the start centre', () => {
    const G = newGesture(box(0, 0, 3001, 2000), NO_TARGETS, 'bottom-right', V100);
    const m = driveMove(G, { x: 33.3, y: 22.1 }, true, true);
    expect([m.result!.controllingAxis, ...arr(m.box)]).toEqual(['x', -325, -217, 3650, 2433]);
    expect(Math.max(Math.abs(2 * m.box.x + m.box.w - 3001), Math.abs(2 * m.box.y + m.box.h - 2000)) / 200).toBeLessThanOrEqual(0.005);
    expect(Math.abs(m.box.h / 100 - (m.box.w * 2000) / 3001 / 100)).toBeLessThanOrEqual(0.005);
  });

  it('B8 snap ties: the lower of two equidistant targets; a half-hundredth target rounds half up (edge within 0.005 mm)', () => {
    const a = direct(box(0, 0, 1000, 1000), { x: [4000, 4200], y: [] })({ l: 0, t: 0, r: 20.5, b: 10 }, 'middle-right');
    expect([a.box.x + a.box.w, a.guideX2]).toEqual([2000, 4000]);
    const b = direct(box(0, 0, 1000, 1000), { x: [5001], y: [] })({ l: 0, t: 0, r: 25.3, b: 10 }, 'middle-right');
    expect([b.box.x + b.box.w, b.guideX2]).toEqual([2501, 5001]);
  });

  it('B9 a target inside the 4 mm floor: the floor wins and the guide is dropped', () => {
    const r = direct(box(0, 0, 1000, 1000), { x: [600], y: [] })({ l: 0, t: 0, r: 3.5, b: 10 }, 'middle-right');
    expect([r.box.w, r.guideX2]).toEqual([400, null]);
  });

  it('every B example equals the evidence script\'s own bound() on the same input', () => {
    const { model } = loadEvidenceModel();
    const cases: [BoxH, TargetsH2, { l: number; t: number; r: number; b: number }, ResizeAnchor, boolean][] = [
      [box(0, 0, 403, 400), NO_TARGETS, { l: 0, t: 0, r: 4.03 * 1.0087, b: 4.0 * 1.0087 }, 'bottom-right', true],
      [box(1000, 1000, 4000, 3000), { x: [12000], y: [] }, { l: 10, t: 10, r: 10 + 40 * 1.248, b: 10 + 30 * 1.248 }, 'bottom-right', true],
      [box(1000, 1000, 4000, 3000), { x: [12000], y: [9520] }, { l: 10, t: 10, r: 10 + 40 * 1.252, b: 10 + 30 * 1.252 }, 'bottom-right', true],
      [box(0, 0, 4000, 4000), { x: [10100], y: [10100] }, { l: 0, t: 0, r: 50, b: 50 }, 'bottom-right', true],
      [box(0, 0, 1000, 1000), NO_TARGETS, { l: 0, t: 0, r: 3.994, b: 10 }, 'middle-right', false],
      [box(0, 0, 250, 2000), NO_TARGETS, { l: 0, t: 0, r: 2.5 * 0.9, b: 20 * 0.9 }, 'bottom-right', true],
      [box(0, 0, 250, 2000), NO_TARGETS, { l: 0, t: 0, r: 2.5 * 1.1, b: 20 * 1.1 }, 'bottom-right', true],
      [box(0, 0, 1000, 1000), { x: [4000, 4200], y: [] }, { l: 0, t: 0, r: 20.5, b: 10 }, 'middle-right', false],
      [box(0, 0, 1000, 1000), { x: [5001], y: [] }, { l: 0, t: 0, r: 25.3, b: 10 }, 'middle-right', false],
      [box(0, 0, 1000, 1000), { x: [600], y: [] }, { l: 0, t: 0, r: 3.5, b: 10 }, 'middle-right', false],
    ];
    for (const [start, t, raw, anchor, ratio] of cases) {
      const ev = model.bound(model.createSession(start, { x: [...t.x], y: [...t.y] }), raw, anchor, ratio, false);
      const pr = direct(start, t)(raw, anchor, ratio);
      expect(arr(pr.box)).toEqual([ev.box.x, ev.box.y, ev.box.w, ev.box.h]);
      expect([pr.guideX2, pr.guideY2]).toEqual([ev.gx ?? null, ev.gy ?? null]);
    }
  });
});

/* ========================================================================== */

describe('Slice D — R9 matrix on a real spread (148 × 210 mm pages, 12 mm margins)', () => {
  const geom = { pageWidthMm: 148, pageHeightMm: 210, pageOffsetsMm: [0, 148], marginMm: 12 };
  // another element whose left edge is at 70 mm (a snap target for T1/T4/T6)
  const targets = resizeTargetsH2(geom, [{ x: 70, y: 150, width: 20, height: 20 }]);
  const START = box(2000, 6000, 4500, 4000); // 20, 60, 45 × 40 on page 1

  it('T1 right edge raw 69 → snaps to 70: w 50, guide at 70', () => {
    const r = direct(START, targets)({ l: 20, t: 60, r: 69, b: 100 }, 'middle-right');
    expect([...arr(r.box), r.guideX2]).toEqual([2000, 6000, 5000, 4000, 14000]);
  });

  it('T2 left edge to the 12 mm margin: the right edge is equal in H; stored x/w canonical, untouched fields keep their numbers', () => {
    const stored = { x: 15, y: 60, width: 40, height: 40 };
    const start = startBoxH(stored, 0);
    const r = direct(start, targets)({ l: 12.9, t: 60, r: 55, b: 100 }, 'middle-left');
    expect([...arr(r.box), r.guideX2]).toEqual([1200, 6000, 4300, 4000, 2400]);
    expect(r.box.x + r.box.w).toBe(start.x + start.w);
    const p = resizePayload(stored, start, r.box, 0);
    expect([p.x, p.width]).toEqual([12, 43]);
    expect(Object.is(p.y, stored.y) && Object.is(p.height, stored.height)).toBe(true);
    expect(toH(p.x + p.width)).toBe(5500);
    expect(Math.abs(p.x + p.width - 55)).toBeLessThan(1e-9);
  });

  it('T3 bottom edge to the page centre line (105)', () => {
    const r = direct(START, targets)({ l: 20, t: 60, r: 65, b: 104.2 }, 'bottom-center');
    expect([...arr(r.box), r.guideY2]).toEqual([2000, 6000, 4500, 4500, 21000]);
  });

  it('T4 a corner without ratio snaps both axes independently', () => {
    const r = direct(START, targets)({ l: 20, t: 60, r: 69, b: 104.2 }, 'bottom-right');
    expect([...arr(r.box), r.guideX2, r.guideY2, r.controllingAxis]).toEqual([2000, 6000, 5000, 4500, 14000, 21000, null]);
  });

  it('T5 released outside the radius: the free 0.01 value, no guide', () => {
    const r = direct(START, targets)({ l: 20, t: 60, r: 71.8, b: 100 }, 'middle-right');
    expect([r.box.w, r.guideX2]).toEqual([5180, null]);
  });

  it('T6 engage, hold, then release past the radius', () => {
    const go = direct(START, targets);
    const seq = [68.6, 69.5, 70.9, 71.7].map((e) => {
      const r = go({ l: 20, t: 60, r: e, b: 100 }, 'middle-right');
      return [r.box.x + r.box.w, r.guideX2];
    });
    expect(seq).toEqual([[7000, 14000], [7000, 14000], [7000, 14000], [7170, null]]);
  });

  it('T7 the minimum pins at the fixed edge; a drag-through freezes, and the next move starts a new segment from prev', () => {
    const G = newGesture(START, targets, 'middle-right', V100);
    const a = driveMove(G, { x: 22, y: 80 }, false, false);
    expect(arr(a.box)).toEqual([2000, 6000, 400, 4000]);
    const b = driveMove(G, { x: 19, y: 80 }, false, false);
    expect([b.cls, b.frozen, b.renamed, G.anchor, ...arr(b.box)]).toEqual(['proceed', true, true, 'middle-left', 2000, 6000, 400, 4000]);
    const c = driveMove(G, { x: 15, y: 80 }, false, false);
    expect([c.segment!.fixedX, ...arr(c.box)]).toEqual([2400, 1500, 6000, 900, 4000]);
  });

  it('T10 ratio 4:3 with a snap on x: 50 × 37.5, fixed corner pinned (B4)', () => {
    const r = direct(box(1000, 1000, 4000, 3000), { x: [12000], y: [] })({ l: 10, t: 10, r: 59.92, b: 47.44 }, 'bottom-right', true);
    expect(arr(r.box)).toEqual([1000, 1000, 5000, 3750]);
  });

  it('T11 centred: no snap even next to a target; width exact; centre within 0.005 mm', () => {
    const r = direct(START, targets)({ l: 15.8, t: 60, r: 69.2, b: 100 }, 'middle-right', false, true);
    expect([...arr(r.box), r.guideX2]).toEqual([1580, 6000, 5340, 4000, null]);
    expect(Math.abs(2 * r.box.x + r.box.w - (2 * START.x + START.w))).toBeLessThanOrEqual(1);
  });

  it('T13 an ellipse uses the same box maths and the same payload rule', () => {
    const el = { ...newEllipseElement({ x: 30, y: 40 }) };
    const stored = { x: el.x, y: el.y, width: el.width, height: el.height };
    const start = startBoxH(stored, 0);
    const r = direct(start, targets)({ l: stored.x, t: stored.y, r: 69, b: stored.y + stored.height }, 'middle-right');
    const p = resizePayload(stored, start, r.box, 0);
    expect(toH(p.x + p.width)).toBe(7000);
    expect(Object.is(p.x, stored.x) && Object.is(p.y, stored.y) && Object.is(p.height, stored.height)).toBe(true);
  });

  it('T17 a right-page margin target (148 + 12 = 160) commits page-relative x 12', () => {
    const stored = { x: 20, y: 60, width: 30, height: 40 };
    const start = startBoxH(stored, 14800);
    const r = direct(start, targets)({ l: 160.9, t: 60, r: 198, b: 100 }, 'middle-left');
    expect([r.box.x, r.guideX2]).toEqual([16000, 32000]);
    expect(resizePayload(stored, start, r.box, 14800).x).toBe(12);
  });

  it('T18 a cross-gutter stretch keeps the owning page: negative page-relative x', () => {
    const stored = { x: 5, y: 60, width: 30, height: 40 };
    const start = startBoxH(stored, 14800);
    const r = direct(start, targets)({ l: 139.37, t: 60, r: 183, b: 100 }, 'middle-left');
    const p = resizePayload(stored, start, r.box, 14800);
    expect([r.box.x, r.guideX2, p.x, p.width]).toEqual([13937, null, -8.63, 43.63]);
  });

  it('Part 12 fixture: off-grid X 20.05 → right edge exactly 70.00; stored w 49.95 canonical; stored x is the original number', () => {
    const stored = { x: 20.05, y: 60, width: 30, height: 40 };
    const start = startBoxH(stored, 0);
    const r = direct(start, targets)({ l: 20.05, t: 60, r: 69.3, b: 100 }, 'middle-right');
    expect(r.box.x + r.box.w).toBe(7000);
    const p = resizePayload(stored, start, r.box, 0);
    expect(Object.is(p.x, 20.05)).toBe(true);
    expect(p.width).toBe(49.95);
    expect(toH(p.x) + toH(p.width)).toBe(7000);
  });

  it('legacy non-canonical stored x: the unchanged field keeps its number; the fixed edge is within 0.005 mm', () => {
    const stored = { x: 20.004, y: 60, width: 30, height: 40 };
    const start = startBoxH(stored, 0);
    const r = direct(start, targets)({ l: 20.004, t: 60, r: 60, b: 100 }, 'middle-right');
    const p = resizePayload(stored, start, r.box, 0);
    expect(Object.is(p.x, 20.004)).toBe(true);
    expect(p.width).toBe(40);
    expect(Math.abs(p.x - r.box.x / 100)).toBeLessThanOrEqual(0.005);
  });

  it('a rect from the factory: a release equal to the start in H gives a payload identical to the stored numbers (G8)', () => {
    const el = newRectElement({ x: 12.3, y: 45.6 });
    const stored = { x: el.x, y: el.y, width: el.width, height: el.height };
    const start = startBoxH(stored, 0);
    const r = direct(start, NO_TARGETS)({ l: stored.x, t: stored.y, r: stored.x + stored.width, b: stored.y + stored.height }, 'bottom-right');
    expect(sameBoxH(r.box, start)).toBe(true);
    const p = resizePayload(stored, start, r.box, 0);
    expect(Object.is(p.x, stored.x) && Object.is(p.y, stored.y) && Object.is(p.width, stored.width) && Object.is(p.height, stored.height)).toBe(true);
  });
});

/* ========================================================================== */

const S40 = box(10000, 10000, 4000, 3000);
const crossing: [string, ResizeAnchor, { x: number; y: number }[], boolean, boolean][] = [
  ['E1', 'bottom-right', [{ x: 140, y: 160 }, { x: 80, y: 160 }, { x: 140, y: 160 }], true, false],
  ['E2', 'bottom-right', [{ x: 170, y: 130 }, { x: 170, y: 80 }, { x: 170, y: 130 }], true, false],
  ['E3', 'bottom-right', [{ x: 140, y: 130 }, { x: 80, y: 85 }, { x: 140, y: 130 }], true, false],
  ['E4', 'top-left', [{ x: 100, y: 60 }, { x: 160, y: 60 }, { x: 100, y: 60 }], true, false],
  ['E5', 'bottom-right', [{ x: 140, y: 160 }, { x: 100, y: 160 }, { x: 140, y: 160 }], true, true],
  ['E6', 'bottom-right', [{ x: 180, y: 130 }, { x: 180, y: 100 }, { x: 180, y: 130 }], true, true],
  ['E7', 'bottom-right', [{ x: 140, y: 130 }, { x: 100, y: 100 }, { x: 140, y: 130 }], true, true],
  ['E8', 'bottom-right', [{ x: 140, y: 160 }, { x: 80, y: 160 }, { x: 140, y: 160 }], false, false],
  ['E9', 'middle-right', [{ x: 140, y: 115 }, { x: 80, y: 115 }, { x: 140, y: 115 }], false, false],
];
const byName = Object.fromEntries(crossing.map((c) => [c[0], c]));
const run = (name: string, clamp = true) => {
  const [, anchor, wps, ratio, alt] = byName[name]!;
  return runPath(S40, anchor, wps, ratio, alt, clamp);
};
const e13Waypoints = () => {
  const wps = [{ x: 112, y: 110 }];
  for (let i = 0; i < 6; i++) wps.push({ x: i % 2 === 0 ? 89.03 : 111.97, y: 110 });
  wps.push({ x: 112, y: 110 });
  return wps;
};

describe('Slice D — crossing and return E1–E13 through the Konva port (§3.8 E; the evidence script\'s results)', () => {
  it('E1–E4 one-edge ratio: 0 freezes, 0 renames, 0 skips; continuous; exact return; the evidence\'s boxes and clamp counts', () => {
    const expected: Record<string, [number, number[], number, ResizeAnchor]> = {
      E1: [253, [10000, 10000, 5769, 4327], 0.09, 'bottom-right'],
      E2: [241, [10000, 10000, 6093, 4570], 0.07, 'bottom-right'],
      E3: [317, [10000, 10000, 4000, 3000], 0.16, 'bottom-right'],
      E4: [253, [7550, 8162, 6450, 4838], 0.08, 'top-left'],
    };
    for (const [name, [clamps, startBox, maxJump, end]] of Object.entries(expected)) {
      const R = run(name);
      expect([name, R.freezes, R.renames, R.skips, R.segments, R.floorViolations, R.referenceViolations, R.returnMismatch]).toEqual([name, 0, 0, 0, 1, 0, 0, 0]);
      expect([R.clamps, arr(R.start), arr(R.final), R.anchorEnd]).toEqual([clamps, startBox, startBox, end]);
      expect(R.maxJump).toBeCloseTo(maxJump, 10);
    }
  });

  it('E5–E7 ratio + Alt: freeze and rename at the centre, the centre carried, continuous, exact return', () => {
    const expected: Record<string, [number[], number]> = {
      E5: [[8060, 8545, 7879, 5909], 0.07],
      E6: [[7052, 7789, 9895, 7421], 0.04],
      E7: [[10000, 10000, 4000, 3000], 0.16],
    };
    for (const [name, [startBox, maxJump]] of Object.entries(expected)) {
      const R = run(name);
      expect([name, R.freezes, R.renames, R.segments, R.floorViolations, R.referenceViolations, R.returnMismatch]).toEqual([name, 2, 2, 3, 0, 0, 0]);
      expect([arr(R.start), arr(R.final), R.anchorEnd]).toEqual([startBox, startBox, 'bottom-right']);
      expect(R.maxJump).toBeCloseTo(maxJump, 10);
      expect(R.maxRunCentreErr).toBeLessThanOrEqual(0.005);
    }
  });

  it('E8–E9 free axes (#11): freeze and rename at the floor, then resume from the opposite edge; continuous at the floor', () => {
    for (const [name, startBox, end] of [
      ['E8', [10000, 10000, 4000, 6000], 'bottom-right'],
      ['E9', [10000, 10000, 4000, 3000], 'middle-right'],
    ] as const) {
      const R = run(name);
      expect([name, R.freezes, R.renames, R.segments, R.floorViolations, R.referenceViolations, R.returnMismatch]).toEqual([name, 2, 2, 3, 0, 0, 4]);
      expect([arr(R.start), arr(R.final), R.anchorEnd]).toEqual([[...startBox], [...startBox], end]);
      expect(R.maxJump).toBeCloseTo(0.6, 10);
    }
  });

  it('E10 near the fixed corner: the minimum box 5.34 × 4.01; E11 a grandfathered 2.5 × 20 never shrinks', () => {
    const near = runPath(S40, 'bottom-right', [{ x: 110, y: 108 }, { x: 95, y: 96 }, { x: 110, y: 108 }], true, false);
    const minBox = near.boxes.reduce((m, B) => (B.w < m.w ? B : m), near.boxes[0]!);
    expect([...arr(minBox), near.freezes, near.renames, near.skips, near.returnMismatch]).toEqual([10000, 10000, 534, 401, 0, 0, 0, 0]);
    const gf = runPath(box(10000, 10000, 250, 2000), 'bottom-right', [{ x: 103, y: 125 }, { x: 95, y: 90 }, { x: 103, y: 125 }], true, false);
    const gmin = gf.boxes.reduce((m, B) => (B.h < m.h ? B : m), gf.boxes[0]!);
    expect([...arr(gmin), gf.freezes, gf.renames, gf.skips, gf.returnMismatch]).toEqual([10000, 10000, 250, 2000, 0, 0, 0, 0]);
    expect(gf.boxes.every((B) => B.w >= 250 && B.h >= 2000)).toBe(true);
  });

  it('E12 one fast move past the corner lands on the minimum box at the fixed corner (and, without the clamp, reproduces r2\'s re-anchoring)', () => {
    const G = newGesture(S40, NO_TARGETS, 'bottom-right', V100, true);
    const a = driveMove(G, { x: 150, y: 140 }, true, false);
    const b = driveMove(G, { x: 60, y: 50 }, true, false);
    const c = driveMove(G, { x: 61, y: 51 }, true, false);
    expect([arr(a.box), b.cls, b.frozen, arr(b.box), c.cls, arr(c.box), G.anchor]).toEqual([
      [10000, 10000, 5122, 3842], 'proceed', false, [10000, 10000, 534, 401], 'unchanged', [10000, 10000, 534, 401], 'bottom-right',
    ]);
    const N = newGesture(S40, NO_TARGETS, 'bottom-right', V100, false);
    driveMove(N, { x: 150, y: 140 }, true, false);
    const nb = driveMove(N, { x: 60, y: 50 }, true, false);
    const nc = driveMove(N, { x: 61, y: 51 }, true, false);
    expect([nb.frozen, arr(nb.box), arr(nc.box), N.anchor]).toEqual([true, [10000, 10000, 5122, 3842], [5072, 6304, 10050, 7538], 'top-left']);
  });

  it('E13 Alt held across 6 centre crossings: 7 segments, 6 renames, the centre carried within 0.005 mm', () => {
    const R = runPath(box(10000, 10000, 1001, 2000), 'middle-right', e13Waypoints(), false, true);
    expect([R.segments, R.renames, arr(R.final)]).toEqual([7, 6, [9801, 10000, 1399, 2000]]);
    expect(R.maxRunCentreErr).toBeLessThanOrEqual(0.005);
  });

  it('every move of every E path equals the evidence script\'s gestureMove (box, freeze, rename, skip, clamp, anchor)', () => {
    const { model } = loadEvidenceModel();
    const paths: [BoxH, ResizeAnchor, { x: number; y: number }[], boolean, boolean, boolean][] = [];
    for (const [, anchor, wps, ratio, alt] of crossing) {
      paths.push([S40, anchor, wps, ratio, alt, true]);
      if (!alt) paths.push([S40, anchor, wps, ratio, alt, false]);
    }
    paths.push([S40, 'bottom-right', [{ x: 110, y: 108 }, { x: 95, y: 96 }, { x: 110, y: 108 }], true, false, true]);
    paths.push([box(10000, 10000, 250, 2000), 'bottom-right', [{ x: 103, y: 125 }, { x: 95, y: 90 }, { x: 103, y: 125 }], true, false, true]);
    paths.push([S40, 'bottom-right', [{ x: 150, y: 140 }, { x: 60, y: 50 }, { x: 61, y: 51 }], true, false, true]);
    paths.push([box(10000, 10000, 1001, 2000), 'middle-right', e13Waypoints(), false, true, true]);
    let compared = 0;
    const diffs = new Diffs();
    for (const [pi, [start, anchor, wps, ratio, alt, clamp]] of paths.entries()) {
      const G = newGesture(start, NO_TARGETS, anchor, V100, clamp);
      const E = model.newGesture(start, { x: [], y: [] }, anchor, V100);
      for (const [mi, p] of [...lineFrom(start, anchor, wps)].entries()) {
        const m = driveMove(G, p, ratio, alt);
        diffs.add(`path ${pi} move ${mi}`, moveDiff(m, model.gestureMove(E, p, ratio, alt, clamp)), [G.anchor, E.anchor]);
        compared++;
      }
    }
    expect(diffs.list).toEqual([]);
    expect(compared).toBeGreaterThan(5000);
  });
});

function* lineFrom(start: BoxH, anchor: ResizeAnchor, wps: { x: number; y: number }[]) {
  const { xs, ys } = anchorAxes(anchor);
  const l = start.x / 100;
  const t = start.y / 100;
  const r = (start.x + start.w) / 100;
  const b = (start.y + start.h) / 100;
  let p = { x: xs > 0 ? r : xs < 0 ? l : (l + r) / 2, y: ys > 0 ? b : ys < 0 ? t : (t + b) / 2 };
  for (const w of wps) {
    const n = Math.ceil(Math.hypot(w.x - p.x, w.y - p.y) / 0.2);
    for (let i = 1; i <= n; i++) yield { x: p.x + ((w.x - p.x) * i) / n, y: p.y + ((w.y - p.y) * i) / n };
    p = w;
  }
}

/** One driven move against the evidence's gestureMove on the same input: null when they agree, else what differs. */
function moveDiff(
  m: DrivenMove,
  t: { skipped?: boolean; frozen?: boolean; renamed?: boolean; clamped?: boolean; box: EvidenceBox; gx?: number | null; gy?: number | null; k?: 'x' | 'y' | null }
): string | null {
  const B = m.box;
  if (m.clamped !== Boolean(t.clamped)) return `clamped ${m.clamped} vs ${Boolean(t.clamped)}`;
  if (B.x !== t.box.x || B.y !== t.box.y || B.w !== t.box.w || B.h !== t.box.h) return `box ${arr(B)} vs ${[t.box.x, t.box.y, t.box.w, t.box.h]}`;
  if (m.cls === 'skip') return t.skipped ? null : 'skip vs not skipped';
  if (t.skipped) return `${m.cls} vs skipped`;
  // F2: real Konva returns early here; the port proceeds, and must land on the same box with nothing else happening
  if (m.cls === 'unchanged') return t.frozen || t.renamed ? 'unchanged vs frozen/renamed' : null;
  if (m.frozen !== Boolean(t.frozen) || m.renamed !== Boolean(t.renamed)) return `frozen/renamed ${m.frozen}/${m.renamed} vs ${Boolean(t.frozen)}/${Boolean(t.renamed)}`;
  if (m.frozen) return null;
  if (m.result!.guideX2 !== (t.gx ?? null) || m.result!.guideY2 !== (t.gy ?? null)) return `guides ${m.result!.guideX2},${m.result!.guideY2} vs ${t.gx},${t.gy}`;
  if (m.result!.controllingAxis !== (t.k ?? null)) return `controlling axis ${m.result!.controllingAxis} vs ${t.k}`;
  return null;
}

/** Collects disagreements; a test asserts the list is empty (one assertion instead of one per move). */
class Diffs {
  readonly list: string[] = [];
  add(where: string, diff: string | null, anchors?: [string, string]) {
    if (diff) this.list.push(`${where}: ${diff}`);
    else if (anchors && anchors[0] !== anchors[1]) this.list.push(`${where}: anchor ${anchors[0]} vs ${anchors[1]}`);
  }
}

/* ========================================================================== */

describe('Slice D — Konva\'s early-return boundary [−1, 1) px (§3.8 H) and Ben\'s regression cases (F1, F2)', () => {
  it('the port: −1 − 2^-20 proceeds and renames; −1 … +1 − 2^-20 skip; +1 and above proceed — width checked before height', () => {
    const node = { x: 100, y: 100, w: 40, h: 30 };
    const e = 2 ** -20;
    for (const [dim, anchor] of [['width', 'middle-right'], ['height', 'bottom-center']] as const) {
      for (const v of [-1 - e, -1, -1 + e, 0, 1 - e, 1, 1 + e]) {
        const target = dim === 'width' ? { x: node.x + v, y: node.y + 15 } : { x: node.x + 20, y: node.y + v };
        const trace: KonvaCall[] = [];
        const k = konvaStep(node, anchor, target, false, false, 0.6, 0.8, trace);
        const skip = -1 <= v && v < 1;
        expect([dim, v, k.skip]).toEqual([dim, v, skip]);
        if (skip) expect(trace).toEqual(dim === 'width' ? ['inRange:width', 'return:extent-skip'] : ['inRange:width', 'inRange:height', 'return:extent-skip']);
        else {
          expect(trace).toEqual(['inRange:width', 'inRange:height', 'boundBoxFunc']);
          expect(k.anchor).toBe(v < 0 ? (dim === 'width' ? 'middle-left' : 'top-center') : anchor);
        }
      }
    }
  });

  it('through the maths at 1 px/mm: a skip holds prev, +1 px lands on the 4 mm floor, −1 − 2^-20 px freezes and renames', () => {
    const e = 2 ** -20;
    const V1: View = { scale: 1, vx: 0, vy: 0 };
    const got = [-1 - e, -1, 0, 1 - e, 1, 1 + e].map((v) => {
      const G = newGesture(S40, NO_TARGETS, 'middle-right', V1);
      const m = driveMove(G, { x: 100 + v, y: 115 }, false, false);
      return [m.cls, m.frozen, G.anchor, m.box.x, m.box.w];
    });
    expect(got).toEqual([
      ['proceed', true, 'middle-left', 10000, 4000],
      ['skip', false, 'middle-right', 10000, 4000],
      ['skip', false, 'middle-right', 10000, 4000],
      ['skip', false, 'middle-right', 10000, 4000],
      ['proceed', false, 'middle-right', 10000, 400],
      ['proceed', false, 'middle-right', 10000, 400],
    ]);
  });

  it('Ben #1 — 32 × 30 mm, the free right handle moved directly onto the fixed edge in one move: proposed width 0 px, Konva skips, the box stays 32 × 30', () => {
    const start = box(1000, 1000, 3200, 3000);
    const G = newGesture(start, NO_TARGETS, 'middle-right', V100);
    const m = driveMove(G, { x: 10, y: 25 }, false, false);
    expect(m.raw!.w).toBe(0);
    expect([m.cls, m.skippedOn, m.trace]).toEqual(['skip', 'width', ['anchorDragBoundFunc', 'inRange:width', 'return:extent-skip']]);
    expect([arr(m.box), arr(G.state.prev), G.anchor, m.renamed, m.frozen]).toEqual([arr(start), arr(start), 'middle-right', false, false]);
  });

  it('Ben #2 — 15% zoom: grandfathered 1 × 20 mm enlarged proportionally to 4 × 80, then moved past the fixed corner (ratio on, Alt off): the clamp targets 0.51 CSS px, Konva skips, 4 × 80 is preserved', () => {
    const view: View = { scale: 3.4 * 0.15, vx: 0, vy: 0 }; // the editor's PX_PER_MM × MIN_ZOOM
    const start = box(1000, 1000, 100, 2000);
    const G = newGesture(start, NO_TARGETS, 'bottom-right', view);
    expect(G.state.floors).toEqual({ w: 100, h: 400 });
    const up = driveMove(G, { x: 14, y: 90 }, true, false);
    expect([up.cls, up.clamped, arr(up.box)]).toEqual(['proceed', false, [1000, 1000, 400, 8000]]);
    const past = driveMove(G, { x: 5, y: 5 }, true, false);
    expect(past.minExtentPx!.w).toBeCloseTo(0.51, 12);
    expect(past.minExtentPx!.w).toBeLessThan(1);
    expect(past.clamped).toBe(true);
    expect(past.target.x - view.scale * 10).toBeCloseTo(0.51, 12); // anchor target = fixed corner + 0.51 px
    expect(Math.abs(past.raw!.w)).toBeLessThan(1);
    expect([past.cls, past.skippedOn, past.trace]).toEqual(['skip', 'width', ['anchorDragBoundFunc', 'inRange:width', 'return:extent-skip']]);
    expect([arr(past.box), arr(G.state.prev), G.anchor, past.renamed]).toEqual([[1000, 1000, 400, 8000], [1000, 1000, 400, 8000], 'bottom-right', false]);
    // the maths' own minimum for this shape is 1 × 20 (both axes at least their start values)
    expect(ratioMinimumBox(G.state)).toEqual({ w: 100, h: 2000 });
  });

  it('Ben #3 — F2: Konva\'s anchor-unchanged return is modelled and kept apart from the extent skip in the callback trace', () => {
    // (a) the designed use: a target exactly at the anchor's current position
    const A = newGesture(S40, NO_TARGETS, 'bottom-right', V100);
    const atHandle = driveMovePx(A, { x: 140 * 3.4, y: 130 * 3.4 }, false, false);
    expect([atHandle.cls, atHandle.trace, arr(atHandle.box)]).toEqual(['unchanged', ['anchorDragBoundFunc', 'return:anchor-unchanged'], arr(S40)]);
    // (b) the stage 1 case: the clamp holds the anchor at the minimum box's corner beyond both axes
    const B = newGesture(S40, NO_TARGETS, 'bottom-right', V100);
    driveMove(B, { x: 60, y: 50 }, true, false);
    const held = driveMove(B, { x: 61, y: 51 }, true, false);
    expect([held.cls, held.clamped, held.trace, held.raw, arr(held.box)]).toEqual([
      'unchanged', true, ['anchorDragBoundFunc', 'return:anchor-unchanged'], null, [10000, 10000, 534, 401],
    ]);
    // (c) contrast: an extent skip runs the range checks; a proceeding move reaches boundBoxFunc
    const C = newGesture(box(1000, 1000, 3200, 3000), NO_TARGETS, 'middle-right', V100);
    expect(driveMove(C, { x: 10, y: 25 }, false, false).trace).toEqual(['anchorDragBoundFunc', 'inRange:width', 'return:extent-skip']);
    expect(driveMove(C, { x: 30, y: 25 }, false, false).trace).toEqual(['anchorDragBoundFunc', 'inRange:width', 'inRange:height', 'boundBoxFunc']);
    // (d) had Konva proceeded, the port would have produced the same box (the probe's 444 cases)
    const { model } = loadEvidenceModel();
    const E = model.newGesture(S40, { x: [], y: [] }, 'bottom-right', V100);
    model.gestureMove(E, { x: 60, y: 50 }, true, false, true);
    const t = model.gestureMove(E, { x: 61, y: 51 }, true, false, true);
    expect([t.skipped ?? false, t.frozen ?? false, t.box.x, t.box.y, t.box.w, t.box.h]).toEqual([false, false, 10000, 10000, 534, 401]);
  });
});

/* ========================================================================== */

describe('Slice D — sequences (finding 1): no accumulation, references constant within a segment', () => {
  it('200 consecutive centred moves from even and odd start widths: every centre within 0.005 mm of the captured centre', () => {
    for (const w0 of [1000, 1001]) {
      const G = newGesture(box(2000, 0, w0, 1000), NO_TARGETS, 'middle-right', V100);
      const C2 = 2 * 2000 + w0;
      const R = rng(w0);
      let maxErr = 0;
      for (let i = 0; i < 200; i++) {
        const m = driveMove(G, { x: 30 + R() * 20, y: 5 }, false, true);
        maxErr = Math.max(maxErr, Math.abs(2 * m.box.x + m.box.w - C2) / 200);
        expect(m.segment!.centreX2).toBe(C2);
      }
      expect(maxErr).toBeLessThanOrEqual(0.005);
    }
  });

  it('width parity alternating (the B1 pattern, forward and back 50 times): the centre never drifts', () => {
    const G = newGesture(box(0, 0, 1000, 1000), NO_TARGETS, 'middle-right', V100);
    const centres = new Set<number>();
    for (let i = 0; i < 50; i++)
      for (const e of [10.005, 10.01, 10.015, 10.02, 10.015, 10.01]) {
        const m = driveMove(G, { x: e, y: 5 }, false, true);
        centres.add(2 * m.box.x + m.box.w);
      }
    expect([...centres].sort((a, b) => a - b)).toEqual([999, 1000]);
  });

  it('modifier transitions: each new segment\'s references equal prev\'s, and stay constant until the next', () => {
    const G = newGesture(box(2000, 2000, 3000, 2000), NO_TARGETS, 'bottom-right', V100);
    const seq: [boolean, boolean][] = [[false, false], [false, true], [false, false], [false, true], [true, false], [false, false], [true, false], [true, true], [false, true]];
    let x = 50;
    for (const [ratio, alt] of seq) {
      const before = { ...G.state.prev };
      const prevSeg = G.state.segment;
      let first: DrivenMove | null = null;
      for (let i = 0; i < 6; i++) {
        x += 0.37;
        const m = driveMove(G, { x, y: 40 + i * 0.29 }, ratio, alt);
        if (m.cls !== 'proceed' || m.frozen) continue;
        if (!first) {
          first = m;
          const g = m.segment!;
          if (alt) {
            const carried = prevSeg !== null && prevSeg.alt;
            expect(g.centreX2).toBe(carried ? prevSeg!.centreX2 : 2 * before.x + before.w);
            expect(g.centreY2).toBe(carried ? prevSeg!.centreY2 : 2 * before.y + before.h);
            expect(g.carried).toBe(carried);
          } else {
            expect([g.fixedX, g.fixedY]).toEqual([before.x, before.y]);
          }
        }
        const g = m.segment!;
        expect(g.key).toBe(first.segment!.key);
        expect([g.fixedX, g.fixedY, g.centreX2, g.centreY2]).toEqual([first.segment!.fixedX, first.segment!.fixedY, first.segment!.centreX2, first.segment!.centreY2]);
      }
      expect(first).not.toBeNull();
    }
  });
});

describe('Slice D — ratio controlling axis and floors (finding 2)', () => {
  const S = box(1000, 1000, 4000, 3000);
  const at = (t: TargetsH2, s: number) => direct(S, t)({ l: 10, t: 10, r: 10 + 40 * s, b: 10 + 30 * s }, 'bottom-right', true);

  it('one snap controls; both snaps: the smaller correction; equal corrections: the larger start axis', () => {
    expect(at({ x: [2 * 6000], y: [] }, 1.248).controllingAxis).toBe('x');
    expect(at({ x: [], y: [2 * 4760] }, 1.252).controllingAxis).toBe('y');
    // equal corrections of 0.25 mm (exact in binary) on both axes at s = 1.25 (edges 60 and 47.5)
    const eq = at({ x: [12050], y: [9550] }, 1.25);
    expect([eq.controllingAxis, eq.box.w, eq.box.h, eq.guideX2, eq.guideY2]).toEqual(['x', 5025, 3769, 12050, null]);
    // taller than wide, equal corrections: the larger start axis is y
    const T = direct(box(0, 0, 3000, 4000), { x: [7550], y: [10050] })({ l: 0, t: 0, r: 37.5, b: 50 }, 'bottom-right', true);
    expect([T.controllingAxis, T.box.w, T.box.h, T.guideY2]).toEqual(['y', 3769, 5025, 10050]);
  });

  it('without a snap the larger start axis controls; the dependent size is within 0.005 mm (G5)', () => {
    const R = rng(5);
    for (let i = 0; i < 5000; i++) {
      const w = 400 + Math.floor(R() * 20000);
      const h = 400 + Math.floor(R() * 20000);
      const s = 0.2 + R() * 3;
      const r = direct(box(0, 0, w, h), NO_TARGETS)({ l: 0, t: 0, r: (w / 100) * s, b: (h / 100) * s }, 'bottom-right', true);
      const k = r.controllingAxis!;
      expect(k).toBe(w >= h ? 'x' : 'y');
      const [ks, os, S0k, S0o] = k === 'x' ? [r.box.w, r.box.h, w, h] : [r.box.h, r.box.w, h, w];
      expect(Math.abs(2 * (os * S0k - ks * S0o)) <= S0k, `seed 5 #${i}`).toBe(true);
    }
  });

  it('the dependent size is exact integer division, ties half up — where float division would round the wrong way', () => {
    // 5.94 × 4.77, controlling w = 6.27: exact h = 627 · 477 / 594 = 503.5 → 504; Math.round(627 · (477 / 594)) gives 503
    expect(Math.round(627 * (477 / 594))).toBe(503);
    const r = direct(box(0, 0, 594, 477), NO_TARGETS)({ l: 0, t: 0, r: 6.27, b: (4.77 * 627) / 594 }, 'bottom-right', true);
    expect([r.controllingAxis, r.box.w, r.box.h]).toEqual(['x', 627, 504]);
  });

  it('the floor outranks the snap (guide dropped) and the ratio (factor floored exactly)', () => {
    const r = at({ x: [2 * 1300], y: [] }, 0.05);
    expect([...arr(r.box), r.guideX2]).toEqual([1000, 1000, 534, 401, null]);
  });

  it('D-1 on an undersized 2.5 × 20: nothing moves when the raw box equals the start; it cannot shrink; it can enlarge to 3.2', () => {
    const go = direct(box(0, 0, 250, 2000), NO_TARGETS);
    expect(arr(go({ l: 0, t: 0, r: 2.5, b: 20 }, 'middle-right').box)).toEqual([0, 0, 250, 2000]);
    expect(go({ l: 0, t: 0, r: 1.0, b: 20 }, 'middle-right').box.w).toBe(250);
    expect(go({ l: 0, t: 0, r: 3.2, b: 20 }, 'middle-right').box.w).toBe(320);
  });
});

/* ========================================================================== */

/** Section F's gesture generator (the evidence script's, value for value). */
function sectionFGesture(seed: number) {
  const geomT2: { x: number[]; y: number[] } = { x: [], y: [] };
  for (const off of [0, 148]) for (const v of [off, off + 148, off + 74, off + 12, off + 136]) geomT2.x.push(2 * toH(v));
  for (const v of [0, 210, 105, 12, 198]) geomT2.y.push(2 * toH(v));
  const ANCHORS: ResizeAnchor[] = ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'];
  const R = rng(seed);
  const gh = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1));
  const undersized = R() < 0.25;
  const start = { x: gh(-2000, 28000), y: gh(-1000, 20000), w: undersized && R() < 0.6 ? gh(150, 399) : gh(400, 12000), h: undersized && R() < 0.6 ? gh(150, 399) : gh(400, 12000) };
  const t2 = { x: geomT2.x.slice(), y: geomT2.y.slice() };
  for (let i = 0; i < 3; i++) {
    const bx = gh(0, 28000), bw = gh(100, 5001), by = gh(0, 20000), bh = gh(100, 5001);
    t2.x.push(2 * bx, 2 * (bx + bw), 2 * bx + bw);
    t2.y.push(2 * by, 2 * (by + bh), 2 * by + bh);
  }
  const view = { scale: 0.51 + R() * 26.69, vx: R() * 400 - 200, vy: R() * 300 - 150 };
  const anchor = ANCHORS[gh(0, 7)]!;
  let ratioOn = R() < 0.4;
  let alt = R() < 0.3;
  const { xs, ys } = anchorAxes(anchor);
  const l = start.x / 100, t = start.y / 100, r = (start.x + start.w) / 100, b = (start.y + start.h) / 100;
  let p = { x: xs > 0 ? r : xs < 0 ? l : (l + r) / 2, y: ys > 0 ? b : ys < 0 ? t : (t + b) / 2 };
  const moves: { p: { x: number; y: number }; ratioOn: boolean; alt: boolean }[] = [];
  for (let m = 0; m < 40; m++) {
    if (R() < 0.08) ratioOn = !ratioOn;
    if (R() < 0.08) alt = !alt;
    const jump = R() < 0.1 ? 15 : 2.5;
    p = { x: p.x + (R() * 2 - 1) * jump, y: p.y + (R() * 2 - 1) * jump };
    moves.push({ p, ratioOn, alt });
  }
  return { start, t2, view, anchor, moves };
}

/** Every property of plan §7 on one driven gesture; returns its box trace for the determinism check. */
function checkProperties(
  st: Record<string, number>,
  start: BoxH,
  view: View,
  G: ReturnType<typeof newGesture>,
  driven: DrivenMove[]
): string {
  const trace: number[] = [];
  let lastKey: string | null = null;
  let runC2: { x?: number; y?: number } | null = null;
  for (const res of driven) {
    const B = res.box;
    trace.push(B.x, B.y, B.w, B.h);
    const g = res.segment!;
    const oneEdgeRatio = g.ratio && !g.alt;
    if (res.clamped) st.clamped!++;
    if (res.cls === 'skip') {
      st.skips!++;
      if (oneEdgeRatio) {
        st.oneEdgeRatioSkips!++;
        // F1: in one-edge ratio a skip happens only where the clamp's minimum extent is under 1 px on screen
        if (!(res.minExtentPx && (res.minExtentPx.w < 1 || res.minExtentPx.h < 1))) st.oneEdgeRatioSkipsWithLargeMin!++;
      }
      continue;
    }
    if (res.cls === 'unchanged') st.unchanged!++;
    if (res.frozen) {
      st.freezes!++;
      if (oneEdgeRatio) st.oneEdgeRatioFreezes!++;
    }
    if (res.renamed) {
      st.renames!++;
      if (oneEdgeRatio) st.oneEdgeRatioRenames!++;
    }
    if (res.frozen) continue;
    st.moves!++;
    if (g.key !== lastKey) {
      st.segs!++;
      lastKey = g.key;
    }
    if (![B.x, B.y, B.w, B.h].every(Number.isInteger)) st.nonInt!++;
    if (B.w < G.state.floors.w || B.h < G.state.floors.h) st.floorViol!++;
    if ((start.w < 400 && B.w < start.w) || (start.h < 400 && B.h < start.h)) st.undersizedShrink!++;
    if (g.ratio && (start.w < 400 || start.h < 400) && (B.w < start.w || B.h < start.h)) st.undersizedShrink!++;
    if (!g.alt) {
      if (g.xs && (g.xs > 0 ? B.x : B.x + B.w) !== g.fixedX) st.fixedViol!++;
      if (g.ys && (g.ys > 0 ? B.y : B.y + B.h) !== g.fixedY) st.fixedViol!++;
      runC2 = null;
    } else {
      if (g.xs) st.maxCentreErr = Math.max(st.maxCentreErr!, Math.abs(2 * B.x + B.w - g.centreX2!) / 200);
      if (g.ys) st.maxCentreErr = Math.max(st.maxCentreErr!, Math.abs(2 * B.y + B.h - g.centreY2!) / 200);
      if (!runC2 || !g.carried) runC2 = g.carried ? runC2 : { x: g.centreX2, y: g.centreY2 };
      if (runC2 && g.xs && runC2.x !== undefined) st.maxRunCentreErr = Math.max(st.maxRunCentreErr!, Math.abs(2 * B.x + B.w - runC2.x) / 200);
      if (runC2 && g.ys && runC2.y !== undefined) st.maxRunCentreErr = Math.max(st.maxRunCentreErr!, Math.abs(2 * B.y + B.h - runC2.y) / 200);
    }
    if (g.ratio && res.result) {
      const [ks, os, S0k, S0o] = res.result.controllingAxis === 'x' ? [B.w, B.h, start.w, start.h] : [B.h, B.w, start.h, start.w];
      st.maxRatioErr = Math.max(st.maxRatioErr!, Math.abs(os - (ks * S0o) / S0k) / 100);
    }
    if (res.result?.guideX2 != null) st.maxGuideErr = Math.max(st.maxGuideErr!, Math.abs(2 * (g.xs > 0 ? B.x + B.w : B.x) - res.result.guideX2) / 200);
    if (res.result?.guideY2 != null) st.maxGuideErr = Math.max(st.maxGuideErr!, Math.abs(2 * (g.ys > 0 ? B.y + B.h : B.y) - res.result.guideY2) / 200);
    // payload: every changed stored value canonical and printed as its digits (G2/G3), on either page
    for (const off of [0, 14800]) {
      const stored = { x: fromH(start.x - off), y: fromH(start.y), width: fromH(start.w), height: fromH(start.h) };
      const pl = resizePayload(stored, start, B, off);
      for (const [v, h] of [[pl.x, B.x - off], [pl.y, B.y], [pl.width, B.w], [pl.height, B.h]] as const) {
        if (toH(v) !== h || formatNum(v) !== formatHInt(h) || quantizeInspector(v) !== v) st.payload!++;
      }
    }
    for (const [mm, o] of [[B.x / 100, view.vx], [(B.x + B.w) / 100, view.vx], [B.y / 100, view.vy], [(B.y + B.h) / 100, view.vy]] as const) {
      const back = (mm * view.scale + o - o) / view.scale;
      if (Math.abs(back * 100 - Math.round(mm * 100)) > 1e-6) st.pxRoundTrip!++;
    }
  }
  return trace.join(',');
}

const newStats = (): Record<string, number> => ({
  gestures: 0, moves: 0, skips: 0, unchanged: 0, segs: 0, freezes: 0, renames: 0, clamped: 0,
  oneEdgeRatioFreezes: 0, oneEdgeRatioRenames: 0, oneEdgeRatioSkips: 0, oneEdgeRatioSkipsWithLargeMin: 0,
  nonInt: 0, floorViol: 0, undersizedShrink: 0, fixedViol: 0, maxCentreErr: 0, maxRunCentreErr: 0, maxRatioErr: 0, maxGuideErr: 0,
  payload: 0, pxRoundTrip: 0, nondet: 0,
});

function expectProperties(st: Record<string, number>) {
  expect([st.oneEdgeRatioFreezes, st.oneEdgeRatioRenames, st.oneEdgeRatioSkipsWithLargeMin]).toEqual([0, 0, 0]);
  expect([st.nonInt, st.floorViol, st.undersizedShrink, st.fixedViol]).toEqual([0, 0, 0, 0]);
  expect(st.maxCentreErr).toBeLessThanOrEqual(0.005);
  expect(st.maxRunCentreErr).toBeLessThanOrEqual(0.005);
  expect(st.maxRatioErr).toBeLessThanOrEqual(0.005 + 1e-12);
  expect(st.maxGuideErr).toBeLessThanOrEqual(0.005);
  expect([st.payload, st.pxRoundTrip, st.nondet]).toEqual([0, 0, 0]);
}

describe('Slice D — properties over section F\'s 4,000 seeded gestures through the Konva port', () => {
  it('with the port exactly as the evidence script has it (no anchor-unchanged return): the production maths reproduces section F move by move and its published totals', () => {
    const { model } = loadEvidenceModel();
    const st = newStats();
    const diffs = new Diffs();
    for (let seed = 1; seed <= 4000; seed++) {
      const F = sectionFGesture(seed);
      const runOnce = (withTwin: boolean) => {
        const G = newGesture(F.start, F.t2, F.anchor, F.view, true, false);
        const E = withTwin ? model.newGesture(F.start, F.t2, F.anchor, F.view) : null;
        const driven: DrivenMove[] = [];
        for (const mv of F.moves) {
          const m = driveMove(G, mv.p, mv.ratioOn, mv.alt);
          driven.push(m);
          if (E) diffs.add(`seed ${seed} move ${driven.length - 1}`, moveDiff(m, model.gestureMove(E, mv.p, mv.ratioOn, mv.alt, true)), [G.anchor, E.anchor]);
        }
        return { G, driven };
      };
      const a = runOnce(true);
      const traceA = checkProperties(st, F.start, F.view, a.G, a.driven);
      const b = runOnce(false);
      if (traceA !== b.driven.map((m) => arr(m.box).join(',')).join(',')) st.nondet!++;
      st.gestures!++;
    }
    expect(diffs.list.slice(0, 5)).toEqual([]);
    // Section F's published r3 line (312,818 moves, 47,126 segments, 530 skips, 6,652 freezes and renames,
    // 6,322 clamped) counts every gesture TWICE: its determinism rerun accumulates into the same counters.
    // The distinct counts are exactly half, and doubling them reproduces the published line number for number.
    const distinct = [st.moves, st.segs, st.skips, st.freezes, st.renames, st.clamped];
    expect([st.gestures, st.unchanged, ...distinct]).toEqual([4000, 0, 156409, 23563, 265, 3326, 3326, 3161]);
    expect(distinct.map((n) => 2 * n!)).toEqual([312818, 47126, 530, 6652, 6652, 6322]);
    expectProperties(st);
  }, 120_000);

  it('with Konva\'s anchor-unchanged return modelled (F2): every other move matches the reviewed model; the 13 returns where the port would differ are pinned for review', () => {
    const { model } = loadEvidenceModel();
    const st = newStats();
    const diffs = new Diffs();
    const divergent: { seed: number; prev: BoxH; would: EvidenceBox; snapped: boolean; atMinimum: boolean; atStart: boolean; oneEdgeRatio: boolean }[] = [];
    for (let seed = 1; seed <= 4000; seed++) {
      const F = sectionFGesture(seed);
      const G = newGesture(F.start, F.t2, F.anchor, F.view, true, true);
      // the twin follows real Konva too: on an anchor-unchanged return it captures the segment (anchorBound ran)
      // and does not advance; what its port would have produced is recorded (as the stage 1 probe's replay did)
      const E = model.newGesture(F.start, F.t2, F.anchor, F.view) as ReturnType<typeof model.newGesture> & { s: { seg: unknown } };
      const driven: DrivenMove[] = [];
      for (const mv of F.moves) {
        const prev = { ...G.state.prev };
        const m = driveMove(G, mv.p, mv.ratioOn, mv.alt);
        driven.push(m);
        if (m.cls === 'unchanged') {
          const ax = model.axesOf(E.anchor);
          const ratio = Boolean(mv.ratioOn && ax.xs && ax.ys);
          if (!E.s.seg || (E.s.seg as { key: string }).key !== model.segKey(E.anchor, ratio, mv.alt))
            E.s.seg = model.capture(E.s.prev, E.anchor, ratio, mv.alt, E.s.seg);
          const would = model.gestureMove(JSON.parse(JSON.stringify(E)), mv.p, mv.ratioOn, mv.alt, true);
          if (would.skipped || would.frozen || !sameBoxH(would.box, prev)) {
            const min = ratioMinimumBox(G.state);
            divergent.push({
              seed, prev, would: would.box,
              snapped: would.gx != null || would.gy != null,
              atMinimum: prev.w === min.w && prev.h === min.h,
              atStart: sameBoxH(prev, F.start),
              oneEdgeRatio: m.segment!.ratio && !m.segment!.alt,
            });
          }
          continue;
        }
        diffs.add(`seed ${seed} move ${driven.length - 1}`, moveDiff(m, model.gestureMove(E, mv.p, mv.ratioOn, mv.alt, true)), [G.anchor, E.anchor]);
      }
      checkProperties(st, F.start, F.view, G, driven);
      st.gestures!++;
    }
    expect(diffs.list.slice(0, 5)).toEqual([]);
    expect([st.unchanged, divergent.length, new Set(divergent.map((d) => d.seed)).size]).toEqual([241, 13, 6]);
    // all 13: one-edge ratio, the box already at the ratio minimum box, and the port's box a snap that enlarges it
    expect(divergent.every((d) => d.oneEdgeRatio && d.atMinimum && d.snapped && d.would.w > d.prev.w && d.would.h > d.prev.h)).toBe(true);
    expect(divergent.filter((d) => d.atStart).length).toBe(6);
    expect(divergent[0]).toMatchObject({ seed: 1106, prev: box(21169, 4510, 300, 304), would: box(21169, 4510, 406, 411) });
    expectProperties(st);
  }, 120_000);
});
