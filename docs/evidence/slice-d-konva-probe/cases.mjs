// Slice D stage 1 probe — the case matrix (plan §6 stage 1, §3.8 E1–E13 and H, §4.1, §4.4, §4.7).
// NOT production code. Every case is driven by real Playwright pointer and keyboard input unless its `kind` says
// 'programmatic' (a supplementary check that calls Konva or dispatches a synthetic event). 'mixed' cases say which
// steps are programmatic in their notes.

export const V100 = { scale: 3.4, vx: 0, vy: 0 }; // 100% zoom (contract #9: 3.4 px/mm)
const S40 = { x: 100, y: 100, w: 40, h: 30 }; // the evidence script's E start box (mm)
const e20 = Math.pow(2, -20);

// integer-px path from p0 to p1 (exclusive of p0), at most 1 px per step on each axis
export function pxPath(p0, p1) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  const pts = [];
  for (let i = 1; i <= n; i++) pts.push([Math.round(p0[0] + (dx * i) / n), Math.round(p0[1] + (dy * i) / n)]);
  return pts;
}
// Lead-in from the press to the first waypoint. The evidence model has no D-5 threshold, so its measured path starts
// live; when the first waypoint is the handle itself (E3, E7, E9), the probe first crosses the threshold by moving
// 4 px away from the first segment's direction and coming back, so the measured path also starts live.
// (r1 of this probe omitted this; see results/INVESTIGATION.md.)
async function leadIn(ctx, press, w0, w1) {
  if (Math.hypot(w0[0] - press[0], w0[1] - press[1]) >= 3) { await ctx.path(press, w0); return; }
  const dx = w0[0] - w1[0], dy = w0[1] - w1[1], n = Math.hypot(dx, dy);
  const q = [Math.round(press[0] + (4 * dx) / n), Math.round(press[1] + (4 * dy) / n)];
  await ctx.path(press, q);
  await ctx.path(q, w0);
}
const mmPx = (v, p) => [Math.round(p[0] * v.scale + v.vx), Math.round(p[1] * v.scale + v.vy)];
const roundPt = (p) => [Math.round(p[0]), Math.round(p[1])];

// ---- E: crossing-and-return paths (evidence §3.8 E1–E13), replayed with real pointer events ----
function ePath(id, title, { anchor, box = S40, view = V100, ratio = 'toggle', alt = false, waypointsMm, expect }) {
  return {
    id, title, kind: 'real', group: 'E',
    setup: { view, box, shape: 'rect', keepRatio: ratio === 'toggle' },
    notes: `anchor ${anchor}; ratio ${ratio === 'toggle' ? 'via Keep proportions (keepRatio)' : ratio === 'shift' ? 'via Shift' : 'off'}; Alt ${alt ? 'held' : 'off'}; waypoints (mm) ${waypointsMm.map((p) => `(${p[0]}, ${p[1]})`).join(' -> ')}, rounded to integer px at ${view.scale} px/mm`,
    expect,
    async run(ctx, info) {
      const press = roundPt(info.anchors[anchor]);
      const wps = waypointsMm.map((p) => mmPx(view, p));
      if (alt) await ctx.keyDown('Alt');
      if (ratio === 'shift') await ctx.keyDown('Shift');
      await ctx.hover(press);
      await ctx.down();
      await leadIn(ctx, press, wps[0], wps[1]); // not measured; crosses the 3 px threshold before the measured path
      await ctx.mark('measure');
      for (let i = 1; i < wps.length; i++) await ctx.path(wps[i - 1], wps[i]);
      await ctx.mark('end');
      await ctx.up();
      if (ratio === 'shift') await ctx.keyUp('Shift');
      if (alt) await ctx.keyUp('Alt');
      return { press, waypointsPx: wps };
    },
  };
}

