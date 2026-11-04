/**
 * Resize maths — Slice D, plan §3 (pure; no Konva, no React).
 *
 * One bounded resize move: Konva proposes a box, and this module decides the
 * box the editor shows and will commit. The rules, highest precedence first
 * (plan §3.6):
 *
 *   1. segment references — a fixed edge, the fixed corner or a centre is
 *      captured once per segment and never moves inside it;
 *   2. floors (D-1) — 4 mm per axis, or the start value for a grandfathered
 *      axis, checked after quantization;
 *   3. ratio — one controlling axis exact on the grid, the other derived;
 *   4. snap — moving one-edge axes only, nearest target within 1.6 mm;
 *   5. the raw pointer, read only through the active side's edge (free and
 *      centred axes) or the dragged anchor's position (ratio);
 *   6. quantization to integer hundredths.
 *
 * Everything is integer hundredths of a millimetre ("H", `hundredths.ts`),
 * in UNIT space (the spread's coordinates; page 2 starts at the trim width).
 * Snap and centre references are doubled hundredths ("H2").
 *
 * A **segment** is a maximal run of moves with the same key
 * `(active anchor, ratio, alt)`. At a segment start the references are
 * captured from `prev`, the last bounded box; while Alt stays held the centre
 * is CARRIED into the next segment instead of being re-derived from a rounded
 * box (plan §3.3, r3 N2). The state is immutable: `boundResize` returns the
 * next state alongside the box.
 *
 * **Zero-H axes.** The schema accepts any positive stored size, so an axis
 * can be positive in mm and still round to 0 H at the edges (a 0.004 mm
 * width at x = 0). Such an axis is defined, finite and grandfathered: its
 * floor is 0, so it never shrinks and can grow; free, side and centred moves
 * work as usual. Ratio mode has no proportion to keep when either start axis
 * is 0 H, so a ratio move HOLDS the previous box (`ratioUndefined`), and
 * `ratioMinimumBox` is the start box. Real Konva does the same in practice:
 * its ratio projection of such a box proposes under 1 px and it skips the
 * move. A release equal to the start in H commits nothing and the original
 * stored numbers are kept (`resizePayload`), so a 0 H axis never writes 0.
 *
 * What this module does not do: the D-5 intent threshold, the ratio anchor
 * clamp's application to Konva's anchor, cancel and commit are the resize
 * session's (plan §4.3, stage 4). It supplies the numbers they need
 * (`ratioMinimumBox`).
 */
import { ceilDiv, floorDiv, fromH, halfUp, roundHalfUpDiv, toH } from './hundredths';
import { effectiveMinH } from './minimums';
import { bestSnap, type SnapBox, type SnapGeometry } from './snapping';

/* -------------------------------------------------------------------------- */
/* Anchors                                                                     */
/* -------------------------------------------------------------------------- */

/** Konva Transformer anchor names (the eight used for rect and ellipse). */
export type ResizeAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export const RESIZE_ANCHORS: readonly ResizeAnchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-right',
  'middle-left',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/** -1, 0 or +1 */
export type AxisDir = -1 | 0 | 1;

/**
 * Which edge of each axis the anchor moves: +1 the right/bottom edge, −1 the
 * left/top edge, 0 the axis is not touched (side handles).
 */
export function anchorAxes(anchor: ResizeAnchor): { xs: AxisDir; ys: AxisDir } {
  return {
    xs: anchor.includes('left') ? -1 : anchor.includes('right') ? 1 : 0,
    ys: anchor.startsWith('top') ? -1 : anchor.startsWith('bottom') ? 1 : 0,
  };
}

export function isCornerAnchor(anchor: ResizeAnchor): boolean {
  const { xs, ys } = anchorAxes(anchor);
  return xs !== 0 && ys !== 0;
}

export type ResizeCursor = 'nwse-resize' | 'nesw-resize' | 'ns-resize' | 'ew-resize';

/** The directional cursor for an anchor (plan §4.7), as Konva shows it on an unrotated box. */
export function anchorCursor(anchor: ResizeAnchor): ResizeCursor {
  const { xs, ys } = anchorAxes(anchor);
  if (xs === 0) return 'ns-resize';
  if (ys === 0) return 'ew-resize';
  return xs === ys ? 'nwse-resize' : 'nesw-resize';
}

/* -------------------------------------------------------------------------- */
/* Boxes, targets, state                                                       */
/* -------------------------------------------------------------------------- */

