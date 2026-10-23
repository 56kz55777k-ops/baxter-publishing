// Slice D stage 1 — isolated Konva probe page (browser side). NOT production code: not imported by the app,
// not linted, not built, not run by CI. Served only by run-probe.mjs on 127.0.0.1.
//
// It loads the repo-locked Konva 10.3.0 from node_modules/konva/lib (the ESM build the app resolves), attaches a
// real Konva.Transformer to one element inside a zoomed parent Group, and wires the plan's three session hooks
// (§4.3: anchorBound -> anchorDragBoundFunc, boxBound -> boundBoxFunc, onTransform -> 'transform') to the REVIEWED
// model functions (createSession, capture, bound, ...) that /model.js serves verbatim from
// docs/evidence/slice-d-math-check.js. Every callback is logged, with the exact numbers Konva passed, so the Node
// runner can replay the same delivered input through the model's Konva port and compare.
//
// Instrumentation only observes: the one wrapper (Konva.Util._inRange) calls the original and returns its result
// unchanged; it lets the runner see the exact width/height Konva tested for its [-1, 1) px early return.
import Konva from '/konva/lib/index.js';

const LOG = [];
const push = (o) => { LOG.push(o); };
const state = { stage: null, tr: null, node: null, cfg: null, view: null, stored: null, session: null, removeSessionListeners: null };
const box4 = (b) => [b.x, b.y, b.width, b.height];
const ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'];
const OPPOSITE = { 'top-left': 'bottom-right', 'bottom-right': 'top-left', 'top-right': 'bottom-left', 'bottom-left': 'top-right' };

// ---------- observation (capture phase on window, registered before Konva adds its own window listeners) ----------
window.addEventListener('mousemove', (e) => push({ e: 'mm', cx: e.clientX, cy: e.clientY, sx: e.shiftKey, ax: e.altKey, bt: e.buttons }), true);
window.addEventListener('mousedown', (e) => push({ e: 'md', cx: e.clientX, cy: e.clientY, sx: e.shiftKey, ax: e.altKey }), true);
window.addEventListener('mouseup', (e) => push({ e: 'mu', cx: e.clientX, cy: e.clientY, synthetic: !e.isTrusted }), true);
window.addEventListener('keydown', (e) => push({ e: 'kd', key: e.key }), true);
window.addEventListener('keyup', (e) => push({ e: 'ku', key: e.key }), true);
// stands in for the editor shell's resting-state key handler (bubble phase): Escape must not reach it mid-resize
window.addEventListener('keydown', (e) => push({ e: 'shellKey', key: e.key }));
document.getElementById('stage').addEventListener('wheel', (e) => push({ e: 'wh', dx: e.deltaX, dy: e.deltaY, ctrl: e.ctrlKey, tr: Boolean(state.tr && state.tr.isTransforming()) }), { capture: true, passive: true });

// plan §4.6 viewport freeze, wheel part only (enabled per case): during a resize session, preventDefault() so the
// browser neither scrolls nor zooms (Firefox zooms the page on an unprevented Ctrl+wheel)
document.getElementById('stage').addEventListener('wheel', (e) => {
  if (state.cfg && state.cfg.freezeWheel && state.session) { e.preventDefault(); push({ e: 'whPrevented', ctrl: e.ctrlKey }); }
}, { capture: true, passive: false });

const origInRange = Konva.Util._inRange;
Konva.Util._inRange = function inRangeObserved(val, left, right) {
  const res = origInRange.call(this, val, left, right);
  // only the Transformer's early-return test uses (-1, 1) here (padding 0); getCursor uses angle ranges
  if (left === -1 && right === 1 && state.tr && state.tr.isTransforming()) push({ e: 'ir', v: val, l: left, r: right, res });
  return res;
};

// ---------- element rendering (plan §4.3 nodeAttrsFor: unscaled attrs; stroke/radius never scaled) ----------
function attrsFor(shape, b) {
  if (shape === 'ellipse') return { x: b.x + b.w / 2, y: b.y + b.h / 2, radiusX: b.w / 2, radiusY: b.h / 2, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0 };
  return { x: b.x, y: b.y, width: b.w, height: b.h, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0 };
}
function nodeAttrs() {
  const n = state.node;
  const a = { x: n.x(), y: n.y(), scaleX: n.scaleX(), scaleY: n.scaleY(), rotation: n.rotation(), skewX: n.skewX(), skewY: n.skewY() };
  if (state.cfg.shape === 'ellipse') { a.radiusX = n.radiusX(); a.radiusY = n.radiusY(); } else { a.width = n.width(); a.height = n.height(); }
  return a;
}
const absRect = () => box4(state.node.getClientRect({ skipShadow: true, skipStroke: true }));
// plan §3.2: the start box is converted edge-wise into integer hundredths
function edgeH(b) {
  const L = toH(b.x), R = toH(b.x + b.w), T = toH(b.y), B = toH(b.y + b.h);
  return { x: L, y: T, w: R - L, h: B - T };
}