const E = [
  ePath('E1', 'ratio, bottom-right, crosses x only (pointer far below)', { anchor: 'bottom-right', waypointsMm: [[140, 160], [80, 160], [140, 160]], expect: 'oneEdgeRatio' }),
  ePath('E1s', 'E1 with ratio from Shift instead of the toggle', { anchor: 'bottom-right', ratio: 'shift', waypointsMm: [[140, 160], [80, 160], [140, 160]], expect: 'oneEdgeRatio' }),
  ePath('E2', 'ratio, bottom-right, crosses y only (pointer far right)', { anchor: 'bottom-right', waypointsMm: [[170, 130], [170, 80], [170, 130]], expect: 'oneEdgeRatio' }),
  ePath('E3', 'ratio, bottom-right, crosses both (diagonal through the fixed corner)', { anchor: 'bottom-right', waypointsMm: [[140, 130], [80, 85], [140, 130]], expect: 'oneEdgeRatio' }),
  ePath('E4', 'ratio, top-left, crosses x only', { anchor: 'top-left', waypointsMm: [[100, 60], [160, 60], [100, 60]], expect: 'oneEdgeRatio' }),
  ePath('E5', 'ratio + Alt, bottom-right, crosses the centre in x only', { anchor: 'bottom-right', alt: true, waypointsMm: [[140, 160], [100, 160], [140, 160]], expect: 'centredRatio' }),
  ePath('E6', 'ratio + Alt, bottom-right, crosses the centre in y only', { anchor: 'bottom-right', alt: true, waypointsMm: [[180, 130], [180, 100], [180, 130]], expect: 'centredRatio' }),
  ePath('E7', 'ratio + Alt, bottom-right, crosses the centre in both', { anchor: 'bottom-right', alt: true, waypointsMm: [[140, 130], [100, 100], [140, 130]], expect: 'centredRatio' }),
  ePath('E8', 'free corner (no ratio), bottom-right, crosses x only [accepted #11 behaviour]', { anchor: 'bottom-right', ratio: 'off', waypointsMm: [[140, 160], [80, 160], [140, 160]], expect: 'free' }),
  ePath('E9', 'free side, middle-right, crosses the fixed edge [accepted #11 behaviour]', { anchor: 'middle-right', ratio: 'off', waypointsMm: [[140, 115], [80, 115], [140, 115]], expect: 'free' }),
  ePath('E10', 'ratio crossing near the fixed corner (minimum box)', { anchor: 'bottom-right', waypointsMm: [[110, 108], [95, 96], [110, 108]], expect: 'minBox' }),
  ePath('E11', 'ratio crossing on grandfathered 2.5 x 20', { anchor: 'bottom-right', box: { x: 100, y: 100, w: 2.5, h: 20 }, waypointsMm: [[103, 125], [95, 90], [103, 125]], expect: 'grandfathered' }),
  {
    id: 'E12', title: 'one fast move from (150, 140) mm past the fixed corner to (60, 50) mm, then (61, 51) mm', kind: 'real', group: 'E',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: true },
    notes: 'ratio via keepRatio; pointer moves are single jumps (no intermediate events), integer px (510, 476) -> (204, 170) -> (207, 173)',
    expect: 'fast',
    async run(ctx, info) {
      const press = roundPt(info.anchors['bottom-right']);
      await ctx.hover(press);
      await ctx.down();
      await ctx.path(press, mmPx(V100, [150, 140]));
      await ctx.mark('measure');
      await ctx.move(mmPx(V100, [60, 50]));
      await ctx.move(mmPx(V100, [61, 51]));
      await ctx.mark('end');
      await ctx.up();
      return { press };
    },
  },
  {
    id: 'E13', title: 'Alt held, middle-right, 6 centre crossings, start 10.01 x 20 (centre 105.005 mm)', kind: 'real', group: 'E',
    setup: { view: V100, box: { x: 100, y: 100, w: 10.01, h: 20 }, shape: 'rect', keepRatio: false },
    notes: 'free side with Alt (centred), waypoints x 112 then alternating 89.03 / 111.97 mm, y 110 mm, integer px',
    expect: 'centreCarry',
    async run(ctx, info) {
      const press = roundPt(info.anchors['middle-right']);
      const wps = [[112, 110]];
      for (let i = 0; i < 6; i++) wps.push([i % 2 === 0 ? 89.03 : 111.97, 110]);
      wps.push([112, 110]);
      const px = wps.map((p) => mmPx(V100, p));
      await ctx.keyDown('Alt');
      await ctx.hover(press);
      await ctx.down();
      await ctx.path(press, px[0]);
      await ctx.mark('measure');
      for (let i = 1; i < px.length; i++) await ctx.path(px[i - 1], px[i]);
      await ctx.mark('end');
      await ctx.up();
      await ctx.keyUp('Alt');
      return { press, waypointsPx: px };
    },
  },
];

