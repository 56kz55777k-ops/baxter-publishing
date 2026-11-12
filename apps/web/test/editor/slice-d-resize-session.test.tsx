// @vitest-environment jsdom
/**
 * Slice D stage 4 — the resize session controller (plan §4.3–§4.5, §7
 * `slice-d-resize-session.test.tsx`; §0.10–§0.11).
 *
 * The session is the PRODUCTION object stage 5 will wire to Konva. These
 * tests drive it with the stage 2 test-only Konva port standing in for
 * Konva's Transformer (`konvaStep`: the anchor rules matched against real
 * Konva in stage 1), real DOM key/blur events on `window`, and the REAL
 * shell keyboard hook (`useEditorKeyboard`) mounted beside it — so the guard
 * is proved against the handlers it must silence, not against a stand-in.
 *
 * jsdom has no canvas and no native control activation: browser-level
 * behaviour (real Konva, a focused button's keyboard activation) is stage 5
 * and stage 8 work and is NOT EXECUTED here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { sameBoxH, startBoxH, type BoxH, type ResizeAnchor, type StoredGeometry, type TargetsH2 } from '@baxter/domain';
import {
  ResizeSession,
  panMayStart,
  ratioAnchorClamp,
  resizeMayStart,
  type ResizeEnd,
  type ResizeModifiers,
  type ResizePreview,
} from '@/components/editor/resize-session';
import { INTENT_THRESHOLD_PX, pastIntentThreshold } from '@/components/editor/geometry';
import { DRAG_THRESHOLD_PX } from '@/components/editor/use-stage-gestures';
import { useEditorKeyboard } from '@/components/editor/use-editor-keyboard';
import type { EditorUiAction } from '@/components/editor/state/editor-ui';
import {
  anchorPositionPx,
  driveMove,
  konvaStep,
  linePath,
  anchorPosMm,
  newGesture,
  nodePxOf,
  type PxBox as PortBox,
  type View,
} from './support/slice-d-konva-port';

/* -------------------------------------------------------------------------- */
/* Rig: a session driven through the Konva port                                */
/* -------------------------------------------------------------------------- */

const NONE: ResizeModifiers = { shift: false, alt: false };
const SHIFT: ResizeModifiers = { shift: true, alt: false };
const ALT: ResizeModifiers = { shift: false, alt: true };
const NO_TARGETS: TargetsH2 = { x: [], y: [] };
const S40_STORED: StoredGeometry = { x: 100, y: 100, width: 40, height: 30 };

interface Rig {
  s: ResizeSession;
  anchor: ResizeAnchor;
  node: PortBox;
  portView: View;
  keep: boolean;
  sin: number;
  cos: number;
  start: BoxH;
  press: { x: number; y: number };
  previews: (ResizePreview | null)[];
  commits: [string, StoredGeometry][];
  ends: ResizeEnd[];
}

/** Every session a test creates; disposed after each test so no capture listener outlives its test. */
const live: ResizeSession[] = [];

function rig(o: {
  stored?: StoredGeometry;
  anchor?: ResizeAnchor;
  zoom?: number;
  keepProportions?: boolean;
  targets?: TargetsH2;
  onCommit?: (r: Rig) => void;
} = {}): Rig {
  const stored = o.stored ?? S40_STORED;
  const view = { x: 0, y: 0, scale: 3.4 * (o.zoom ?? 1) };
  const portView: View = { scale: view.scale, vx: view.x, vy: view.y };
  const start = startBoxH(stored, 0);
  const anchor = o.anchor ?? 'bottom-right';
  const node = nodePxOf(start, portView);
  const press = anchorPositionPx(node, anchor);
  const hyp = Math.hypot(start.w, start.h);
  const r = {
    anchor, node, portView, keep: o.keepProportions ?? false, sin: start.h / hyp, cos: start.w / hyp, start, press,
    previews: [], commits: [], ends: [],
  } as unknown as Rig;
  r.s = new ResizeSession(
    { elementId: 'el-1', stored, pageOffsetH: 0, targets: o.targets ?? NO_TARGETS, anchor, view, pressPoint: press, keepProportions: r.keep, keyTarget: window },
    {
      onPreview: (p) => void r.previews.push(p),
      onCommit: (id, p) => {
        r.commits.push([id, p]);
        o.onCommit?.(r);
      },
      onEnd: (e) => void r.ends.push(e),
    }
  );
  live.push(r.s);
  return r;
}

type MoveClass = 'pending-or-unchanged' | 'skip' | 'proceed';

