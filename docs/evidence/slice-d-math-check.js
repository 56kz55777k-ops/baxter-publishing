// Slice D plan — isolated validation of the resize maths (plan §3). NOT production code: not imported,
// not linted (docs/ is outside the npm workspaces), not run by CI. Run: node docs/evidence/slice-d-math-check.js
// r2 introduced the integer-hundredths rules; r3 (this version) replaces the simplified Konva model with a
// line-by-line port of Konva 10.3.0's Transformer anchor logic (ratio reverse per axis, centred mirroring,
// 1 px early return, anchor rename), adds crossing-and-return cases, and checks the r3 ratio anchor clamp.
// This is MATHEMATICAL-MODEL evidence. Behaviour in real browsers is verified only by the plan's stage 1 probe.
'use strict';

// ---------- shared helpers (identical to r2) ----------
const nz = (n) => (n === 0 ? 0 : n);
const toH = (mm) => nz(Math.round(mm * 100));
const fromH = (h) => nz(h / 100);
function floorDiv(a, b) {
  // integers, b > 0, |a| < 2^53: float quotient then exact remainder correction
  let q = Math.trunc(a / b);
  const r = a - q * b;
  if (r < 0) q -= 1;
  else if (r >= b) q += 1;
  return q;
}
const ceilDiv = (a, b) => -floorDiv(-a, b);
const roundHalfUpDiv = (a, b) => floorDiv(2 * a + b, 2 * b);
const halfUp2 = (t2) => floorDiv(t2 + 1, 2); // doubled hundredths -> hundredths, ties toward +inf
const quantizeInspector = (mm) => nz(Math.round(mm * 100) / 100); // repo precision.ts
const formatNum = (v) => String(nz(Math.round(v * 100) / 100)); // repo num-field.ts
function formatHInt(h) {
  const neg = h < 0;
  const a = Math.abs(h);
  const i = Math.floor(a / 100);
  const f = a % 100;
  let s = String(i);
  if (f !== 0) s += '.' + String(f).padStart(2, '0').replace(/0$/, '');
  return (neg ? '-' : '') + s;
}
// repo snapping.ts bestSnap, verbatim logic
function bestSnap(candidates, targets, radiusMm = 1.6) {
  let best = null;
  for (const c of candidates) {
    if (c.rate === 0) continue;
    for (const t of targets) {
      const d = Math.abs(t - c.value);
      if (d > radiusMm) continue;
      if (best === null || d < best.distance || (d === best.distance && t < best.guide))
        best = { distance: d, delta: (t - c.value) / c.rate, guide: t };
    }
  }
  return best === null ? null : { delta: best.delta, guide: best.guide };
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- the bounded-move maths (plan §3.3–3.5; unchanged since r2) ----------
const MIN_H = 400;
function axesOf(anchor) {
  return {
    xs: anchor.includes('left') ? -1 : anchor.includes('right') ? 1 : 0,
    ys: anchor.startsWith('top') ? -1 : anchor.startsWith('bottom') ? 1 : 0,
  };
}
function createSession(start, targets2) {
  return {
    start: { ...start },
    prev: { ...start },
    fl: { w: Math.min(MIN_H, start.w), h: Math.min(MIN_H, start.h) },
    seg: null,
    tMm: { x: targets2.x.map((t) => t / 200), y: targets2.y.map((t) => t / 200) },
  };
}
const segKey = (anchor, ratio, alt) => `${anchor}|${ratio}|${alt}`;
let CARRY_CENTRE = true; // r3 rule; set false only to demonstrate r2's per-segment re-capture
function capture(prev, anchor, ratio, alt, prevSeg) {
  const { xs, ys } = axesOf(anchor);
  const g = { key: segKey(anchor, ratio, alt), xs, ys, ratio, alt, carried: false };
  // r3: while Alt stays held across a segment change (anchor rename, ratio toggle), the centre is CARRIED,
  // never re-derived from the rounded box; it is captured from prev only when Alt is newly pressed.
  const carry = CARRY_CENTRE && alt && prevSeg && prevSeg.alt;
  if (xs) {
    if (alt) { g.C2x = carry && prevSeg.C2x !== undefined ? prevSeg.C2x : 2 * prev.x + prev.w; g.carried = g.carried || (carry && prevSeg.C2x !== undefined); }
    else g.Fx = xs > 0 ? prev.x : prev.x + prev.w;
  }
  if (ys) {
    if (alt) { g.C2y = carry && prevSeg.C2y !== undefined ? prevSeg.C2y : 2 * prev.y + prev.h; g.carried = g.carried || (carry && prevSeg.C2y !== undefined); }
    else g.Fy = ys > 0 ? prev.y : prev.y + prev.h;
  }
  return g;
}
function axisFree(s, g, ax, dir, e, alt, floor) {
  if (alt) {
    const C2 = ax === 'x' ? g.C2x : g.C2y;
    let W = toH(2 * dir * (e - C2 / 200));
    if (W < floor) W = floor;
    return { pos: floorDiv(C2 - W, 2), size: W, guide2: null };
  }
  const F = ax === 'x' ? g.Fx : g.Fy;
  let E;
  let guide2 = null;
  const sn = bestSnap([{ value: e, rate: 1 }], s.tMm[ax]);
  if (sn) { guide2 = Math.round(sn.guide * 200); E = halfUp2(guide2); } else E = toH(e);
  if (dir * (E - F) < floor) { E = F + dir * floor; guide2 = null; }
  return { pos: dir > 0 ? F : E, size: dir * (E - F), guide2 };
}
function bound(s, raw, anchor, ratioFlag, alt, anchorMm) {
  const { xs, ys } = axesOf(anchor);
  const ratio = Boolean(ratioFlag && xs && ys);
  if (raw.r - raw.l <= 0 || raw.b - raw.t <= 0) return { box: s.prev, gx: null, gy: null, frozen: true };
  const key = segKey(anchor, ratio, alt);
  if (!s.seg || s.seg.key !== key) s.seg = capture(s.prev, anchor, ratio, alt, s.seg);
  const g = s.seg;
  const S0 = s.start;
  const ex = xs > 0 ? raw.r : raw.l;
  const ey = ys > 0 ? raw.b : raw.t;
  let box = { ...s.prev };
  let gx = null, gy = null, k = null;
  if (ratio) {
    const big = S0.w >= S0.h ? 'x' : 'y';
    // r3: in ratio mode the scale comes from the dragged anchor's position against the segment's own integer
    // reference (fixed corner, or carried centre), mirroring Konva's hypotenuse projection
    // (corner = ref + hyp*(cos, sin)) without Konva's rounded node box. Without an anchor position (direct calls
    // in section B) the raw corner is used, which is identical for one-edge ratio.
    const hyp0H = Math.hypot(S0.w, S0.h);
    const sRaw = anchorMm
      ? alt
        ? (2 * Math.hypot(anchorMm.x * 100 - g.C2x / 2, anchorMm.y * 100 - g.C2y / 2)) / hyp0H
        : Math.hypot(anchorMm.x * 100 - g.Fx, anchorMm.y * 100 - g.Fy) / hyp0H
      : alt
        ? big === 'x' ? (2 * xs * (ex - g.C2x / 200) * 100) / S0.w : (2 * ys * (ey - g.C2y / 200) * 100) / S0.h
        : big === 'x' ? (xs * (ex * 100 - g.Fx)) / S0.w : (ys * (ey * 100 - g.Fy)) / S0.h;
    k = big;
    let kSize;
    let snapped = null;
    if (!alt) {
      const sx = bestSnap([{ value: (g.Fx + xs * S0.w * sRaw) / 100, rate: 1 }], s.tMm.x);
      const sy = bestSnap([{ value: (g.Fy + ys * S0.h * sRaw) / 100, rate: 1 }], s.tMm.y);
      if (sx && sy) k = Math.abs(sx.delta) < Math.abs(sy.delta) ? 'x' : Math.abs(sy.delta) < Math.abs(sx.delta) ? 'y' : big;
      else if (sx) k = 'x';
      else if (sy) k = 'y';
      const sn = k === 'x' ? sx : sy;
      if (sn) {
        const T2 = Math.round(sn.guide * 200);
        const E = halfUp2(T2);
        kSize = k === 'x' ? xs * (E - g.Fx) : ys * (E - g.Fy);
        snapped = { axis: k, guide2: T2 };
      }
    }
    const S0k = k === 'x' ? S0.w : S0.h, S0o = k === 'x' ? S0.h : S0.w;
    const flk = k === 'x' ? s.fl.w : s.fl.h, flo = k === 'x' ? s.fl.h : s.fl.w;
    if (kSize === undefined) kSize = Math.round(S0k * sRaw);
    const kMin = Math.max(flk, ceilDiv(flo * S0k, S0o));
    if (kSize < kMin) { kSize = kMin; snapped = null; }
    const oSize = roundHalfUpDiv(kSize * S0o, S0k);
    const W = k === 'x' ? kSize : oSize, H = k === 'x' ? oSize : kSize;
    box = alt
      ? { x: floorDiv(g.C2x - W, 2), y: floorDiv(g.C2y - H, 2), w: W, h: H }
      : { x: xs > 0 ? g.Fx : g.Fx - W, y: ys > 0 ? g.Fy : g.Fy - H, w: W, h: H };
    if (snapped) { if (snapped.axis === 'x') gx = snapped.guide2; else gy = snapped.guide2; }
  } else {
    if (xs) { const r = axisFree(s, g, 'x', xs, ex, alt, s.fl.w); box.x = r.pos; box.w = r.size; gx = r.guide2; }
    if (ys) { const r = axisFree(s, g, 'y', ys, ey, alt, s.fl.h); box.y = r.pos; box.h = r.size; gy = r.guide2; }
  }
  s.prev = box;
  return { box, gx, gy, k, seg: g };
}

// ---------- Konva 10.3.0 Transformer: line-by-line port of _handleMouseMove (anchor branches + centred
// mirroring) and the start of _fitNodesInto (1 px early return, anchor rename), in absolute stage px.
// Source: node_modules/konva/lib/shapes/Transformer.js, _handleMouseMove lines ~506-688, _fitNodesInto ~713-784.
const CORNERS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
function konvaStep(nodePx, anchor, anchorTargetPx, keepProportion, centeredScaling, sin, cos) {
  const W = nodePx.w, H = nodePx.h;
  // transformer-local coordinates: origin at the node's top-left; anchors sit on the node box
  const tl = { x: 0, y: 0 }, br = { x: W, y: H };
  const a = { x: anchorTargetPx.x - nodePx.x, y: anchorTargetPx.y - nodePx.y }; // anchorNode moved here
  if (CORNERS.has(anchor)) {
    const dx = anchor.includes('left') ? -1 : 1, dy = anchor.startsWith('top') ? -1 : 1;
    let px = a.x, py = a.y;
    if (keepProportion) {
      // comparePoint: the opposite corner of the CURRENT box, or its centre when centred
      const c = centeredScaling ? { x: W / 2, y: H / 2 } : { x: dx < 0 ? W : 0, y: dy < 0 ? H : 0 };
      const hyp = Math.sqrt(Math.pow(c.x - a.x, 2) + Math.pow(c.y - a.y, 2));
      // reverse per axis: -1 when the anchor is strictly on the far side of the comparePoint
      // (top-left: tl.x > c.x ? -1 : 1; top-right: tr.x < c.x ? -1 : 1; bottom-left: c.x < bl.x ? -1 : 1; ...)
      const rx = dx * (a.x - c.x) < 0 ? -1 : 1;
      const ry = dy * (a.y - c.y) < 0 ? -1 : 1;
      px = c.x + dx * hyp * cos * rx;
      py = c.y + dy * hyp * sin * ry;
    }
    if (dx < 0) tl.x = px; else br.x = px;
    if (dy < 0) tl.y = py; else br.y = py;
  } else if (anchor === 'middle-left') tl.x = a.x;
  else if (anchor === 'middle-right') br.x = a.x;
  else if (anchor === 'top-center') tl.y = a.y;
  else if (anchor === 'bottom-center') br.y = a.y;
  if (centeredScaling) {
    const topOffX = tl.x, topOffY = tl.y, botOffX = W - br.x, botOffY = H - br.y;
    br.x -= topOffX; br.y -= topOffY;
    tl.x += botOffX; tl.y += botOffY;
  }
  const raw = { x: nodePx.x + tl.x, y: nodePx.y + tl.y, w: br.x - tl.x, h: br.y - tl.y };
  // _fitNodesInto: Util._inRange(width, -padding*2 - 1, 1) -> this.update(); return  (padding 0)
  if ((raw.w >= -1 && raw.w <= 1) || (raw.h >= -1 && raw.h <= 1)) return { skip: true, anchor };
  let renamed = anchor;
  if (raw.w < 0) renamed = renamed.includes('left') ? renamed.replace('left', 'right') : renamed.replace('right', 'left');
  if (raw.h < 0) renamed = renamed.includes('top') ? renamed.replace('top', 'bottom') : renamed.replace('bottom', 'top');
  return { raw, anchor: renamed, renamed: renamed !== anchor };
}

// ---------- the editor's resize session around Konva (plan §4.3): anchorBound then Konva then boxBound ----------
function newGesture(startH, targets2, anchor, view) {
  const hyp = Math.hypot(startH.w, startH.h);
  return { s: createSession(startH, targets2), anchor, view, sin: startH.h / hyp, cos: startH.w / hyp };
}
const mmToPxX = (mm, v) => mm * v.scale + v.vx;
const mmToPxY = (mm, v) => mm * v.scale + v.vy;
function gestureMove(G, pointerMm, ratioFlag, alt, clampOn) {
  const v = G.view;
  const { xs, ys } = axesOf(G.anchor);
  const ratio = Boolean(ratioFlag && xs && ys);
  // anchorBound: segment key for this move, captured from prev when it changes (plan §3.3)
  const key = segKey(G.anchor, ratio, alt);
  if (!G.s.seg || G.s.seg.key !== key) G.s.seg = capture(G.s.prev, G.anchor, ratio, alt, G.s.seg);
  const g = G.s.seg;
  const target = { x: mmToPxX(pointerMm.x, v), y: mmToPxY(pointerMm.y, v) };
  let clamped = false;
  if (clampOn && ratio && !alt) {
    // r3 (plan §3.5 step 0): the dragged anchor never comes closer to the segment's fixed corner, on either
    // axis, than the minimum box's corner (kMin box, §3.5 step 5.5). Konva therefore never sees a crossing
    // (no negative extent, no rename) and never produces a sub-1 px box (no skipped move): beyond the corner
    // the box is exactly the minimum box, however far or fast the pointer moved.
    const S0 = G.s.start, big = S0.w >= S0.h ? 'x' : 'y';
    const S0k = big === 'x' ? S0.w : S0.h, S0o = big === 'x' ? S0.h : S0.w;
    const flk = big === 'x' ? G.s.fl.w : G.s.fl.h, flo = big === 'x' ? G.s.fl.h : G.s.fl.w;
    const kMin = Math.max(flk, ceilDiv(flo * S0k, S0o)), oMin = roundHalfUpDiv(kMin * S0o, S0k);
    const minW = ((big === 'x' ? kMin : oMin) / 100) * v.scale, minH = ((big === 'x' ? oMin : kMin) / 100) * v.scale;
    const Fx = mmToPxX(g.Fx / 100, v), Fy = mmToPxY(g.Fy / 100, v);
    if (xs * (target.x - Fx) < minW) { target.x = Fx + xs * minW; clamped = true; }
    if (ys * (target.y - Fy) < minH) { target.y = Fy + ys * minH; clamped = true; }
  }
  const P = G.s.prev;
  const nodePx = { x: mmToPxX(P.x / 100, v), y: mmToPxY(P.y / 100, v), w: (P.w / 100) * v.scale, h: (P.h / 100) * v.scale };
  // Konva's keepProportion = keepRatio() || shiftKey; it only acts in corner branches
  const k = konvaStep(nodePx, G.anchor, target, Boolean(ratioFlag), alt, G.sin, G.cos);
  if (k.skip) return { skipped: true, clamped, box: G.s.prev, seg: g };
  G.anchor = k.anchor;
  const rawMm = {
    l: (k.raw.x - v.vx) / v.scale, r: (k.raw.x + k.raw.w - v.vx) / v.scale,
    t: (k.raw.y - v.vy) / v.scale, b: (k.raw.y + k.raw.h - v.vy) / v.scale,
  };
  const anchorMm = { x: (target.x - v.vx) / v.scale, y: (target.y - v.vy) / v.scale };
  const res = bound(G.s, rawMm, k.anchor, ratioFlag, alt, anchorMm);
  return { seg: g, ...res, clamped, renamed: k.renamed, rawW: k.raw.w, rawH: k.raw.h };
}
const hToMmBox = (B) => ({ l: B.x / 100, t: B.y / 100, r: (B.x + B.w) / 100, b: (B.y + B.h) / 100 });
const boxStr = (B) => `[${fromH(B.x)}, ${fromH(B.y)}, ${fromH(B.w)} x ${fromH(B.h)}]`;
const edgeJump = (A, B) => Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.x + A.w - B.x - B.w), Math.abs(A.y + A.h - B.y - B.h)) / 100;