// ---- H: Konva's early-return boundary [-1, 1) px, through real pointer events ----
// Pointer coordinates are integers. The exact sub-pixel extent comes from the node geometry: the box is a canonical
// 32 mm on the tested axis, and the zoom is s = (v + 40) / 32 px/mm, so the node is exactly v + 40 px and a 40 px
// pointer move makes Konva's proposed extent exactly v. Division by 32 and multiplication by 32 are exact in binary.
const H_VALUES = [[-1 - e20, '-1 - 2^-20'], [-1, '-1'], [-1 + e20, '-1 + 2^-20'], [0, '0'], [1 - e20, '+1 - 2^-20'], [1, '+1'], [1 + e20, '+1 + 2^-20']];
const H = [];
for (const dim of ['width', 'height']) {
  for (const [v, label] of H_VALUES) {
    const scale = (v + 40) / 32;
    const anchor = dim === 'width' ? 'middle-right' : 'bottom-center';
    H.push({
      id: `H-${dim === 'width' ? 'w' : 'h'}${label.replace(/ /g, '')}`, title: `${dim} = ${label} px (${anchor})`, kind: 'real', group: 'H',
      setup: { view: { scale, vx: 0, vy: 0 }, box: dim === 'width' ? { x: 100, y: 100, w: 32, h: 30 } : { x: 100, y: 100, w: 40, h: 32 }, shape: 'rect', keepRatio: false },
      boundary: { dim, v, label, anchor },
      notes: `zoom ${scale} px/mm, node ${dim} exactly ${v + 40} px; pointer moves 40 px ${dim === 'width' ? 'left' : 'up'} in one event; the other dimension is ${dim === 'width' ? '30 mm' : '40 mm'} (> 1 px)`,
      async run(ctx, info) {
        const press = roundPt(info.anchors[anchor]);
        await ctx.hover(press);
        await ctx.down();
        await ctx.mark('measure');
        await ctx.move(dim === 'width' ? [press[0] - 40, press[1]] : [press[0], press[1] - 40]);
        await ctx.mark('end');
        await ctx.up();
        return { press };
      },
    });
  }
}

// ---- TH: the D-5 threshold through anchorDragBoundFunc, at 15%, 100% and 800% ----
const ZOOMS = [
  { tag: '15', view: { scale: 0.51, vx: 37.25, vy: 21.5 }, box: { x: 100, y: 100, w: 200, h: 160 } },
  { tag: '100', view: { scale: 3.4, vx: 37.25, vy: 21.5 }, box: { x: 100, y: 100, w: 40, h: 30 } },
  { tag: '800', view: { scale: 27.2, vx: 37.25, vy: 21.5 }, box: { x: 10, y: 10, w: 6, h: 5 } },
];
const TH = [];
for (const z of ZOOMS) {
  TH.push({
    id: `TH-wiggle-${z.tag}`, title: `sub-threshold wiggle at ${z.tag}% then release (no-op path)`, kind: 'real', group: 'TH',
    setup: { view: z.view, box: z.box, shape: 'rect', keepRatio: false }, expect: 'noop',
    notes: 'press bottom-right; moves (+1,0) (+2,0) (+2,+2) (0,+2) (-2,-2) (0,0) px from the press, all < 3 px; release',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      for (const d of [[1, 0], [2, 0], [2, 2], [0, 2], [-2, -2], [0, 0]]) await ctx.move([p[0] + d[0], p[1] + d[1]]);
      await ctx.up();
      return { press: p };
    },
  });
  TH.push({
    id: `TH-cross-${z.tag}`, title: `threshold crossing at ${z.tag}%, Shift pressed below the threshold, then latch`, kind: 'real', group: 'TH',
    setup: { view: z.view, box: z.box, shape: 'rect', keepRatio: false }, expect: 'cross',
    notes: 'press bottom-right; (+1,0) (+2,0) (+2,+2) [pending]; Shift down; (+1,+2) [pending, 2.24 px]; (+2,+3) [3.61 px: crosses, ratio]; (+1,0) and (0,0) [latched: live]; release; Shift up',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      for (const d of [[1, 0], [2, 0], [2, 2]]) await ctx.move([p[0] + d[0], p[1] + d[1]]);
      await ctx.keyDown('Shift');
      await ctx.move([p[0] + 1, p[1] + 2]);
      await ctx.mark('cross');
      await ctx.move([p[0] + 2, p[1] + 3]);
      await ctx.mark('latched');
      await ctx.move([p[0] + 1, p[1]]);
      await ctx.move([p[0], p[1]]);
      await ctx.up();
      await ctx.keyUp('Shift');
      return { press: p };
    },
  });
}

