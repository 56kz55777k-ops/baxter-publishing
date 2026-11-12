/**
 * TEST-ONLY fixture — a port of Konva 10.3.0's Transformer anchor logic and a
 * driver that runs the production resize maths behind it (Slice D plan §6
 * stage 2, §7). Never imported by application code.
 *
 * `konvaStep` is the line-by-line port the evidence script uses
 * (`docs/evidence/slice-d-math-check.js`, from `_handleMouseMove`'s anchor
 * branches and the start of `_fitNodesInto` in
 * `node_modules/konva/lib/shapes/Transformer.js`), and the stage 1 probe
 * matched it against real Konva on every move in three browsers.
 *
 * `driveMove` follows the evidence script's `gestureMove` (anchorBound →
 * Konva → boxBound), with one addition from stage 1 finding F2, adopted by
 * Ben on 2026-11-04: Konva's `_handleMouseMove` returns early when the
 * anchor's position did not change (`oldAbs === newAbs`). The driver models
 * that branch and records it in a callback trace that keeps it apart from
 * the [−1, 1) px extent skip:
 *
 *   anchor unchanged:  anchorDragBoundFunc → return:anchor-unchanged
 *   extent skip:       anchorDragBoundFunc → inRange:width [→ inRange:height] → return:extent-skip
 *   proceeds:          anchorDragBoundFunc → inRange:width → inRange:height → boundBoxFunc
 *
 * Modelling F2 is not always outcome-neutral. When the ratio clamp holds the
 * anchor at the corner of a box that is already the ratio minimum box, and a
 * snap target lies within 1.6 mm of that box's moving edge, the port (which
 * proceeds) snaps the box larger while Konva holds it. Stage 2 pins this
 * case in `slice-d-resize-math.test.ts` for Ben and Codex to review; it is a
 * Konva-boundary effect, not a difference in `boundResize`.
 *
 * The D-5 threshold and cancel are the session's (stage 4) and are not here.
 * The ratio anchor clamp (plan §3.5 step 0; Q7 (a), decided 2026-11-12) is
 * applied when `clamp` is on — through the PRODUCTION `ratioAnchorClamp`
 * (stage 4, `resize-session.ts`), so the fixture never carries its own copy.
 */
import { ratioAnchorClamp } from '@/components/editor/resize-session';
import {
  anchorAxes,
  boundResize,
  createResizeState,
  ratioApplies,
  withSegment,
  type BoxH,
  type ResizeAnchor,
  type ResizeResult,
  type ResizeSegment,
  type ResizeState,
  type TargetsH2,
} from '@baxter/domain';

/* -------------------------------------------------------------------------- */
/* The Konva port                                                              */
/* -------------------------------------------------------------------------- */

export interface PxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PxPoint {
  x: number;
  y: number;
}

export type KonvaCall =
  | 'anchorDragBoundFunc'
  | 'return:anchor-unchanged'
  | 'inRange:width'
  | 'inRange:height'
  | 'return:extent-skip'
  | 'boundBoxFunc';

export type KonvaStepResult =
  | { skip: true; anchor: ResizeAnchor; skippedOn: 'width' | 'height'; raw: PxBox }
  | { skip: false; anchor: ResizeAnchor; renamed: boolean; raw: PxBox };