// ---------- r1 (the first reviewed plan), only the parts Codex questioned ----------
function r1Centred(prevMm, rawW, floor) {
  const c = prevMm.x + prevMm.w / 2;
  const w = Math.max(floor, quantizeInspector(rawW));
  return { x: quantizeInspector(c - w / 2), w };
}

const out = [];
const log = (...a) => out.push(a.join(' '));
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; log('  FAIL:', msg); } };

// ===== A. Codex's r1 counterexamples =====
log('A. Codex counterexamples against r1');
{
  let prev = { x: 0, w: 10 };
  const seq = [10.01, 10.02, 10.03, 10.04];
  for (const w of seq) prev = r1Centred(prev, w, 4);
  log(`  A1 r1 centred: start x=0 w=10 (centre 5); after widths ${seq.join(', ')} -> x=${prev.x} w=${prev.w} centre=${+(prev.x + prev.w / 2).toFixed(6)}`);
  const W0 = 4.03, H0 = 4, sc = 1.0087;
  const w = quantizeInspector(W0 * sc), h = quantizeInspector(H0 * sc);
  const exact = (w * H0) / W0;
  log(`  A2 r1 ratio: 4.03x4, s=1.0087 -> ${w} x ${h}; exact h for w=${w} is ${exact.toFixed(6)}; error ${Math.abs(h - exact).toFixed(6)} mm`);
  log(`  A3 float: 0.03 - 0.01 = ${0.03 - 0.01}; integer hundredths: 3 - 1 = 2 -> fromH(2) = ${fromH(2)}`);
}

