// Slice D plan r2 — isolated validation of the resize maths. NOT production code: not imported,
// not linted (docs/ is outside the npm workspaces), not run by CI. Run: node docs/evidence/slice-d-r2-math-check.js
// It reproduces Codex's r1 counterexamples and checks the r2 integer-hundredths rules (plan §3).
'use strict';
/*
 * Slice D r2 maths — isolated validation (NOT production code).
 * Reproduces Codex's three counterexamples against the r1 algorithm, then
 * checks the r2 integer-hundredths algorithm with deterministic examples and
 * seeded random gestures driven through a simplified model of Konva 10.3.0's
 * Transformer (one-edge, centred, keepRatio corner behaviour, anchor rename).
 */

// ---------- shared helpers ----------
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

// ---------- r2: integer-hundredths session ----------
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
function capture(prev, anchor, ratio, alt) {
  const { xs, ys } = axesOf(anchor);
  const g = { key: `${anchor}|${ratio}|${alt}`, xs, ys, ratio, alt };
  if (xs) { if (alt) g.C2x = 2 * prev.x + prev.w; else g.Fx = xs > 0 ? prev.x : prev.x + prev.w; }
  if (ys) { if (alt) g.C2y = 2 * prev.y + prev.h; else g.Fy = ys > 0 ? prev.y : prev.y + prev.h; }
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
function bound(s, raw, anchor, ratioFlag, alt) {
  const { xs, ys } = axesOf(anchor);
  const ratio = Boolean(ratioFlag && xs && ys);
  if (raw.r - raw.l <= 0 || raw.b - raw.t <= 0) return { box: s.prev, gx: null, gy: null, frozen: true };
  const key = `${anchor}|${ratio}|${alt}`;
  if (!s.seg || s.seg.key !== key) s.seg = capture(s.prev, anchor, ratio, alt);
  const g = s.seg;
  const S0 = s.start;
  const ex = xs > 0 ? raw.r : raw.l;
  const ey = ys > 0 ? raw.b : raw.t;
  let box = { ...s.prev };
  let gx = null, gy = null, k = null;
  if (ratio) {
    const big = S0.w >= S0.h ? 'x' : 'y';
    const sRaw = alt
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

// ---------- simplified Konva 10.3.0 Transformer model (mm space; Konva is linear in px) ----------
function konvaRaw(nodeMm, anchorIn, p, keepRatio, alt, startMm) {
  let { l, t, r, b } = nodeMm;
  const { xs, ys } = axesOf(anchorIn);
  const cx = (l + r) / 2, cy = (t + b) / 2;
  if (keepRatio && xs && ys) {
    const hyp0 = Math.hypot(startMm.w, startMm.h);
    const cos = startMm.w / hyp0, sin = startMm.h / hyp0;
    const cp = alt ? { x: cx, y: cy } : { x: xs > 0 ? l : r, y: ys > 0 ? t : b };
    const hyp = Math.hypot(p.x - cp.x, p.y - cp.y);
    const nx = cp.x + xs * hyp * cos, ny = cp.y + ys * hyp * sin;
    if (xs > 0) r = nx; else l = nx;
    if (ys > 0) b = ny; else t = ny;
  } else {
    if (xs > 0) r = p.x; else if (xs < 0) l = p.x;
    if (ys > 0) b = p.y; else if (ys < 0) t = p.y;
  }
  if (alt) {
    if (xs > 0) l = 2 * cx - r; else if (xs < 0) r = 2 * cx - l;
    if (ys > 0) t = 2 * cy - b; else if (ys < 0) b = 2 * cy - t;
  }
  let anchor = anchorIn;
  if (r - l < 0) anchor = anchor.includes('left') ? anchor.replace('left', 'right') : anchor.replace('right', 'left');
  if (b - t < 0) anchor = anchor.startsWith('top') ? anchor.replace('top', 'bottom') : anchor.replace('bottom', 'top');
  return { raw: { l, t, r, b }, anchor };
}
const hToMmBox = (B) => ({ l: B.x / 100, t: B.y / 100, r: (B.x + B.w) / 100, b: (B.y + B.h) / 100 });

// ---------- r1 (the reviewed plan), only the parts Codex questioned ----------
function r1Centred(prevMm, rawW, floor) {
  const c = prevMm.x + prevMm.w / 2;
  const w = Math.max(floor, quantizeInspector(rawW));
  return { x: quantizeInspector(c - w / 2), w };
}

const out = [];
const log = (...a) => out.push(a.join(' '));
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; log('  FAIL:', msg); } };

// ===== A. Codex's counterexamples on r1 =====
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

// ===== B. r2 deterministic examples =====
log('B. r2 deterministic examples (hundredths in brackets)');
const noTargets = { x: [], y: [] };
const fmtBox = (B) => `x=${fromH(B.x)} y=${fromH(B.y)} w=${fromH(B.w)} h=${fromH(B.h)} [${B.x},${B.y},${B.w},${B.h}]`;
{
  // B1 centred, Codex's sequence: the right handle's pointer gives widths 10.01..10.04 about the start centre 5.00
  const s = createSession({ x: 0, y: 0, w: 1000, h: 1000 }, noTargets);
  const rows = [];
  for (const edge of [10.005, 10.01, 10.015, 10.02]) {
    const { raw } = konvaRaw(hToMmBox(s.prev), 'middle-right', { x: edge, y: 5 }, false, true, { w: 10, h: 10 });
    const { box } = bound(s, raw, 'middle-right', false, true);
    const c2 = 2 * box.x + box.w;
    rows.push(`pointer ${edge.toFixed(3)} -> w=${fromH(box.w)} x=${fromH(box.x)} right=${fromH(box.x + box.w)} centre=${c2 / 200} [${box.x},${box.w}]`);
    check(Math.abs(c2 - 1000) <= 1, 'B1 centre within 0.005');
  }
  log('  B1 centred (Alt), x=0 w=10, right handle; Konva mirrors about its own (rounded) node centre, r2 ignores it:');
  for (const r of rows) log('     ' + r);
}
{
  // B2 Alt pressed and released mid-gesture
  const s = createSession({ x: 2000, y: 1000, w: 3000, h: 2000 }, noTargets);
  const step = (px, alt) => {
    const { raw } = konvaRaw(hToMmBox(s.prev), 'middle-right', { x: px, y: 20 }, false, alt, { w: 30, h: 20 });
    return bound(s, raw, 'middle-right', false, alt).box;
  };
  const a = step(55.37, false);
  const b = step(57.0, true);
  const c = step(57.5, true);
  const d = step(60.0, false);
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
  // B3 Codex ratio counterexample under r2 (controlling = larger start axis)
  const s = createSession({ x: 0, y: 0, w: 403, h: 400 }, noTargets);
  const raw = { l: 0, t: 0, r: 4.03 * 1.0087, b: 4.0 * 1.0087 };
  const { box, k } = bound(s, raw, 'bottom-right', true, false);
  const exact = (box.w * 400) / 403 / 100;
  log(`  B3 ratio 4.03x4, s=1.0087: controlling ${k} -> ${fmtBox(box)}; exact h for w=${fromH(box.w)} is ${exact.toFixed(6)}; error ${Math.abs(box.h / 100 - exact).toFixed(6)} mm`);
  check(Math.abs(box.h / 100 - exact) <= 0.005 + 1e-12, 'B3 G5');
}
{
  // B4 R9 T10: ratio 4:3, x snaps -> 50 x 37.5 exactly, fixed corner pinned
  const s = createSession({ x: 1000, y: 1000, w: 4000, h: 3000 }, { x: [2 * 6000], y: [] });
  const raw = { l: 10, t: 10, r: 10 + 40 * 1.248, b: 10 + 30 * 1.248 };
  const { box, gx, k } = bound(s, raw, 'bottom-right', true, false);
  log(`  B4 T10 ratio 4:3, target x=60: controlling ${k} -> ${fmtBox(box)} guide x=${gx / 200}`);
  check(box.x === 1000 && box.y === 1000 && box.w === 5000 && box.h === 3750 && gx === 12000, 'B4');
}
{
  // B5 ratio, both axes in range: smaller correction wins; tie -> larger start axis
  const s = createSession({ x: 1000, y: 1000, w: 4000, h: 3000 }, { x: [2 * 6000], y: [2 * 4760] });
  const raw = { l: 10, t: 10, r: 10 + 40 * 1.252, b: 10 + 30 * 1.252 };
  const { box, gx, gy, k } = bound(s, raw, 'bottom-right', true, false);
  log(`  B5 ratio, targets x=60 (corr 0.08) and y=47.60 (corr 0.04): controlling ${k} -> ${fmtBox(box)} guide ${gx ? 'x=' + gx / 200 : 'y=' + gy / 200}`);
  check(k === 'y' && box.h === 3760 && box.w === 5013, 'B5');
  const s2 = createSession({ x: 0, y: 0, w: 4000, h: 3000 }, { x: [2 * 5100], y: [2 * 3790] });
  // candidate edges at s=1.26: x 50.40 (corr 0.60 to 51), y 37.80 (corr 0.10 to 37.90) -> y; then a true tie:
  const s3 = createSession({ x: 0, y: 0, w: 4000, h: 4000 }, { x: [2 * 5050], y: [2 * 5050] });
  const r3 = bound(s3, { l: 0, t: 0, r: 50, b: 50 }, 'bottom-right', true, false);
  log(`  B5b square 40x40, both edges 0.50 from a target: tie -> larger start axis, equal -> x: controlling ${r3.k} -> ${fmtBox(r3.box)}`);
  check(r3.k === 'x', 'B5b tie');
  void s2;
}
{
  // B6 D-1 floors after quantization; grandfathered axis; ratio with undersized axis
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
  const r1 = bound(rr, { l: 0, t: 0, r: 2.5 * 0.9, b: 20 * 0.9 }, 'bottom-right', true, false).box;
  const r2 = bound(rr, { l: 0, t: 0, r: 2.5 * 1.1, b: 20 * 1.1 }, 'bottom-right', true, false).box;
  log(`  B6c ratio on grandfathered 2.5 x 20: s=0.9 -> ${fromH(r1.w)} x ${fromH(r1.h)}; s=1.1 -> ${fromH(r2.w)} x ${fromH(r2.h)}`);
  check(r1.w === 250 && r1.h === 2000 && r2.w === 275 && r2.h === 2200, 'B6c');
}
{
  // B7 ratio + Alt
  const s = createSession({ x: 0, y: 0, w: 3001, h: 2000 }, noTargets);
  const { raw } = konvaRaw(hToMmBox(s.prev), 'bottom-right', { x: 33.3, y: 22.1 }, true, true, { w: 30.01, h: 20 });
  const { box, k } = bound(s, raw, 'bottom-right', true, true);
  const errC = Math.max(Math.abs(2 * box.x + box.w - 3001), Math.abs(2 * box.y + box.h - 2000)) / 200;
  const exactH = (box.w * 2000) / 3001 / 100;
  log(`  B7 ratio+Alt on 30.01 x 20: controlling ${k} -> ${fmtBox(box)}; centre error ${errC} mm; ratio error ${Math.abs(box.h / 100 - exactH).toFixed(6)} mm`);
  check(errC <= 0.005 && Math.abs(box.h / 100 - exactH) <= 0.005 + 1e-12, 'B7');
}
{
  // B8 snap ties and half-hundredth targets
  const s = createSession({ x: 0, y: 0, w: 1000, h: 1000 }, { x: [2 * 2000, 2 * 2100], y: [] });
  const a = bound(s, { l: 0, t: 0, r: 20.5, b: 10 }, 'middle-right', false, false);
  log(`  B8a two targets 0.50 mm either side (20.00, 21.00): lower wins -> right edge ${fromH(a.box.x + a.box.w)} guide ${a.gx / 200}`);
  check(a.box.x + a.box.w === 2000, 'B8a');
  const c2 = 2 * 2000 + 1001; // centre of a 10.01-wide element at x=20
  const s2 = createSession({ x: 0, y: 0, w: 1000, h: 1000 }, { x: [c2], y: [] });
  const b = bound(s2, { l: 0, t: 0, r: 25.3, b: 10 }, 'middle-right', false, false);
  log(`  B8b target = centre of a 10.01-wide element at 20.00 (25.005): right edge ${fromH(b.box.x + b.box.w)} guide ${b.gx / 200} (|diff| ${(Math.abs(2 * (b.box.x + b.box.w) - b.gx) / 200).toFixed(3)} mm)`);
  check(Math.abs(2 * (b.box.x + b.box.w) - b.gx) <= 1, 'B8b');
}
{
  // B9 minimum outranks snap: target inside the floor drops the guide
  const s = createSession({ x: 0, y: 0, w: 1000, h: 1000 }, { x: [2 * 300], y: [] });
  const a = bound(s, { l: 0, t: 0, r: 3.5, b: 10 }, 'middle-right', false, false);
  log(`  B9 target at 3.00 within the 4 mm floor: w=${fromH(a.box.w)} guide=${a.gx}`);
  check(a.box.w === 400 && a.gx === null, 'B9');
}

// ===== C. exhaustive representation checks =====
log('C. representation (exhaustive over -2000.00 .. 2000.00 mm)');
{
  let bad = 0;
  for (let h = -200000; h <= 200000; h++) {
    const v = fromH(h);
    if (toH(v) !== h || quantizeInspector(v) !== v || formatNum(v) !== formatHInt(h) || v !== Number(formatHInt(h))) bad++;
  }
  log(`  toH(fromH(h))===h, quantizeInspector(fromH(h))===fromH(h), formatNum(fromH(h))===integer formatting: ${bad} mismatches in 400001 values`);
  check(bad === 0, 'C exhaustive');
  // sums of canonical values recover exactly in hundredths
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

// ===== D. seeded random gestures: r2 properties, r1 violation counts =====
log('D. seeded random gestures through the Konva model');
{
  const ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'];
  const geomT2 = { x: [], y: [] };
  for (const off of [0, 148]) for (const v of [off, off + 148, off + 74, off + 12, off + 136]) geomT2.x.push(2 * toH(v));
  for (const v of [0, 210, 105, 12, 198]) geomT2.y.push(2 * toH(v));
  const stats = { gestures: 0, moves: 0, segs: 0, maxCentreErr: 0, maxRatioErr: 0, maxGuideErr: 0, fixedViol: 0, floorViol: 0, nonInt: 0, undersizedShrink: 0, pxRoundTrip: 0, payload: 0, nondet: 0 };
  const r1 = { centredMoves: 0, centreDriftViol: 0, maxDrift: 0, ratioMoves: 0, ratioViol: 0, maxRatioErr: 0 };
  const N = 4000;
  for (let seed = 1; seed <= N; seed++) {
    const run = () => {
      const R = rng(seed);
      const gh = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
      const undersized = R() < 0.25;
      const start = { x: gh(-2000, 28000), y: gh(-1000, 20000), w: undersized && R() < 0.6 ? gh(150, 399) : gh(400, 12000), h: undersized && R() < 0.6 ? gh(150, 399) : gh(400, 12000) };
      const t2 = { x: geomT2.x.slice(), y: geomT2.y.slice() };
      for (let i = 0; i < 3; i++) { const bx = gh(0, 28000), bw = gh(100, 5001), by = gh(0, 20000), bh = gh(100, 5001); t2.x.push(2 * bx, 2 * (bx + bw), 2 * bx + bw); t2.y.push(2 * by, 2 * (by + bh), 2 * by + bh); }
      const view = { scale: 0.51 + R() * 26.69, vx: R() * 400 - 200, vy: R() * 300 - 150 };
      const s = createSession(start, t2);
      let anchor = ANCHORS[gh(0, 7)];
      let ratioOn = R() < 0.4, alt = R() < 0.3;
      const startMm = { w: start.w / 100, h: start.h / 100 };
      let p = (() => { const n = hToMmBox(start); const { xs, ys } = axesOf(anchor); return { x: xs > 0 ? n.r : xs < 0 ? n.l : (n.l + n.r) / 2, y: ys > 0 ? n.b : ys < 0 ? n.t : (n.t + n.b) / 2 }; })();
      const trace = [];
      let lastKey = null;
      let segStartMetric = null;
      // r1 shadow for centred drift: tracks only axes in Alt one-edge-free scaling
      for (let m = 0; m < 40; m++) {
        if (R() < 0.08) ratioOn = !ratioOn;
        if (R() < 0.08) alt = !alt;
        const jump = R() < 0.1 ? 15 : 2.5;
        p = { x: p.x + (R() * 2 - 1) * jump, y: p.y + (R() * 2 - 1) * jump };
        const { xs, ys } = axesOf(anchor);
        const kr = konvaRaw(hToMmBox(s.prev), anchor, p, ratioOn && xs && ys, alt, startMm);
        // Konva works in px: round-trip the raw box through a random view to include conversion noise
        const toPx = (mm, o) => mm * view.scale + o, toMm = (px, o) => (px - o) / view.scale;
        const raw = { l: toMm(toPx(kr.raw.l, view.vx), view.vx), r: toMm(toPx(kr.raw.r, view.vx), view.vx), t: toMm(toPx(kr.raw.t, view.vy), view.vy), b: toMm(toPx(kr.raw.b, view.vy), view.vy) };
        anchor = kr.anchor;
        const res = bound(s, raw, anchor, ratioOn, alt);
        const B = res.box;
        trace.push(B.x, B.y, B.w, B.h);
        if (res.frozen) continue;
        stats.moves++;
        const g = res.seg;
        if (g.key !== lastKey) { stats.segs++; lastKey = g.key; segStartMetric = { ...g }; }
        if (![B.x, B.y, B.w, B.h].every(Number.isInteger)) stats.nonInt++;
        if (B.w < s.fl.w || B.h < s.fl.h) stats.floorViol++;
        if ((start.w < 400 && B.w < start.w) || (start.h < 400 && B.h < start.h)) stats.undersizedShrink++;
        if (g.ratio && (start.w < 400 || start.h < 400) && (B.w < start.w || B.h < start.h)) stats.undersizedShrink++;
        if (!g.alt) {
          if (g.xs && (g.xs > 0 ? B.x : B.x + B.w) !== g.Fx) stats.fixedViol++;
          if (g.ys && (g.ys > 0 ? B.y : B.y + B.h) !== g.Fy) stats.fixedViol++;
        } else {
          if (g.xs) stats.maxCentreErr = Math.max(stats.maxCentreErr, Math.abs(2 * B.x + B.w - g.C2x) / 200);
          if (g.ys) stats.maxCentreErr = Math.max(stats.maxCentreErr, Math.abs(2 * B.y + B.h - g.C2y) / 200);
        }
        if (g.ratio) {
          const [ks, os, S0k, S0o] = res.k === 'x' ? [B.w, B.h, start.w, start.h] : [B.h, B.w, start.h, start.w];
          stats.maxRatioErr = Math.max(stats.maxRatioErr, Math.abs(os - (ks * S0o) / S0k) / 100);
        }
        if (res.gx !== null) stats.maxGuideErr = Math.max(stats.maxGuideErr, Math.abs(2 * (g.xs > 0 ? B.x + B.w : B.x) - res.gx) / 200);
        if (res.gy !== null) stats.maxGuideErr = Math.max(stats.maxGuideErr, Math.abs(2 * (g.ys > 0 ? B.y + B.h : B.y) - res.gy) / 200);
        // payload: page-relative for page 0 or 1 (offset 0 / 148 mm)
        for (const off of [0, 14800]) {
          const pay = [fromH(B.x - off), fromH(B.y), fromH(B.w), fromH(B.h)];
          const hs = [B.x - off, B.y, B.w, B.h];
          for (let i = 0; i < 4; i++) if (toH(pay[i]) !== hs[i] || formatNum(pay[i]) !== formatHInt(hs[i]) || quantizeInspector(pay[i]) !== pay[i]) stats.payload++;
        }
        // px round trip of committed edges
        for (const [mm, o] of [[B.x / 100, view.vx], [(B.x + B.w) / 100, view.vx], [B.y / 100, view.vy], [(B.y + B.h) / 100, view.vy]]) {
          const back = ((mm * view.scale + o) - o) / view.scale;
          if (Math.abs(back * 100 - Math.round(mm * 100)) > 1e-6) stats.pxRoundTrip++;
        }
        void segStartMetric;
      }
      return trace.join(',');
    };
    const a = run();
    const b = run();
    if (a !== b) stats.nondet++;
    stats.gestures++;
  }
  // r1 shadow runs: centred one-edge scaling and unsnapped ratio, same model
  for (let seed = 1; seed <= N; seed++) {
    const R = rng(1e6 + seed);
    const gh = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
    // centred: Konva mirrors about the current (rounded) node centre; r1 recomputes the centre from prev
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
      const sf = Math.max(sc, 4 / W0, 4 / H0); // r1 step 5.4: floor the factor, then step 6: quantize both
      const w = quantizeInspector(W0 * sf), h = quantizeInspector(H0 * sf);
      const big = W0 >= H0;
      const err = big ? Math.abs(h - (w * H0) / W0) : Math.abs(w - (h * W0) / H0);
      r1.ratioMoves++;
      r1.maxRatioErr = Math.max(r1.maxRatioErr, err);
      if (err > 0.005 + 1e-9) r1.ratioViol++;
    }
  }
  log(`  r2: ${stats.gestures} gestures, ${stats.moves} bounded moves, ${stats.segs} segments`);
  log(`      non-integer outputs ${stats.nonInt} | floor violations ${stats.floorViol} | undersized shrink ${stats.undersizedShrink} | fixed-edge changes within a segment ${stats.fixedViol}`);
  log(`      max centre error ${stats.maxCentreErr} mm | max ratio error ${stats.maxRatioErr.toFixed(6)} mm | max snapped-edge vs guide ${stats.maxGuideErr} mm`);
  log(`      payload canonical/format mismatches ${stats.payload} | px round-trip failures ${stats.pxRoundTrip} | nondeterministic reruns ${stats.nondet}`);
  check(stats.nonInt === 0 && stats.floorViol === 0 && stats.undersizedShrink === 0 && stats.fixedViol === 0, 'D integer/floor/fixed');
  check(stats.maxCentreErr <= 0.005 && stats.maxRatioErr <= 0.005 + 1e-12 && stats.maxGuideErr <= 0.005, 'D tolerances');
  check(stats.payload === 0 && stats.pxRoundTrip === 0 && stats.nondet === 0, 'D payload/px/determinism');
  log(`  r1 shadow: centred moves ${r1.centredMoves}, centre-drift > 0.005 mm in ${r1.centreDriftViol} (max drift ${r1.maxDrift.toFixed(3)} mm)`);
  log(`             unsnapped ratio moves ${r1.ratioMoves}, dependent error > 0.005 mm in ${r1.ratioViol} (max ${r1.maxRatioErr.toFixed(6)} mm)`);
}

log(failures === 0 ? 'RESULT: all r2 checks passed' : `RESULT: ${failures} r2 check(s) FAILED`);
console.log(out.join('\n'));
process.exitCode = failures === 0 ? 0 : 1;