// ---------- the session hooks (plan §4.3), built on the reviewed model functions ----------
function comparePoints(tr, anc) {
  const tl = tr.findOne('.top-left').getAbsolutePosition();
  const out = { cmpC: [tl.x + tr.width() / 2, tl.y + tr.height() / 2] };
  if (OPPOSITE[anc]) { const o = tr.findOne('.' + OPPOSITE[anc]).getAbsolutePosition(); out.cmp = [o.x, o.y]; }
  return out;
}
function anchorBound(oldAbs, newPos, evt) {
  const S = state.session, tr = state.tr;
  const anc = tr.getActiveAnchor();
  const rec = { e: 'adbf', anc, old: [oldAbs.x, oldAbs.y], np: [newPos.x, newPos.y], cx: evt.clientX, cy: evt.clientY, sx: evt.shiftKey, ax: evt.altKey, et: evt.type, kr: tr.keepRatio(), ...comparePoints(tr, anc) };
  if (!S || S.cancelled) { rec.why = 'no-session'; rec.ret = [newPos.x, newPos.y]; push(rec); return newPos; }
  // D-5: 3 screen px (Euclidean, CSS px) from the press point, latched once crossed (use-stage-gestures DRAG_THRESHOLD_PX)
  if (!S.crossed) {
    if (Math.hypot(evt.clientX - S.press.x, evt.clientY - S.press.y) < 3) { rec.why = 'pending'; rec.ret = [oldAbs.x, oldAbs.y]; push(rec); return oldAbs; }
    S.crossed = true;
  }
  const v = S.view;
  const { xs, ys } = axesOf(anc);
  const ratioFlag = Boolean(tr.keepRatio() || evt.shiftKey); // Konva: keepRatio() || shiftKey (shiftBehavior 'default')
  const alt = Boolean(evt.altKey);
  const ratio = Boolean(ratioFlag && xs && ys);
  const key = segKey(anc, ratio, alt);
  if (!S.s.seg || S.s.seg.key !== key) S.s.seg = capture(S.s.prev, anc, ratio, alt, S.s.seg);
  const g = S.s.seg;
  const target = { x: newPos.x, y: newPos.y };
  let clamped = false;
  if (ratio && !alt) {
    const Fx = mmToPxX(g.Fx / 100, v), Fy = mmToPxY(g.Fy / 100, v);
    rec.F = [Fx, Fy];
    if (S.clampOn) {
      // plan §3.5 step 0 (Q7 proposal), exactly as gestureMove in the evidence script
      const S0 = S.s.start, big = S0.w >= S0.h ? 'x' : 'y';
      const S0k = big === 'x' ? S0.w : S0.h, S0o = big === 'x' ? S0.h : S0.w;
      const flk = big === 'x' ? S.s.fl.w : S.s.fl.h, flo = big === 'x' ? S.s.fl.h : S.s.fl.w;
      const kMin = Math.max(flk, ceilDiv(flo * S0k, S0o)), oMin = roundHalfUpDiv(kMin * S0o, S0k);
      const minW = ((big === 'x' ? kMin : oMin) / 100) * v.scale, minH = ((big === 'x' ? oMin : kMin) / 100) * v.scale;
      rec.minExt = [minW, minH];
      if (xs * (target.x - Fx) < minW) { target.x = Fx + xs * minW; clamped = true; }
      if (ys * (target.y - Fy) < minH) { target.y = Fy + ys * minH; clamped = true; }
    }
  }
  if (alt) rec.C = [g.C2x !== undefined ? mmToPxX(g.C2x / 200, v) : null, g.C2y !== undefined ? mmToPxY(g.C2y / 200, v) : null];
  S.move = { ratioFlag, alt, target };
  rec.why = 'live';
  rec.clamped = clamped;
  rec.seg = g.key;
  rec.ref = [g.xs, g.ys, g.Fx ?? null, g.Fy ?? null, g.C2x ?? null, g.C2y ?? null];
  rec.ret = [target.x, target.y];
  push(rec);
  return target;
}
function boxBound(oldBox, newBox) {
  const S = state.session, tr = state.tr, v = S.view;
  const anc = tr.getActiveAnchor(); // Konva renames before calling boundBoxFunc
  const rec = { e: 'bbf', anc, old: box4(oldBox), nb: box4(newBox) };
  const raw = { l: (newBox.x - v.vx) / v.scale, r: (newBox.x + newBox.width - v.vx) / v.scale, t: (newBox.y - v.vy) / v.scale, b: (newBox.y + newBox.height - v.vy) / v.scale };
  const anchorMm = { x: (S.move.target.x - v.vx) / v.scale, y: (S.move.target.y - v.vy) / v.scale };
  const res = bound(S.s, raw, anc, S.move.ratioFlag, S.move.alt, anchorMm);
  const B = { x: res.box.x, y: res.box.y, w: res.box.w, h: res.box.h };
  S.last = B;
  const px = { x: mmToPxX(B.x / 100, v), y: mmToPxY(B.y / 100, v), width: (B.w / 100) * v.scale, height: (B.h / 100) * v.scale, rotation: 0 };
  rec.H = [B.x, B.y, B.w, B.h];
  rec.fz = Boolean(res.frozen);
  rec.k = res.k ?? null;
  rec.px = box4(px);
  push(rec);
  return px;
}
function onTransform() {
  // plan §4.3 onTransform: re-apply the bounded box as unscaled render attrs (scaleX = scaleY = 1)
  const S = state.session, B = S.last;
  state.stored = { x: fromH(B.x), y: fromH(B.y), w: fromH(B.w), h: fromH(B.h) };
  state.node.setAttrs(attrsFor(state.cfg.shape, state.stored));
  push({ e: 'trT', stored: [state.stored.x, state.stored.y, state.stored.w, state.stored.h], attrs: nodeAttrs(), rect: absRect() });
}