// ===== B. deterministic examples of the bounded-move maths =====
log('B. deterministic examples (hundredths in brackets)');
const noTargets = { x: [], y: [] };
const V100 = { scale: 3.4, vx: 0, vy: 0 };
const fmtBox = (B) => `x=${fromH(B.x)} y=${fromH(B.y)} w=${fromH(B.w)} h=${fromH(B.h)} [${B.x},${B.y},${B.w},${B.h}]`;
{
  const G = newGesture({ x: 0, y: 0, w: 1000, h: 1000 }, noTargets, 'middle-right', V100);
  const rows = [];
  for (const edge of [10.005, 10.01, 10.015, 10.02]) {
    const { box } = gestureMove(G, { x: edge, y: 5 }, false, true, true);
    const c2 = 2 * box.x + box.w;
    rows.push(`pointer ${edge.toFixed(3)} -> w=${fromH(box.w)} x=${fromH(box.x)} right=${fromH(box.x + box.w)} centre=${c2 / 200} [${box.x},${box.w}]`);
    check(Math.abs(c2 - 1000) <= 1, 'B1 centre within 0.005');
  }
  log('  B1 centred (Alt), x=0 w=10, right handle; Konva mirrors about its own (rounded) node centre, the maths ignores it:');
  for (const r of rows) log('     ' + r);
}
{
  const G = newGesture({ x: 2000, y: 1000, w: 3000, h: 2000 }, noTargets, 'middle-right', V100);
  const a = gestureMove(G, { x: 55.37, y: 20 }, false, false, true).box;
  const b = gestureMove(G, { x: 57.0, y: 20 }, false, true, true).box;
  const c = gestureMove(G, { x: 57.5, y: 20 }, false, true, true).box;
  const d = gestureMove(G, { x: 60.0, y: 20 }, false, false, true).box;
  log('  B2 right handle: free -> Alt pressed -> Alt held -> Alt released');
  log(`     free  to 55.37: ${fmtBox(a)}  (fixed left 20.00)`);
  log(`     Alt   to 57.00: ${fmtBox(b)}  centre captured from previous box = ${(2 * a.x + a.w) / 200}`);
  log(`     Alt   to 57.50: ${fmtBox(c)}  centre = ${(2 * c.x + c.w) / 200}`);
  log(`     free  to 60.00: ${fmtBox(d)}  (fixed left = previous box's left ${fromH(c.x)})`);
  check(a.x === 2000 && a.w === 3537, 'B2a');
  check(Math.abs(2 * b.x + b.w - (2 * a.x + a.w)) <= 1 && Math.abs(2 * c.x + c.w - (2 * a.x + a.w)) <= 1, 'B2 centre stable');
  check(d.x === c.x && d.x + d.w === 6000, 'B2d');
}
{
  const s = createSession({ x: 0, y: 0, w: 403, h: 400 }, noTargets);
  const raw = { l: 0, t: 0, r: 4.03 * 1.0087, b: 4.0 * 1.0087 };
  const { box, k } = bound(s, raw, 'bottom-right', true, false);
  const exact = (box.w * 400) / 403 / 100;
  log(`  B3 ratio 4.03x4, s=1.0087: controlling ${k} -> ${fmtBox(box)}; exact h for w=${fromH(box.w)} is ${exact.toFixed(6)}; error ${Math.abs(box.h / 100 - exact).toFixed(6)} mm`);
  check(Math.abs(box.h / 100 - exact) <= 0.005 + 1e-12, 'B3 G5');
}
{
  const s = createSession({ x: 1000, y: 1000, w: 4000, h: 3000 }, { x: [2 * 6000], y: [] });
  const raw = { l: 10, t: 10, r: 10 + 40 * 1.248, b: 10 + 30 * 1.248 };
  const { box, gx, k } = bound(s, raw, 'bottom-right', true, false);
  log(`  B4 T10 ratio 4:3, target x=60: controlling ${k} -> ${fmtBox(box)} guide x=${gx / 200}`);
  check(box.x === 1000 && box.y === 1000 && box.w === 5000 && box.h === 3750 && gx === 12000, 'B4');
}
{
  const s = createSession({ x: 1000, y: 1000, w: 4000, h: 3000 }, { x: [2 * 6000], y: [2 * 4760] });
  const raw = { l: 10, t: 10, r: 10 + 40 * 1.252, b: 10 + 30 * 1.252 };
  const { box, gy, k } = bound(s, raw, 'bottom-right', true, false);
  log(`  B5 ratio, targets x=60 (corr 0.08) and y=47.60 (corr 0.04): controlling ${k} -> ${fmtBox(box)} guide y=${gy / 200}`);
  check(k === 'y' && box.h === 3760 && box.w === 5013, 'B5');
  const s3 = createSession({ x: 0, y: 0, w: 4000, h: 4000 }, { x: [2 * 5050], y: [2 * 5050] });
  const r3 = bound(s3, { l: 0, t: 0, r: 50, b: 50 }, 'bottom-right', true, false);
  log(`  B5b square 40x40, both edges 0.50 from a target: tie -> larger start axis, equal -> x: controlling ${r3.k} -> ${fmtBox(r3.box)}`);
  check(r3.k === 'x', 'B5b tie');
}
{
  const s = createSession({ x: 0, y: 0, w: 1000, h: 1000 }, noTargets);
  const a = bound(s, { l: 0, t: 0, r: 3.994, b: 10 }, 'middle-right', false, false).box;
  log(`  B6a normal axis, raw right edge 3.994 -> ${fmtBox(a)} (floor 4)`);
  check(a.w === 400, 'B6a');
  const g = createSession({ x: 0, y: 0, w: 250, h: 2000 }, noTargets);
  const g1 = bound(g, { l: 0, t: 0, r: 2.4, b: 20 }, 'middle-right', false, false).box;
  const g2 = bound(g, { l: 0, t: 0, r: 3.2, b: 20 }, 'middle-right', false, false).box;
  log(`  B6b grandfathered 2.5 x 20: shrink to 2.4 -> w=${fromH(g1.w)}; enlarge to 3.2 -> w=${fromH(g2.w)}`);
  check(g1.w === 250 && g2.w === 320, 'B6b');
  const rr = createSession({ x: 0, y: 0, w: 250, h: 2000 }, noTargets);
  const q1 = bound(rr, { l: 0, t: 0, r: 2.5 * 0.9, b: 20 * 0.9 }, 'bottom-right', true, false).box;
  const q2 = bound(rr, { l: 0, t: 0, r: 2.5 * 1.1, b: 20 * 1.1 }, 'bottom-right', true, false).box;
  log(`  B6c ratio on grandfathered 2.5 x 20: s=0.9 -> ${fromH(q1.w)} x ${fromH(q1.h)}; s=1.1 -> ${fromH(q2.w)} x ${fromH(q2.h)}`);
  check(q1.w === 250 && q1.h === 2000 && q2.w === 275 && q2.h === 2200, 'B6c');
}
{
  const G = newGesture({ x: 0, y: 0, w: 3001, h: 2000 }, noTargets, 'bottom-right', V100);
  const { box, k } = gestureMove(G, { x: 33.3, y: 22.1 }, true, true, true);
  const errC = Math.max(Math.abs(2 * box.x + box.w - 3001), Math.abs(2 * box.y + box.h - 2000)) / 200;
  const exactH = (box.w * 2000) / 3001 / 100;
  log(`  B7 ratio+Alt on 30.01 x 20, corner pointer (33.30, 22.10): controlling ${k} -> ${fmtBox(box)}; centre error ${errC} mm; ratio error ${Math.abs(box.h / 100 - exactH).toFixed(6)} mm`);
  check(errC <= 0.005 && Math.abs(box.h / 100 - exactH) <= 0.005 + 1e-12, 'B7');
}
{
  const s = createSession({ x: 0, y: 0, w: 1000, h: 1000 }, { x: [2 * 2000, 2 * 2100], y: [] });
  const a = bound(s, { l: 0, t: 0, r: 20.5, b: 10 }, 'middle-right', false, false);
  log(`  B8a two targets 0.50 mm either side (20.00, 21.00): lower wins -> right edge ${fromH(a.box.x + a.box.w)} guide ${a.gx / 200}`);
  check(a.box.x + a.box.w === 2000, 'B8a');
  const c2 = 2 * 2000 + 1001;
  const s2 = createSession({ x: 0, y: 0, w: 1000, h: 1000 }, { x: [c2], y: [] });
  const b = bound(s2, { l: 0, t: 0, r: 25.3, b: 10 }, 'middle-right', false, false);
  log(`  B8b target = centre of a 10.01-wide element at 20.00 (25.005): right edge ${fromH(b.box.x + b.box.w)} guide ${b.gx / 200} (|diff| ${(Math.abs(2 * (b.box.x + b.box.w) - b.gx) / 200).toFixed(3)} mm)`);
  check(Math.abs(2 * (b.box.x + b.box.w) - b.gx) <= 1, 'B8b');
}
{
  const s = createSession({ x: 0, y: 0, w: 1000, h: 1000 }, { x: [2 * 300], y: [] });
  const a = bound(s, { l: 0, t: 0, r: 3.5, b: 10 }, 'middle-right', false, false);
  log(`  B9 target at 3.00 within the 4 mm floor: w=${fromH(a.box.w)} guide=${a.gx}`);
  check(a.box.w === 400 && a.gx === null, 'B9');
}