/** A box in unit space, integer hundredths. */
export interface BoxH {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Snap targets in unit space, DOUBLED hundredths (H2): a centre can fall on a half-hundredth. */
export interface TargetsH2 {
  x: readonly number[];
  y: readonly number[];
}

/** Konva's proposed box converted to unit-space mm (plan §3.2 `raw`). Only the active side is read. */
export interface RawEdgesMm {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PointMm {
  x: number;
  y: number;
}

/** Per-axis references of one segment (plan §3.3). Exactly one of fixed/centre is set for a touched axis. */
export interface ResizeSegment {
  key: string;
  anchor: ResizeAnchor;
  /** Ratio applies: requested (Keep proportions or Shift) AND the anchor is a corner. */
  ratio: boolean;
  alt: boolean;
  xs: AxisDir;
  ys: AxisDir;
  /** One-edge axis: the fixed edge, H. */
  fixedX?: number;
  fixedY?: number;
  /** Centred axis: the doubled centre, H2. */
  centreX2?: number;
  centreY2?: number;
  /** True when a centre was carried from the previous segment rather than captured. */
  carried: boolean;
}

export interface ResizeState {
  /** The element's box at gesture start. */
  readonly start: BoxH;
  /** The last bounded box. */
  readonly prev: BoxH;
  /** D-1 effective floors, from `start`. */
  readonly floors: { readonly w: number; readonly h: number };
  readonly targets: TargetsH2;
  /** The same targets in mm, as `bestSnap` takes them. */
  readonly targetsMm: { readonly x: readonly number[]; readonly y: readonly number[] };
  readonly segment: ResizeSegment | null;
}

export function createResizeState(start: BoxH, targets: TargetsH2): ResizeState {
  return {
    start: { ...start },
    prev: { ...start },
    floors: { w: effectiveMinH(start.w), h: effectiveMinH(start.h) },
    targets,
    targetsMm: { x: targets.x.map((t) => t / 200), y: targets.y.map((t) => t / 200) },
    segment: null,
  };
}

/**
 * The element's start box in unit-space H, converted EDGE-wise (plan §3.2):
 * `L = toH(x) + off`, `R = toH(x + w) + off`. For canonical stored values
 * this equals `toH(x) + toH(w)`; for a legacy non-canonical value each edge
 * stays within 0.005 mm of its stored geometry.
 */
export function startBoxH(
  stored: { x: number; y: number; width: number; height: number },
  pageOffsetH: number
): BoxH {
  const left = toH(stored.x) + pageOffsetH;
  const right = toH(stored.x + stored.width) + pageOffsetH;
  const top = toH(stored.y);
  const bottom = toH(stored.y + stored.height);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Snap targets for a resize, built once at gesture start (plan §3.2), in H2:
 * page edges, centre lines and margins, and every other element's edges and
 * centres (locked included, #20). Element edges are `2·toH(edge)`; a centre is
 * the sum of its two edges in H, so a half-hundredth centre is exact.
 * `otherBoxes` are unit-space mm and must exclude the resized element.
 */
export function resizeTargetsH2(geom: SnapGeometry, otherBoxes: readonly SnapBox[]): TargetsH2 {
  const x: number[] = [];
  const y: number[] = [];
  const marginH = toH(geom.marginMm);
  for (const offset of geom.pageOffsetsMm) {
    const left = toH(offset);
    const right = toH(offset + geom.pageWidthMm);
    x.push(2 * left, 2 * right, left + right, 2 * (left + marginH), 2 * (right - marginH));
  }
  const bottom = toH(geom.pageHeightMm);
  y.push(0, 2 * bottom, bottom, 2 * marginH, 2 * (bottom - marginH));
  for (const b of otherBoxes) {
    const l = toH(Math.min(b.x, b.x + b.width));
    const r = toH(Math.max(b.x, b.x + b.width));
    const t = toH(Math.min(b.y, b.y + b.height));
    const btm = toH(Math.max(b.y, b.y + b.height));
    x.push(2 * l, 2 * r, l + r);
    y.push(2 * t, 2 * btm, t + btm);
  }
  return { x: sortedUnique(x), y: sortedUnique(y) };
}

function sortedUnique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/* -------------------------------------------------------------------------- */
/* Segments                                                                    */
/* -------------------------------------------------------------------------- */

/** Ratio applies only when requested AND the anchor is a corner (D-2; Konva's own corner-only rule). */
export function ratioApplies(anchor: ResizeAnchor, ratioRequested: boolean): boolean {
  return ratioRequested && isCornerAnchor(anchor);
}

export function segmentKey(anchor: ResizeAnchor, ratio: boolean, alt: boolean): string {
  return `${anchor}|${ratio}|${alt}`;
}

/**
 * Capture a segment's references from `prev` (plan §3.3). A one-edge axis
 * fixes the edge opposite the active side. A centred axis takes the centre of
 * `prev` when Alt is newly pressed, or CARRIES the previous segment's centre
 * while Alt stays held (anchor rename, ratio toggle).
 */
export function captureSegment(
  prev: BoxH,
  anchor: ResizeAnchor,
  ratio: boolean,
  alt: boolean,
  previous: ResizeSegment | null
): ResizeSegment {
  const { xs, ys } = anchorAxes(anchor);
  const segment: ResizeSegment = { key: segmentKey(anchor, ratio, alt), anchor, ratio, alt, xs, ys, carried: false };
  const carry = alt && previous !== null && previous.alt;
  if (xs !== 0) {
    if (alt) {
      if (carry && previous?.centreX2 !== undefined) {
        segment.centreX2 = previous.centreX2;
        segment.carried = true;
      } else segment.centreX2 = 2 * prev.x + prev.w;
    } else segment.fixedX = xs > 0 ? prev.x : prev.x + prev.w;
  }
  if (ys !== 0) {
    if (alt) {
      if (carry && previous?.centreY2 !== undefined) {
        segment.centreY2 = previous.centreY2;
        segment.carried = true;
      } else segment.centreY2 = 2 * prev.y + prev.h;
    } else segment.fixedY = ys > 0 ? prev.y : prev.y + prev.h;
  }
  return segment;
}

/**
 * The state with the segment for this key, capturing a new one when the key
 * changed. The session calls it before Konva runs (plan §3.5 step 2), so the
 * ratio clamp always uses the current segment's fixed corner; `boundResize`
 * calls it again after Konva's possible anchor rename.
 */
export function withSegment(
  state: ResizeState,
  anchor: ResizeAnchor,
  ratioRequested: boolean,
  alt: boolean
): ResizeState {
  const ratio = ratioApplies(anchor, ratioRequested);
  const key = segmentKey(anchor, ratio, alt);
  if (state.segment !== null && state.segment.key === key) return state;
  return { ...state, segment: captureSegment(state.prev, anchor, ratio, alt, state.segment) };
}

/* -------------------------------------------------------------------------- */
/* The ratio minimum box (plan §3.5 steps 0 and 5.5)                            */
/* -------------------------------------------------------------------------- */

/**
 * Ratio needs a proportion: both start sizes positive in H. When a positive
 * stored size rounds to 0 H, ratio mode holds the box (see the module note).
 */
export function ratioDefined(start: BoxH): boolean {
  return start.w > 0 && start.h > 0;
}

/**
 * The smallest box ratio mode can produce: the controlling (larger start)
 * axis at `kMin = max(fl_k, ceil(fl_o · S0k / S0o))`, the other derived from
 * it. Both sizes then meet their floors; with a grandfathered axis both stay
 * at or above their start values. The session's ratio anchor clamp keeps the
 * dragged anchor at least this far from the fixed corner (step 0).
 * Without a proportion (a start axis of 0 H) it is the start box.
 */
export function ratioMinimumBox(state: ResizeState): { w: number; h: number } {
  const S0 = state.start;
  if (!ratioDefined(S0)) return { w: S0.w, h: S0.h };
  const big = S0.w >= S0.h ? 'x' : 'y';
  const S0k = big === 'x' ? S0.w : S0.h;
  const S0o = big === 'x' ? S0.h : S0.w;
  const flk = big === 'x' ? state.floors.w : state.floors.h;
  const flo = big === 'x' ? state.floors.h : state.floors.w;
  const kMin = Math.max(flk, ceilDiv(flo * S0k, S0o));
  const oMin = roundHalfUpDiv(kMin * S0o, S0k);
  return big === 'x' ? { w: kMin, h: oMin } : { w: oMin, h: kMin };
}

/* -------------------------------------------------------------------------- */
/* One bounded move (plan §3.5)                                                 */
/* -------------------------------------------------------------------------- */

export interface ResizeMoveInput {
  /** The active anchor AFTER Konva's possible rename (`tr.getActiveAnchor()`). */
  anchor: ResizeAnchor;
  /** Keep proportions OR Shift. It applies only at a corner. */
  ratio: boolean;
  /** Alt: centred scaling. */
  alt: boolean;
  /** Konva's proposed box in unit-space mm. Only the active side's edges are read. */
  raw: RawEdgesMm;
  /**
   * The dragged anchor's position in unit-space mm, after the ratio clamp.
   * Ratio mode takes its scale from it (plan §3.4); other modes ignore it.
   */
  anchorPoint: PointMm;
}

export interface ResizeResult {
  state: ResizeState;
  box: BoxH;
  /** Vertical guide, H2, or null. Reported only for a snap that survived its floor. */
  guideX2: number | null;
  /** Horizontal guide, H2, or null. */
  guideY2: number | null;
  /** Ratio mode's controlling axis; null in free and centred modes. */
  controllingAxis: 'x' | 'y' | null;
  /** Drag-through (plan §3.5 step 1): Konva proposed a non-positive extent; `prev` is held. */
  frozen: boolean;
  /** Ratio mode on a start box with a 0 H axis: no proportion to keep; `prev` is held. */
  ratioUndefined: boolean;
  /** The segment this move ran in (null only for a freeze before any segment existed). */
  segment: ResizeSegment | null;
}

export function boundResize(state: ResizeState, input: ResizeMoveInput): ResizeResult {
  const { raw, anchor, alt } = input;

  // Step 1 — drag-through freeze (free and centred modes; one-edge ratio never gets here after
  // the clamp). Konva has already renamed the anchor, so the next move starts a new segment.
  if (raw.right - raw.left <= 0 || raw.bottom - raw.top <= 0) {
    return { state, box: state.prev, guideX2: null, guideY2: null, controllingAxis: null, frozen: true, ratioUndefined: false, segment: state.segment };
  }

  // Step 2 — the segment for this key.
  const s = withSegment(state, anchor, input.ratio, alt);
  const g = s.segment!;
  const { xs, ys } = g;
  const ex = xs > 0 ? raw.right : raw.left;
  const ey = ys > 0 ? raw.bottom : raw.top;

  let box: BoxH = { ...s.prev };
  let guideX2: number | null = null;
  let guideY2: number | null = null;
  let controllingAxis: 'x' | 'y' | null = null;

  if (g.ratio && !ratioDefined(s.start)) {
    // No proportion to keep (a start axis rounds to 0 H): hold the previous box.
    return { state: s, box: s.prev, guideX2: null, guideY2: null, controllingAxis: null, frozen: false, ratioUndefined: true, segment: g };
  }
  if (g.ratio) {
    ({ box, guideX2, guideY2, controllingAxis } = boundRatio(s, g, input.anchorPoint));
  } else {
    if (xs !== 0) {
      const r = boundAxis(s, g, 'x', xs, ex);
      box.x = r.pos;
      box.w = r.size;
      guideX2 = r.guide2;
    }
    if (ys !== 0) {
      const r = boundAxis(s, g, 'y', ys, ey);
      box.y = r.pos;
      box.h = r.size;
      guideY2 = r.guide2;
    }
  }

  return { state: { ...s, prev: box }, box, guideX2, guideY2, controllingAxis, frozen: false, ratioUndefined: false, segment: g };
}

/** Steps 3 and 4: one free (snapping) or centred axis. */
function boundAxis(
  s: ResizeState,
  g: ResizeSegment,
  axis: 'x' | 'y',
  dir: AxisDir,
  edgeMm: number
): { pos: number; size: number; guide2: number | null } {
  const floor = axis === 'x' ? s.floors.w : s.floors.h;
  if (g.alt) {
    // Step 4 — centred: no snap; width from the dragged edge against the SEGMENT centre;
    // floorDiv puts an odd-parity centre half a hundredth low, and it never accumulates.
    const C2 = (axis === 'x' ? g.centreX2 : g.centreY2)!;
    let W = toH(2 * dir * (edgeMm - C2 / 200));
    if (W < floor) W = floor;
    return { pos: floorDiv(C2 - W, 2), size: W, guide2: null };
  }
  // Step 3 — free one-edge: snap, then the floor AFTER quantization (the floor drops the guide).
  const F = (axis === 'x' ? g.fixedX : g.fixedY)!;
  let E: number;
  let guide2: number | null = null;
  const snap = bestSnap([{ value: edgeMm, rate: 1 }], axis === 'x' ? s.targetsMm.x : s.targetsMm.y);
  if (snap) {
    guide2 = Math.round(snap.guide * 200);
    E = halfUp(guide2);
  } else E = toH(edgeMm);
  if (dir * (E - F) < floor) {
    E = F + dir * floor;
    guide2 = null;
  }
  return { pos: dir > 0 ? F : E, size: dir * (E - F), guide2 };
}

/** Step 5: ratio (a corner; both axes one-edge, or both centred with Alt). */
function boundRatio(
  s: ResizeState,
  g: ResizeSegment,
  anchorPoint: PointMm
): { box: BoxH; guideX2: number | null; guideY2: number | null; controllingAxis: 'x' | 'y' } {
  const S0 = s.start;
  const { xs, ys } = g;
  const big: 'x' | 'y' = S0.w >= S0.h ? 'x' : 'y';

  // 5.1 — raw scale from the anchor position against the segment's own integer reference:
  // Konva's corner rule (comparePoint + hyp·(cos, sin)) without Konva's rounded node box.
  const hyp0 = Math.hypot(S0.w, S0.h);
  const sRaw = g.alt
    ? (2 * Math.hypot(anchorPoint.x * 100 - g.centreX2! / 2, anchorPoint.y * 100 - g.centreY2! / 2)) / hyp0
    : Math.hypot(anchorPoint.x * 100 - g.fixedX!, anchorPoint.y * 100 - g.fixedY!) / hyp0;

  // 5.2–5.4 — snap candidates (one-edge only) and the controlling axis.
  let k: 'x' | 'y' = big;
  let kSize: number | undefined;
  let snapped: { axis: 'x' | 'y'; guide2: number } | null = null;
  if (!g.alt) {
    const sx = bestSnap([{ value: (g.fixedX! + xs * S0.w * sRaw) / 100, rate: 1 }], s.targetsMm.x);
    const sy = bestSnap([{ value: (g.fixedY! + ys * S0.h * sRaw) / 100, rate: 1 }], s.targetsMm.y);
    if (sx && sy) {
      const dx = Math.abs(sx.delta);
      const dy = Math.abs(sy.delta);
      k = dx < dy ? 'x' : dy < dx ? 'y' : big;
    } else if (sx) k = 'x';
    else if (sy) k = 'y';
    const sn = k === 'x' ? sx : sy;
    if (sn) {
      const T2 = Math.round(sn.guide * 200);
      const E = halfUp(T2);
      kSize = k === 'x' ? xs * (E - g.fixedX!) : ys * (E - g.fixedY!);
      snapped = { axis: k, guide2: T2 };
    }
  }
  const S0k = k === 'x' ? S0.w : S0.h;
  const S0o = k === 'x' ? S0.h : S0.w;
  const flk = k === 'x' ? s.floors.w : s.floors.h;
  const flo = k === 'x' ? s.floors.h : s.floors.w;
  if (kSize === undefined) kSize = Math.round(S0k * sRaw);

  // 5.5 — the floor, exact: it outranks the snap (the guide is dropped).
  const kMin = Math.max(flk, ceilDiv(flo * S0k, S0o));
  if (kSize < kMin) {
    kSize = kMin;
    snapped = null;
  }
  // 5.6 — the dependent size, exact integer arithmetic.
  const oSize = roundHalfUpDiv(kSize * S0o, S0k);
  const W = k === 'x' ? kSize : oSize;
  const H = k === 'x' ? oSize : kSize;

  // 5.7 — positions.
  const box: BoxH = g.alt
    ? { x: floorDiv(g.centreX2! - W, 2), y: floorDiv(g.centreY2! - H, 2), w: W, h: H }
    : { x: xs > 0 ? g.fixedX! : g.fixedX! - W, y: ys > 0 ? g.fixedY! : g.fixedY! - H, w: W, h: H };

  return {
    box,
    guideX2: snapped && snapped.axis === 'x' ? snapped.guide2 : null,
    guideY2: snapped && snapped.axis === 'y' ? snapped.guide2 : null,
    controllingAxis: k,
  };
}

/* -------------------------------------------------------------------------- */
/* Commit mapping (plan §3.9)                                                   */
/* -------------------------------------------------------------------------- */

export interface StoredGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The payload the pill renders and the release commits, built from the
 * bounded box. A field whose H value equals the start box's keeps the
 * element's ORIGINAL stored number (so an untouched axis and a no-op never
 * rewrite stored values); a changed field is the canonical `fromH(h)`,
 * page-relative for x. The owning page never changes (#2), so x may be
 * negative (T18).
 */
export function resizePayload(stored: StoredGeometry, start: BoxH, box: BoxH, pageOffsetH: number): StoredGeometry {
  return {
    x: box.x === start.x ? stored.x : fromH(box.x - pageOffsetH),
    y: box.y === start.y ? stored.y : fromH(box.y),
    width: box.w === start.w ? stored.width : fromH(box.w),
    height: box.h === start.h ? stored.height : fromH(box.h),
  };
}

/** True when the bounded box equals the start box in H: release then commits nothing (G8). */
export function sameBoxH(a: BoxH, b: BoxH): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