function endSessionListeners() { if (state.removeSessionListeners) { state.removeSessionListeners(); state.removeSessionListeners = null; } }
function cancel(reason) {
  const S = state.session;
  if (!S || S.cancelled) return;
  S.cancelled = true;
  push({ e: 'cancel', reason });
  state.tr.stopTransform(); // plan §4.4: fires transformend without an event
  state.stored = { ...S.startStored }; // the preview is discarded; the model attrs come back
  state.node.setAttrs(attrsFor(state.cfg.shape, state.stored));
  state.tr.forceUpdate();
  push({ e: 'restored', attrs: nodeAttrs(), rect: absRect() });
}

function setup(cfg) {
  endSessionListeners();
  if (state.stage) state.stage.destroy();
  LOG.length = 0;
  state.cfg = cfg;
  state.view = { scale: cfg.view.scale, vx: cfg.view.vx, vy: cfg.view.vy };
  state.stored = { ...cfg.box };
  state.session = null;
  const stage = new Konva.Stage({ container: 'stage', width: 1000, height: 800 });
  const docLayer = new Konva.Layer();
  const zoom = new Konva.Group({ x: cfg.view.vx, y: cfg.view.vy, scaleX: cfg.view.scale, scaleY: cfg.view.scale });
  const common = { name: 'element', fill: '#d8c9b0', strokeEnabled: false };
  const node = cfg.shape === 'ellipse' ? new Konva.Ellipse({ ...common, ...attrsFor('ellipse', cfg.box) }) : new Konva.Rect({ ...common, ...attrsFor('rect', cfg.box) });
  zoom.add(node);
  docLayer.add(zoom);
  const overlay = new Konva.Layer({ listening: Boolean(cfg.overlayCover) });
  if (cfg.overlayCover) {
    const c = cfg.overlayCover;
    const cover = new Konva.Rect({ name: 'overlay-cover', x: c[0], y: c[1], width: c[2], height: c[3], fill: 'rgba(0,0,255,0.15)' });
    cover.on('mousedown', () => push({ e: 'overlayDown' }));
    overlay.add(cover);
  }
  const trLayer = new Konva.Layer();
  const trCfg = {
    nodes: [node], rotateEnabled: false, flipEnabled: false, keepRatio: Boolean(cfg.keepRatio), shiftBehavior: 'default',
    centeredScaling: false, ignoreStroke: true, padding: 0, borderEnabled: false, anchorSize: 7, anchorStroke: '#7a1f2b',
    anchorFill: '#ffffff', anchorCornerRadius: 2, enabledAnchors: ANCHORS.slice(),
    anchorDragBoundFunc: anchorBound, boundBoxFunc: boxBound,
  };
  const tr = new Konva.Transformer(trCfg);
  trLayer.add(tr);
  stage.add(docLayer);
  if (cfg.layerOrder === 'overlay-above-transformer') { stage.add(trLayer); stage.add(overlay); }
  else { stage.add(overlay); stage.add(trLayer); }
  stage.on('mousedown', (e) => push({ e: 'kmd', target: e.target.name() || e.target.getClassName() }));
  stage.on('wheel', () => push({ e: 'kwh', tr: tr.isTransforming() }));
  tr.on('transformstart', (e) => {
    const evt = e.evt;
    const anc = tr.getActiveAnchor();
    const r = tr._getNodeRect();
    state.session = {
      s: createSession(edgeH(state.stored), { x: [], y: [] }), view: state.view, press: { x: evt.clientX, y: evt.clientY },
      crossed: false, clampOn: cfg.clamp !== false, startStored: { ...state.stored }, cancelled: false, last: null, move: null,
    };
    push({ e: 'ts', who: 'tr', et: evt ? evt.type : null, cx: evt ? evt.clientX : null, cy: evt ? evt.clientY : null, anc, sin: tr.sin, cos: tr.cos, rect: [r.x, r.y, r.width, r.height], startH: edgeH(state.stored) });
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopImmediatePropagation(); ev.preventDefault(); cancel('escape'); } };
    const onBlur = () => cancel('blur');
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    state.removeSessionListeners = () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('blur', onBlur); };
  });
  node.on('transformstart', (e) => push({ e: 'ts', who: 'node', et: e.evt ? e.evt.type : null }));
  tr.on('transform', () => onTransform());
  node.on('transform', () => push({ e: 'nT' }));
  tr.on('transformend', (e) => {
    const evt = e.evt;
    const S = state.session;
    push({ e: 'te', who: 'tr', et: evt ? evt.type : null, cx: evt ? evt.clientX : null, cy: evt ? evt.clientY : null, attrs: nodeAttrs(), rect: absRect(), stored: [state.stored.x, state.stored.y, state.stored.w, state.stored.h], last: S && S.last ? [S.last.x, S.last.y, S.last.w, S.last.h] : null, cancelled: S ? S.cancelled : null });
    endSessionListeners();
    state.session = null;
  });
  node.on('transformend', (e) => push({ e: 'te', who: 'node', et: e.evt ? e.evt.type : null }));
  stage.draw();
  state.stage = stage; state.tr = tr; state.node = node;
  const anchors = {};
  for (const a of ANCHORS) { const p = tr.findOne('.' + a).getAbsolutePosition(); anchors[a] = [p.x, p.y]; }
  return { anchors, rect: absRect(), attrs: nodeAttrs(), konva: Konva.version };
}