/** One pointer move in stage px: anchorBound → Konva (port) → boxBound, as Konva calls them. */
function movePx(r: Rig, p: { x: number; y: number }, mods: ResizeModifiers = NONE): MoveClass {
  const oldAbs = anchorPositionPx(r.node, r.anchor);
  const target = r.s.anchorBound(oldAbs, p, p, mods, r.anchor);
  if (target.x === oldAbs.x && target.y === oldAbs.y) return 'pending-or-unchanged'; // Konva's F2 early return
  const k = konvaStep(r.node, r.anchor, target, r.keep || mods.shift, mods.alt, r.sin, r.cos);
  if (k.skip) return 'skip';
  r.anchor = k.anchor;
  const out = r.s.boxBound(
    { x: r.node.x, y: r.node.y, width: r.node.w, height: r.node.h, rotation: 0 },
    { x: k.raw.x, y: k.raw.y, width: k.raw.w, height: k.raw.h, rotation: 0 },
    k.anchor,
    mods
  );
  r.node = { x: out.x, y: out.y, w: out.width, h: out.height };
  return 'proceed';
}

/** A pointer move in unit-space mm (the stage 2 tests' coordinates). */
function move(r: Rig, mm: { x: number; y: number }, mods: ResizeModifiers = NONE): MoveClass {
  return movePx(r, { x: mm.x * r.portView.scale + r.portView.vx, y: mm.y * r.portView.scale + r.portView.vy }, mods);
}

const box = (r: Rig) => r.s.snapshot().box;
const arr = (b: BoxH) => [b.x, b.y, b.w, b.h];

/* -------------------------------------------------------------------------- */
/* Keyboard rig: the REAL shell hook beside the session                         */
/* -------------------------------------------------------------------------- */

let log: string[] = [];
let ui: EditorUiAction[] = [];
let shellSpace = { current: false };
let container: HTMLDivElement;
let root: Root;

function Shell() {
  const { spaceHeld } = useEditorKeyboard((a) => void ui.push(a), {
    onUndo: () => void log.push('undo'),
    onRedo: () => void log.push('redo'),
    onDelete: () => void log.push('delete'),
    onNudge: (dx, dy) => void log.push(`nudge ${dx},${dy}`),
    onDuplicate: () => void log.push('duplicate'),
    onCopy: () => void log.push('copy'),
    onCut: () => void log.push('cut'),
    onPaste: () => void log.push('paste'),
    onSelectAll: () => void log.push('all'),
  });
  shellSpace.current = spaceHeld;
  return null;
}

function key(type: 'keydown' | 'keyup', k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const e = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(e));
  return e;
}
const down = (k: string, init: KeyboardEventInit = {}, t?: EventTarget) => key('keydown', k, init, t);
const up = (k: string, init: KeyboardEventInit = {}, t?: EventTarget) => key('keyup', k, init, t);
const blur = () => act(() => void window.dispatchEvent(new Event('blur')));

const SHORTCUTS: [string, KeyboardEventInit][] = [
  ['z', { metaKey: true }],
  ['z', { metaKey: true, shiftKey: true }],
  ['z', { ctrlKey: true }],
  ['Delete', {}],
  ['Backspace', {}],
  ['ArrowLeft', {}],
  ['ArrowRight', { shiftKey: true }],
  ['ArrowUp', {}],
  ['ArrowDown', {}],
  ['d', { metaKey: true }],
  ['c', { metaKey: true }],
  ['x', { metaKey: true }],
  ['v', { metaKey: true }],
  ['a', { metaKey: true }],
  ['v', {}],
  ['h', {}],
  ['r', {}],
];