const CORNERS = new Set<ResizeAnchor>(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

/** `Util._inRange(val, left, right)` in `lib/Util.js`: `left <= val && val < right`. */
const inRange = (val: number, left: number, right: number) => left <= val && val < right;

/**
 * One Konva move after `anchorDragBoundFunc`: the dragged anchor sits at
 * `anchorTarget` (absolute stage px) on a node box `node`. `sin`/`cos` are
 * the gesture-start box's (Konva records them at mousedown). Returns Konva's
 * proposed box, or the [−1, 1) px early return of `_fitNodesInto`, and the
 * anchor after Konva's rename on a negative extent.
 */
export function konvaStep(
  node: PxBox,
  anchor: ResizeAnchor,
  anchorTarget: PxPoint,
  keepProportion: boolean,
  centeredScaling: boolean,
  sin: number,
  cos: number,
  trace?: KonvaCall[]
): KonvaStepResult {
  const W = node.w;
  const H = node.h;
  const tl = { x: 0, y: 0 };
  const br = { x: W, y: H };
  const a = { x: anchorTarget.x - node.x, y: anchorTarget.y - node.y };
  if (CORNERS.has(anchor)) {
    const dx = anchor.includes('left') ? -1 : 1;
    const dy = anchor.startsWith('top') ? -1 : 1;
    let px = a.x;
    let py = a.y;
    if (keepProportion) {
      // comparePoint: the opposite corner of the CURRENT box, or its centre when centred
      const c = centeredScaling ? { x: W / 2, y: H / 2 } : { x: dx < 0 ? W : 0, y: dy < 0 ? H : 0 };
      const hyp = Math.sqrt(Math.pow(c.x - a.x, 2) + Math.pow(c.y - a.y, 2));
      // reverse per axis: -1 when the anchor is strictly on the far side of the comparePoint
      const rx = dx * (a.x - c.x) < 0 ? -1 : 1;
      const ry = dy * (a.y - c.y) < 0 ? -1 : 1;
      px = c.x + dx * hyp * cos * rx;
      py = c.y + dy * hyp * sin * ry;
    }
    if (dx < 0) tl.x = px;
    else br.x = px;
    if (dy < 0) tl.y = py;
    else br.y = py;
  } else if (anchor === 'middle-left') tl.x = a.x;
  else if (anchor === 'middle-right') br.x = a.x;
  else if (anchor === 'top-center') tl.y = a.y;
  else if (anchor === 'bottom-center') br.y = a.y;
  if (centeredScaling) {
    const topOffX = tl.x;
    const topOffY = tl.y;
    const botOffX = W - br.x;
    const botOffY = H - br.y;
    br.x -= topOffX;
    br.y -= topOffY;
    tl.x += botOffX;
    tl.y += botOffY;
  }
  const raw: PxBox = { x: node.x + tl.x, y: node.y + tl.y, w: br.x - tl.x, h: br.y - tl.y };
  // _fitNodesInto: width checked first, then height (padding 0); the interval is [-1, 1).
  trace?.push('inRange:width');
  if (inRange(raw.w, -1, 1)) {
    trace?.push('return:extent-skip');
    return { skip: true, anchor, skippedOn: 'width', raw };
  }
  trace?.push('inRange:height');
  if (inRange(raw.h, -1, 1)) {
    trace?.push('return:extent-skip');
    return { skip: true, anchor, skippedOn: 'height', raw };
  }
  let renamed: ResizeAnchor = anchor;
  if (raw.w < 0)
    renamed = (renamed.includes('left') ? renamed.replace('left', 'right') : renamed.replace('right', 'left')) as ResizeAnchor;
  if (raw.h < 0)
    renamed = (renamed.includes('top') ? renamed.replace('top', 'bottom') : renamed.replace('bottom', 'top')) as ResizeAnchor;
  trace?.push('boundBoxFunc');
  return { skip: false, anchor: renamed, renamed: renamed !== anchor, raw };
}

/* -------------------------------------------------------------------------- */
/* The gesture driver: anchorBound → Konva → boxBound, on the production maths  */
/* -------------------------------------------------------------------------- */

export interface View {
  /** Stage px per mm (3.4 at 100 %). */
  scale: number;
  vx: number;
  vy: number;
}

export const V100: View = { scale: 3.4, vx: 0, vy: 0 };

export const mmToPxX = (mm: number, v: View) => mm * v.scale + v.vx;
export const mmToPxY = (mm: number, v: View) => mm * v.scale + v.vy;

export interface Gesture {
  state: ResizeState;
  anchor: ResizeAnchor;
  view: View;
  sin: number;
  cos: number;
  clamp: boolean;
  /**
   * Model Konva's anchor-unchanged early return (F2). On by default, as real
   * Konva behaves; off reproduces the evidence script's port, which omits it.
   */
  unchangedReturn: boolean;
}

export function newGesture(
  start: BoxH,
  targets: TargetsH2,
  anchor: ResizeAnchor,
  view: View,
  clamp = true,
  unchangedReturn = true,
  /**
   * The node size Konva reads its ratio basis from at mousedown (any unit). Real Konva reads the
   * node's stored size, which for a 0 H axis is still positive (e.g. 0.004 mm); the default is the
   * start box in H, which is the same proportion for every box with no 0 H axis.
   */
  konvaBasis: { w: number; h: number } = start
): Gesture {
  const hyp = Math.hypot(konvaBasis.w, konvaBasis.h);
  return {
    state: createResizeState(start, targets),
    anchor,
    view,
    sin: konvaBasis.h / hyp,
    cos: konvaBasis.w / hyp,
    clamp,
    unchangedReturn,
  };
}

/** The node box in absolute stage px, from a box in H (what `onTransform` leaves on the node). */
export function nodePxOf(box: BoxH, v: View): PxBox {
  return { x: mmToPxX(box.x / 100, v), y: mmToPxY(box.y / 100, v), w: (box.w / 100) * v.scale, h: (box.h / 100) * v.scale };
}

/** Where Konva's `update()` placed the active anchor on the node box: Konva's `oldAbs`. */
export function anchorPositionPx(node: PxBox, anchor: ResizeAnchor): PxPoint {
  const { xs, ys } = anchorAxes(anchor);
  return {
    x: xs < 0 ? node.x : xs > 0 ? node.x + node.w : node.x + node.w / 2,
    y: ys < 0 ? node.y : ys > 0 ? node.y + node.h : node.y + node.h / 2,
  };
}

export type MoveClass = 'unchanged' | 'skip' | 'proceed';

export interface DrivenMove {
  cls: MoveClass;
  /** Konva's calls for this move, in order. */
  trace: KonvaCall[];
  /** The anchor target after the clamp (absolute stage px). */
  target: PxPoint;
  clamped: boolean;
  /** The ratio clamp's minimum-box extent in px (one-edge ratio only). */
  minExtentPx: { w: number; h: number } | null;
  /** Konva's proposed box (px) when it got that far. */
  raw: PxBox | null;
  skippedOn: 'width' | 'height' | null;
  renamed: boolean;
  frozen: boolean;
  /** The box after this move (prev on an unchanged return or a skip). */
  box: BoxH;
  segment: ResizeSegment | null;
  result: ResizeResult | null;
}

/**
 * One delivered move. `pointer` is the anchor target Konva proposes, in
 * unit-space mm (the probe's integer px paths convert exactly via `View`).
 * `ratioRequested` is Keep proportions or Shift; Konva's own
 * `keepProportion` is the same flag (it acts only in its corner branches).
 */
export function driveMove(G: Gesture, pointer: { x: number; y: number }, ratioRequested: boolean, alt: boolean): DrivenMove {
  return driveMovePx(G, { x: mmToPxX(pointer.x, G.view), y: mmToPxY(pointer.y, G.view) }, ratioRequested, alt);
}

export function driveMovePx(G: Gesture, targetIn: PxPoint, ratioRequested: boolean, alt: boolean): DrivenMove {
  const v = G.view;
  const trace: KonvaCall[] = ['anchorDragBoundFunc'];

  // anchorBound: the segment for this move's key, captured before Konva runs (plan §3.5 step 2).
  G.state = withSegment(G.state, G.anchor, ratioRequested, alt);
  const g = G.state.segment!;
  const ratio = ratioApplies(G.anchor, ratioRequested);

  // anchorBound: the ratio anchor clamp in one-edge ratio (plan §3.5 step 0) — the production function.
  let target = { ...targetIn };
  let clamped = false;
  let minExtentPx: { w: number; h: number } | null = null;
  if (G.clamp && ratio && !alt) {
    const c = ratioAnchorClamp(G.state, { x: v.vx, y: v.vy, scale: v.scale }, targetIn)!;
    target = c.target;
    clamped = c.clamped;
    minExtentPx = c.minExtentPx;
  }

  const prev = G.state.prev;
  const node = nodePxOf(prev, v);
  const base = { target, clamped, minExtentPx, segment: g };

  // F2: `_handleMouseMove` returns when the bound anchor position equals the anchor's current one.
  const oldAbs = anchorPositionPx(node, G.anchor);
  if (G.unchangedReturn && oldAbs.x === target.x && oldAbs.y === target.y) {
    trace.push('return:anchor-unchanged');
    return { cls: 'unchanged', trace, ...base, raw: null, skippedOn: null, renamed: false, frozen: false, box: prev, result: null };
  }

  const k = konvaStep(node, G.anchor, target, ratioRequested, alt, G.sin, G.cos, trace);
  if (k.skip) {
    return { cls: 'skip', trace, ...base, raw: k.raw, skippedOn: k.skippedOn, renamed: false, frozen: false, box: prev, result: null };
  }
  G.anchor = k.anchor;

  // boxBound: Konva's proposed box (px → unit mm) and the anchor position, into the production maths.
  const raw = {
    left: (k.raw.x - v.vx) / v.scale,
    right: (k.raw.x + k.raw.w - v.vx) / v.scale,
    top: (k.raw.y - v.vy) / v.scale,
    bottom: (k.raw.y + k.raw.h - v.vy) / v.scale,
  };
  const anchorPoint = { x: (target.x - v.vx) / v.scale, y: (target.y - v.vy) / v.scale };
  const result = boundResize(G.state, { anchor: k.anchor, ratio: ratioRequested, alt, raw, anchorPoint });
  G.state = result.state;
  return {
    cls: 'proceed',
    trace,
    ...base,
    segment: result.segment,
    raw: k.raw,
    skippedOn: null,
    renamed: k.renamed,
    frozen: result.frozen,
    box: result.box,
    result,
  };
}

/* -------------------------------------------------------------------------- */
/* Paths (the evidence script's section E helpers)                              */
/* -------------------------------------------------------------------------- */

export function linePath(p0: { x: number; y: number }, p1: { x: number; y: number }, step: number) {
  const n = Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / step);
  const pts: { x: number; y: number }[] = [];
  for (let i = 1; i <= n; i++) pts.push({ x: p0.x + ((p1.x - p0.x) * i) / n, y: p0.y + ((p1.y - p0.y) * i) / n });
  return pts;
}