function call(name, arg) {
  const tr = state.tr, stage = state.stage;
  switch (name) {
    case 'mark': push({ e: 'mark', label: arg }); return null;
    case 'stopTransform': push({ e: 'call', name }); tr.stopTransform(); return tr.isTransforming();
    case 'destroy': push({ e: 'call', name, cursorBefore: stage.content.style.cursor }); tr.destroy(); push({ e: 'destroyed', cursor: stage.content.style.cursor }); return stage.content.style.cursor;
    case 'blur': push({ e: 'call', name }); window.dispatchEvent(new Event('blur')); return null;
    case 'syntheticMouseup': push({ e: 'call', name, at: arg }); window.dispatchEvent(new MouseEvent('mouseup', { clientX: arg[0], clientY: arg[1], bubbles: true })); return null;
    case 'setListening': tr.listening(arg); state.stage.draw(); push({ e: 'call', name, arg, cursor: stage.content.style.cursor }); return stage.content.style.cursor;
    case 'clearInnerCursor':
      // plan §4.7: when handles become inactive and no resize is live, clear what an anchor wrote (never set)
      if (!tr.isTransforming()) stage.content.style.cursor = '';
      push({ e: 'call', name, cursor: stage.content.style.cursor });
      return stage.content.style.cursor;
    case 'cursor': return stage.content.style.cursor;
    case 'viewport': return { innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio, visualScale: window.visualViewport ? window.visualViewport.scale : null };
    case 'state': return { stored: [state.stored.x, state.stored.y, state.stored.w, state.stored.h], attrs: nodeAttrs(), rect: absRect(), transforming: tr.isTransforming(), active: tr.getActiveAnchor(), cursor: stage.content.style.cursor };
    case 'defaults': {
      const t = new Konva.Transformer();
      const d = { keepRatio: t.keepRatio(), flipEnabled: t.flipEnabled(), rotateEnabled: t.rotateEnabled(), shiftBehavior: t.shiftBehavior(), centeredScaling: t.centeredScaling(), padding: t.padding(), ignoreStroke: t.ignoreStroke(), borderEnabled: t.borderEnabled(), anchorSize: t.anchorSize() };
      t.destroy();
      return d;
    }
    default: throw new Error('unknown call ' + name);
  }
}

window.probe = { setup, call, takeLog: () => LOG.splice(0, LOG.length), konvaVersion: Konva.version, ready: true };