// ---- P1: boundBoxFunc's coordinate space with a zoomed, translated parent Group ----
const P1 = ZOOMS.map((z) => ({
  id: `P1-${z.tag}`, title: `free corner moves at ${z.tag}% with parent Group translated (37.25, 21.5) px`, kind: 'real', group: 'P',
  setup: { view: z.view, box: z.box, shape: 'rect', keepRatio: false }, expect: 'coords',
  notes: 'press bottom-right; 30 px out diagonally, 50 px back; boxes passed to boundBoxFunc compared with the group-transformed node box (absolute stage px)',
  async run(ctx, info) {
    const p = roundPt(info.anchors['bottom-right']);
    await ctx.hover(p);
    await ctx.down();
    await ctx.path(p, [p[0] + 30, p[1] + 24]);
    await ctx.path([p[0] + 30, p[1] + 24], [p[0] - 20, p[1] - 16]);
    await ctx.up();
    return { press: p };
  },
}));

// ---- MT: modifier transitions (segments, centre capture/carry, fixed edges) ----
const MT = [
  {
    id: 'MT1', title: 'corner: free -> Shift (ratio) -> free -> Alt (centred) -> Alt+Shift (centred ratio) -> Shift only -> free', kind: 'real', group: 'MT',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'transitions',
    notes: 'bottom-right; each modifier change is a real key event between pointer moves',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      let cur = p;
      const go = async (q) => { await ctx.path(cur, q); cur = q; };
      await go([510, 470]);
      await ctx.keyDown('Shift'); await go([540, 490]);
      await ctx.keyUp('Shift'); await go([520, 500]);
      await ctx.keyDown('Alt'); await go([550, 480]);
      await ctx.keyDown('Shift'); await go([560, 500]);
      await ctx.keyUp('Alt'); await go([530, 470]);
      await ctx.keyUp('Shift'); await go([500, 460]);
      await ctx.up();
      return { press: p };
    },
  },
  {
    id: 'MT2', title: 'right handle on 30 x 20: free -> Alt pressed -> Alt held -> Alt released (evidence B2)', kind: 'real', group: 'MT',
    setup: { view: V100, box: { x: 20, y: 10, w: 30, h: 20 }, shape: 'rect', keepRatio: false }, expect: 'b2',
    notes: 'middle-right at (170, 68) px; free to 188 px; Alt down; to 194 and 196 px; Alt up; to 204 px',
    async run(ctx, info) {
      const p = roundPt(info.anchors['middle-right']);
      await ctx.hover(p);
      await ctx.down();
      await ctx.path(p, [188, 68]);
      await ctx.mark('alt');
      await ctx.keyDown('Alt');
      await ctx.path([188, 68], [194, 68]);
      await ctx.path([194, 68], [196, 68]);
      await ctx.mark('free');
      await ctx.keyUp('Alt');
      await ctx.path([196, 68], [204, 68]);
      await ctx.up();
      return { press: p };
    },
  },
];

const GF = [
  {
    id: 'GF1', title: 'grandfathered 2.5 x 20, right handle: shrink attempt, enlarge, shrink back (free axis)', kind: 'real', group: 'GF',
    setup: { view: V100, box: { x: 100, y: 100, w: 2.5, h: 20 }, shape: 'rect', keepRatio: false }, expect: 'gf',
    notes: 'middle-right; pointer to 344 px (shrink), 352 px (enlarge), 345 px (shrink again); floor = start width 2.5 mm',
    async run(ctx, info) {
      const p = roundPt(info.anchors['middle-right']);
      await ctx.hover(p);
      await ctx.down();
      await ctx.path(p, [344, p[1]]);
      await ctx.path([344, p[1]], [352, p[1]]);
      await ctx.path([352, p[1]], [345, p[1]]);
      await ctx.up();
      return { press: p };
    },
  },
];

