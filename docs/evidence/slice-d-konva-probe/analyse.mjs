// Slice D stage 1 probe — analysis: every delivered move replayed through the reviewed model and compared with what
// real Konva did. NOT production code.
import { newReplay, replayMove, twinMove } from './model.mjs';

// Tolerances. Bounded boxes, anchor names, skip/proceed decisions, segment keys and references are compared EXACTLY.
export const TOL = {
  target: 1e-9, // our anchorDragBoundFunc return vs the model's clamped target (same formula, px)
  anchor: 1e-9, // Konva's anchor / current box (oldBox) vs the model's box in px
  raw: 1e-6, // Konva's proposed box (boundBoxFunc newBox) vs the port's raw box, px (plan §6 stage 1)
  compare: 1e-6, // Konva's comparePoint vs our fixed corner / carried centre, px (plan §6 stage 1)
  rect: 1e-9, // node client rect after onTransform vs the bounded box in px
};
const sameBox = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const boxOf = (arr) => ({ x: arr[0], y: arr[1], w: arr[2], h: arr[3] });
const maxAbs = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const fmt = (B) => (B ? `[${B.x / 100}, ${B.y / 100}, ${B.w / 100} x ${B.h / 100}]` : 'null');
const edgeH = (toH, b) => { const L = toH(b.x), R = toH(b.x + b.w), T = toH(b.y), Bm = toH(b.y + b.h); return { x: L, y: T, w: R - L, h: Bm - T }; };
const edgeJump = (A, B) => Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y), Math.abs(A.x + A.w - B.x - B.w), Math.abs(A.y + A.h - B.y - B.h)) / 100;

function parse(log) {
  const setups = [];
  let setup = null, phase = null, g = null, move = null;
  const gestures = [], outside = [];
  for (let i = 0; i < log.length; i++) {
    const ev = log[i];
    if (ev.e === 'setup') { setup = { cfg: ev.cfg, anchors: ev.anchors, gestures: [] }; setups.push(setup); phase = null; continue; }
    if (ev.e === 'mark') { phase = ev.label; if (!g) outside.push({ ev, phase }); continue; }
    if (ev.e === 'ts' && ev.who === 'tr') {
      g = { setup, start: ev, prevEv: log[i - 1], pre: [], moves: [], end: null, phase0: phase };
      gestures.push(g); setup.gestures.push(g); move = null; continue;
    }
    if (!g) { outside.push({ ev, phase }); continue; }
    if (ev.e === 'te' && ev.who === 'tr') { g.end = ev; g.endPrev = log[i - 1]; g.endNext = log[i + 1]; if (move) move.ev.push({ e: '__end' }); g = null; move = null; continue; }
    if (ev.e === 'mm') { move = { mm: ev, ev: [], phase }; g.moves.push(move); continue; }
    if (move) move.ev.push(ev); else g.pre.push(ev);
  }
  return { setups, gestures, outside };
}

function classify(mv) {
  const ev = mv.ev;
  const adbf = ev.find((e) => e.e === 'adbf');
  const irs = ev.filter((e) => e.e === 'ir');
  const bbf = ev.find((e) => e.e === 'bbf');
  const trT = ev.find((e) => e.e === 'trT');
  const nT = ev.find((e) => e.e === 'nT');
  let cls;
  if (!adbf) cls = 'none';
  else if (adbf.why === 'pending') cls = 'pending';
  else if (adbf.why !== 'live') cls = adbf.why;
  else if (irs.length === 0) cls = 'unchanged';
  else if (irs.some((r) => r.res)) cls = 'skip';
  else cls = bbf ? 'proceed' : 'odd';
  const order = ev.filter((e) => ['adbf', 'ir', 'bbf', 'trT', 'nT'].includes(e.e)).map((e) => e.e).join(',');
  return { adbf, irs, bbf, trT, nT, cls, order };
}
const EXPECTED_ORDER = { pending: ['adbf'], unchanged: ['adbf'], skip: ['adbf,ir', 'adbf,ir,ir'], proceed: ['adbf,ir,ir,bbf,trT,nT'] };