// ===== C. representation (exhaustive) =====
log('C. representation (exhaustive over -2000.00 .. 2000.00 mm)');
{
  let bad = 0;
  for (let h = -200000; h <= 200000; h++) {
    const v = fromH(h);
    if (toH(v) !== h || quantizeInspector(v) !== v || formatNum(v) !== formatHInt(h) || v !== Number(formatHInt(h))) bad++;
  }
  log(`  toH(fromH(h))===h, quantizeInspector(fromH(h))===fromH(h), formatNum(fromH(h))===integer formatting: ${bad} mismatches in 400001 values`);
  check(bad === 0, 'C exhaustive');
  const R = rng(7);
  let badSum = 0, maxFloatDiff = 0;
  for (let i = 0; i < 200000; i++) {
    const a = Math.floor(R() * 60000) - 10000, b = Math.floor(R() * 30000) + 1;
    if (toH(fromH(a) + fromH(b)) !== a + b) badSum++;
    maxFloatDiff = Math.max(maxFloatDiff, Math.abs(fromH(a) + fromH(b) - fromH(a + b)));
  }
  log(`  toH(x + w) === hx + hw for 200000 random canonical pairs: ${badSum} mismatches; max |float(x+w) - canonical(x+w)| = ${maxFloatDiff.toExponential(2)} mm`);
  check(badSum === 0, 'C sums');
}