// ---- LC: lifecycle, cancellation, anchors, callback order ----
const ALL8 = ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'];
const LC = [
  {
    id: 'LC1', title: 'transformstart on press (before movement), sin/cos basis, transformend on mouseup, release = last bounded box', kind: 'real', group: 'LC',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'lc1',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      await ctx.mark('pressed');
      await ctx.path(p, [p[0] + 20, p[1] + 12]);
      await ctx.up();
      return { press: p };
    },
  },
  {
    id: 'LC2', title: 'anchor click: press and release without movement', kind: 'real', group: 'LC',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'click',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      await ctx.up();
      return { press: p };
    },
  },
  {
    id: 'LC4', title: 'transformend ignores the mouseup coordinates (synthetic mouseup far away)', kind: 'programmatic', group: 'LC',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'synthUp',
    notes: 'real press and moves; then a synthetic window mouseup at (900, 700) (programmatic, because Playwright releases at the current pointer position); then real moves and a real release',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      await ctx.path(p, [p[0] + 15, p[1] + 10]);
      await ctx.call('syntheticMouseup', [900, 700]);
      await ctx.mark('after');
      await ctx.path([p[0] + 15, p[1] + 10], [p[0] + 25, p[1] + 20]);
      await ctx.up();
      return { press: p };
    },
  },
  {
    id: 'LC5', title: 'stopTransform() mid-gesture: transformend without an event; later moves and the release are inert', kind: 'programmatic', group: 'LC',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'stop',
    notes: 'real press and moves; tr.stopTransform() called programmatically; then real moves and a real release',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      await ctx.path(p, [p[0] + 15, p[1] + 10]);
      await ctx.call('stopTransform');
      await ctx.mark('after');
      await ctx.path([p[0] + 15, p[1] + 10], [p[0] + 25, p[1] + 20]);
      await ctx.up();
      return { press: p };
    },
  },
  {
    id: 'LC6', title: 'destroy() mid-gesture: transformend without an event; the anchor cursor is cleared', kind: 'programmatic', group: 'LC',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'destroy',
    notes: 'real hover (sets the anchor cursor), press and moves; tr.destroy() called programmatically; then real moves and release',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      const cursorHover = await ctx.call('cursor');
      await ctx.down();
      await ctx.path(p, [p[0] + 15, p[1] + 10]);
      const cursorAfter = await ctx.call('destroy');
      await ctx.mark('after');
      await ctx.path([p[0] + 15, p[1] + 10], [p[0] + 25, p[1] + 20]);
      await ctx.up();
      return { press: p, cursorHover, cursorAfter };
    },
  },
  {
    id: 'LC7', title: 'Escape mid-resize (real key): cancel, model attrs restored, the shell never sees it; next Escape reaches the shell', kind: 'real', group: 'LC',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'escape',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      await ctx.path(p, [p[0] + 15, p[1] + 10]);
      await ctx.press('Escape');
      await ctx.mark('after');
      await ctx.path([p[0] + 15, p[1] + 10], [p[0] + 25, p[1] + 20]);
      await ctx.up();
      await ctx.mark('rest');
      await ctx.press('Escape');
      return { press: p };
    },
  },
  {
    id: 'LC8', title: 'window blur mid-resize: cancel and restore', kind: 'programmatic', group: 'LC',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'blur',
    notes: 'real press and moves; a synthetic window blur event (headless browsers do not blur the window on demand); then real moves and release',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      await ctx.path(p, [p[0] + 15, p[1] + 10]);
      await ctx.call('blur');
      await ctx.mark('after');
      await ctx.path([p[0] + 15, p[1] + 10], [p[0] + 25, p[1] + 20]);
      await ctx.up();
      return { press: p };
    },
  },
  {
    id: 'LC9', title: 'Konva.Transformer defaults (keepRatio, flipEnabled, rotateEnabled, shiftBehavior, centeredScaling)', kind: 'programmatic', group: 'LC',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'defaults',
    async run(ctx) { return { defaults: await ctx.call('defaults') }; },
  },
  {
    id: 'LC10', title: 'keepProportion = keepRatio || Shift, applied only in corner branches', kind: 'real', group: 'LC',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: true }, expect: 'cornerOnly',
    notes: 'gesture 1: middle-right with keepRatio on and Shift held; gesture 2: top-center with Shift; gesture 3: bottom-right, keepRatio on, no Shift; gesture 4 (keepRatio off): bottom-right with Shift; gesture 5 (keepRatio off): bottom-right, no Shift',
    async run(ctx) {
      const g = async (keepRatio, anchor, shift, d) => {
        const inf = await ctx.setup({ view: V100, box: S40, shape: 'rect', keepRatio });
        const p = roundPt(inf.anchors[anchor]);
        if (shift) await ctx.keyDown('Shift');
        await ctx.hover(p);
        await ctx.down();
        await ctx.path(p, [p[0] + d[0], p[1] + d[1]]);
        await ctx.up();
        if (shift) await ctx.keyUp('Shift');
      };
      await g(true, 'middle-right', true, [20, 15]);
      await g(true, 'top-center', true, [15, -20]);
      await g(true, 'bottom-right', false, [20, 30]);
      await g(false, 'bottom-right', true, [20, 30]);
      await g(false, 'bottom-right', false, [20, 30]);
      return {};
    },
  },
  {
    id: 'LC11', title: 'all 8 anchors (free): raw box per anchor branch, fixed edges', kind: 'real', group: 'LC',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'anchors',
    notes: 'one gesture per anchor: 15 px outward (both axes), then 30 px back',
    async run(ctx) {
      for (const a of ALL8) {
        const inf = await ctx.setup({ view: V100, box: S40, shape: 'rect', keepRatio: false });
        const p = roundPt(inf.anchors[a]);
        const sx = a.includes('left') ? -1 : a.includes('right') ? 1 : 0, sy = a.startsWith('top') ? -1 : a.startsWith('bottom') ? 1 : 0;
        const out = [p[0] + 15 * (sx || 1), p[1] + 15 * (sy || 1)];
        const back = [p[0] - 15 * (sx || 1), p[1] - 15 * (sy || 1)];
        await ctx.hover(p);
        await ctx.down();
        await ctx.path(p, out);
        await ctx.path(out, back);
        await ctx.up();
      }
      return {};
    },
  },
  {
    id: 'P8', title: 'scale normalisation on an ellipse (x/y centre + radiusX/radiusY), free and ratio', kind: 'real', group: 'P',
    setup: { view: V100, box: S40, shape: 'ellipse', keepRatio: false }, expect: 'ellipse',
    notes: 'gesture 1: bottom-right free; gesture 2: bottom-right with Shift (ratio), crossing x',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      await ctx.path(p, [p[0] + 40, p[1] + 25]);
      await ctx.path([p[0] + 40, p[1] + 25], [p[0] - 30, p[1] - 10]);
      await ctx.up();
      const inf = await ctx.setup({ view: V100, box: S40, shape: 'ellipse', keepRatio: false });
      const q = roundPt(inf.anchors['bottom-right']);
      await ctx.keyDown('Shift');
      await ctx.hover(q);
      await ctx.down();
      await ctx.path(q, [q[0], q[1] + 100]);
      await ctx.path([q[0], q[1] + 100], [q[0] - 200, q[1] + 100]);
      await ctx.path([q[0] - 200, q[1] + 100], [q[0], q[1] + 100]);
      await ctx.up();
      await ctx.keyUp('Shift');
      return {};
    },
  },
];