/** The anchor's position on a box, unit-space mm. */
export function anchorPosMm(B: BoxH, anchor: ResizeAnchor) {
  const { xs, ys } = anchorAxes(anchor);
  const l = B.x / 100;
  const t = B.y / 100;
  const r = (B.x + B.w) / 100;
  const b = (B.y + B.h) / 100;
  return { x: xs > 0 ? r : xs < 0 ? l : (l + r) / 2, y: ys > 0 ? b : ys < 0 ? t : (t + b) / 2 };
}

export const edgeJumpMm = (A: BoxH, B: BoxH) =>
  Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.x + A.w - B.x - B.w), Math.abs(A.y + A.h - B.y - B.h)) / 100;

export interface PathRun {
  freezes: number;
  renames: number;
  clamps: number;
  skips: number;
  unchanged: number;
  segments: number;
  maxJump: number;
  floorViolations: number;
  referenceViolations: number;
  returnMismatch: number;
  maxRunCentreErr: number;
  boxes: BoxH[];
  start: BoxH;
  final: BoxH;
  anchorEnd: ResizeAnchor;
  moves: DrivenMove[];
}

/**
 * The evidence script's `runPath`: a lead-in from the handle to the first
 * waypoint (not measured), then out-and-back legs in 0.2 mm steps. Recovery
 * compares box i on the way out with box (n − 1 − i) on the way back.
 */