export function analyseCase(M, c, log, sent, runOut, runError, bname) {
  const failures = [];
  const info = [];
  let notExecuted = null;
  const trace = [];
  const fail = (m) => failures.push(m);
  if (runError) fail('probe error: ' + runError);
  const P = parse(log);
  const metrics = {
    moves: 0, pending: 0, unchanged: 0, skip: 0, proceed: 0, frozen: 0, renamed: 0, clamped: 0,
    maxTarget: 0, maxRaw: 0, maxAnchor: 0, maxRect: 0, maxCompare: null, compareN: 0, maxCentre: null, centreN: 0,
    unchangedPredictedAgree: 0, unchangedPredictedDisagree: 0, twinChecked: 0, diffs: 0,
    minClampExtent: null, maxMirror: null, mirrorN: 0,
  };

  // ---- delivery: every sent pointer position arrived once, in order, with the sent modifiers ----
  const mms = log.filter((e) => e.e === 'mm');
  const sentMoves = [];
  { let ph = null; for (const s of sent) { if (s.mark !== undefined) ph = s.mark; else sentMoves.push({ ...s, phase: ph }); } }
  // W3 (control) only: when the browser itself zoomed the page, later pointer input arrives in the new CSS px
  const zoom = c.expect === 'wheelZoomControl' && runOut.vpBefore && runOut.vpAfter && runOut.vpAfter.innerWidth !== runOut.vpBefore.innerWidth ? runOut.vpBefore.innerWidth / runOut.vpAfter.innerWidth : null;
  let deliveryIssues = 0, deliveryScaled = 0;
  if (mms.length !== sentMoves.length) { deliveryIssues++; fail(`delivery: sent ${sentMoves.length} pointer moves, received ${mms.length} mousemove events`); }
  for (let i = 0; i < Math.min(mms.length, sentMoves.length); i++) {
    const a = mms[i], s = sentMoves[i];
    if (zoom && s.phase === 'moves' && Math.abs(a.cx - s.x / zoom) <= 1 && Math.abs(a.cy - s.y / zoom) <= 1 && a.sx === s.Shift && a.ax === s.Alt) { deliveryScaled++; continue; }
    if (a.cx !== s.x || a.cy !== s.y || a.sx !== s.Shift || a.ax !== s.Alt) { deliveryIssues++; if (deliveryIssues <= 3) fail(`delivery: move ${i} sent (${s.x}, ${s.y}, shift ${s.Shift}, alt ${s.Alt}) received (${a.cx}, ${a.cy}, shift ${a.sx}, alt ${a.ax})`); }
  }
  info.push(deliveryIssues !== 0 ? `delivery: ${deliveryIssues} issue(s)` : deliveryScaled ? `delivery: ${sentMoves.length} sent = ${mms.length} received; ${sentMoves.length - deliveryScaled} exact, and the ${deliveryScaled} moves after the browser's own page zoom arrived scaled by 1/${zoom.toFixed(4)} (within 1 px)` : `delivery exact: ${sentMoves.length} sent = ${mms.length} received (coordinates and modifiers)`);

  // ---- every gesture: callback order, model replay, comparisons ----
  const gStates = [];
  let lastStored = null;
  for (const g of P.gestures) {
    const cfg = g.setup.cfg;
    const v = cfg.view;
    const gi = P.gestures.indexOf(g);
    const startStored = g.setup.gestures.indexOf(g) === 0 ? cfg.box : lastStored;
    const expectH = edgeH(M.toH, startStored);
    if (!sameBox(expectH, g.start.startH)) fail(`g${gi}: start box (edge-wise H) ${JSON.stringify(g.start.startH)} != expected ${JSON.stringify(expectH)}`);
    // start order: window mousedown, then Transformer transformstart (with the mousedown event), then the node's
    if (!g.prevEv || g.prevEv.e !== 'md') fail(`g${gi}: transformstart not immediately after the mousedown (previous event ${g.prevEv && g.prevEv.e})`);
    if (g.start.et !== 'mousedown') fail(`g${gi}: transformstart event type ${g.start.et}`);
    if (!g.pre.length || g.pre[0].e !== 'ts' || g.pre[0].who !== 'node') fail(`g${gi}: node transformstart not directly after the Transformer's`);
    const r = g.start.rect, hyp = Math.hypot(r[2], r[3]);
    if (Math.abs(g.start.sin - Math.abs(r[3] / hyp)) > 1e-15 || Math.abs(g.start.cos - Math.abs(r[2] / hyp)) > 1e-15) fail(`g${gi}: sin/cos at press not the current box ratio`);
    const R = newReplay(M, g.start.startH, g.start.anc, v, { x: g.start.cx, y: g.start.cy }, cfg.clamp !== false && !M.__noClamp);
    const gs = { g, gi, cfg, boxes: [], rows: [] };
    gStates.push(gs);
    let curBox = { ...g.start.startH };
    let prevAnchor = g.start.anc;
    for (let mi = 0; mi < g.moves.length; mi++) {
      const mv = g.moves[mi];
      const C = classify(mv);
      const row = { g: gi, i: mi, phase: mv.phase, cls: C.cls, cx: mv.mm.cx, cy: mv.mm.cy, sx: mv.mm.sx, ax: mv.mm.ax, diffs: [] };
      const d = (m) => { row.diffs.push(m); metrics.diffs++; };
      if (C.cls === 'none') { row.note = 'no Konva callback (no transform listener at this point)'; trace.push(row); gs.rows.push({ row, C, model: null, box: curBox }); continue; }
      metrics.moves++;
      const A = C.adbf;
      Object.assign(row, { anc0: A.anc, old: A.old, np: A.np, ret: A.ret, kr: A.kr, clamped: A.clamped ?? null, seg: A.seg ?? null, ref: A.ref ?? null, cmp: A.cmp ?? null, cmpC: A.cmpC, F: A.F ?? null, C: A.C ?? null, ir: C.irs.map((x) => [x.v, x.res]) });
      if (A.et !== 'mousemove') d(`anchorDragBoundFunc evt.type ${A.et}`);
      if (A.cx !== mv.mm.cx || A.cy !== mv.mm.cy) d('anchorDragBoundFunc event is not the delivered mousemove');
      if (!EXPECTED_ORDER[C.cls] || !EXPECTED_ORDER[C.cls].includes(C.order)) d(`callback order ${C.cls}: ${C.order}`);
      const mvIn = { cx: A.cx, cy: A.cy, np: { x: A.np[0], y: A.np[1] }, ratioFlag: Boolean(A.kr || A.sx), alt: Boolean(A.ax) };
      const m = replayMove(M, R, mvIn, C.cls === 'unchanged');
      row.model = { cls: m.cls };
      if (m.cls === 'pending') {
        metrics.pending++;
        if (C.cls !== 'pending') d(`model says threshold pending, browser ${C.cls}`);
        if (!(Object.is(A.ret[0], A.old[0]) && Object.is(A.ret[1], A.old[1]))) d('pending move did not return oldAbs exactly');
      } else {
        if (C.cls === 'pending') d('browser threshold pending, model crossed');
        const tw = twinMove(M, R, mvIn);
        metrics.twinChecked++;
        Object.assign(row.model, { target: [m.target.x, m.target.y], clamped: m.clamped, segKey: m.segKey, ref: m.ref, corner: [m.corner.x, m.corner.y], nodePx: [m.nodePx.x, m.nodePx.y, m.nodePx.w, m.nodePx.h] });
        const dt = maxAbs(A.ret, [m.target.x, m.target.y]);
        metrics.maxTarget = Math.max(metrics.maxTarget, dt);
        if (dt > TOL.target) d(`returned anchor target differs from the model by ${dt} px`);
        if (Boolean(A.clamped) !== m.clamped) d(`clamp flag browser ${A.clamped} model ${m.clamped}`);
        if (A.seg !== m.segKey) d(`segment key browser ${A.seg} model ${m.segKey}`);
        if (JSON.stringify(A.ref) !== JSON.stringify(m.ref)) d(`segment references browser ${JSON.stringify(A.ref)} model ${JSON.stringify(m.ref)}`);
        const da = maxAbs(A.old, [m.corner.x, m.corner.y]);
        metrics.maxAnchor = Math.max(metrics.maxAnchor, da);
        if (da > TOL.anchor) d(`Konva anchor position (oldAbs) differs from the model box corner by ${da} px`);
        if (A.minExt) metrics.minClampExtent = Math.min(metrics.minClampExtent ?? Infinity, A.minExt[0], A.minExt[1]);
        if (m.F && A.cmp) {
          const dc = maxAbs(A.cmp, [m.F.x, m.F.y]);
          metrics.maxCompare = Math.max(metrics.maxCompare ?? 0, dc); metrics.compareN++;
          if (dc > TOL.compare) d(`Konva comparePoint differs from our fixed corner by ${dc} px`);
        }
        if (m.C && mvIn.alt) {
          const ax = [];
          if (m.C.x !== null) ax.push(Math.abs(A.cmpC[0] - m.C.x));
          if (m.C.y !== null) ax.push(Math.abs(A.cmpC[1] - m.C.y));
          const dc = Math.max(...ax);
          metrics.maxCentre = Math.max(metrics.maxCentre ?? 0, dc); metrics.centreN++;
          // Konva mirrors about ITS current box centre (the rounded prev), which may sit up to half a hundredth
          // (0.005 mm) from our carried centre; that offset is why the maths never reads Konva's centre (plan §3.4)
          if (dc > 0.005 * v.scale + 1e-9) d(`Konva's centre is ${dc} px from our carried centre (more than 0.005 mm)`);
        }
        if (m.cls === 'unchanged') {
          metrics.unchanged++;
          if (m.predictedUnchanged) metrics.unchangedPredictedAgree++; else metrics.unchangedPredictedDisagree++;
          row.model.wouldBox = m.wouldBox; row.model.predictedUnchanged = m.predictedUnchanged;
          if (m.wouldSkip || !sameBox(m.wouldBox, m.box)) d(`Konva returned early (anchor unchanged) but the port would have produced ${m.wouldSkip ? 'a skip' : fmt(m.wouldBox)} instead of holding ${fmt(m.box)}`);
          if (tw.skipped || !sameBox(tw.box, m.box)) d(`twin (evidence gestureMove) on an unchanged move gave ${fmt(tw.box)}`);
        } else if (m.cls === 'skip') {
          metrics.skip++;
          if (C.cls !== 'skip') d(`model (port) skips (extent in [-1, 1) px), browser ${C.cls}`);
          if (!tw.skipped) d('twin did not skip');
        } else {
          metrics.proceed++;
          if (C.cls !== 'proceed') d(`model proceeds, browser ${C.cls}${C.cls === 'skip' ? ` (Konva tested ${C.irs.map((x) => x.v).join(', ')})` : ''}`);
          if (!tw.skipped && !(sameBox(tw.box, m.box) && tw.frozen === m.frozen && tw.renamed === m.renamed && tw.clamped === m.clamped && Math.abs(tw.rawW - m.raw.w) <= 1e-9 && Math.abs(tw.rawH - m.raw.h) <= 1e-9)) d(`twin (evidence gestureMove) differs from the replay: ${fmt(tw.box)} vs ${fmt(m.box)}`);
          if (tw.skipped) d('twin skipped where the replay proceeded');
          Object.assign(row.model, { raw: [m.raw.x, m.raw.y, m.raw.w, m.raw.h], anchor: m.anchor, box: [m.box.x, m.box.y, m.box.w, m.box.h], frozen: m.frozen, renamed: m.renamed });
          if (C.bbf) {
            const Bf = C.bbf;
            Object.assign(row, { anc1: Bf.anc, bOld: Bf.old, nb: Bf.nb, H: Bf.H, fz: Bf.fz, px: Bf.px });
            if (Bf.anc !== m.anchor) d(`anchor at boundBoxFunc browser ${Bf.anc} model ${m.anchor}`);
            const dr = maxAbs(Bf.nb, [m.raw.x, m.raw.y, m.raw.w, m.raw.h]);
            metrics.maxRaw = Math.max(metrics.maxRaw, dr);
            if (dr > TOL.raw) d(`Konva raw box differs from the port by ${dr} px: ${JSON.stringify(Bf.nb)} vs ${JSON.stringify([m.raw.x, m.raw.y, m.raw.w, m.raw.h])}`);
            const dold = maxAbs(Bf.old, [m.nodePx.x, m.nodePx.y, m.nodePx.w, m.nodePx.h]);
            metrics.maxAnchor = Math.max(metrics.maxAnchor, dold);
            if (dold > TOL.anchor) d(`boundBoxFunc oldBox differs from the model's current box (absolute px) by ${dold}`);
            if (C.irs.length === 2 && (Math.abs(C.irs[0].v - m.raw.w) > TOL.raw || Math.abs(C.irs[1].v - m.raw.h) > TOL.raw)) d('Konva tested extents differ from the port');
            if (!sameBox(boxOf(Bf.H), m.box)) d(`bounded box browser ${fmt(boxOf(Bf.H))} model ${fmt(m.box)}`);
            if (Bf.fz !== m.frozen) d(`frozen browser ${Bf.fz} model ${m.frozen}`);
            if (mvIn.alt) {
              // Konva mirrors the opposite side about the CURRENT box centre (plan §4.1): the proposed box's centre
              // on each axis the anchor drives equals oldBox's centre
              const { xs, ys } = M.axesOf(row.anc0);
              const dm = [];
              if (xs) dm.push(Math.abs(Bf.nb[0] + Bf.nb[2] / 2 - (Bf.old[0] + Bf.old[2] / 2)));
              if (ys) dm.push(Math.abs(Bf.nb[1] + Bf.nb[3] / 2 - (Bf.old[1] + Bf.old[3] / 2)));
              const dmm = Math.max(...dm);
              metrics.maxMirror = Math.max(metrics.maxMirror ?? 0, dmm); metrics.mirrorN++;
              if (dmm > TOL.anchor) d(`Konva's centred box is not mirrored about the current box centre (${dmm} px)`);
            }
            if (Bf.anc !== prevAnchor) metrics.renamed++;
            if (Bf.fz) metrics.frozen++;
            prevAnchor = Bf.anc;
            curBox = boxOf(Bf.H);
            // onTransform: unscaled attrs, exactly the stored numbers; the drawn box is the bounded box
            const T = C.trT;
            if (!T) d('no transform event after boundBoxFunc');
            else {
              const st = [M.fromH(curBox.x), M.fromH(curBox.y), M.fromH(curBox.w), M.fromH(curBox.h)];
              if (JSON.stringify(T.stored) !== JSON.stringify(st)) d(`stored after transform ${JSON.stringify(T.stored)} != fromH(box) ${JSON.stringify(st)}`);
              const a = T.attrs;
              if (a.scaleX !== 1 || a.scaleY !== 1 || a.rotation !== 0 || a.skewX !== 0 || a.skewY !== 0) d(`attrs not normalised ${JSON.stringify(a)}`);
              if (cfg.shape === 'ellipse') {
                if (a.x !== st[0] + st[2] / 2 || a.y !== st[1] + st[3] / 2 || a.radiusX !== st[2] / 2 || a.radiusY !== st[3] / 2) d(`ellipse attrs ${JSON.stringify(a)} != centre/radii of ${JSON.stringify(st)}`);
              } else if (a.x !== st[0] || a.y !== st[1] || a.width !== st[2] || a.height !== st[3]) d(`rect attrs ${JSON.stringify(a)} != ${JSON.stringify(st)}`);
              const drt = maxAbs(T.rect, Bf.px);
              metrics.maxRect = Math.max(metrics.maxRect, drt);
              if (drt > TOL.rect) d(`node client rect differs from the bounded box by ${drt} px`);
            }
          }
        }
        if (A.clamped) metrics.clamped++;
      }
      trace.push(row);
      gs.rows.push({ row, C, model: m, box: { ...curBox } });
    }
    // end: Konva's transformend; window mouseup first for a release
    if (!g.end) fail(`g${gi}: no transformend`);
    else {
      lastStored = { x: g.end.stored[0], y: g.end.stored[1], w: g.end.stored[2], h: g.end.stored[3] };
      const nodeEnd = Boolean(g.endNext && g.endNext.e === 'te' && g.endNext.who === 'node' && g.endNext.et === g.end.et);
      gs.nodeEnd = nodeEnd;
      // destroy() detaches the node before it fires transformend, so only the Transformer's fires (reported in that case)
      if (!nodeEnd && c.expect !== 'destroy') fail(`g${gi}: node transformend not directly after the Transformer's with the same event`);
      if (g.end.et === 'mouseup' && !g.end.cancelled) {
        if (!g.endPrev || g.endPrev.e !== 'mu') fail(`g${gi}: transformend not directly after the window mouseup`);
        const last = g.end.last ? boxOf(g.end.last) : null;
        const relBox = last || g.start.startH;
        const st = [M.fromH(relBox.x), M.fromH(relBox.y), M.fromH(relBox.w), M.fromH(relBox.h)];
        if (last && JSON.stringify(g.end.stored) !== JSON.stringify(st)) fail(`g${gi}: release stored ${JSON.stringify(g.end.stored)} != last bounded box ${JSON.stringify(st)}`);
      }
    }
    trace.push({ g: gi, gesture: { anchor: g.start.anc, press: [g.start.cx, g.start.cy], startH: g.start.startH, end: g.end ? { et: g.end.et, cx: g.end.cx, cy: g.end.cy, stored: g.end.stored, cancelled: g.end.cancelled } : null, view: cfg.view, keepRatio: cfg.keepRatio, shape: cfg.shape } });
  }
  for (const gs of gStates) for (const { row } of gs.rows) if (row.diffs.length) { fail(`g${row.g} move ${row.i} (${row.cls}, pointer ${row.cx},${row.cy}): ${row.diffs.join(' | ')}`); }

  // ---- case-specific expectations ----
  const X = expectations(M, c, P, gStates, runOut, fail, info);
  if (X && X.notExecuted) notExecuted = X.notExecuted;

  // keep failure list readable
  const shown = failures.length > 12 ? [...failures.slice(0, 12), `... and ${failures.length - 12} more`] : failures;
  const status = failures.length ? 'FAIL' : notExecuted ? 'NOT EXECUTED' : 'PASS';
  return { summary: { id: c.id, title: c.title, kind: c.kind, group: c.group, status, failures: shown, failureCount: failures.length, notExecuted, info, metrics, extra: X ? X.extra : null, gestures: P.gestures.length }, trace };
}