// ===== D. Konva port sanity (finding 1 of the r2 review) =====
log('D. Konva port: ratio corner reverse per axis (node 40 x 30 at (100,100) mm, 100% zoom, bottom-right anchor)');
{
  const v = V100;
  const node = { x: 100 * 3.4, y: 100 * 3.4, w: 40 * 3.4, h: 30 * 3.4 };
  const hyp0 = Math.hypot(40, 30);
  const cases = [
    ['natural quadrant (130, 160)', { x: 130, y: 160 }, false],
    ['crossed x only   (90, 160)', { x: 90, y: 160 }, false],
    ['crossed y only   (130, 90)', { x: 130, y: 90 }, false],
    ['crossed both     (90, 90)', { x: 90, y: 90 }, false],
    ['Alt, crossed centre in x (110, 160)', { x: 110, y: 160 }, true],
    ['Alt, crossed centre in both (110, 105)', { x: 110, y: 105 }, true],
  ];
  for (const [name, p, alt] of cases) {
    const k = konvaStep(node, 'bottom-right', { x: p.x * 3.4, y: p.y * 3.4 }, true, alt, 30 / hyp0, 40 / hyp0);
    log(`  ${name}: raw w=${(k.raw.w / v.scale).toFixed(3)} h=${(k.raw.h / v.scale).toFixed(3)} mm -> anchor ${k.anchor}${k.renamed ? ' (renamed)' : ''}`);
  }
  const kx = konvaStep(node, 'bottom-right', { x: 90 * 3.4, y: 160 * 3.4 }, true, false, 30 / hyp0, 40 / hyp0);
  check(kx.raw.w < 0 && kx.raw.h > 0 && kx.anchor === 'bottom-left', 'D crossed-x gives negative width and rename');
  const kb = konvaStep(node, 'bottom-right', { x: 90 * 3.4, y: 90 * 3.4 }, true, false, 30 / hyp0, 40 / hyp0);
  check(kb.raw.w < 0 && kb.raw.h < 0 && kb.anchor === 'top-left', 'D crossed-both gives negative extents and rename');
}