// ---- C: inner cursor and listening(false); layer hit order ----
const C = [
  {
    id: 'C1', title: 'anchor cursors; listening(false) leaves a stale inner cursor that the session clears; inactive anchors do not transform', kind: 'mixed', group: 'C',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'cursor',
    notes: 'hovers and presses are real pointer events; tr.listening(false/true) and the cursor clear are programmatic (they model SelectionTransformer reacting to Hand/Space)',
    async run(ctx, info) {
      const r = {};
      const A = info.anchors;
      for (const a of ['bottom-right', 'middle-right', 'top-center', 'top-right']) { await ctx.hover(roundPt(A[a])); r['hover:' + a] = await ctx.call('cursor'); }
      await ctx.hover([700, 700]); r['away'] = await ctx.call('cursor');
      await ctx.hover(roundPt(A['bottom-right'])); r['hoverAgain'] = await ctx.call('cursor');
      r['afterListeningFalse'] = await ctx.call('setListening', false);
      r['afterClear'] = await ctx.call('clearInnerCursor');
      await ctx.mark('inactive-press');
      await ctx.down();
      await ctx.move([roundPt(A['bottom-right'])[0] + 20, roundPt(A['bottom-right'])[1] + 20]);
      await ctx.up();
      r['stateInactive'] = await ctx.call('state');
      await ctx.mark('reactivated');
      await ctx.call('setListening', true);
      await ctx.hover([700, 700]);
      await ctx.hover(roundPt(A['bottom-right'])); r['hoverReactivated'] = await ctx.call('cursor');
      await ctx.down();
      await ctx.path(roundPt(A['bottom-right']), [roundPt(A['bottom-right'])[0] + 10, roundPt(A['bottom-right'])[1] + 10]);
      await ctx.up();
      r['destroyAtRest'] = await ctx.call('destroy');
      return r;
    },
  },
  {
    id: 'C2', title: 'layer hit order: the Transformer layer on top takes the anchor press; a listening layer above it would steal it', kind: 'real', group: 'C',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false, overlayCover: [466, 432, 20, 20] }, expect: 'hitOrder',
    notes: 'gesture 1: listening overlay rect covering the bottom-right anchor, overlay layer BELOW the Transformer layer (the plan); gesture 2: the same overlay layer ABOVE the Transformer layer (control)',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p); await ctx.down(); await ctx.path(p, [p[0] + 10, p[1] + 10]); await ctx.up();
      const inf = await ctx.setup({ view: V100, box: S40, shape: 'rect', keepRatio: false, overlayCover: [466, 432, 20, 20], layerOrder: 'overlay-above-transformer' });
      await ctx.mark('control'); // after the setup: a setup resets the phase
      const q = roundPt(inf.anchors['bottom-right']);
      await ctx.hover(q); await ctx.down(); await ctx.path(q, [q[0] + 10, q[1] + 10]); await ctx.up();
      return { press: p };
    },
  },
  {
    id: 'W1', title: 'plain wheel events are delivered during an active transform and do not touch it', kind: 'real', group: 'C',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'wheel',
    notes: 'press bottom-right, cross the threshold, then wheel (0, 120) and (60, 0) with the button held (no preventDefault anywhere), then more moves and release',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      await ctx.path(p, [p[0] + 10, p[1] + 10]);
      const vpBefore = await ctx.call('viewport');
      await ctx.mark('wheel');
      await ctx.wheel(0, 120);
      await ctx.wheel(60, 0);
      const vpAfter = await ctx.call('viewport');
      await ctx.mark('moves');
      await ctx.path([p[0] + 10, p[1] + 10], [p[0] + 20, p[1] + 15]);
      await ctx.up();
      return { press: p, vpBefore, vpAfter, wheels: 2 };
    },
  },
  {
    id: 'W2', title: 'Ctrl+wheel during a transform with the plan\'s freeze (preventDefault while a session is live)', kind: 'real', group: 'C',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false, freezeWheel: true }, expect: 'wheelFrozen',
    notes: 'as W1 with Control held for one wheel (0, -120); a non-passive stage wheel listener calls preventDefault during the session (plan §4.6)',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      await ctx.path(p, [p[0] + 10, p[1] + 10]);
      const vpBefore = await ctx.call('viewport');
      await ctx.mark('wheel');
      await ctx.wheel(0, 120);
      await ctx.keyDown('Control'); await ctx.wheel(0, -120); await ctx.keyUp('Control');
      await ctx.wheel(60, 0);
      const vpAfter = await ctx.call('viewport');
      await ctx.mark('moves');
      await ctx.path([p[0] + 10, p[1] + 10], [p[0] + 20, p[1] + 15]);
      await ctx.up();
      return { press: p, vpBefore, vpAfter, wheels: 3 };
    },
  },
  {
    id: 'W3', title: 'control: the same Ctrl+wheel WITHOUT preventDefault (observation of each browser)', kind: 'real', group: 'C',
    setup: { view: V100, box: S40, shape: 'rect', keepRatio: false }, expect: 'wheelZoomControl',
    notes: 'as W2 but nothing prevents the wheel default; records whether the browser zooms the page and how later pointer input then arrives',
    async run(ctx, info) {
      const p = roundPt(info.anchors['bottom-right']);
      await ctx.hover(p);
      await ctx.down();
      await ctx.path(p, [p[0] + 10, p[1] + 10]);
      const vpBefore = await ctx.call('viewport');
      await ctx.mark('wheel');
      await ctx.wheel(0, 120);
      await ctx.keyDown('Control'); await ctx.wheel(0, -120); await ctx.keyUp('Control');
      await ctx.wheel(60, 0);
      const vpAfter = await ctx.call('viewport');
      await ctx.mark('moves');
      await ctx.path([p[0] + 10, p[1] + 10], [p[0] + 20, p[1] + 15]);
      await ctx.up();
      return { press: p, vpBefore, vpAfter, wheels: 3 };
    },
  },
];

export const CASES = [...E, ...H, ...TH, ...P1, ...MT, ...GF, ...LC, ...C];