// path metrics on the measured part of a gesture (mirrors runPath in the evidence script, on browser results)
function pathMetrics(gs, fl) {
  const rows = gs.rows.filter((r) => r.row.phase === 'measure');
  const before = gs.rows.filter((r) => r.row.phase !== 'measure' && r.row.phase !== 'end');
  const startBox = before.length ? before[before.length - 1].box : gs.g.start.startH;
  const R = { freezes: 0, renames: 0, clamps: 0, skips: 0, unchanged: 0, segs: 0, floorViol: 0, refViol: 0, maxJump: 0, jumpAt: null, boxes: [{ ...startBox }], runC2: null, maxRunCentreErr: 0, minByW: { ...startBox }, minByH: { ...startBox } };
  let prevBox = { ...startBox }, lastKey = null, prevAnc = before.length ? (before[before.length - 1].row.anc1 || before[before.length - 1].row.anc0) : gs.g.start.anc;
  for (const { row, C } of rows) {
    if (row.clamped) R.clamps++;
    if (C.cls === 'skip') { R.skips++; R.boxes.push({ ...prevBox }); continue; }
    if (C.cls === 'unchanged') { R.unchanged++; R.boxes.push({ ...prevBox }); continue; }
    if (C.cls !== 'proceed') { R.boxes.push({ ...prevBox }); continue; }
    const B = boxOf(C.bbf.H);
    if (C.bbf.fz) R.freezes++;
    if (C.bbf.anc !== prevAnc) R.renames++;
    prevAnc = C.bbf.anc;
    if (row.seg !== lastKey) { R.segs++; lastKey = row.seg; }
    if (B.w < fl.w || B.h < fl.h) R.floorViol++;
    const [xs, ys, Fx, Fy, C2x, C2y] = row.ref;
    if (!C.bbf.fz) {
      if (C2x === null && C2y === null) {
        if (xs && (xs > 0 ? B.x : B.x + B.w) !== Fx) R.refViol++;
        if (ys && (ys > 0 ? B.y : B.y + B.h) !== Fy) R.refViol++;
      } else {
        if (xs && Math.abs(2 * B.x + B.w - C2x) > 1) R.refViol++;
        if (ys && Math.abs(2 * B.y + B.h - C2y) > 1) R.refViol++;
        if (!R.runC2) R.runC2 = { x: C2x, y: C2y };
        if (xs && R.runC2.x !== null) R.maxRunCentreErr = Math.max(R.maxRunCentreErr, Math.abs(2 * B.x + B.w - R.runC2.x) / 200);
        if (ys && R.runC2.y !== null) R.maxRunCentreErr = Math.max(R.maxRunCentreErr, Math.abs(2 * B.y + B.h - R.runC2.y) / 200);
      }
    }
    const j = edgeJump(prevBox, B);
    if (j > R.maxJump) { R.maxJump = j; R.jumpAt = { pointer: [row.cx, row.cy], from: { ...prevBox }, to: { ...B } }; }
    prevBox = { ...B };
    if (B.w < R.minByW.w) R.minByW = { ...B };
    if (B.h < R.minByH.h) R.minByH = { ...B };
    R.boxes.push({ ...B });
  }
  const n = R.boxes.length;
  let mismatch = 0;
  for (let i = 0; i < (n - 1) / 2; i++) if (!sameBox(R.boxes[i], R.boxes[n - 1 - i])) mismatch++;
  R.returnMismatch = mismatch;
  R.start = R.boxes[0];
  R.final = R.boxes[n - 1];
  R.measuredMoves = rows.length;
  R.anchorEnd = prevAnc;
  delete R.boxes;
  return R;
}