export function runPath(
  start: BoxH,
  anchor: ResizeAnchor,
  waypoints: { x: number; y: number }[],
  ratio: boolean,
  alt: boolean,
  clamp = true
): PathRun {
  const G = newGesture(start, { x: [], y: [] }, anchor, V100, clamp);
  for (const p of linePath(anchorPosMm(start, anchor), waypoints[0]!, 0.2)) driveMove(G, p, ratio, alt);
  const leadIn = { ...G.state.prev };
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < waypoints.length; i++) pts.push(...linePath(waypoints[i]!, waypoints[i + 1]!, 0.2));
  const R: PathRun = {
    freezes: 0, renames: 0, clamps: 0, skips: 0, unchanged: 0, segments: 0, maxJump: 0,
    floorViolations: 0, referenceViolations: 0, returnMismatch: 0, maxRunCentreErr: 0,
    boxes: [{ ...leadIn }], start: leadIn, final: leadIn, anchorEnd: anchor, moves: [],
  };
  let prevBox = { ...leadIn };
  let lastKey: string | null = null;
  let runC2: { x?: number; y?: number } | null = null;
  for (const p of pts) {
    const m = driveMove(G, p, ratio, alt);
    R.moves.push(m);
    if (m.clamped) R.clamps++;
    if (m.cls !== 'proceed') {
      if (m.cls === 'skip') R.skips++;
      else R.unchanged++;
      R.boxes.push({ ...prevBox });
      continue;
    }
    if (m.frozen) R.freezes++;
    if (m.renamed) R.renames++;
    if (m.segment && m.segment.key !== lastKey) {
      R.segments++;
      lastKey = m.segment.key;
    }
    const B = m.box;
    const fl = G.state.floors;
    if (B.w < fl.w || B.h < fl.h) R.floorViolations++;
    const g = m.segment;
    if (!m.frozen && g && !g.alt) {
      if (g.xs && (g.xs > 0 ? B.x : B.x + B.w) !== g.fixedX) R.referenceViolations++;
      if (g.ys && (g.ys > 0 ? B.y : B.y + B.h) !== g.fixedY) R.referenceViolations++;
    }
    if (!m.frozen && g && g.alt) {
      if (g.xs && Math.abs(2 * B.x + B.w - g.centreX2!) > 1) R.referenceViolations++;
      if (g.ys && Math.abs(2 * B.y + B.h - g.centreY2!) > 1) R.referenceViolations++;
      if (!runC2) runC2 = { x: g.centreX2, y: g.centreY2 };
      if (g.xs && runC2.x !== undefined) R.maxRunCentreErr = Math.max(R.maxRunCentreErr, Math.abs(2 * B.x + B.w - runC2.x) / 200);
      if (g.ys && runC2.y !== undefined) R.maxRunCentreErr = Math.max(R.maxRunCentreErr, Math.abs(2 * B.y + B.h - runC2.y) / 200);
    }
    R.maxJump = Math.max(R.maxJump, edgeJumpMm(prevBox, B));
    prevBox = { ...B };
    R.boxes.push({ ...B });
  }
  const n = R.boxes.length;
  for (let i = 0; i < (n - 1) / 2; i++) {
    const A = R.boxes[i]!;
    const B = R.boxes[n - 1 - i]!;
    if (A.x !== B.x || A.y !== B.y || A.w !== B.w || A.h !== B.h) R.returnMismatch++;
  }
  R.final = R.boxes[n - 1]!;
  R.anchorEnd = G.anchor;
  return R;
}