// ===== E. crossing-and-return paths: r2 (freeze + Konva rename) vs r3 (ratio anchor clamp) =====
log('E. crossing-and-return paths (start 40 x 30 at (100,100) mm, 100% zoom, no snap targets, 0.2 mm pointer steps)');
function linePath(p0, p1, step) {
  const n = Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / step);
  const pts = [];
  for (let i = 1; i <= n; i++) pts.push({ x: p0.x + ((p1.x - p0.x) * i) / n, y: p0.y + ((p1.y - p0.y) * i) / n });
  return pts;
}
function anchorPos(B, anchor) {
  const n = hToMmBox(B); const { xs, ys } = axesOf(anchor);
  return { x: xs > 0 ? n.r : xs < 0 ? n.l : (n.l + n.r) / 2, y: ys > 0 ? n.b : ys < 0 ? n.t : (n.t + n.b) / 2 };
}
function runPath(start, anchor, waypoints, ratio, alt, clampOn) {
  const G = newGesture(start, noTargets, anchor, V100);
  // lead-in: from the handle's real position to the first waypoint (not measured)
  for (const p of linePath(anchorPos(start, anchor), waypoints[0], 0.2)) gestureMove(G, p, ratio, alt, clampOn);
  const leadIn = { ...G.s.prev };
  const pts = [];
  for (let i = 0; i + 1 < waypoints.length; i++) pts.push(...linePath(waypoints[i], waypoints[i + 1], 0.2));
  const log2 = { freezes: 0, renames: 0, clamps: 0, skips: 0, segs: 0, maxJump: 0, jumpAt: null, boxes: [], floorViol: 0, refViol: 0, runC2: null, maxRunCentreErr: 0 };
  let prevBox = { ...leadIn };
  let lastKey = null;
  log2.boxes.push({ ...leadIn });
  for (const p of pts) {
    const r = gestureMove(G, p, ratio, alt, clampOn);
    if (r.clamped) log2.clamps++;
    if (r.skipped) { log2.skips++; log2.boxes.push({ ...prevBox }); continue; }
    if (r.frozen) log2.freezes++;
    if (r.renamed) log2.renames++;
    if (r.seg && r.seg.key !== lastKey) { log2.segs++; lastKey = r.seg.key; }
    const B = r.box;
    if (B.w < G.s.fl.w || B.h < G.s.fl.h) log2.floorViol++;
    if (!r.frozen && r.seg && !r.seg.alt) {
      if (r.seg.xs && (r.seg.xs > 0 ? B.x : B.x + B.w) !== r.seg.Fx) log2.refViol++;
      if (r.seg.ys && (r.seg.ys > 0 ? B.y : B.y + B.h) !== r.seg.Fy) log2.refViol++;
    }
    if (!r.frozen && r.seg && r.seg.alt) {
      if (r.seg.xs && Math.abs(2 * B.x + B.w - r.seg.C2x) > 1) log2.refViol++;
      if (r.seg.ys && Math.abs(2 * B.y + B.h - r.seg.C2y) > 1) log2.refViol++;
      if (!log2.runC2) log2.runC2 = { x: r.seg.C2x, y: r.seg.C2y };
      if (r.seg.xs) log2.maxRunCentreErr = Math.max(log2.maxRunCentreErr, Math.abs(2 * B.x + B.w - log2.runC2.x) / 200);
      if (r.seg.ys) log2.maxRunCentreErr = Math.max(log2.maxRunCentreErr, Math.abs(2 * B.y + B.h - log2.runC2.y) / 200);
    }
    const j = edgeJump(prevBox, B);
    if (j > log2.maxJump) { log2.maxJump = j; log2.jumpAt = { p, from: { ...prevBox }, to: { ...B } }; }
    prevBox = { ...B };
    log2.boxes.push({ ...B });
  }
  // recovery: the out-and-back path is symmetric, so box i on the way out should equal box (n-1-i) on the way back
  const n = log2.boxes.length;
  let mismatch = 0;
  for (let i = 0; i < (n - 1) / 2; i++) {
    const A = log2.boxes[i], B = log2.boxes[n - 1 - i];
    if (A.x !== B.x || A.y !== B.y || A.w !== B.w || A.h !== B.h) mismatch++;
  }
  log2.start = leadIn;
  log2.returnMismatch = mismatch;
  log2.final = log2.boxes[n - 1];
  log2.anchorEnd = G.anchor;
  return log2;
}
const S40 = { x: 10000, y: 10000, w: 4000, h: 3000 };
const crossingCases = [
  // name, anchor, out-and-back waypoints (pointer in mm), ratio, alt
  ['E1 ratio, bottom-right, crosses x only (pointer far below)', 'bottom-right', [{ x: 140, y: 160 }, { x: 80, y: 160 }, { x: 140, y: 160 }], true, false],
  ['E2 ratio, bottom-right, crosses y only (pointer far right)', 'bottom-right', [{ x: 170, y: 130 }, { x: 170, y: 80 }, { x: 170, y: 130 }], true, false],
  ['E3 ratio, bottom-right, crosses both (diagonal through the fixed corner)', 'bottom-right', [{ x: 140, y: 130 }, { x: 80, y: 85 }, { x: 140, y: 130 }], true, false],
  ['E4 ratio, top-left, crosses x only', 'top-left', [{ x: 100, y: 60 }, { x: 160, y: 60 }, { x: 100, y: 60 }], true, false],
  ['E5 ratio+Alt, bottom-right, crosses the centre in x only', 'bottom-right', [{ x: 140, y: 160 }, { x: 100, y: 160 }, { x: 140, y: 160 }], true, true],
  ['E6 ratio+Alt, bottom-right, crosses the centre in y only', 'bottom-right', [{ x: 180, y: 130 }, { x: 180, y: 100 }, { x: 180, y: 130 }], true, true],
  ['E7 ratio+Alt, bottom-right, crosses the centre in both', 'bottom-right', [{ x: 140, y: 130 }, { x: 100, y: 100 }, { x: 140, y: 130 }], true, true],
  ['E8 free corner (no ratio), bottom-right, crosses x only [accepted #11 behaviour]', 'bottom-right', [{ x: 140, y: 160 }, { x: 80, y: 160 }, { x: 140, y: 160 }], false, false],
  ['E9 free side, middle-right, crosses the fixed edge [accepted #11 behaviour]', 'middle-right', [{ x: 140, y: 115 }, { x: 80, y: 115 }, { x: 140, y: 115 }], false, false],
];
const crossingResults = {};
for (const [name, anchor, wps, ratio, alt] of crossingCases) {
  const r2 = runPath(S40, anchor, wps, ratio, alt, false);
  const r3 = runPath(S40, anchor, wps, ratio, alt, true);
  crossingResults[name] = { r2, r3 };
  log(`  ${name}`);
  for (const [lab, R] of [['r2', r2], ['r3', r3]]) {
    const ja = R.jumpAt ? ` at pointer (${R.jumpAt.p.x.toFixed(1)}, ${R.jumpAt.p.y.toFixed(1)}): ${boxStr(R.jumpAt.from)} -> ${boxStr(R.jumpAt.to)}` : '';
    log(`     ${lab}: freezes ${R.freezes}, renames ${R.renames}, clamped moves ${R.clamps}, segments ${R.segs}, floor violations ${R.floorViol}, reference violations ${R.refViol}, out/back mismatches ${R.returnMismatch}; at waypoint 0 ${boxStr(R.start)} -> back at waypoint 0 ${boxStr(R.final)}, end anchor ${R.anchorEnd}`);
    log(`         max edge jump per 0.2 mm pointer step ${R.maxJump.toFixed(2)} mm${ja}`);
  }
}
{
  const r = (n) => crossingResults[n];
  // r3: one-edge ratio never reaches Konva's reverse, never freezes or renames, is continuous and recovers exactly
  for (const n of ['E1 ratio, bottom-right, crosses x only (pointer far below)', 'E2 ratio, bottom-right, crosses y only (pointer far right)', 'E3 ratio, bottom-right, crosses both (diagonal through the fixed corner)', 'E4 ratio, top-left, crosses x only']) {
    const R3 = r(n).r3;
    check(R3.freezes === 0 && R3.renames === 0 && R3.returnMismatch === 0 && R3.floorViol === 0 && R3.refViol === 0 && R3.maxJump <= 1.0, `${n} r3`);
  }
  // r2 on the same paths: the defect the corrected model exposes (re-anchoring jump in one-edge ratio)
  check(r('E1 ratio, bottom-right, crosses x only (pointer far below)').r2.maxJump > 5 && r('E1 ratio, bottom-right, crosses x only (pointer far below)').r2.returnMismatch > 0, 'E1 r2 defect reproduced');
  // centred ratio: Konva's freeze + rename is continuous and recovers (r3 keeps it)
  for (const n of ['E5 ratio+Alt, bottom-right, crosses the centre in x only', 'E6 ratio+Alt, bottom-right, crosses the centre in y only', 'E7 ratio+Alt, bottom-right, crosses the centre in both']) {
    const R3 = r(n).r3;
    check(R3.freezes >= 1 && R3.renames >= 1 && R3.returnMismatch === 0 && R3.floorViol === 0 && R3.refViol === 0 && R3.maxJump <= 1.0, `${n} r3`);
  }
  // free axes: unchanged accepted #11 behaviour (freeze + rename at the floor, continuous)
  for (const n of ['E8 free corner (no ratio), bottom-right, crosses x only [accepted #11 behaviour]', 'E9 free side, middle-right, crosses the fixed edge [accepted #11 behaviour]']) {
    const R3 = r(n).r3;
    check(R3.freezes >= 1 && R3.renames >= 1 && R3.floorViol === 0 && R3.refViol === 0 && R3.maxJump <= 1.0, `${n} r3 continuity`);
  }
}
{
  // floors and grandfathering under the clamp: crossing near the corner holds the floor; a grandfathered shape cannot shrink
  const nearCorner = runPath(S40, 'bottom-right', [{ x: 110, y: 108 }, { x: 95, y: 96 }, { x: 110, y: 108 }], true, false, true);
  const minBox = nearCorner.boxes.reduce((m, B) => (B.w < m.w ? B : m), nearCorner.boxes[0]);
  log(`  E10 ratio crossing near the fixed corner (r3): smallest box ${boxStr(minBox)} (kMin = ceil(4.00 x 40/30) = 5.34 on the controlling axis; dependent 4.005 -> 4.01); freezes ${nearCorner.freezes}, renames ${nearCorner.renames}, out/back mismatches ${nearCorner.returnMismatch}`);
  check(minBox.w === 534 && minBox.h === 401 && nearCorner.freezes === 0 && nearCorner.returnMismatch === 0, 'E10');
  const GF = { x: 10000, y: 10000, w: 250, h: 2000 };
  const gf = runPath(GF, 'bottom-right', [{ x: 103, y: 125 }, { x: 95, y: 90 }, { x: 103, y: 125 }], true, false, true);
  const gmin = gf.boxes.reduce((m, B) => (B.h < m.h ? B : m), gf.boxes[0]);
  log(`  E11 ratio crossing on grandfathered 2.5 x 20 (r3): smallest box ${boxStr(gmin)}; freezes ${gf.freezes}, renames ${gf.renames}, out/back mismatches ${gf.returnMismatch}`);
  check(gmin.w === 250 && gmin.h === 2000 && gf.freezes === 0 && gf.returnMismatch === 0, 'E11');
  // E12: the pointer jumps past the fixed corner in ONE move (fast mouse); r3 lands exactly on the minimum box
  for (const clampOn of [false, true]) {
    const G = newGesture(S40, noTargets, 'bottom-right', V100);
    const a = gestureMove(G, { x: 150, y: 140 }, true, false, clampOn);
    const b = gestureMove(G, { x: 60, y: 50 }, true, false, clampOn);
    const c = gestureMove(G, { x: 61, y: 51 }, true, false, clampOn);
    log(`  E12 ${clampOn ? 'r3' : 'r2'} one-move jump from (150,140) to (60,50) then (61,51): ${boxStr(a.box)} -> ${b.skipped ? 'Konva skipped' : b.frozen ? 'frozen' : 'bounded'} ${boxStr(b.box)} -> ${c.skipped ? 'Konva skipped' : c.frozen ? 'frozen' : 'bounded'} ${boxStr(c.box)}, anchor ${G.anchor}`);
    if (clampOn) check(b.box.w === 534 && b.box.h === 401 && b.box.x === 10000 && b.box.y === 10000 && !b.frozen && !b.skipped && G.anchor === 'bottom-right', 'E12 r3 lands on the minimum box at the fixed corner');
  }
  // E13: Alt held, right handle, pointer crosses the centre back and forth 6 times (each crossing renames the anchor)
  for (const carry of [false, true]) {
    CARRY_CENTRE = carry;
    const start = { x: 10000, y: 10000, w: 1001, h: 2000 };
    const wps = [{ x: 112, y: 110 }];
    for (let i = 0; i < 6; i++) wps.push({ x: i % 2 === 0 ? 89.03 : 111.97, y: 110 });
    wps.push({ x: 112, y: 110 });
    const R = runPath(start, 'middle-right', wps, false, true, true);
    log(`  E13 Alt held, 6 centre crossings, start centre 105.005 (${carry ? 'r3: centre carried' : 'r2: centre re-captured per segment'}): segments ${R.segs}, renames ${R.renames}, max centre error vs the first centre ${R.maxRunCentreErr.toFixed(3)} mm, final ${boxStr(R.final)}`);
    if (carry) check(R.maxRunCentreErr <= 0.005, 'E13 r3 centre carried across renames');
    else check(R.maxRunCentreErr > 0.005, 'E13 r2 creep reproduced');
  }
  CARRY_CENTRE = true;
}