function expectations(M, c, P, gStates, runOut, fail, info) {
  const G0 = gStates[0];
  const need = (cond, msg) => { if (!cond) fail(msg); };
  const out = { extra: {} };
  const firstFl = (gs) => ({ w: Math.min(400, gs.g.start.startH.w), h: Math.min(400, gs.g.start.startH.h) });
  switch (c.expect) {
    case 'oneEdgeRatio': case 'centredRatio': case 'free': case 'minBox': case 'grandfathered': case 'centreCarry': {
      need(gStates.length === 1, `expected one gesture, got ${gStates.length}`);
      if (!G0) return out;
      const R = pathMetrics(G0, firstFl(G0));
      out.extra.path = R;
      info.push(`path: ${R.measuredMoves} measured moves; freezes ${R.freezes}, renames ${R.renames}, clamped ${R.clamps}, Konva [-1,1) skips ${R.skips}, Konva unchanged-anchor returns ${R.unchanged}, segments ${R.segs}, floor violations ${R.floorViol}, reference violations ${R.refViol}, out/back mismatches ${R.returnMismatch}, max edge jump ${R.maxJump.toFixed(2)} mm; start ${fmt(R.start)} -> back ${fmt(R.final)}; end anchor ${R.anchorEnd}`);
      if (c.expect === 'oneEdgeRatio') need(R.freezes === 0 && R.renames === 0 && R.skips === 0 && R.returnMismatch === 0 && R.floorViol === 0 && R.refViol === 0 && R.maxJump <= 1.0 && R.clamps > 0, `one-edge ratio expectations (0 freezes/renames/skips/mismatches/violations, max jump <= 1 mm, clamp engaged) not met`);
      if (c.expect === 'centredRatio') need(R.freezes >= 1 && R.renames >= 1 && R.returnMismatch === 0 && R.floorViol === 0 && R.refViol === 0 && R.maxJump <= 1.0 && R.maxRunCentreErr <= 0.005, `centred ratio expectations (freeze + rename at the centre, exact return, centre within 0.005 mm, max jump <= 1 mm) not met (centre err ${R.maxRunCentreErr})`);
      if (c.expect === 'free') need(R.freezes >= 1 && R.renames >= 1 && R.floorViol === 0 && R.refViol === 0 && R.maxJump <= 1.0, 'free-axis #11 expectations (freeze + rename at the floor, continuous) not met');
      if (c.expect === 'minBox') { need(R.minByW.w === 534 && R.minByW.h === 401 && R.freezes === 0 && R.renames === 0 && R.returnMismatch === 0, `E10: minimum box ${fmt(R.minByW)}, expected 5.34 x 4.01 with 0 freezes/renames/mismatches`); }
      if (c.expect === 'grandfathered') { need(R.minByH.w >= 250 && R.minByH.h === 2000 && R.minByW.w === 250 && R.freezes === 0 && R.returnMismatch === 0, `E11: smallest box ${fmt(R.minByH)} / ${fmt(R.minByW)}, expected never below 2.5 x 20`); }
      if (c.expect === 'centreCarry') { need(R.maxRunCentreErr <= 0.005 && R.renames >= 6, `E13: centre error ${R.maxRunCentreErr} mm (<= 0.005), renames ${R.renames} (>= 6)`); }
      return out;
    }
    case 'fast': {
      if (!G0) return out;
      const ms = G0.rows.filter((r) => r.row.phase === 'measure');
      need(ms.length === 2, `E12: expected 2 measured moves, got ${ms.length}`);
      if (ms.length >= 1) {
        const r0 = ms[0];
        info.push(`E12: fast move -> ${r0.C.cls}${r0.C.bbf ? ' ' + fmt(boxOf(r0.C.bbf.H)) + ' anchor ' + r0.C.bbf.anc + (r0.C.bbf.fz ? ' FROZEN' : '') : ''}; clamped ${r0.row.clamped}`);
        need(r0.C.cls === 'proceed' && r0.C.bbf && !r0.C.bbf.fz && sameBox(boxOf(r0.C.bbf.H), { x: 10000, y: 10000, w: 534, h: 401 }) && r0.C.bbf.anc === 'bottom-right', 'E12: the fast move did not land on the minimum box 5.34 x 4.01 at the fixed corner (100, 100) without freeze or rename');
      }
      return out;
    }
    case 'boundary': default: break;
  }
  if (c.group === 'H') {
    const b = c.boundary;
    if (!G0) { fail('no gesture'); return out; }
    const ms = G0.rows.filter((r) => r.row.phase === 'measure');
    if (ms.length !== 1) { fail(`expected one measured move, got ${ms.length}`); return out; }
    const { row, C } = ms[0];
    const tested = b.dim === 'width' ? (C.irs[0] ? C.irs[0].v : undefined) : C.irs[1] ? C.irs[1].v : C.irs[0] && C.irs[0].res ? null : undefined;
    const delivered = [row.cx, row.cy];
    out.extra.boundary = { requested: b.v, label: b.label, delivered, konvaTested: tested, cls: C.cls, anchorAfter: C.bbf ? C.bbf.anc : row.anc0, extent: C.bbf ? (b.dim === 'width' ? C.bbf.nb[2] : C.bbf.nb[3]) : null, box: C.bbf ? C.bbf.H : null, frozen: C.bbf ? C.bbf.fz : null };
    if (b.dim === 'height' && C.irs[0] && Math.abs(C.irs[0].v) < 1) fail('height case: the width was not outside the skip interval');
    if (tested === undefined || tested === null || !Object.is(tested, b.v)) {
      out.notExecuted = `exact extent not delivered: Konva tested ${tested} px, requested ${b.v}; pointer delivered at (${delivered.join(', ')})`;
      return out;
    }
    const expectSkip = -1 <= b.v && b.v < 1;
    const res = b.dim === 'width' ? C.irs[0].res : C.irs[1].res;
    need(res === expectSkip, `Konva _inRange(${b.v}, -1, 1) returned ${res}, expected ${expectSkip}`);
    need((C.cls === 'skip') === expectSkip, `class ${C.cls}, expected ${expectSkip ? 'skip' : 'proceed'}`);
    if (!expectSkip) {
      const ext = b.dim === 'width' ? C.bbf.nb[2] : C.bbf.nb[3];
      need(Object.is(ext, b.v), `boundBoxFunc received extent ${ext}, expected exactly ${b.v}`);
      const renamedTo = b.dim === 'width' ? 'middle-left' : 'top-center';
      need((C.bbf.anc === renamedTo) === (b.v < 0), `anchor at boundBoxFunc ${C.bbf.anc} (rename expected: ${b.v < 0})`);
      if (b.v < 0) need(C.bbf.fz === true && sameBox(boxOf(C.bbf.H), G0.g.start.startH), 'negative extent: expected freeze holding the start box');
      else need(!C.bbf.fz && (b.dim === 'width' ? C.bbf.H[2] === 400 && C.bbf.H[0] === 10000 : C.bbf.H[3] === 400 && C.bbf.H[1] === 10000), `+1 px: expected the 4 mm floor at the fixed edge, got ${JSON.stringify(C.bbf.H)}`);
    } else need(!C.bbf && G0.g.end && JSON.stringify(G0.g.end.stored) === JSON.stringify([G0.cfg.box.x, G0.cfg.box.y, G0.cfg.box.w, G0.cfg.box.h]), 'skip: the box must hold (no boundBoxFunc, stored box unchanged)');
    info.push(`boundary ${b.dim} ${b.label}: pointer delivered (${delivered.join(', ')}); Konva tested exactly ${tested}; ${C.cls}${C.bbf ? `, anchor ${C.bbf.anc}, bounded ${fmt(boxOf(C.bbf.H))}${C.bbf.fz ? ' (frozen)' : ''}` : ''}`);
    return out;
  }
  switch (c.expect) {
    case 'noop': {
      need(gStates.length === 1, 'one gesture');
      if (!G0) return out;
      const cls = G0.rows.map((r) => r.row.cls);
      need(cls.length === 6 && cls.every((x) => x === 'pending'), `every sub-threshold move must be pending (no Konva transform), got ${cls.join(',')}`);
      need(G0.g.end && G0.g.end.et === 'mouseup' && JSON.stringify(G0.g.end.stored) === JSON.stringify([G0.cfg.box.x, G0.cfg.box.y, G0.cfg.box.w, G0.cfg.box.h]) && G0.g.end.last === null, 'release after a sub-threshold wiggle must leave the box untouched with no bounded move');
      info.push(`threshold: ${cls.length} sub-threshold moves, all returned oldAbs, Konva ran no transform`);
      return out;
    }
    case 'cross': {
      if (!G0) return out;
      const pre = G0.rows.filter((r) => r.row.phase === null || r.row.phase === undefined);
      const cross = G0.rows.filter((r) => r.row.phase === 'cross');
      const lat = G0.rows.filter((r) => r.row.phase === 'latched');
      need(pre.length === 4 && pre.every((r) => r.row.cls === 'pending'), `4 pending moves before the crossing, got ${pre.map((r) => r.row.cls).join(',')}`);
      need(cross.length === 1 && cross[0].row.cls === 'proceed' && cross[0].row.sx === true && cross[0].model && cross[0].model.segKey === 'bottom-right|true|false', 'the crossing move must transform, in ratio mode from the Shift pressed below the threshold');
      need(lat.length === 2 && lat.every((r) => r.row.cls !== 'pending'), 'moves back inside 3 px after crossing must stay live (latch)');
      if (cross[0]) info.push(`threshold: crossing at (${cross[0].row.cx}, ${cross[0].row.cy}) -> ${cross[0].row.H ? fmt(boxOf(cross[0].row.H)) : cross[0].row.cls} (full displacement from the press, ratio)`);
      return out;
    }
    case 'coords': {
      if (!G0) return out;
      const n = G0.rows.filter((r) => r.row.cls === 'proceed').length;
      need(n >= 20, `expected >= 20 transformed moves, got ${n}`);
      info.push(`coordinate space: ${n} boundBoxFunc calls; oldBox/newBox are absolute stage px (group-transformed) within ${TOL.anchor} / ${TOL.raw} px`);
      return out;
    }
    case 'transitions': {
      if (!G0) return out;
      const keys = [];
      for (const r of G0.rows) if (r.row.seg && keys[keys.length - 1] !== r.row.seg) keys.push(r.row.seg);
      const expected = ['bottom-right|false|false', 'bottom-right|true|false', 'bottom-right|false|false', 'bottom-right|false|true', 'bottom-right|true|true', 'bottom-right|true|false', 'bottom-right|false|false'];
      need(JSON.stringify(keys) === JSON.stringify(expected), `segment sequence ${keys.join(' > ')} (expected ${expected.join(' > ')})`);
      let ratioErr = 0, centreErr = 0, refViol = 0;
      for (const { row, C } of G0.rows) {
        if (!C.bbf || C.bbf.fz) continue;
        const B = boxOf(C.bbf.H);
        const [xs, ys, Fx, Fy, C2x, C2y] = row.ref;
        if (C2x === null) { if ((xs > 0 ? B.x : B.x + B.w) !== Fx || (ys > 0 ? B.y : B.y + B.h) !== Fy) refViol++; }
        else centreErr = Math.max(centreErr, Math.abs(2 * B.x + B.w - C2x) / 200, Math.abs(2 * B.y + B.h - C2y) / 200);
        if (row.seg.includes('|true|')) { const S0 = G0.g.start.startH; const kx = C.bbf.k === 'x'; const [ks, os, S0k, S0o] = kx ? [B.w, B.h, S0.w, S0.h] : [B.h, B.w, S0.h, S0.w]; ratioErr = Math.max(ratioErr, Math.abs(os - (ks * S0o) / S0k) / 100); }
      }
      need(refViol === 0 && centreErr <= 0.005 && ratioErr <= 0.005 + 1e-12, `G1/G5/G6: fixed-edge violations ${refViol}, centre error ${centreErr} mm, ratio error ${ratioErr} mm`);
      info.push(`segments ${keys.length}: ${keys.join(' > ')}; fixed-edge violations ${refViol}; max centre error ${centreErr} mm; max ratio error ${ratioErr.toFixed(6)} mm`);
      return out;
    }
    case 'b2': {
      if (!G0) return out;
      const free1 = G0.rows.filter((r) => !r.row.phase && r.C.bbf);
      const alt = G0.rows.filter((r) => r.row.phase === 'alt' && r.C.bbf);
      const free2 = G0.rows.filter((r) => r.row.phase === 'free' && r.C.bbf);
      const lastFree = free1.length ? boxOf(free1[free1.length - 1].C.bbf.H) : null;
      const C2 = alt.length ? alt[0].row.ref[4] : null;
      need(lastFree && C2 === 2 * lastFree.x + lastFree.w, `Alt press captures the centre from the previous box: C2 ${C2}, expected ${lastFree && 2 * lastFree.x + lastFree.w}`);
      need(alt.every((r) => Math.abs(2 * r.C.bbf.H[0] + r.C.bbf.H[2] - C2) <= 1), 'centre held within 0.005 mm while Alt is held');
      const lastAlt = alt.length ? boxOf(alt[alt.length - 1].C.bbf.H) : null;
      need(lastAlt && free2.length && free2[0].row.ref[2] === lastAlt.x && free2.every((r) => r.C.bbf.H[0] === lastAlt.x), 'after Alt release the left edge is fixed at the last Alt box left');
      info.push(`B2: free ${fmt(lastFree)}; Alt centre ${C2 / 200} mm; last Alt ${fmt(lastAlt)}; after release ${free2.length ? fmt(boxOf(free2[free2.length - 1].C.bbf.H)) : '-'}`);
      return out;
    }
    case 'gf': {
      if (!G0) return out;
      const bs = G0.rows.filter((r) => r.C.bbf).map((r) => boxOf(r.C.bbf.H));
      const minW = Math.min(...bs.map((b) => b.w)), maxW = Math.max(...bs.map((b) => b.w));
      need(bs.length > 0 && minW === 250 && maxW > 250 && bs.every((b) => b.h === 2000 && b.x === 10000), `grandfathered: widths ${minW}..${maxW} H; expected never below 250 and enlargement above it, x fixed`);
      info.push(`grandfathered free axis: ${bs.length} bounded moves, width ${minW / 100}..${maxW / 100} mm, never below the 2.5 mm start`);
      return out;
    }
    case 'lc1': {
      if (!G0) return out;
      const g = G0.g;
      need(g.pre.length >= 1 && G0.rows.length > 0 && G0.rows[0].row.phase === 'pressed', 'transformstart fired on the press, before any move');
      need(g.end && g.end.et === 'mouseup', 'transformend carries the mouseup');
      const lastB = [...G0.rows].reverse().find((r) => r.C.bbf);
      const lastMm = G0.rows[G0.rows.length - 1];
      need(g.end && lastMm && g.end.cx === lastMm.row.cx && g.end.cy === lastMm.row.cy, 'release at the last pointer position');
      need(lastB && g.end && JSON.stringify(g.end.stored) === JSON.stringify(lastB.C.trT.stored), 'release box equals the last bounded preview (no recomputation at mouseup)');
      info.push(`press -> transformstart (${g.start.et}) before ${G0.rows.length} moves; release -> transformend (${g.end && g.end.et}); stored at release ${g.end && JSON.stringify(g.end.stored)}`);
      return out;
    }
    case 'click': {
      need(gStates.length === 1 && G0 && G0.rows.length === 0 && G0.g.end && G0.g.end.et === 'mouseup' && G0.g.end.last === null, 'anchor click: transformstart and transformend(mouseup), no move, no bounded box');
      if (G0) need(JSON.stringify(G0.g.end.attrs) === JSON.stringify(log0attrs(G0)), 'attrs unchanged');
      info.push('anchor click: transformstart + transformend(mouseup), 0 moves, 0 boundBoxFunc calls, box unchanged');
      return out;
    }
    case 'synthUp': case 'stop': case 'destroy': case 'blur': case 'escape': {
      need(gStates.length === 1, `one gesture, got ${gStates.length}`);
      if (!G0) return out;
      const g = G0.g;
      const after = P.outside.filter((o) => o.phase === 'after');
      const adbfAfter = after.filter((o) => o.ev.e === 'adbf').length;
      const teAfter = after.filter((o) => o.ev.e === 'te').length;
      const mmAfter = after.filter((o) => o.ev.e === 'mm').length;
      need(mmAfter > 0 && adbfAfter === 0 && teAfter === 0, `after the end: ${mmAfter} moves delivered, ${adbfAfter} anchorDragBoundFunc calls, ${teAfter} transformend (expected moves, 0, 0)`);
      if (c.expect === 'synthUp') {
        need(g.end && g.end.et === 'mouseup' && g.end.cx === 900 && g.end.cy === 700, 'transformend carries the synthetic mouseup');
        const lastB = [...G0.rows].reverse().find((r) => r.C.bbf);
        need(lastB && JSON.stringify(g.end.stored) === JSON.stringify(lastB.C.trT.stored), 'the box is the last bounded preview; the mouseup coordinates were not processed');
        info.push(`synthetic mouseup at (900, 700): transformend(mouseup), stored ${JSON.stringify(g.end && g.end.stored)} = last preview; later moves inert`);
      } else {
        need(g.end && g.end.et === null, `transformend without an event (got ${g.end && g.end.et})`);
        if (c.expect === 'destroy') {
          need(runOut.cursorHover && runOut.cursorHover !== '' && runOut.cursorAfter === '', `destroy clears the anchor cursor: hover '${runOut.cursorHover}', after '${runOut.cursorAfter}'`);
          info.push(`destroy: the Transformer's transformend fired without an event; the node's transformend ${G0.nodeEnd ? 'also fired' : 'did not fire (destroy() detaches the node first)'}`);
        }
        if (c.expect === 'escape' || c.expect === 'blur') {
          const lastMove = G0.rows[G0.rows.length - 1];
          const evs = lastMove ? lastMove.C && G0.g.moves[G0.g.moves.length - 1].ev : [];
          const cancelEv = evs.find((e) => e.e === 'cancel');
          need(cancelEv && cancelEv.reason === (c.expect === 'escape' ? 'escape' : 'blur'), 'session cancel recorded');
          if (c.expect === 'escape') {
            const kdI = evs.findIndex((e) => e.e === 'kd' && e.key === 'Escape');
            need(kdI >= 0 && !evs.some((e) => e.e === 'shellKey'), 'Escape seen in capture, never reached the shell handler during the gesture');
            const rest = P.outside.filter((o) => o.phase === 'rest');
            need(rest.some((o) => o.ev.e === 'shellKey' && o.ev.key === 'Escape'), 'the next Escape (no gesture) reaches the shell handler');
          }
          const restored = after.find((o) => o.ev.e === 'restored') || P.outside.find((o) => o.ev.e === 'restored');
          const st = P.outside.find((o) => o.ev.e === 'restored');
          need(st && JSON.stringify([st.ev.attrs.x, st.ev.attrs.y, st.ev.attrs.width, st.ev.attrs.height]) === JSON.stringify([G0.cfg.box.x, G0.cfg.box.y, G0.cfg.box.w, G0.cfg.box.h]), 'model attrs restored after cancel');
          void restored;
        }
        info.push(`${c.expect}: transformend(no event); later ${mmAfter} moves inert; release inert`);
      }
      return out;
    }
    case 'defaults': {
      const d = runOut.defaults || {};
      out.extra.defaults = d;
      need(d.keepRatio === true && d.flipEnabled === true && d.rotateEnabled === true, `defaults keepRatio ${d.keepRatio}, flipEnabled ${d.flipEnabled}, rotateEnabled ${d.rotateEnabled} (plan §4.1: all true, so they are set explicitly)`);
      info.push(`Konva.Transformer defaults: ${JSON.stringify(d)}`);
      return out;
    }
    case 'cornerOnly': {
      need(gStates.length === 5, `5 gestures, got ${gStates.length}`);
      const chk = (gs, fn, label) => { const rs = gs ? gs.rows.filter((r) => r.C.bbf) : []; need(rs.length > 0 && rs.every((r) => fn(r.C.bbf)), label); };
      chk(gStates[0], (b) => Math.abs(b.nb[3] - b.old[3]) <= 1e-9 && b.nb[1] === b.old[1], 'side anchor + keepRatio + Shift: height untouched (no ratio)');
      chk(gStates[1], (b) => Math.abs(b.nb[2] - b.old[2]) <= 1e-9 && b.nb[0] === b.old[0], 'top-center + Shift: width untouched (no ratio)');
      const ratioOK = (b) => Math.abs(b.nb[2] * 3 - b.nb[3] * 4) <= 1e-6;
      chk(gStates[2], ratioOK, 'corner + keepRatio, no Shift: Konva keeps the start ratio 4:3');
      chk(gStates[3], ratioOK, 'corner + Shift, keepRatio off: Konva keeps the start ratio 4:3');
      const rs5 = gStates[4] ? gStates[4].rows.filter((r) => r.C.bbf) : [];
      need(rs5.length > 0 && rs5.some((r) => !ratioOK(r.C.bbf)), 'corner, keepRatio off, no Shift: free (not ratio)');
      info.push('keepProportion = keepRatio || Shift, corner branches only: side anchors ignore both; corners follow either');
      return out;
    }
    case 'anchors': {
      const names = ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'];
      need(gStates.length === 8, `8 gestures, got ${gStates.length}`);
      gStates.forEach((gs, i) => {
        need(gs.g.start.anc === names[i], `gesture ${i}: pressed ${gs.g.start.anc}, intended ${names[i]}`);
        const R = pathMetrics({ ...gs, rows: gs.rows.map((r) => ({ ...r, row: { ...r.row, phase: 'measure' } })) }, firstFl(gs));
        need(R.refViol === 0 && R.floorViol === 0, `${names[i]}: fixed-edge violations ${R.refViol}`);
      });
      info.push('all 8 anchors pressed as intended; raw boxes match the port per branch; fixed edges held');
      return out;
    }
    case 'ellipse': {
      need(gStates.length === 2 && gStates.every((gs) => gs.rows.some((r) => r.C.bbf)), 'two ellipse gestures with transforms');
      const R = gStates[1] ? pathMetrics({ ...gStates[1], rows: gStates[1].rows.map((r) => ({ ...r, row: { ...r.row, phase: 'measure' } })) }, firstFl(gStates[1])) : null;
      if (R) need(R.renames === 0 && R.freezes === 0 && R.clamps > 0, 'ellipse ratio crossing: clamp engaged, no rename/freeze');
      info.push('ellipse: x/y centre and radii re-applied unscaled after every transform; client rect = bounded box');
      return out;
    }
    case 'cursor': {
      const r = runOut;
      out.extra.cursor = r;
      need(r['hover:bottom-right'] === 'nwse-resize' && r['hover:middle-right'] === 'ew-resize' && r['hover:top-center'] === 'ns-resize' && r['hover:top-right'] === 'nesw-resize', `anchor cursors ${JSON.stringify(r)}`);
      need(r.away === '', `cursor after leaving the anchors '${r.away}'`);
      need(r.hoverAgain === 'nwse-resize' && r.afterListeningFalse === 'nwse-resize', `listening(false) while hovering leaves the inner cursor set (stale): '${r.afterListeningFalse}'`);
      need(r.afterClear === '', 'the session clear empties the inner cursor');
      const inactive = P.outside.filter((o) => o.phase === 'inactive-press');
      const gInactive = P.gestures.filter((g) => g.phase0 === 'inactive-press');
      need(gInactive.length === 0 && inactive.some((o) => o.ev.e === 'md') && !inactive.some((o) => o.ev.e === 'adbf'), 'a press on an inactive anchor starts no transform');
      const kmd = inactive.find((o) => o.ev.e === 'kmd');
      need(!kmd || !String(kmd.ev.target).includes('anchor'), `the inactive press is not delivered to an anchor (target ${kmd && kmd.ev.target})`);
      need(r.stateInactive && JSON.stringify(r.stateInactive.stored) === JSON.stringify([c.setup.box.x, c.setup.box.y, c.setup.box.w, c.setup.box.h]), 'box unchanged by the inactive press');
      need(r.hoverReactivated === 'nwse-resize', 'cursor set again after reactivation');
      const gAct = P.gestures.filter((g) => g.phase0 === 'reactivated');
      need(gAct.length === 1, 'reactivated anchor transforms');
      info.push(`cursors: ${['bottom-right', 'middle-right', 'top-center', 'top-right'].map((a) => a + ' ' + r['hover:' + a]).join(', ')}; listening(false) leaves '${r.afterListeningFalse}' until cleared -> '${r.afterClear}'; inactive press target ${kmd ? kmd.ev.target : 'none'}; destroy at rest -> '${r.destroyAtRest}'`);
      return out;
    }
    case 'hitOrder': {
      const g1 = P.gestures.filter((g) => g.phase0 !== 'control');
      const ctl = P.outside.filter((o) => o.phase === 'control');
      need(g1.length === 1 && !g1[0].pre.some((e) => e.e === 'overlayDown'), 'Transformer layer on top: the anchor press starts a transform and the overlay rect gets no mousedown');
      need(P.gestures.filter((g) => g.phase0 === 'control').length === 0 && ctl.some((o) => o.ev.e === 'overlayDown'), 'control (listening layer above): the overlay takes the press, no transform');
      const k1 = ctl.find((o) => o.ev.e === 'kmd');
      info.push(`hit order: Transformer layer on top -> transform; overlay above -> press goes to ${k1 ? k1.ev.target : '?'}, no transform`);
      return out;
    }
    case 'wheel': case 'wheelFrozen': case 'wheelZoomControl': {
      if (!G0) return out;
      const evs = G0.g.moves.flatMap((m) => m.ev);
      const wh = evs.filter((e) => e.e === 'wh');
      const kwh = evs.filter((e) => e.e === 'kwh');
      const prevented = evs.filter((e) => e.e === 'whPrevented');
      const vb = runOut.vpBefore, va = runOut.vpAfter;
      const vpSame = vb && va && vb.innerWidth === va.innerWidth && vb.innerHeight === va.innerHeight && vb.devicePixelRatio === va.devicePixelRatio && vb.visualScale === va.visualScale;
      out.extra.wheel = { delivered: wh.map((e) => [e.dx, e.dy, e.ctrl, e.tr]), konva: kwh.length, prevented: prevented.length, vpBefore: vb, vpAfter: va };
      need(wh.length === runOut.wheels && wh.every((e) => e.tr === true), `wheel delivered during the transform: ${wh.length} of ${runOut.wheels} DOM wheel events (transforming: ${wh.map((e) => e.tr).join(',')})`);
      need(kwh.length === runOut.wheels, `Konva stage wheel events during the transform: ${kwh.length}`);
      const wheelMoves = G0.g.moves.filter((m) => m.ev.some((e) => e.e === 'wh'));
      need(wheelMoves.every((m) => m.ev.filter((e) => e.e === 'adbf').length <= 1), 'wheel triggers no extra anchorDragBoundFunc');
      if (c.expect === 'wheelFrozen' || c.expect === 'wheelZoomControl') need(wh[1] && wh[1].ctrl === true, 'the Control+wheel arrives with ctrlKey');
      if (c.expect === 'wheel') need(vpSame, `plain wheel changed the viewport ${JSON.stringify(vb)} -> ${JSON.stringify(va)}`);
      if (c.expect === 'wheelFrozen') {
        need(prevented.length === 3 && prevented[1].ctrl === true, `the freeze prevented ${prevented.length} of 3 wheel events`);
        need(vpSame, `with the freeze the viewport must not change: ${JSON.stringify(vb)} -> ${JSON.stringify(va)}`);
      }
      const zoomed = !vpSame;
      info.push(`wheel during transform: ${wh.length} DOM wheel events (deltas ${wh.map((e) => `${e.dx},${e.dy}${e.ctrl ? ' ctrl' : ''}`).join(' | ')}), ${kwh.length} Konva stage wheel events, ${prevented.length} prevented; viewport ${zoomed ? `CHANGED ${JSON.stringify(vb)} -> ${JSON.stringify(va)}` : 'unchanged'}; no transform callback from the wheel`);
      return out;
    }
    default: return out;
  }
}
function log0attrs(gs) { const b = gs.cfg.box; return { x: b.x, y: b.y, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0, width: b.w, height: b.h }; }