beforeEach(() => {
  log = [];
  ui = [];
  shellSpace = { current: false };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(React.createElement(Shell)));
});
afterEach(() => {
  for (const s of live.splice(0)) s.dispose();
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/* ========================================================================== */
/* Threshold (D-5)                                                             */
/* ========================================================================== */

describe('stage 4 — the D-5 intent threshold (screen px, every zoom)', () => {
  it('one shared helper: 3 screen px, Euclidean, inclusive at 3 — the same constant Slice C drag uses', () => {
    expect(INTENT_THRESHOLD_PX).toBe(3);
    expect(DRAG_THRESHOLD_PX).toBe(INTENT_THRESHOLD_PX);
    expect(pastIntentThreshold({ x: 0, y: 0 }, { x: 2.999, y: 0 })).toBe(false);
    expect(pastIntentThreshold({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(true);
    expect(pastIntentThreshold({ x: 0, y: 0 }, { x: 2.1, y: 2.1 })).toBe(false); // 2.97
    expect(pastIntentThreshold({ x: 0, y: 0 }, { x: 2.2, y: 2.2 })).toBe(true); // 3.11
  });

  it.each([0.15, 1, 8])('zoom %s: under 3 px → anchorBound returns oldAbs and boxBound never runs; the crossing move applies the FULL displacement', (zoom) => {
    const r = rig({ zoom });
    const p0 = r.press;
    for (const d of [0.5, 1.5, 2.9]) {
      const oldAbs = anchorPositionPx(r.node, r.anchor);
      const got = r.s.anchorBound(oldAbs, { x: p0.x + d, y: p0.y }, { x: p0.x + d, y: p0.y }, NONE, r.anchor);
      expect(got).toEqual(oldAbs);
    }
    expect(r.s.snapshot().phase).toBe('pending');
    expect(r.previews).toEqual([]);
    // the crossing move: the proposed anchor exactly, not a position shortened by the threshold
    const oldAbs = anchorPositionPx(r.node, r.anchor);
    const proposed = { x: p0.x + 12, y: p0.y + 0.5 };
    expect(r.s.anchorBound(oldAbs, proposed, proposed, NONE, r.anchor)).toEqual(proposed);
    expect(r.s.snapshot().phase).toBe('active');
  });

  it('the latch holds: back within 3 px of the press after crossing, moves still apply', () => {
    const r = rig();
    expect(movePx(r, { x: r.press.x + 20, y: r.press.y })).toBe('proceed');
    expect(movePx(r, { x: r.press.x + 1, y: r.press.y })).toBe('proceed');
    expect(r.s.snapshot().phase).toBe('active');
  });

  it('a boxBound before the crossing (not reachable through Konva) returns the old box and records nothing', () => {
    const r = rig();
    const old = { x: 1, y: 2, width: 3, height: 4, rotation: 0 };
    expect(r.s.boxBound(old, { x: 9, y: 9, width: 99, height: 99 }, 'bottom-right', NONE)).toBe(old);
    expect(r.previews).toEqual([]);
  });

  it('an anchor click (press, release, no crossing) commits nothing', () => {
    const r = rig();
    movePx(r, { x: r.press.x + 2, y: r.press.y + 1 });
    expect(r.s.release()).toBe(true);
    expect(r.commits).toEqual([]);
    expect(r.ends).toEqual([{ reason: 'release', committed: false, spaceHeld: false, refit: null }]);
  });
});

/* ========================================================================== */
/* The maths through the session: identical to the accepted stage 2 port        */
/* ========================================================================== */

const S40: BoxH = { x: 10000, y: 10000, w: 4000, h: 3000 };
const PATHS: [string, ResizeAnchor, { x: number; y: number }[], boolean, boolean][] = [
  ['E1', 'bottom-right', [{ x: 140, y: 160 }, { x: 80, y: 160 }, { x: 140, y: 160 }], true, false],
  ['E2', 'bottom-right', [{ x: 170, y: 130 }, { x: 170, y: 80 }, { x: 170, y: 130 }], true, false],
  ['E3', 'bottom-right', [{ x: 140, y: 130 }, { x: 80, y: 85 }, { x: 140, y: 130 }], true, false],
  ['E4', 'top-left', [{ x: 100, y: 60 }, { x: 160, y: 60 }, { x: 100, y: 60 }], true, false],
  ['E5', 'bottom-right', [{ x: 140, y: 160 }, { x: 100, y: 160 }, { x: 140, y: 160 }], true, true],
  ['E6', 'bottom-right', [{ x: 180, y: 130 }, { x: 180, y: 100 }, { x: 180, y: 130 }], true, true],
  ['E7', 'bottom-right', [{ x: 140, y: 130 }, { x: 100, y: 100 }, { x: 140, y: 130 }], true, true],
  ['E8', 'bottom-right', [{ x: 140, y: 160 }, { x: 80, y: 160 }, { x: 140, y: 160 }], false, false],
  ['E9', 'middle-right', [{ x: 140, y: 115 }, { x: 80, y: 115 }, { x: 140, y: 115 }], false, false],
  ['E10', 'bottom-right', [{ x: 110, y: 108 }, { x: 95, y: 96 }, { x: 110, y: 108 }], true, false],
];

/** The full point sequence of a path (lead-in from the handle, then the legs), 0.2 mm steps. */
function pathPoints(start: BoxH, anchor: ResizeAnchor, wps: { x: number; y: number }[]) {
  const pts = [...linePath(anchorPosMm(start, anchor), wps[0]!, 0.2)];
  for (let i = 0; i + 1 < wps.length; i++) pts.push(...linePath(wps[i]!, wps[i + 1]!, 0.2));
  return pts;
}

describe('stage 4 — segments, centre carry and the Q7 clamp: the session reproduces the stage 2 port move by move', () => {
  it.each(PATHS)('%s (%s): after the crossing every bounded box equals the port\'s', (_n, anchor, wps, ratio, alt) => {
    const r = rig({ anchor });
    const G = newGesture(S40, NO_TARGETS, anchor, { scale: 3.4, vx: 0, vy: 0 }, true);
    const mods = { shift: ratio, alt };
    let crossed = false;
    let compared = 0;
    for (const p of pathPoints(S40, anchor, wps)) {
      const m = driveMove(G, p, ratio, alt);
      move(r, p, mods);
      if (!crossed && r.s.snapshot().phase === 'active') crossed = true;
      if (crossed) {
        expect(arr(box(r))).toEqual(arr(m.box));
        expect(r.anchor).toBe(G.anchor);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(300);
  });

  it('E12 one fast move past the corner: the clamp lands on the minimum box at the fixed corner; no rename', () => {
    const r = rig({ keepProportions: true });
    move(r, { x: 150, y: 140 });
    expect(arr(box(r))).toEqual([10000, 10000, 5122, 3842]);
    move(r, { x: 60, y: 50 });
    expect([arr(box(r)), r.anchor]).toEqual([[10000, 10000, 534, 401], 'bottom-right']);
  });

  it('the crossing move itself, already past the fixed corner, is clamped: the segment is captured BEFORE Konva runs (§3.5 step 2)', () => {
    const r = rig({ keepProportions: true });
    expect(move(r, { x: 60, y: 50 })).toBe('proceed'); // the very first (crossing) move
    expect([arr(box(r)), r.anchor]).toEqual([[10000, 10000, 534, 401], 'bottom-right']);
  });

  it('Shift pressed on a move that is already past the fixed corner is clamped on that same move (no rename, no re-anchor)', () => {
    const r = rig();
    move(r, { x: 150, y: 140 });
    move(r, { x: 60, y: 50 }, SHIFT);
    expect([arr(box(r)), r.anchor, r.s.snapshot().segmentKey]).toEqual([[10000, 10000, 534, 401], 'bottom-right', 'bottom-right|true|false']);
  });

  it('E13 Alt held across 6 centre crossings: the centre is CARRIED (segment keys change, the centre does not drift)', () => {
    const start = { x: 100, y: 100, width: 10.01, height: 20 };
    const r = rig({ stored: start, anchor: 'middle-right' });
    const wps = [{ x: 112, y: 110 }];
    for (let i = 0; i < 6; i++) wps.push({ x: i % 2 === 0 ? 89.03 : 111.97, y: 110 });
    wps.push({ x: 112, y: 110 });
    const keys = new Set<string>();
    let maxErr = 0;
    let c2: number | null = null;
    for (const p of pathPoints(startBoxH(start, 0), 'middle-right', wps)) {
      move(r, p, ALT);
      const snap = r.s.snapshot();
      if (snap.segmentKey) keys.add(snap.segmentKey);
      if (snap.phase === 'active') {
        const B = snap.box;
        c2 ??= 2 * B.x + B.w;
        maxErr = Math.max(maxErr, Math.abs(2 * B.x + B.w - c2) / 200);
      }
    }
    expect(keys).toEqual(new Set(['middle-right|false|true', 'middle-left|false|true']));
    expect(arr(box(r))).toEqual([9801, 10000, 1399, 2000]);
    expect(maxErr).toBeLessThanOrEqual(0.005);
  });

  it('segment transitions: Shift pressed and released mid-gesture change the key; references come from the box at the change', () => {
    const r = rig();
    move(r, { x: 150, y: 140 });
    const k1 = r.s.snapshot().segmentKey;
    move(r, { x: 152, y: 141 }, SHIFT);
    const k2 = r.s.snapshot().segmentKey;
    move(r, { x: 153, y: 142 });
    const k3 = r.s.snapshot().segmentKey;
    expect([k1, k2, k3]).toEqual(['bottom-right|false|false', 'bottom-right|true|false', 'bottom-right|false|false']);
    expect(box(r).x).toBe(10000); // the fixed corner never moved
    expect(box(r).y).toBe(10000);
  });

  it('ratio clamp modes: one-edge ratio only — inactive under the threshold, in free mode, in centred mode and on side handles', () => {
    // one-edge ratio: a target past the fixed corner is moved to the minimum extent
    const r = rig({ keepProportions: true });
    move(r, { x: 150, y: 140 });
    const oldAbs = anchorPositionPx(r.node, r.anchor);
    const past = { x: 50 * 3.4, y: 50 * 3.4 };
    const clamped = r.s.anchorBound(oldAbs, past, past, NONE, r.anchor);
    expect(clamped).toEqual({ x: 100 * 3.4 + 5.34 * 3.4, y: 100 * 3.4 + 4.01 * 3.4 });
    // free mode and centred mode: the target is returned as proposed
    const f = rig();
    move(f, { x: 150, y: 140 });
    expect(f.s.anchorBound(anchorPositionPx(f.node, f.anchor), past, past, NONE, f.anchor)).toEqual(past);
    const c = rig({ keepProportions: true });
    move(c, { x: 150, y: 140 }, ALT);
    expect(c.s.anchorBound(anchorPositionPx(c.node, c.anchor), past, past, ALT, c.anchor)).toEqual(past);
    const side = rig({ anchor: 'middle-right', keepProportions: true });
    move(side, { x: 150, y: 115 });
    expect(side.s.anchorBound(anchorPositionPx(side.node, side.anchor), past, past, NONE, side.anchor)).toEqual(past);
    // below the threshold nothing is clamped: the old position comes back unchanged
    const p = rig({ keepProportions: true });
    const o = anchorPositionPx(p.node, p.anchor);
    expect(p.s.anchorBound(o, { x: p.press.x - 1, y: p.press.y - 1 }, { x: p.press.x - 1, y: p.press.y - 1 }, NONE, p.anchor)).toEqual(o);
  });

  it('ratioAnchorClamp: null outside one-edge ratio; the clamp follows the CURRENT segment\'s fixed corner', () => {
    const r = rig({ anchor: 'top-left', keepProportions: true });
    move(r, { x: 90, y: 90 });
    const state = (r.s as unknown as { state: Parameters<typeof ratioAnchorClamp>[0] }).state;
    const c = ratioAnchorClamp(state, { x: 0, y: 0, scale: 3.4 }, { x: 1000, y: 1000 })!;
    // top-left: the fixed corner is bottom-right (140, 130); the clamp pulls the anchor up-left of it
    expect(c.clamped).toBe(true);
    expect(c.target.x).toBeCloseTo((140 - 5.34) * 3.4, 9);
    expect(c.target.y).toBeCloseTo((130 - 4.01) * 3.4, 9);
    expect(ratioAnchorClamp({ ...state, segment: null }, { x: 0, y: 0, scale: 3.4 }, { x: 0, y: 0 })).toBeNull();
  });

  it('Q7 (a) keeps F1/S2-1/zero-H: a 0 H start axis holds the box in ratio mode; release commits nothing and keeps the stored numbers', () => {
    const stored = { x: 0, y: 10, width: 0.004, height: 20 };
    const r = rig({ stored, keepProportions: true });
    for (const p of [{ x: 20, y: 40 }, { x: 30, y: 50 }]) move(r, p);
    expect(sameBoxH(box(r), r.start)).toBe(true);
    r.s.release();
    expect(r.commits).toEqual([]);
  });
});

/* ========================================================================== */
/* Release point, at-most-once commit, cancellation                             */
/* ========================================================================== */

describe('stage 4 — release commits the last synchronously bounded payload, at most once', () => {
  it('release right after a move, before any React render, commits THAT move\'s payload object (Object.is)', () => {
    const r = rig();
    move(r, { x: 151.23, y: 141.07 });
    const last = r.previews.at(-1)!;
    r.s.release(); // no coordinates: the mouseup position is never read
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0]![0]).toBe('el-1');
    expect(Object.is(r.commits[0]![1], last.payload)).toBe(true);
    expect(r.commits[0]![1]).toEqual({ x: 100, y: 100, width: 51.23, height: 41.07 });
    expect(r.ends).toEqual([{ reason: 'release', committed: true, spaceHeld: false, refit: null }]);
    expect(r.previews.at(-1)).toBeNull(); // preview cleared at the end
  });

  it('transformEnd with a mouseup is a release; without one (stopTransform/destroy, F4) it cancels', () => {
    const a = rig();
    move(a, { x: 150, y: 140 });
    a.s.transformEnd(true);
    expect(a.commits).toHaveLength(1);
    const b = rig();
    move(b, { x: 150, y: 140 });
    b.s.transformEnd(false);
    expect(b.commits).toEqual([]);
    expect(b.ends[0]!.reason).toBe('transformend');
  });

  it('a gesture that ends where it started in H commits nothing', () => {
    const r = rig();
    move(r, { x: 150, y: 140 });
    move(r, { x: 140, y: 130 });
    expect(sameBoxH(box(r), r.start)).toBe(true);
    r.s.release();
    expect(r.commits).toEqual([]);
    expect(r.ends[0]).toMatchObject({ reason: 'release', committed: false });
  });

  it.each(['readOnly', 'transformend', 'escape', 'blur'] as const)('cancel(%s) after a real change: zero commits, preview cleared', (reason) => {
    const r = rig();
    move(r, { x: 150, y: 140 });
    r.s.cancel(reason);
    expect(r.commits).toEqual([]);
    expect(r.previews.at(-1)).toBeNull();
    expect(r.ends).toEqual([{ reason, committed: false, spaceHeld: false, refit: null }]);
  });

  it('termination is idempotent and reentrancy-safe: a second release/cancel commits nothing; onEnd fires once', () => {
    const r = rig({ onCommit: (rr) => void (rr.s.release(), rr.s.cancel('escape')) });
    move(r, { x: 150, y: 140 });
    expect(r.s.release()).toBe(true);
    expect(r.s.release()).toBe(false);
    expect(r.s.cancel('blur')).toBe(false);
    expect(r.s.transformEnd(true)).toBe(false);
    expect(r.commits).toHaveLength(1);
    expect(r.ends).toHaveLength(1);
    expect(r.s.snapshot().listening).toBe(false);
    // moves after the end change nothing
    const oldAbs = anchorPositionPx(r.node, r.anchor);
    expect(r.s.anchorBound(oldAbs, { x: 0, y: 0 }, { x: 0, y: 0 }, NONE, r.anchor)).toEqual(oldAbs);
  });

  it('dispose (unmount) calls no owner callback, ends the session and detaches every listener', () => {
    const r = rig();
    move(r, { x: 150, y: 140 });
    const n = r.previews.length;
    r.s.dispose();
    r.s.dispose();
    expect([r.commits, r.ends, r.previews.length]).toEqual([[], [], n]);
    expect(r.s.isLive()).toBe(false);
    expect(r.s.snapshot().listening).toBe(false);
    expect(r.s.release()).toBe(false);
    down('z', { metaKey: true });
    expect(log).toEqual(['undo']); // nothing intercepts any more
  });

  it('every listener added is removed: add/remove balance on every exit path', () => {
    for (const exit of ['release', 'escape', 'blur', 'readOnly', 'dispose'] as const) {
      const add = vi.spyOn(window, 'addEventListener');
      const rem = vi.spyOn(window, 'removeEventListener');
      const r = rig();
      move(r, { x: 150, y: 140 });
      if (exit === 'release') r.s.release();
      else if (exit === 'escape') {
        down('Escape');
        up('Escape');
      } else if (exit === 'blur') blur();
      else if (exit === 'readOnly') r.s.cancel('readOnly');
      else r.s.dispose();
      const mine = (calls: unknown[][]) => calls.filter((c) => ['keydown', 'keyup', 'click', 'blur'].includes(c[0] as string)).map((c) => c[1]);
      expect([exit, r.s.snapshot().listening, r.s.snapshot().residualKeys]).toEqual([exit, false, []]);
      // the shell's own listeners were added before the spies; every one the session added is removed
      expect(mine(add.mock.calls)).toHaveLength(4);
      expect(new Set(mine(rem.mock.calls))).toEqual(new Set(mine(add.mock.calls)));
      add.mockRestore();
      rem.mockRestore();
    }
  });
});

/* ========================================================================== */
/* Keyboard guard (§4.5; Q3 default: resize only)                              */
/* ========================================================================== */

describe('stage 4 — the keyboard guard: no shell shortcut runs mid-session (pending or active)', () => {
  it.each(['pending', 'active'] as const)('%s: mutation, clipboard, tool and history keys reach no handler; page defaults prevented', (phase) => {
    const r = rig();
    if (phase === 'active') move(r, { x: 150, y: 140 });
    const events = SHORTCUTS.map(([k, init]) => down(k, init));
    expect(log).toEqual([]);
    expect(ui).toEqual([]);
    for (const [i, e] of events.entries()) {
      const [k] = SHORTCUTS[i]!;
      if (!['v', 'h', 'r'].includes(k) || SHORTCUTS[i]![1].metaKey) expect([k, e.defaultPrevented]).toEqual([k, true]);
    }
    expect(r.s.snapshot().phase).toBe(phase); // nothing restarted or altered the session
  });

  it('control: the same keys run normally once the session has ended', () => {
    const r = rig();
    r.s.release();
    for (const [k, init] of SHORTCUTS) down(k, init);
    expect(log).toEqual(['undo', 'redo', 'undo', 'delete', 'delete', 'nudge -0.5,0', 'nudge 5,0', 'nudge 0,-0.5', 'nudge 0,0.5', 'duplicate', 'copy', 'cut', 'paste', 'all']);
    expect(ui.map((a) => (a.type === 'SET_TOOL' ? a.tool : a.type))).toEqual(['select', 'hand', 'rect']);
  });

  it('modifier keys pass through the session unchanged and do not alter it', () => {
    const r = rig();
    move(r, { x: 150, y: 140 });
    const before = r.s.snapshot();
    for (const k of ['Shift', 'Alt', 'Meta', 'Control']) down(k);
    expect(r.s.snapshot()).toEqual(before);
  });

  it('auto-repeat keydowns (Space, arrows, ⌘Z) never restart or alter the session', () => {
    const r = rig();
    move(r, { x: 150, y: 140 });
    const b0 = arr(box(r));
    for (let i = 0; i < 5; i++) {
      down(' ', { repeat: i > 0 });
      down('ArrowLeft', { repeat: true });
      down('z', { metaKey: true, repeat: true });
    }
    expect([r.s.snapshot().phase, arr(box(r)), log, ui]).toEqual(['active', b0, [], []]);
    move(r, { x: 151, y: 141 });
    expect(arr(box(r))).toEqual([10000, 10000, 5100, 4100]);
  });

  it('Escape cancels and never reaches the resting-state deselect — nor do its auto-repeats; a fresh Escape after keyup does', () => {
    const r = rig();
    move(r, { x: 150, y: 140 });
    down('Escape');
    expect(r.ends[0]).toMatchObject({ reason: 'escape', committed: false });
    for (let i = 0; i < 4; i++) down('Escape', { repeat: true });
    expect(ui).toEqual([]);
    expect(r.s.snapshot().residualKeys).toEqual(['Escape']);
    up('Escape');
    expect(r.s.snapshot()).toMatchObject({ residualKeys: [], listening: false });
    down('Escape'); // a new intention, after the session
    expect(ui.map((a) => a.type)).toEqual(['CLEAR_SELECTION', 'SET_TOOL']);
  });

  it('a missed keyup: a fresh (non-repeat) press clears the residual and is not swallowed', () => {
    const r = rig();
    move(r, { x: 150, y: 140 });
    down('Escape');
    down('Escape'); // not a repeat: the earlier keyup was missed
    expect(ui.map((a) => a.type)).toEqual(['CLEAR_SELECTION', 'SET_TOOL']);
    expect(r.s.snapshot().listening).toBe(false);
  });
});

/* ========================================================================== */
/* Space (Q2 (a), §0.10–§0.11)                                                 */
/* ========================================================================== */

describe('stage 4 — Q2 (a): Space during a resize does not change it; Space at the end; pan only for a new press', () => {
  const phases = ['pending', 'active'] as const;
  const toPhase = (r: Rig, phase: (typeof phases)[number]) => {
    if (phase === 'active') move(r, { x: 150, y: 140 });
    expect(r.s.snapshot().phase).toBe(phase);
  };

  it.each(phases)('%s: Space pressed then released mid-session → the resize continues exactly as without Space; viewport frozen; normal after exit', (phase) => {
    const r = rig();
    const ctrl = rig();
    toPhase(r, phase);
    toPhase(ctrl, phase);
    const down1 = down(' ');
    expect(down1.defaultPrevented).toBe(true);
    expect(r.s.snapshot().spaceHeld).toBe(true);
    const wheel = { preventDefault: vi.fn() };
    expect(r.s.handleWheel(wheel)).toBe(true);
    expect(panMayStart({ spaceHeld: true, tool: 'select', session: r.s })).toBe(false);
    up(' ');
    for (const p of [{ x: 155, y: 144 }, { x: 161.3, y: 147.9 }]) {
      move(r, p);
      move(ctrl, p);
    }
    expect(arr(box(r))).toEqual(arr(box(ctrl)));
    expect(shellSpace.current).toBe(false); // the shell never saw Space mid-session
    r.s.release();
    ctrl.s.release();
    expect(r.commits.map((c) => c[1])).toEqual(ctrl.commits.map((c) => c[1]));
    expect(r.ends[0]).toMatchObject({ reason: 'release', committed: true, spaceHeld: false });
    expect(r.s.handleWheel({ preventDefault: vi.fn() })).toBe(false);
    expect(panMayStart({ spaceHeld: r.ends[0]!.spaceHeld, tool: 'select', session: r.s })).toBe(false);
  });

  it.each(phases)('%s: Space held through release → at most one changed-only commit; Space reported held; pan only for a NEW press', (phase) => {
    const r = rig();
    toPhase(r, phase);
    down(' ');
    expect(panMayStart({ spaceHeld: true, tool: 'select', session: r.s })).toBe(false); // the resize press is not a pan
    if (phase === 'active') move(r, { x: 152, y: 142 });
    r.s.release();
    expect(r.commits).toHaveLength(phase === 'active' ? 1 : 0);
    expect(r.ends[0]).toMatchObject({ reason: 'release', committed: phase === 'active', spaceHeld: true });
    expect(panMayStart({ spaceHeld: r.ends[0]!.spaceHeld, tool: 'select', session: r.s })).toBe(true);
    // Space's keyup after the session still reaches the shell, which clears its own state
    up(' ');
    expect(shellSpace.current).toBe(false);
  });

  it.each(phases)('%s: Space held through Escape → zero commits, selection kept, Space reported held, pan only for a new press', (phase) => {
    const r = rig();
    toPhase(r, phase);
    down(' ');
    down('Escape');
    expect(r.commits).toEqual([]);
    expect(r.ends[0]).toMatchObject({ reason: 'escape', committed: false, spaceHeld: true });
    expect(ui).toEqual([]); // no CLEAR_SELECTION: the selection is kept
    expect(panMayStart({ spaceHeld: true, tool: 'select', session: r.s })).toBe(true);
  });

  it.each(phases)('%s: Space held through window blur → zero commits, selection kept, Space cleared, no stuck pan on refocus', (phase) => {
    const r = rig();
    toPhase(r, phase);
    down(' ');
    blur();
    expect(r.commits).toEqual([]);
    expect(r.ends[0]).toMatchObject({ reason: 'blur', committed: false, spaceHeld: false });
    expect(ui).toEqual([]);
    expect(r.s.snapshot()).toMatchObject({ listening: false, residualKeys: [] });
    act(() => void window.dispatchEvent(new Event('focus')));
    expect(shellSpace.current).toBe(false);
    expect(panMayStart({ spaceHeld: r.ends[0]!.spaceHeld || shellSpace.current, tool: 'select', session: r.s })).toBe(false);
  });

  it('Space already held before the anchor press → no resize session starts (D-4: handles visible but inactive)', () => {
    const base = { spaceHeld: false, tool: 'select' as const, readOnly: false, selectionCount: 1, locked: false };
    expect(resizeMayStart(base)).toBe(true);
    expect(resizeMayStart({ ...base, spaceHeld: true })).toBe(false);
    expect(resizeMayStart({ ...base, tool: 'hand' })).toBe(false);
    expect(resizeMayStart({ ...base, tool: 'rect' })).toBe(false);
    expect(resizeMayStart({ ...base, readOnly: true })).toBe(false);
    expect(resizeMayStart({ ...base, selectionCount: 2 })).toBe(false);
    expect(resizeMayStart({ ...base, locked: true })).toBe(false);
  });

  it('panMayStart is the shell\'s rule (Space or Hand) and is always false while a session lives', () => {
    const r = rig();
    expect(panMayStart({ spaceHeld: false, tool: 'hand', session: r.s })).toBe(false);
    expect(panMayStart({ spaceHeld: true, tool: 'select', session: null })).toBe(true);
    expect(panMayStart({ spaceHeld: false, tool: 'hand', session: null })).toBe(true);
    expect(panMayStart({ spaceHeld: false, tool: 'select', session: null })).toBe(false);
    r.s.release();
    expect(panMayStart({ spaceHeld: false, tool: 'hand', session: r.s })).toBe(true);
  });
});

/* ========================================================================== */
/* Focused controls: tracking and activation                                    */
/* ========================================================================== */

describe('stage 4 — focused controls: Space tracking survives suppression; no activation during or after the session', () => {
  let button: HTMLButtonElement;
  let clicks: number;
  beforeEach(() => {
    clicks = 0;
    button = document.createElement('button');
    button.addEventListener('click', () => void clicks++);
    document.body.appendChild(button);
    button.focus();
  });
  afterEach(() => button.remove());

  const keyboardClick = () => act(() => void button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));

  it('Space on a focused button mid-session: tracked (the shell hook would ignore it), native activation prevented on keydown and keyup', () => {
    const r = rig();
    const d = down(' ', {}, button);
    expect([d.defaultPrevented, r.s.snapshot().spaceHeld]).toEqual([true, true]);
    const u = up(' ', {}, button);
    expect([u.defaultPrevented, r.s.snapshot().spaceHeld]).toEqual([true, false]);
    // control: with no session, the shell hook leaves Space on a focused button native (C-6)
    r.s.release();
    const free = down(' ', {}, button);
    expect([free.defaultPrevented, shellSpace.current]).toEqual([false, false]);
  });

  it.each(['release', 'escape'] as const)('Space pressed on a button during the session, released after %s: the keyup and its keyboard click cannot activate it', (end) => {
    vi.useFakeTimers();
    const r = rig();
    move(r, { x: 150, y: 140 });
    down(' ', {}, button);
    if (end === 'release') r.s.release();
    else down('Escape', {}, button);
    const u = up(' ', {}, button);
    expect(u.defaultPrevented).toBe(true);
    keyboardClick(); // what a browser's keyup activation would dispatch
    expect(clicks).toBe(0);
    act(() => void vi.runAllTimers());
    expect(r.s.snapshot()).toMatchObject({ listening: end === 'escape', residualKeys: end === 'escape' ? ['Escape'] : [] });
    keyboardClick(); // later keyboard clicks are untouched
    expect(clicks).toBe(1);
  });

  it('Enter on a focused button mid-session: prevented; its repeats and keyup after the session too; a pointer click is never touched', () => {
    vi.useFakeTimers();
    const r = rig();
    move(r, { x: 150, y: 140 });
    const d = down('Enter', {}, button);
    expect(d.defaultPrevented).toBe(true);
    r.s.cancel('readOnly');
    const rep = down('Enter', { repeat: true }, button);
    expect(rep.defaultPrevented).toBe(true);
    const u = up('Enter', {}, button);
    expect(u.defaultPrevented).toBe(true);
    keyboardClick();
    expect(clicks).toBe(0);
    act(() => void button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))); // a real pointer click
    expect(clicks).toBe(1);
    act(() => void vi.runAllTimers());
    expect(r.s.snapshot().listening).toBe(false);
  });

  it('window blur drops every residual suppression (keyups will not arrive)', () => {
    const r = rig();
    down(' ', {}, button);
    down('Enter', {}, button);
    r.s.release();
    expect(r.s.snapshot().residualKeys.sort()).toEqual([' ', 'Enter']);
    blur();
    expect(r.s.snapshot()).toMatchObject({ residualKeys: [], listening: false });
  });
});