// ===== F. seeded random gestures through the Konva port: r3 properties; r2 comparison =====
log('F. seeded random gestures through the Konva port');
{
  const ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'];
  const geomT2 = { x: [], y: [] };
  for (const off of [0, 148]) for (const v of [off, off + 148, off + 74, off + 12, off + 136]) geomT2.x.push(2 * toH(v));
  for (const v of [0, 210, 105, 12, 198]) geomT2.y.push(2 * toH(v));
  const N = 4000;
  const runAll = (clampOn) => {
    const st = { maxRunCentreErr: 0, gestures: 0, moves: 0, skips: 0, segs: 0, freezes: 0, renames: 0, clamped: 0, oneEdgeRatioFreezes: 0, oneEdgeRatioRenames: 0, oneEdgeRatioSkips: 0, oneEdgeRatioMaxJump: 0, maxCentreErr: 0, maxRatioErr: 0, maxGuideErr: 0, fixedViol: 0, floorViol: 0, nonInt: 0, undersizedShrink: 0, payload: 0, pxRoundTrip: 0, nondet: 0 };
    for (let seed = 1; seed <= N; seed++) {
      const run = () => {
        const R = rng(seed);
        const gh = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
        const undersized = R() < 0.25;
        const start = { x: gh(-2000, 28000), y: gh(-1000, 20000), w: undersized && R() < 0.6 ? gh(150, 399) : gh(400, 12000), h: undersized && R() < 0.6 ? gh(150, 399) : gh(400, 12000) };
        const t2 = { x: geomT2.x.slice(), y: geomT2.y.slice() };
        for (let i = 0; i < 3; i++) { const bx = gh(0, 28000), bw = gh(100, 5001), by = gh(0, 20000), bh = gh(100, 5001); t2.x.push(2 * bx, 2 * (bx + bw), 2 * bx + bw); t2.y.push(2 * by, 2 * (by + bh), 2 * by + bh); }
        const view = { scale: 0.51 + R() * 26.69, vx: R() * 400 - 200, vy: R() * 300 - 150 };
        let anchor = ANCHORS[gh(0, 7)];
        const G = newGesture(start, t2, anchor, view);
        let ratioOn = R() < 0.4, alt = R() < 0.3;
        let p = (() => { const n = hToMmBox(start); const { xs, ys } = axesOf(anchor); return { x: xs > 0 ? n.r : xs < 0 ? n.l : (n.l + n.r) / 2, y: ys > 0 ? n.b : ys < 0 ? n.t : (n.t + n.b) / 2 }; })();
        const trace = [];
        let lastKey = null;
        let prevBox = { ...start };
        let runC2 = null;
        for (let m = 0; m < 40; m++) {
          if (R() < 0.08) ratioOn = !ratioOn;
          if (R() < 0.08) alt = !alt;
          const jump = R() < 0.1 ? 15 : 2.5;
          p = { x: p.x + (R() * 2 - 1) * jump, y: p.y + (R() * 2 - 1) * jump };
          const res = gestureMove(G, p, ratioOn, alt, clampOn);
          const B = res.box;
          trace.push(B.x, B.y, B.w, B.h);
          const g = res.seg;
          const oneEdgeRatio = g && g.ratio && !g.alt;
          if (res.clamped) st.clamped++;
          if (res.skipped) { st.skips++; if (oneEdgeRatio) st.oneEdgeRatioSkips++; continue; }
          if (res.frozen) { st.freezes++; if (oneEdgeRatio) st.oneEdgeRatioFreezes++; }
          if (res.renamed) { st.renames++; if (oneEdgeRatio) st.oneEdgeRatioRenames++; }
          if (res.frozen) continue;
          st.moves++;
          if (g.key !== lastKey) { st.segs++; lastKey = g.key; }
          if (![B.x, B.y, B.w, B.h].every(Number.isInteger)) st.nonInt++;
          if (B.w < G.s.fl.w || B.h < G.s.fl.h) st.floorViol++;
          if ((start.w < 400 && B.w < start.w) || (start.h < 400 && B.h < start.h)) st.undersizedShrink++;
          if (g.ratio && (start.w < 400 || start.h < 400) && (B.w < start.w || B.h < start.h)) st.undersizedShrink++;
          if (!g.alt) {
            if (g.xs && (g.xs > 0 ? B.x : B.x + B.w) !== g.Fx) st.fixedViol++;
            if (g.ys && (g.ys > 0 ? B.y : B.y + B.h) !== g.Fy) st.fixedViol++;
          } else {
            if (g.xs) st.maxCentreErr = Math.max(st.maxCentreErr, Math.abs(2 * B.x + B.w - g.C2x) / 200);
            if (g.ys) st.maxCentreErr = Math.max(st.maxCentreErr, Math.abs(2 * B.y + B.h - g.C2y) / 200);
            if (!runC2 || !g.carried) runC2 = g.carried ? runC2 : { x: g.C2x, y: g.C2y };
            if (runC2 && g.xs && runC2.x !== undefined) st.maxRunCentreErr = Math.max(st.maxRunCentreErr, Math.abs(2 * B.x + B.w - runC2.x) / 200);
            if (runC2 && g.ys && runC2.y !== undefined) st.maxRunCentreErr = Math.max(st.maxRunCentreErr, Math.abs(2 * B.y + B.h - runC2.y) / 200);
          }
          if (!g.alt) runC2 = null;
          if (g.ratio) {
            const [ks, os, S0k, S0o] = res.k === 'x' ? [B.w, B.h, start.w, start.h] : [B.h, B.w, start.h, start.w];
            st.maxRatioErr = Math.max(st.maxRatioErr, Math.abs(os - (ks * S0o) / S0k) / 100);
          }
          if (res.gx !== null) st.maxGuideErr = Math.max(st.maxGuideErr, Math.abs(2 * (g.xs > 0 ? B.x + B.w : B.x) - res.gx) / 200);
          if (res.gy !== null) st.maxGuideErr = Math.max(st.maxGuideErr, Math.abs(2 * (g.ys > 0 ? B.y + B.h : B.y) - res.gy) / 200);
          for (const off of [0, 14800]) {
            const hs = [B.x - off, B.y, B.w, B.h];
            for (const h of hs) { const v = fromH(h); if (toH(v) !== h || formatNum(v) !== formatHInt(h) || quantizeInspector(v) !== v) st.payload++; }
          }
          for (const [mm, o] of [[B.x / 100, view.vx], [(B.x + B.w) / 100, view.vx], [B.y / 100, view.vy], [(B.y + B.h) / 100, view.vy]]) {
            const back = ((mm * view.scale + o) - o) / view.scale;
            if (Math.abs(back * 100 - Math.round(mm * 100)) > 1e-6) st.pxRoundTrip++;
          }
          if (oneEdgeRatio) st.oneEdgeRatioMaxJump = Math.max(st.oneEdgeRatioMaxJump, edgeJump(prevBox, B));
          prevBox = { ...B };
        }
        return trace.join(',');
      };
      const a = run();
      const b = run();
      if (a !== b) st.nondet++;
      st.gestures++;
    }
    return st;
  };
  const s3 = runAll(true);
  CARRY_CENTRE = false;
  const s2 = runAll(false);
  CARRY_CENTRE = true;
  log(`  r3 (with the ratio anchor clamp): ${s3.gestures} gestures, ${s3.moves} bounded moves, ${s3.segs} segments, ${s3.skips} Konva 1 px early returns, ${s3.freezes} freezes, ${s3.renames} renames, ${s3.clamped} clamped moves`);
  log(`      one-edge ratio: freezes ${s3.oneEdgeRatioFreezes}, renames ${s3.oneEdgeRatioRenames}, Konva 1 px skips ${s3.oneEdgeRatioSkips}`);
  log(`      non-integer outputs ${s3.nonInt} | floor violations ${s3.floorViol} | undersized shrink ${s3.undersizedShrink} | fixed-edge changes within a segment ${s3.fixedViol}`);
  log(`      max centre error per segment ${s3.maxCentreErr} mm, per continuous Alt hold ${s3.maxRunCentreErr} mm | max ratio error ${s3.maxRatioErr.toFixed(6)} mm | max snapped-edge vs guide ${s3.maxGuideErr} mm`);
  log(`      payload canonical/format mismatches ${s3.payload} | px round-trip failures ${s3.pxRoundTrip} | nondeterministic reruns ${s3.nondet}`);
  log(`  r2 (no clamp, centre re-captured per segment), same gestures: ${s2.moves} bounded moves, ${s2.freezes} freezes, ${s2.renames} renames; one-edge ratio: freezes ${s2.oneEdgeRatioFreezes}, renames ${s2.oneEdgeRatioRenames}, Konva 1 px skips ${s2.oneEdgeRatioSkips}`);
  log(`      centre error per continuous Alt hold ${s2.maxRunCentreErr} mm; other properties: non-integer ${s2.nonInt}, floor ${s2.floorViol}, undersized ${s2.undersizedShrink}, fixed-edge ${s2.fixedViol}, centre per segment ${s2.maxCentreErr}, ratio ${s2.maxRatioErr.toFixed(6)}, guide ${s2.maxGuideErr}`);
  check(s3.nonInt === 0 && s3.floorViol === 0 && s3.undersizedShrink === 0 && s3.fixedViol === 0, 'F integer/floor/fixed');
  check(s3.maxCentreErr <= 0.005 && s3.maxRunCentreErr <= 0.005 && s3.maxRatioErr <= 0.005 + 1e-12 && s3.maxGuideErr <= 0.005, 'F tolerances');
  check(s3.payload === 0 && s3.pxRoundTrip === 0 && s3.nondet === 0, 'F payload/px/determinism');
  check(s3.oneEdgeRatioFreezes === 0 && s3.oneEdgeRatioRenames === 0 && s3.oneEdgeRatioSkips === 0, 'F r3 one-edge ratio never freezes, renames or is skipped');
}

