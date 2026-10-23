// Slice D stage 1 probe — the reviewed model, loaded verbatim, plus the replay used to compare real Konva with it.
// NOT production code. The model text is the shared section of docs/evidence/slice-d-math-check.js (everything
// before its "r1" section): helpers, bound(), the line-by-line Konva 10.3.0 port konvaStep(), newGesture() and
// gestureMove(). It is never edited here; its sha256 is recorded in the results.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

export const MODEL_END_MARKER = '// ---------- r1 (the first reviewed plan), only the parts Codex questioned ----------';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function extractModel(evidencePath) {
  const full = fs.readFileSync(evidencePath, 'utf8');
  const i = full.indexOf(MODEL_END_MARKER);
  if (i < 0 || full.indexOf(MODEL_END_MARKER, i + 1) >= 0) throw new Error('model end marker not found exactly once in ' + evidencePath);
  const shared = full.slice(0, i);
  return { shared, sha256Full: sha256(full), sha256Shared: sha256(shared), sharedLines: shared.split('\n').length - 1 };
}

export function loadModel(shared) {
  const ctx = vm.createContext({});
  vm.runInContext(
    shared +
      '\n;globalThis.__model = { toH, fromH, floorDiv, ceilDiv, roundHalfUpDiv, axesOf, createSession, segKey, capture, bound,' +
      ' konvaStep, newGesture, gestureMove, mmToPxX, mmToPxY, hToMmBox, edgeJump };',
    ctx,
    { filename: 'slice-d-math-check.js (shared model section)' },
  );
  return ctx.__model;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const anchorCorner = (nodePx, anchor) => ({
  x: anchor.includes('left') ? nodePx.x : anchor.includes('right') ? nodePx.x + nodePx.w : nodePx.x + nodePx.w / 2,
  y: anchor.startsWith('top') ? nodePx.y : anchor.startsWith('bottom') ? nodePx.y + nodePx.h : nodePx.y + nodePx.h / 2,
});

// One gesture's replay state. G drives the px-native replay below; E is an independent twin driven through the
// evidence script's own gestureMove() (mm input), used to prove the replay IS the reviewed model.
export function newReplay(M, startH, anchor, view, press, clampOn) {
  return {
    G: M.newGesture(startH, { x: [], y: [] }, anchor, view),
    E: M.newGesture(startH, { x: [], y: [] }, anchor, view),
    press, clampOn, crossed: false,
  };
}

// Replays one delivered move. mv = { cx, cy, np: {x, y} (Konva's proposed anchor = pointer - drag offset),
// ratioFlag (keepRatio || shift), alt }. observedUnchanged: Konva returned early because the anchor did not move
// (Transformer _handleMouseMove `oldAbs === newAbs`), a branch the port does not model; the replay then does not
// advance, and reports what the model would have produced had Konva proceeded (wouldBox), which must equal prev.
// The body after the threshold is gestureMove() from the evidence script, taking the anchor target in px and
// returning the intermediate values (target, clamp, node box, Konva raw box) so they can be compared.
export function replayMove(M, R, mv, observedUnchanged) {
  const G = R.G, v = G.view;
  if (!R.crossed) {
    if (Math.hypot(mv.cx - R.press.x, mv.cy - R.press.y) < 3) return { cls: 'pending', box: { ...G.s.prev } };
    R.crossed = true;
  }
  const { xs, ys } = M.axesOf(G.anchor);
  const ratio = Boolean(mv.ratioFlag && xs && ys);
  const key = M.segKey(G.anchor, ratio, mv.alt);
  if (!G.s.seg || G.s.seg.key !== key) G.s.seg = M.capture(G.s.prev, G.anchor, ratio, mv.alt, G.s.seg);
  const g = G.s.seg;
  const target = { x: mv.np.x, y: mv.np.y };
  let clamped = false, F = null, minExt = null;
  if (ratio && !mv.alt) {
    const Fx = M.mmToPxX(g.Fx / 100, v), Fy = M.mmToPxY(g.Fy / 100, v);
    F = { x: Fx, y: Fy };
    if (R.clampOn) {
      const S0 = G.s.start, big = S0.w >= S0.h ? 'x' : 'y';
      const S0k = big === 'x' ? S0.w : S0.h, S0o = big === 'x' ? S0.h : S0.w;
      const flk = big === 'x' ? G.s.fl.w : G.s.fl.h, flo = big === 'x' ? G.s.fl.h : G.s.fl.w;
      const kMin = Math.max(flk, M.ceilDiv(flo * S0k, S0o)), oMin = M.roundHalfUpDiv(kMin * S0o, S0k);
      const minW = ((big === 'x' ? kMin : oMin) / 100) * v.scale, minH = ((big === 'x' ? oMin : kMin) / 100) * v.scale;
      minExt = { w: minW, h: minH };
      if (xs * (target.x - Fx) < minW) { target.x = Fx + xs * minW; clamped = true; }
      if (ys * (target.y - Fy) < minH) { target.y = Fy + ys * minH; clamped = true; }
    }
  }
  const C = mv.alt ? { x: g.C2x !== undefined ? M.mmToPxX(g.C2x / 200, v) : null, y: g.C2y !== undefined ? M.mmToPxY(g.C2y / 200, v) : null } : null;
  const P = G.s.prev;
  const nodePx = { x: M.mmToPxX(P.x / 100, v), y: M.mmToPxY(P.y / 100, v), w: (P.w / 100) * v.scale, h: (P.h / 100) * v.scale };
  const corner = anchorCorner(nodePx, G.anchor);
  const base = { target, clamped, F, C, minExt, nodePx, corner, segKey: g.key, ref: [g.xs, g.ys, g.Fx ?? null, g.Fy ?? null, g.C2x ?? null, g.C2y ?? null], predictedUnchanged: target.x === corner.x && target.y === corner.y };
  if (observedUnchanged) {
    const s2 = clone(G.s);
    const k2 = M.konvaStep(nodePx, G.anchor, target, Boolean(mv.ratioFlag), mv.alt, G.sin, G.cos);
    let wouldBox = { ...P }, wouldSkip = Boolean(k2.skip);
    if (!k2.skip) {
      const raw2 = { l: (k2.raw.x - v.vx) / v.scale, r: (k2.raw.x + k2.raw.w - v.vx) / v.scale, t: (k2.raw.y - v.vy) / v.scale, b: (k2.raw.y + k2.raw.h - v.vy) / v.scale };
      wouldBox = { ...M.bound(s2, raw2, k2.anchor, mv.ratioFlag, mv.alt, { x: (target.x - v.vx) / v.scale, y: (target.y - v.vy) / v.scale }).box };
    }
    return { cls: 'unchanged', ...base, wouldBox, wouldSkip, box: { ...P } };
  }
  const k = M.konvaStep(nodePx, G.anchor, target, Boolean(mv.ratioFlag), mv.alt, G.sin, G.cos);
  if (k.skip) return { cls: 'skip', ...base, box: { ...P } };
  G.anchor = k.anchor;
  const rawMm = { l: (k.raw.x - v.vx) / v.scale, r: (k.raw.x + k.raw.w - v.vx) / v.scale, t: (k.raw.y - v.vy) / v.scale, b: (k.raw.y + k.raw.h - v.vy) / v.scale };
  const anchorMm = { x: (target.x - v.vx) / v.scale, y: (target.y - v.vy) / v.scale };
  const res = M.bound(G.s, rawMm, k.anchor, mv.ratioFlag, mv.alt, anchorMm);
  return { cls: 'proceed', ...base, raw: k.raw, renamed: k.renamed, anchor: k.anchor, box: { ...res.box }, frozen: Boolean(res.frozen), k: res.k ?? null };
}

// The twin: the evidence script's gestureMove() on the same delivered move (mm input), unchanged.
export function twinMove(M, R, mv) {
  const v = R.E.view;
  const pm = { x: (mv.np.x - v.vx) / v.scale, y: (mv.np.y - v.vy) / v.scale };
  const t = M.gestureMove(R.E, pm, mv.ratioFlag, mv.alt, R.clampOn);
  return { skipped: Boolean(t.skipped), frozen: Boolean(t.frozen), renamed: Boolean(t.renamed), clamped: Boolean(t.clamped), rawW: t.rawW ?? null, rawH: t.rawH ?? null, box: { ...t.box }, anchor: R.E.anchor };
}