// ===== G. r1 shadow (unchanged from r2's evidence) =====
log('G. r1 shadow runs');
{
  const N = 4000;
  const r1 = { centredMoves: 0, centreDriftViol: 0, maxDrift: 0, ratioMoves: 0, ratioViol: 0, maxRatioErr: 0 };
  for (let seed = 1; seed <= N; seed++) {
    const R = rng(1e6 + seed);
    const gh = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
    let prev = { x: gh(0, 20000) / 100, w: gh(400, 8000) / 100 };
    const c0 = prev.x + prev.w / 2;
    let px = prev.x + prev.w;
    for (let m = 0; m < 40; m++) {
      px += (R() * 2 - 1) * 2.5;
      const cNode = prev.x + prev.w / 2;
      const rawW = 2 * (px - cNode);
      if (rawW <= 0) break;
      prev = r1Centred(prev, rawW, 4);
      r1.centredMoves++;
      const drift = Math.abs(prev.x + prev.w / 2 - c0);
      r1.maxDrift = Math.max(r1.maxDrift, drift);
      if (drift > 0.005 + 1e-9) r1.centreDriftViol++;
    }
    const W0 = gh(400, 8000) / 100, H0 = gh(400, 8000) / 100;
    for (let m = 0; m < 10; m++) {
      const sc = 0.5 + R() * 1.5;
      const sf = Math.max(sc, 4 / W0, 4 / H0);
      const w = quantizeInspector(W0 * sf), h = quantizeInspector(H0 * sf);
      const err = W0 >= H0 ? Math.abs(h - (w * H0) / W0) : Math.abs(w - (h * W0) / H0);
      r1.ratioMoves++;
      r1.maxRatioErr = Math.max(r1.maxRatioErr, err);
      if (err > 0.005 + 1e-9) r1.ratioViol++;
    }
  }
  log(`  r1: centred moves ${r1.centredMoves}, centre-drift > 0.005 mm in ${r1.centreDriftViol} (max drift ${r1.maxDrift.toFixed(3)} mm)`);
  log(`      unsnapped ratio moves ${r1.ratioMoves}, dependent error > 0.005 mm in ${r1.ratioViol} (max ${r1.maxRatioErr.toFixed(6)} mm)`);
}

log(failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) FAILED`);
console.log(out.join('\n'));
process.exitCode = failures === 0 ? 0 : 1;
