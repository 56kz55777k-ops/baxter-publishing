#!/usr/bin/env node
// Slice D stage 5 — real-Konva probe of the resize WIRING. NOT production code: not imported by the app, not
// linted, type-checked, built or run by CI (`docs/` is outside the npm workspaces). Uses only what `npm ci`
// installs (esbuild via vitest, konva 10.3.0, react-konva, @playwright/test 1.62.1) plus a Chromium build.
//
//   node docs/evidence/slice-d-stage5-probe/run-probe.mjs [--chromium <path to chrome>] [--out <dir>]
//
// It bundles `page.tsx` — the REAL EditorShell, SpreadStage, SelectionTransformer, ResizeSession, reducer and
// autosave hook, with real Konva and react-konva — into a standalone page, serves it on 127.0.0.1 only, and drives
// it with real Playwright mouse and keyboard input. Only `fetch` is stood in (every PUT answered 200 and counted).
// No server code, no Supabase, no credentials, no production data, no network beyond localhost.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const requireRepo = createRequire(path.join(REPO, 'apps/web/package.json'));
const pkgVersion = (name) => JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules', name, 'package.json'), 'utf8')).version;
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const OUT = path.resolve(opt('--out', path.join(HERE, 'results')));
const CHROMIUM = opt('--chromium', process.env.PROBE_CHROMIUM ?? undefined);

/* ----------------------------------------------------------------- build */
const build = fs.mkdtempSync(path.join(os.tmpdir(), 's5probe-'));
const esbuild = createRequire(requireRepo.resolve('vitest/package.json'))('esbuild');
await esbuild.build({
  entryPoints: [path.join(HERE, 'page.tsx')],
  bundle: true,
  outfile: path.join(build, 'bundle.js'),
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@': path.join(REPO, 'apps/web'), 'next/link': path.join(HERE, 'stub-next-link.tsx') },
  nodePaths: [path.join(REPO, 'apps/web/node_modules'), path.join(REPO, 'node_modules')],
  logLevel: 'warning',
});
fs.copyFileSync(path.join(HERE, 'probe.html'), path.join(build, 'index.html'));

/* ----------------------------------------------------------------- serve */
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/favicon')) { res.writeHead(204); res.end(); return; }
  const file = req.url === '/' ? 'index.html' : req.url.replace(/^\//, '').split('?')[0];
  const p = path.join(build, path.basename(file));
  if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${server.address().port}/`;

const { chromium } = requireRepo('@playwright/test');
const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
const version = browser.version();

/* ----------------------------------------------------------------- helpers */
const results = [];
async function fresh() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__probe?.state?.() && document.querySelector('[data-testid="spread-stage"] canvas'));
  await stableView(page);
  page.errors = errors;
  return page;
}
const S = (page, fn, a) => page.evaluate(fn, a);
/** The editor fits the unit after its first measure; wait until the view has not changed for 300 ms. */
async function stableView(page) {
  let last = null;
  let since = Date.now();
  for (;;) {
    const v = await page.evaluate(() => document.querySelector('[data-testid="spread-stage"]').dataset.view + '|' + JSON.stringify(document.querySelector('[data-testid="spread-stage"]').getBoundingClientRect()));
    if (v !== last) { last = v; since = Date.now(); }
    else if (Date.now() - since >= 300) return;
    await page.waitForTimeout(50);
  }
}
async function select(page, which) {
  await S(page, (w) => window.__probe.uiDispatch({ type: 'SET_SELECTION', ids: [window.__probe.ids[w]] }), which);
  await stableView(page);
}
async function info(page) {
  return S(page, () => {
    const w = document.querySelector('[data-testid="spread-stage"]');
    const r = w.getBoundingClientRect();
    const [x, y, scale] = w.dataset.view.split(' ').map(Number);
    const st = window.__probe.state();
    const els = Object.fromEntries(st.doc.pages[0].elements.map((e) => [e.id, { x: e.x, y: e.y, width: e.width, height: e.height }]));
    return {
      left: r.left, top: r.top, view: { x, y, scale }, els, ids: window.__probe.ids,
      history: st.history.map((h) => h.label), selection: window.__probe.ui().selection, tool: window.__probe.ui().tool,
      puts: window.__probe.puts.length, pill: document.querySelector('[data-testid="size-readout"]')?.textContent ?? null,
      cursor: w.style.cursor, dataView: w.dataset.view, active: document.activeElement?.id || document.activeElement?.tagName, clicks: window.__probe.clicks,
    };
  });
}
/** Page coordinates of an element's anchor (unit 0, page offset 0), rounded to whole px as the pointer delivers. */
function anchorAt(I, which, anchor) {
  const g = I.els[I.ids[which]];
  const fx = anchor.includes('left') ? g.x : anchor.includes('right') ? g.x + g.width : g.x + g.width / 2;
  const fy = anchor.includes('top') ? g.y : anchor.includes('bottom') ? g.y + g.height : g.y + g.height / 2;
  return { x: Math.round(I.left + I.view.x + fx * I.view.scale), y: Math.round(I.top + I.view.y + fy * I.view.scale) };
}
const H = (mm) => Math.round(mm * 100);
async function check(name, kind, fn) {
  const page = await fresh();
  const notes = [];
  let pass = false;
  let error = null;
  try {
    pass = await fn(page, notes);
  } catch (e) {
    error = String(e?.stack ?? e);
  }
  if (page.errors.length) notes.push(`page errors: ${page.errors.join(' | ')}`);
  results.push({ name, kind, pass: pass && !error && page.errors.length === 0, notes, error });
  await page.close();
}
const settleSaves = (page) => page.waitForTimeout(2600);

/* ----------------------------------------------------------------- cases */
// R1 — a changed release: preview == commit (G3), one 'Resize' entry, selection/page kept, one PUT.
await check('R1 changed release (rect, bottom-right): pill = commit; one Resize; one save', 'real', async (page, n) => {
  await select(page, 'rect');
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  const d = { x: 107, y: 120 }; // edges ≈ 91.97 / 85.86 mm: no snap target within 1.6 mm
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + d.x, a.y + d.y, { steps: 12 });
  const mid = await info(page);
  await page.mouse.up();
  const J = await info(page);
  await settleSaves(page);
  const K = await info(page);
  const g = J.els[J.ids.rect];
  const expW = (H(60 + d.x / I.view.scale) - 2000) / 100;
  const expH = (H(50 + d.y / I.view.scale) - 2000) / 100;
  n.push(`scale ${I.view.scale}; pill during drag "${mid.pill}"; cursor during drag "${mid.cursor}"; committed ${JSON.stringify(g)}; expected ${expW} × ${expH}; history ${JSON.stringify(J.history)}; PUTs ${K.puts}`);
  return mid.pill === `${g.width} × ${g.height} mm` && g.width === expW && g.height === expH && g.x === 20 && g.y === 20
    && JSON.stringify(J.history) === '["Resize"]' && J.selection[0] === J.ids.rect && K.puts === 1 && mid.cursor === 'nwse-resize' && J.pill === null;
});

await check('R2 anchor click (no movement): zero history, zero saves', 'real', async (page, n) => {
  await select(page, 'rect');
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 2, a.y + 1, { steps: 2 }); // under 3 px
  await page.mouse.up();
  await settleSaves(page);
  const J = await info(page);
  n.push(`history ${JSON.stringify(J.history)}; PUTs ${J.puts}; geometry ${JSON.stringify(J.els[J.ids.rect])}`);
  return J.history.length === 0 && J.puts === 0;
});

await check('R3 out and back to the press point: unchanged in H → zero history, zero saves', 'real', async (page, n) => {
  await select(page, 'rect');
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 80, a.y + 60, { steps: 10 });
  await page.mouse.move(a.x, a.y, { steps: 10 });
  await page.mouse.up();
  await settleSaves(page);
  const J = await info(page);
  n.push(`history ${JSON.stringify(J.history)}; PUTs ${J.puts}; geometry ${JSON.stringify(J.els[J.ids.rect])}`);
  return J.history.length === 0 && J.puts === 0;
});

await check('R4 Escape mid-drag: cancelled; later moves and mouseup do nothing; selection kept; zero saves', 'real', async (page, n) => {
  await select(page, 'rect');
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 80, a.y + 60, { steps: 10 });
  await page.keyboard.press('Escape');
  await page.mouse.move(a.x + 120, a.y + 90, { steps: 5 });
  await page.mouse.up();
  await settleSaves(page);
  const J = await info(page);
  n.push(`history ${JSON.stringify(J.history)}; selection ${JSON.stringify(J.selection)}; tool ${J.tool}; pill ${J.pill}; PUTs ${J.puts}`);
  return J.history.length === 0 && J.puts === 0 && J.selection[0] === J.ids.rect && J.pill === null && J.tool === 'select';
});

await check('R5 Space held through release (Q2 a): one commit; handles then inactive — a new press on the anchor pans; after keyup it resizes again', 'real', async (page, n) => {
  await select(page, 'rect');
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 40, { steps: 8 });
  await page.keyboard.down(' ');
  await page.mouse.move(a.x + 70, a.y + 45, { steps: 3 });
  await page.mouse.up();
  const J = await info(page);
  const b = anchorAt(J, 'rect', 'bottom-right');
  await page.mouse.move(b.x, b.y);
  const hover = await info(page);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y + 30, { steps: 5 });
  const panning = await info(page);
  await page.mouse.up();
  await page.keyboard.up(' ');
  const P = await info(page);
  const c = anchorAt(P, 'rect', 'bottom-right');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 30, c.y + 20, { steps: 5 });
  await page.mouse.up();
  const L = await info(page);
  n.push(`after release: history ${JSON.stringify(J.history)}, hover cursor "${hover.cursor}"; second press: view ${J.dataView} → ${panning.dataView}, cursor "${panning.cursor}", history ${JSON.stringify(panning.history)}; after keyup: history ${JSON.stringify(L.history)}`);
  return JSON.stringify(J.history) === '["Resize"]' && hover.cursor === 'grab' && panning.dataView !== J.dataView && panning.cursor === 'grabbing'
    && panning.history.length === 1 && JSON.stringify(L.history) === '["Resize","Resize"]';
});

await check('R6 Space held through Escape: zero commits, selection kept; a new press pans', 'real', async (page, n) => {
  await select(page, 'rect');
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 40, { steps: 8 });
  await page.keyboard.down(' ');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const J = await info(page);
  await page.mouse.move(I.left + 40, I.top + 40); // pasteboard, inside the stage
  await page.mouse.down();
  await page.mouse.move(I.left + 90, I.top + 80, { steps: 5 });
  const K = await info(page);
  await page.mouse.up();
  await page.keyboard.up(' ');
  n.push(`history ${JSON.stringify(J.history)}; selection ${JSON.stringify(J.selection)}; cursor after Escape "${J.cursor}"; view ${J.dataView} → ${K.dataView}`);
  return J.history.length === 0 && J.selection[0] === J.ids.rect && J.cursor === 'grab' && K.dataView !== J.dataView;
});

await check('R7 Space held through window blur: zero commits, selection kept, Space cleared — the next anchor press resizes (no stuck pan)', 'mixed', async (page, n) => {
  await select(page, 'rect');
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 40, { steps: 8 });
  await page.keyboard.down(' ');
  await S(page, () => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); }); // programmatic step
  await page.mouse.up();
  const J = await info(page);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 30, a.y + 20, { steps: 5 });
  await page.mouse.up();
  const K = await info(page);
  await page.keyboard.up(' ');
  n.push(`after blur: history ${JSON.stringify(J.history)}, selection ${JSON.stringify(J.selection)}, cursor "${J.cursor}"; next press: history ${JSON.stringify(K.history)} (blur and focus dispatched programmatically)`);
  return J.history.length === 0 && J.selection[0] === J.ids.rect && J.cursor !== 'grab' && JSON.stringify(K.history) === '["Resize"]';
});

await check('R8 Q7 (a) with Shift: a fast drag far past the fixed corner holds it — the ratio minimum box 5.34 × 4.01', 'real', async (page, n) => {
  await select(page, 'rect');
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 15, { steps: 3 });
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x - 300, a.y - 250, { steps: 6 });
  const mid = await info(page);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const J = await info(page);
  const g = J.els[J.ids.rect];
  n.push(`pill "${mid.pill}"; committed ${JSON.stringify(g)}`);
  return mid.pill === '5.34 × 4.01 mm' && g.x === 20 && g.y === 20 && g.width === 5.34 && g.height === 4.01;
});

await check('R9 wheel during the resize is consumed (no pan, no zoom); after release it pans again', 'real', async (page, n) => {
  await select(page, 'rect');
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.wheel(0, 120); // threshold pending
  await page.mouse.move(a.x + 60, a.y + 40, { steps: 8 });
  await page.mouse.wheel(0, 120);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  const mid = await info(page);
  await page.mouse.up();
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(50);
  const J = await info(page);
  n.push(`view at press ${I.dataView}; during ${mid.dataView}; after release + wheel ${J.dataView}; history ${JSON.stringify(J.history)}`);
  return mid.dataView === I.dataView && J.dataView !== I.dataView && JSON.stringify(J.history) === '["Resize"]';
});

await check('R10 ellipse, top-left: pill = commit; the fixed corner (bottom-right) unchanged', 'real', async (page, n) => {
  await select(page, 'ellipse');
  const I = await info(page);
  const a = anchorAt(I, 'ellipse', 'top-left');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x - 41, a.y - 33, { steps: 10 });
  const mid = await info(page);
  await page.mouse.up();
  const J = await info(page);
  const g = J.els[J.ids.ellipse];
  n.push(`pill "${mid.pill}"; committed ${JSON.stringify(g)}`);
  return mid.pill === `${g.width} × ${g.height} mm` && H(g.x + g.width) === H(54) && H(g.y + g.height) === H(78) && JSON.stringify(J.history) === '["Resize"]';
});

await check('R11 native control activation (Chromium): Space on a focused button during a resize, released after it, does not click', 'mixed', async (page, n) => {
  await page.focus('#probe-button');
  await page.keyboard.press(' ');
  const control = await info(page); // the browser's own activation, no resize
  await select(page, 'rect');
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const afterPress = await info(page);
  await page.mouse.move(a.x + 60, a.y + 40, { steps: 8 });
  await page.focus('#probe-button'); // programmatic: a pointer press moves focus off the button
  await page.keyboard.down(' ');
  await page.mouse.up();
  await page.keyboard.up(' ');
  await page.waitForTimeout(30);
  const J = await info(page);
  n.push(`control click count ${control.clicks}; focus after the anchor press "${afterPress.active}"; clicks after resize ${J.clicks}; history ${JSON.stringify(J.history)}`);
  return control.clicks === 1 && J.clicks === 1 && JSON.stringify(J.history) === '["Resize"]';
});

await check('R12 native control activation (Chromium): Enter on a focused button during a resize does not click, during or after', 'mixed', async (page, n) => {
  await page.focus('#probe-button');
  await page.keyboard.press('Enter');
  const control = await info(page);
  await select(page, 'rect');
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 40, { steps: 8 });
  await page.focus('#probe-button');
  await page.keyboard.down('Enter');
  await page.mouse.up();
  await page.keyboard.up('Enter');
  await page.waitForTimeout(30);
  const J = await info(page);
  n.push(`control click count ${control.clicks}; clicks after resize ${J.clicks}; history ${JSON.stringify(J.history)}`);
  return control.clicks === 1 && J.clicks === 1 && JSON.stringify(J.history) === '["Resize"]';
});

await check('R13 shortcuts mid-resize do nothing (⌘Z, Delete, H); they work after', 'real', async (page, n) => {
  await select(page, 'rect');
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 40, { steps: 8 });
  await page.keyboard.press('Delete');
  await page.keyboard.press('h');
  await page.keyboard.press('Control+z');
  const mid = await info(page);
  await page.mouse.up();
  await page.keyboard.press('Control+z');
  const J = await info(page);
  n.push(`mid: tool ${mid.tool}, elements ${Object.keys(mid.els).length}; after release + Ctrl+Z: history ${JSON.stringify(J.history)}, rect ${JSON.stringify(J.els[J.ids.rect])}`);
  return mid.tool === 'select' && Object.keys(mid.els).length === 2 && J.history.length === 0 && J.els[J.ids.rect].width === 40;
});

await check('R14 Hand tool: handles visible but inactive — an anchor press pans, nothing resizes', 'real', async (page, n) => {
  await select(page, 'rect');
  await S(page, () => window.__probe.uiDispatch({ type: 'SET_TOOL', tool: 'hand' }));
  await page.waitForTimeout(30);
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  await page.mouse.move(a.x, a.y);
  const hover = await info(page);
  await page.mouse.down();
  await page.mouse.move(a.x + 50, a.y + 40, { steps: 5 });
  await page.mouse.up();
  const J = await info(page);
  n.push(`hover cursor "${hover.cursor}"; view ${I.dataView} → ${J.dataView}; history ${JSON.stringify(J.history)}`);
  return hover.cursor === 'grab' && J.dataView !== I.dataView && J.history.length === 0;
});

/* ------------------------------------------- stage 5 correction (Codex finding 1) */
// The LIVE node and the Transformer, read through Konva itself (not the model): position, size or radii, scale,
// and whether the handles' box matches the node's box.
async function live(page, which) {
  return S(page, (w) => {
    const st = window.__konva.stages[0];
    const n = st.findOne('#' + window.__probe.ids[w]);
    const tr = st.findOne('Transformer');
    const nb = n.getClientRect({ skipStroke: true });
    const geom = n.getClassName() === 'Rect'
      ? { x: n.x(), y: n.y(), width: n.width(), height: n.height(), scaleX: n.scaleX(), scaleY: n.scaleY() }
      : { x: n.x(), y: n.y(), radiusX: n.radiusX(), radiusY: n.radiusY(), scaleX: n.scaleX(), scaleY: n.scaleY() };
    const handles = tr && tr.nodes().length ? { x: tr.x(), y: tr.y(), width: tr.width(), height: tr.height() } : null;
    const fits = !handles || (Math.abs(handles.x - nb.x) < 0.5 && Math.abs(handles.y - nb.y) < 0.5 && Math.abs(handles.width - nb.width) < 0.5 && Math.abs(handles.height - nb.height) < 0.5);
    return { geom, fits, handles, nodeBox: { x: nb.x, y: nb.y, width: nb.width, height: nb.height } };
  }, which);
}
const expectedGeom = (type, g) => type === 'rect'
  ? { x: g.x, y: g.y, width: g.width, height: g.height, scaleX: 1, scaleY: 1 }
  : { x: g.x + g.width / 2, y: g.y + g.height / 2, radiusX: g.width / 2, radiusY: g.height / 2, scaleX: 1, scaleY: 1 };
const sameGeom = (a, b) => Object.keys(b).every((k) => Math.abs(a[k] - b[k]) < 1e-9);

for (const [label, which, anchor, d] of [['R15', 'rect', 'bottom-right', { x: 100, y: 70 }], ['R16', 'ellipse', 'bottom-right', { x: 100, y: 70 }]]) {
  await check(`${label} ${which}: a move and Escape in ONE browser task (before React renders the preview) → the LIVE node is the model again, scale 1, handles fitted; the next resize commits once`, 'mixed', async (page, n) => {
    await select(page, which);
    const I = await info(page);
    const a = anchorAt(I, which, anchor);
    const model0 = I.els[I.ids[which]];
    await page.mouse.move(a.x, a.y);
    await page.mouse.down(); // real press on the anchor
    // Programmatic step (as in Codex's reproduction): one synchronous task delivers Konva's window mousemove,
    // then Escape — React has no chance to render the preview in between.
    const during = await S(page, ({ a, d, w }) => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: a.x + d.x, clientY: a.y + d.y, bubbles: true, buttons: 1 }));
      const n = window.__konva.stages[0].findOne('#' + window.__probe.ids[w]);
      const mutated = n.getClassName() === 'Rect' ? n.width() : n.radiusX() * 2;
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return { mutated };
    }, { a, d, w: which });
    await page.waitForTimeout(100);
    const L = await live(page, which);
    const J = await info(page);
    await page.mouse.up();
    await S(page, () => document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true, cancelable: true })));
    // A later resize with real input, released: exactly one commit and the drawn node equals it.
    const I2 = await info(page);
    const a2 = anchorAt(I2, which, anchor);
    await page.mouse.move(a2.x, a2.y);
    await page.mouse.down();
    await page.mouse.move(a2.x + 60, a2.y + 40, { steps: 8 });
    await page.mouse.up();
    await settleSaves(page);
    const K2 = await info(page);
    const L2 = await live(page, which);
    const g2 = K2.els[K2.ids[which]];
    n.push(`width during the task ${during.mutated} (model ${model0.width}); after cancel: live ${JSON.stringify(L.geom)}, handles fit ${L.fits}; model ${JSON.stringify(J.els[J.ids[which]])}; history ${JSON.stringify(J.history)}; pill ${J.pill}; next resize: ${JSON.stringify(g2)}, history ${JSON.stringify(K2.history)}, PUTs ${K2.puts}, live ${JSON.stringify(L2.geom)}, fit ${L2.fits}`);
    return during.mutated !== model0.width
      && sameGeom(L.geom, expectedGeom(which, model0)) && L.fits
      && JSON.stringify(J.els[J.ids[which]]) === JSON.stringify(model0) && J.history.length === 0 && J.pill === null
      && JSON.stringify(K2.history) === '["Resize"]' && K2.puts === 1 && g2.width !== model0.width
      && sameGeom(L2.geom, expectedGeom(which, g2)) && L2.fits;
  });
}

for (const [label, which] of [['R17', 'rect'], ['R18', 'ellipse']]) {
  await check(`${label} ${which}: Escape AFTER a rendered preview → the LIVE node is the model again, scale 1, handles fitted; zero saves`, 'real', async (page, n) => {
    await select(page, which);
    const I = await info(page);
    const a = anchorAt(I, which, 'bottom-right');
    const model0 = I.els[I.ids[which]];
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 90, a.y + 60, { steps: 10 });
    await page.waitForTimeout(100);
    const mid = await info(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const L = await live(page, which);
    await page.mouse.up();
    await settleSaves(page);
    const J = await info(page);
    n.push(`pill during "${mid.pill}"; after Escape live ${JSON.stringify(L.geom)}, handles fit ${L.fits}; model ${JSON.stringify(J.els[J.ids[which]])}; history ${JSON.stringify(J.history)}; PUTs ${J.puts}`);
    return mid.pill !== null && sameGeom(L.geom, expectedGeom(which, model0)) && L.fits
      && J.history.length === 0 && J.puts === 0 && J.pill === null;
  });
}

/* ------------------------------------------- stage 6: D-2 Keep proportions (plan §6.11) */
const keepSel = '[data-testid="keep-proportions"]';
const keepState = (page) => S(page, (sel) => { const b = document.querySelector(sel); return b ? { checked: b.checked, disabled: b.matches(':disabled') } : null; }, keepSel);
/** Ratio held within the derived axis's rounding (AC-4: one axis exact, the other derived within 0.005 mm). */
const ratioHeld = (g, w0, h0) => Math.abs(g.height - (g.width * h0) / w0) <= 0.0051 || Math.abs(g.width - (g.height * w0) / h0) <= 0.0051;
/** A real resize with real input; optional modifier key held through the drag. */
async function realDrag(page, which, anchor, d, key) {
  const I = await info(page);
  const a = anchorAt(I, which, anchor);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  if (key) await page.keyboard.down(key);
  await page.mouse.move(a.x + d.x, a.y + d.y, { steps: 10 });
  const mid = await info(page);
  await page.mouse.up();
  if (key) await page.keyboard.up(key);
  return { I, mid };
}

await check('R19 rect: a real click on Keep proportions → checked, no history, no save; a real corner drag keeps 4:3 (AC-4), one Resize, one save, live node and handles = committed', 'real', async (page, n) => {
  await select(page, 'rect');
  const k0 = await keepState(page);
  await page.click(keepSel);
  await settleSaves(page);
  const T = await info(page);
  const k1 = await keepState(page);
  const { mid } = await realDrag(page, 'rect', 'bottom-right', { x: 100, y: 35 });
  await settleSaves(page);
  const J = await info(page);
  const L = await live(page, 'rect');
  const g = J.els[J.ids.rect];
  n.push(`checkbox before ${JSON.stringify(k0)} after click ${JSON.stringify(k1)}; after toggling: history ${JSON.stringify(T.history)}, PUTs ${T.puts}; pill "${mid.pill}"; committed ${JSON.stringify(g)}; history ${JSON.stringify(J.history)}; PUTs ${J.puts}; live ${JSON.stringify(L.geom)} fit ${L.fits}`);
  return k0?.checked === false && k1?.checked === true && T.history.length === 0 && T.puts === 0
    && mid.pill === `${g.width} × ${g.height} mm` && ratioHeld(g, 40, 30) && g.width !== 40 && g.x === 20 && g.y === 20
    && JSON.stringify(J.history) === '["Resize"]' && J.puts === 1 && sameGeom(L.geom, expectedGeom('rect', g)) && L.fits;
});

await check('R20 ellipse: toggled ON with the rect selected, it stays ON after selecting the ellipse; a real top-left drag keeps the ellipse\'s ratio, fixed corner kept', 'real', async (page, n) => {
  await select(page, 'rect');
  await page.click(keepSel);
  await select(page, 'ellipse');
  const k = await keepState(page);
  const { mid } = await realDrag(page, 'ellipse', 'top-left', { x: -80, y: -20 });
  await settleSaves(page);
  const J = await info(page);
  const L = await live(page, 'ellipse');
  const g = J.els[J.ids.ellipse];
  n.push(`checkbox after selecting the ellipse ${JSON.stringify(k)}; pill "${mid.pill}"; committed ${JSON.stringify(g)}; history ${JSON.stringify(J.history)}; PUTs ${J.puts}; live ${JSON.stringify(L.geom)} fit ${L.fits}`);
  return k?.checked === true && mid.pill === `${g.width} × ${g.height} mm` && ratioHeld(g, 24, 18) && g.width !== 24
    && H(g.x + g.width) === H(54) && H(g.y + g.height) === H(78) && JSON.stringify(J.history) === '["Resize"]' && J.puts === 1
    && sameGeom(L.geom, expectedGeom('ellipse', g)) && L.fits;
});

await check('R21 ON + Shift (real key): still proportional — Shift adds ratio, it does not invert the toggle', 'real', async (page, n) => {
  await select(page, 'rect');
  await page.click(keepSel);
  await realDrag(page, 'rect', 'bottom-right', { x: 100, y: 35 }, 'Shift');
  const J = await info(page);
  const g = J.els[J.ids.rect];
  n.push(`committed ${JSON.stringify(g)}; history ${JSON.stringify(J.history)}`);
  return ratioHeld(g, 40, 30) && g.width !== 40 && JSON.stringify(J.history) === '["Resize"]';
});

await check('R22 ON: side handles stay independent (middle-right, then bottom-center with Shift)', 'real', async (page, n) => {
  await select(page, 'rect');
  await page.click(keepSel);
  await realDrag(page, 'rect', 'middle-right', { x: 60, y: 40 });
  const J = await info(page);
  const g1 = J.els[J.ids.rect];
  await realDrag(page, 'rect', 'bottom-center', { x: 40, y: 50 }, 'Shift');
  const K = await info(page);
  const g2 = K.els[K.ids.rect];
  const L = await live(page, 'rect');
  n.push(`after middle-right ${JSON.stringify(g1)}; after bottom-center + Shift ${JSON.stringify(g2)}; history ${JSON.stringify(K.history)}; live fit ${L.fits}`);
  return g1.height === 30 && g1.width > 40 && g2.width === g1.width && g2.height > 30 && JSON.stringify(K.history) === '["Resize","Resize"]'
    && sameGeom(L.geom, expectedGeom('rect', g2)) && L.fits;
});

await check('R23 ON + Alt (real key): centred and proportional — the centre (40, 35) kept', 'real', async (page, n) => {
  await select(page, 'rect');
  await page.click(keepSel);
  await realDrag(page, 'rect', 'bottom-right', { x: 70, y: 20 }, 'Alt');
  const J = await info(page);
  const g = J.els[J.ids.rect];
  n.push(`committed ${JSON.stringify(g)}; doubled-H centre offset (${H(2 * g.x + g.width) - 8000}, ${H(2 * g.y + g.height) - 7000}) H/2`);
  return ratioHeld(g, 40, 30) && g.width > 40 && Math.abs(H(2 * g.x + g.width) - 8000) <= 1 && Math.abs(H(2 * g.y + g.height) - 7000) <= 1 /* centre within 0.005 mm, compared in doubled H (AC-5) */
    && JSON.stringify(J.history) === '["Resize"]';
});

await check('R24 ON, no Shift: Q7 — a fast drag far past the fixed corner holds it; the ratio minimum box 5.34 × 4.01', 'real', async (page, n) => {
  await select(page, 'rect');
  await page.click(keepSel);
  const { mid } = await realDrag(page, 'rect', 'bottom-right', { x: -300, y: -250 });
  const J = await info(page);
  const g = J.els[J.ids.rect];
  n.push(`pill "${mid.pill}"; committed ${JSON.stringify(g)}`);
  return mid.pill === '5.34 × 4.01 mm' && g.x === 20 && g.y === 20 && g.width === 5.34 && g.height === 4.01;
});

await check('R25 ON rect: a move and Escape in ONE browser task (before the preview renders) → the LIVE node = model, scale 1, handles fitted; the next real resize commits once, drawn as committed and proportional', 'mixed', async (page, n) => {
  await select(page, 'rect');
  await page.click(keepSel);
  const I = await info(page);
  const a = anchorAt(I, 'rect', 'bottom-right');
  const model0 = I.els[I.ids.rect];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down(); // real press
  const during = await S(page, ({ a, w }) => { // synthetic: one task
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: a.x + 100, clientY: a.y + 35, bubbles: true, buttons: 1 }));
    const node = window.__konva.stages[0].findOne('#' + window.__probe.ids[w]);
    const mutated = { width: node.width(), height: node.height() };
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return { mutated };
  }, { a, w: 'rect' });
  await page.waitForTimeout(100);
  const L = await live(page, 'rect');
  const J = await info(page);
  await page.mouse.up();
  await S(page, () => document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true, cancelable: true })));
  await realDrag(page, 'rect', 'bottom-right', { x: 100, y: 35 });
  await settleSaves(page);
  const K2 = await info(page);
  const L2 = await live(page, 'rect');
  const g2 = K2.els[K2.ids.rect];
  n.push(`mutated in the task ${JSON.stringify(during.mutated)} (proportional ${ratioHeld(during.mutated, 40, 30)}); after cancel live ${JSON.stringify(L.geom)} fit ${L.fits}; history ${JSON.stringify(J.history)}; pill ${J.pill}; next ${JSON.stringify(g2)}, history ${JSON.stringify(K2.history)}, PUTs ${K2.puts}, live fit ${L2.fits}`);
  return during.mutated.width !== 40 && sameGeom(L.geom, expectedGeom('rect', model0)) && L.fits && J.history.length === 0 && J.pill === null
    && JSON.stringify(K2.history) === '["Resize"]' && K2.puts === 1 && ratioHeld(g2, 40, 30) && sameGeom(L2.geom, expectedGeom('rect', g2)) && L2.fits;
});

await check('R26 ON ellipse: Escape (real key) AFTER a rendered preview → the LIVE node = model, scale 1, handles fitted; zero saves', 'real', async (page, n) => {
  await select(page, 'ellipse');
  await page.click(keepSel);
  const I = await info(page);
  const a = anchorAt(I, 'ellipse', 'bottom-right');
  const model0 = I.els[I.ids.ellipse];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 90, a.y + 20, { steps: 10 });
  await page.waitForTimeout(100);
  const mid = await info(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const L = await live(page, 'ellipse');
  await page.mouse.up();
  await settleSaves(page);
  const J = await info(page);
  n.push(`pill during "${mid.pill}"; after Escape live ${JSON.stringify(L.geom)} fit ${L.fits}; history ${JSON.stringify(J.history)}; PUTs ${J.puts}`);
  return mid.pill !== null && sameGeom(L.geom, expectedGeom('ellipse', model0)) && L.fits && J.history.length === 0 && J.puts === 0;
});

await check('R27 the checkbox by keyboard (real keys): Space on the focused checkbox toggles it natively; ⌘/Ctrl+Z and H from the checkbox still reach the editor', 'real', async (page, n) => {
  await select(page, 'rect');
  await realDrag(page, 'rect', 'bottom-right', { x: 60, y: 40 });
  await page.focus(keepSel);
  await page.keyboard.press('Space');
  const k1 = await keepState(page);
  const J = await info(page);
  await page.keyboard.press('Control+z');
  const K = await info(page);
  await page.keyboard.press('h');
  const M = await info(page);
  const focused = await S(page, (sel) => document.activeElement === document.querySelector(sel), keepSel);
  n.push(`after Space ${JSON.stringify(k1)}, history ${JSON.stringify(J.history)}; after Ctrl+Z history ${JSON.stringify(K.history)}; after H tool ${M.tool}; checkbox focused ${focused}`);
  return k1?.checked === true && JSON.stringify(J.history) === '["Resize"]' && K.history.length === 0 && M.tool === 'hand' && focused;
});

await check('R28 locked object: the checkbox is disabled; read-only (save conflict) is covered in jsdom only', 'mixed', async (page, n) => {
  await select(page, 'rect');
  await S(page, () => {
    const st = window.__probe.state();
    window.__probe.docDispatch({ type: 'COMMIT', nextDoc: { ...st.doc, pages: st.doc.pages.map((p) => ({ ...p, elements: p.elements.map((e) => e.id === window.__probe.ids.rect ? { ...e, locked: true } : e) })) }, selection: [window.__probe.ids.rect], label: 'Lock' });
  }); // programmatic lock (the Lock button is covered in jsdom)
  await page.waitForTimeout(50);
  const k = await keepState(page);
  n.push(`checkbox ${JSON.stringify(k)} (lock applied programmatically)`);
  return k?.disabled === true;
});

/* ------------------------------------------- stage 7: D-6 selection and lock indicators (plan §6.12) */
fs.mkdirSync(path.join(OUT, 'screens'), { recursive: true });
const shot = async (page, name) => {
  const el = await page.$('[data-testid="spread-stage"]');
  await el.screenshot({ path: path.join(OUT, 'screens', `${name}.png`) });
};
/** Programmatic SETUP only: change the document through the reducer (lock, add elements). */
async function commitDoc(page, edit) {
  await S(page, (src) => {
    const st = window.__probe.state();
    const fn = new Function('doc', 'ids', 'uuid', src);
    const next = fn(structuredClone(st.doc), window.__probe.ids, () => crypto.randomUUID());
    window.__probe.docDispatch({ type: 'COMMIT', nextDoc: next, selection: window.__probe.ui().selection, label: 'Setup' });
  }, edit);
  await page.waitForTimeout(50);
}
const LOCK = (which) => `for (const p of doc.pages) for (const e of p.elements) if (e.id === ids.${which}) e.locked = true; return doc;`;
/** Real clicks: select `first`, Shift-click the others, each on a point inside its node. */
async function clickSelect(page, first, ...more) {
  clickSelect.log = [];
  // 60 ms between clicks: React renders the first selection before the Shift-click is read (see §6.12).
  for (const [i, w] of [first, ...more].entries()) {
    const c = await S(page, (w) => { const r = window.__konva.stages[0].findOne('#' + (window.__probe.ids[w] ?? w)).getClientRect({ skipStroke: true }); const box = document.querySelector('[data-testid="spread-stage"] canvas').getBoundingClientRect(); return { x: box.left + r.x + r.width * 0.75, y: box.top + r.y + r.height * 0.75 }; }, w);
    if (i > 0) await page.keyboard.down('Shift');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.up();
    if (i > 0) await page.keyboard.up('Shift');
    await page.waitForTimeout(60);
    const sel = await S(page, () => window.__probe.ui().selection.length);
    (clickSelect.log ??= []).push(`${w}@${Math.round(c.x)},${Math.round(c.y)}→${sel}`);
  }
}
/** Rendered chrome, read through Konva: client rects in stage px. */
async function chrome(page, ids) {
  return S(page, (ids) => {
    const st = window.__konva.stages[0];
    const rect = (n) => { const r = n.getClientRect({ skipStroke: true }); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const border = st.findOne('.multi-selection-border');
    const tr = st.findOne('Transformer');
    return {
      border: border ? { ...rect(border), dash: border.dash(), listening: border.listening(), layerListening: border.getLayer().listening() } : null,
      outlines: st.find('.selection-outline').length,
      handles: tr ? tr.nodes().length : 0,
      nodes: Object.fromEntries(ids.map((id) => [id, rect(st.findOne('#' + id))])),
      locks: Object.fromEntries(st.find('.lock-indicator').map((g) => [g.id().replace(/^lock-/, ''), { ...rect(g), absScale: g.getAbsoluteScale().x, listening: g.listening(), layerListening: g.getLayer().listening() }])),
    };
  }, ids);
}
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
const unionOf = (rs) => { const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y)); return { x, y, width: Math.max(...rs.map((r) => r.x + r.width)) - x, height: Math.max(...rs.map((r) => r.y + r.height)) - y }; };
const sameRect = (a, b, tol = 0.75) => a && b && near(a.x, b.x, tol) && near(a.y, b.y, tol) && near(a.width, b.width, tol) && near(a.height, b.height, tol);

await check('R29 multi-selection by real clicks (rect, then Shift-click the ellipse): ONE dashed [3, 2] border = the union of the two rendered nodes; no per-object outlines; no handles; not listening', 'real', async (page, n) => {
  await clickSelect(page, 'rect', 'ellipse');
  const J = await info(page);
  const C = await chrome(page, [J.ids.rect, J.ids.ellipse]);
  const U = unionOf(Object.values(C.nodes));
  await shot(page, 'R29-multi-union');
  n.push(`clicks ${clickSelect.log?.splice(0).join(' ')}; selection ${J.selection.length}; border ${JSON.stringify(C.border)}; node union ${JSON.stringify(U)}; outlines ${C.outlines}; handles ${C.handles}; history ${JSON.stringify(J.history)}`);
  return J.selection.length === 2 && sameRect(C.border, U) && JSON.stringify(C.border.dash) === '[3,2]' && C.border.listening === false && C.border.layerListening === false
    && C.outlines === 0 && C.handles === 0 && J.history.length === 0;
});

await check('R30 mixed locked/unlocked drag (lock = programmatic setup; selection and drag = real input): mid-drag the border = union of the MOVED rect and the STATIONARY locked ellipse; after release = the document', 'mixed', async (page, n) => {
  await commitDoc(page, LOCK('ellipse'));
  await clickSelect(page, 'rect', 'ellipse');
  const I = await info(page);
  const C0 = await chrome(page, [I.ids.rect, I.ids.ellipse]);
  const r = C0.nodes[I.ids.rect];
  const canvas = await S(page, () => { const b = document.querySelector('[data-testid="spread-stage"] canvas').getBoundingClientRect(); return { x: b.left, y: b.top }; });
  const start = { x: canvas.x + r.x + r.width / 2, y: canvas.y + r.y + r.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 160, start.y - 40, { steps: 12 });
  await page.waitForTimeout(60);
  const M = await chrome(page, [I.ids.rect, I.ids.ellipse]);
  await shot(page, 'R30-mixed-drag-preview');
  await page.mouse.up();
  await page.waitForTimeout(60);
  const J = await info(page);
  const E = await chrome(page, [J.ids.rect, J.ids.ellipse]);
  const ellStill = sameRect(M.nodes[I.ids.ellipse], C0.nodes[I.ids.ellipse], 0.01);
  const rectMoved = near(M.nodes[I.ids.rect].x - r.x, 160, 1) && near(M.nodes[I.ids.rect].y - r.y, -40, 1);
  const naive = { ...unionOf(Object.values(C0.nodes)) }; naive.x += 160; naive.y -= 40;
  n.push(`rect moved ${rectMoved}; ellipse stationary ${ellStill}; mid border ${JSON.stringify(M.border)} vs union of displayed ${JSON.stringify(unionOf(Object.values(M.nodes)))} (naive translated union ${JSON.stringify(naive)}); after release border ${JSON.stringify(E.border)}; history ${JSON.stringify(J.history)}; padlock on ellipse ${!!E.locks[J.ids.ellipse]}`);
  return rectMoved && ellStill && sameRect(M.border, unionOf(Object.values(M.nodes))) && !sameRect(M.border, naive)
    && sameRect(E.border, unionOf(Object.values(E.nodes))) && JSON.stringify(J.history) === '["Setup","Move"]' && !!E.locks[J.ids.ellipse] && E.handles === 0;
});

await check('R31 padlock placement and size (lock = programmatic setup): an ~11 px padlock 2 px inside the top-left of the rendered rect and of the ellipse\'s bounding box; unlocked objects none', 'mixed', async (page, n) => {
  await commitDoc(page, LOCK('rect'));
  await commitDoc(page, LOCK('ellipse'));
  await S(page, () => window.__probe.uiDispatch({ type: 'CLEAR_SELECTION' }));
  await page.waitForTimeout(30);
  const I = await info(page);
  const C = await chrome(page, [I.ids.rect, I.ids.ellipse]);
  await shot(page, 'R31-padlocks');
  const ok = [I.ids.rect, I.ids.ellipse].every((id) => {
    const l = C.locks[id], b = C.nodes[id];
    return l && near(l.x, b.x + 2, 0.6) && near(l.y - 0.5, b.y + 2, 0.6) && l.width >= 9 && l.width <= 11.5 && l.height >= 9 && l.height <= 11.5 && near(l.absScale, 1, 1e-9) && !l.listening && !l.layerListening;
  });
  n.push(`padlocks ${JSON.stringify(C.locks)}; nodes ${JSON.stringify(C.nodes)}; scale ${I.view.scale}`);
  return ok && Object.keys(C.locks).length === 2;
});

await check('R32 zoom (real Ctrl+wheel in and out): the padlock stays the same screen size and stays 2 px inside the rect\'s top-left', 'mixed', async (page, n) => {
  await commitDoc(page, LOCK('rect'));
  const I = await info(page);
  // Zoom about the rect's top-left corner, so the padlock stays on screen at every zoom.
  const canvas = await S(page, (id) => { const b = document.querySelector('[data-testid="spread-stage"] canvas').getBoundingClientRect(); const r = window.__konva.stages[0].findOne('#' + id).getClientRect({ skipStroke: true }); return { x: b.left + r.x + 8, y: b.top + r.y + 8 }; }, I.ids.rect);
  const rows = [];
  const measure = async (label) => { const J = await info(page); const C = await chrome(page, [J.ids.rect]); rows.push({ label, scale: J.view.scale, lock: C.locks[J.ids.rect], node: C.nodes[J.ids.rect] }); };
  await measure('fit');
  await shot(page, 'R32-zoom-fit');
  await page.mouse.move(canvas.x, canvas.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 250);
  await page.keyboard.up('Control');
  await page.waitForTimeout(80);
  await measure('out');
  await shot(page, 'R32-zoom-out');
  await page.keyboard.down('Control');
  for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -250);
  await page.keyboard.up('Control');
  await page.waitForTimeout(80);
  await measure('in');
  await shot(page, 'R32-zoom-in');
  n.push(rows.map((r) => `${r.label}: scale ${r.scale.toFixed(3)}, padlock ${r.lock.width.toFixed(2)} × ${r.lock.height.toFixed(2)} px at (${(r.lock.x - r.node.x).toFixed(2)}, ${(r.lock.y - r.node.y).toFixed(2)}) from the node`).join('; '));
  const w0 = rows[0].lock.width, h0 = rows[0].lock.height;
  return rows[1].scale < rows[0].scale / 2 && rows[2].scale > rows[0].scale * 2
    && rows.every((r) => near(r.lock.width, w0, 0.05) && near(r.lock.height, h0, 0.05) && near(r.lock.x - r.node.x, 2, 0.6));
});

await check('R33 pass-through (lock = programmatic setup; pointer = real): over the padlock the hit target is the rect, the cursor equals that elsewhere on the locked rect, a click there selects the rect, and under Hand a press there pans', 'mixed', async (page, n) => {
  await commitDoc(page, LOCK('rect'));
  await S(page, () => window.__probe.uiDispatch({ type: 'CLEAR_SELECTION' }));
  const I = await info(page);
  const C = await chrome(page, [I.ids.rect]);
  const l = C.locks[I.ids.rect], b = C.nodes[I.ids.rect];
  const canvas = await S(page, () => { const r = document.querySelector('[data-testid="spread-stage"] canvas').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const onLock = { x: canvas.x + l.x + l.width / 2, y: canvas.y + l.y + l.height * 0.7 };
  const elsewhere = { x: canvas.x + b.x + b.width * 0.7, y: canvas.y + b.y + b.height * 0.7 };
  const hit = await S(page, (p) => { const st = window.__konva.stages[0]; const s = st.getIntersection(p); return s ? s.id() || s.name() || s.getClassName() : null; }, { x: l.x + l.width / 2, y: l.y + l.height * 0.7 });
  await page.mouse.move(elsewhere.x, elsewhere.y);
  const curElse = (await info(page)).cursor;
  await page.mouse.move(onLock.x, onLock.y);
  const curLock = (await info(page)).cursor;
  await page.mouse.click(onLock.x, onLock.y);
  const J = await info(page);
  await S(page, () => window.__probe.uiDispatch({ type: 'SET_TOOL', tool: 'hand' }));
  await page.waitForTimeout(30);
  const v0 = (await info(page)).dataView;
  await page.mouse.move(onLock.x, onLock.y);
  await page.mouse.down();
  await page.mouse.move(onLock.x + 40, onLock.y + 30, { steps: 5 });
  await page.mouse.up();
  const K = await info(page);
  n.push(`hit at the padlock: ${hit === I.ids.rect ? 'the rect' : hit}; cursor elsewhere "${curElse}", on the padlock "${curLock}"; selection after click ${JSON.stringify(J.selection.map((s) => (s === J.ids.rect ? 'rect' : s)))}; Hand press on the padlock: view ${v0} → ${K.dataView} (tool set programmatically)`);
  return hit === I.ids.rect && curLock === curElse && J.selection.length === 1 && J.selection[0] === J.ids.rect && K.dataView !== v0;
});

await check('R34 spread (elements added and the recto one locked = programmatic setup; navigation and selection = real clicks): the border spans both pages at their offsets; the recto padlock sits at its node', 'mixed', async (page, n) => {
  await commitDoc(page, `const mk = (x, y, w, h, locked) => ({ ...doc.pages[0].elements.find((e) => e.id === ids.rect), id: uuid(), x, y, width: w, height: h, locked }); const a = mk(100, 40, 30, 20, false), b = mk(10, 50, 20, 30, true); doc.pages[1].elements.push(a); doc.pages[2].elements.push(b); window.__spread = { a: a.id, b: b.id }; return doc;`);
  await page.click('ul li:nth-child(2) button');
  await stableView(page);
  const ids = await S(page, () => window.__spread);
  await clickSelect(page, ids.a, ids.b);
  const J = await info(page);
  const C = await chrome(page, [ids.a, ids.b]);
  const offsets = await S(page, () => document.querySelector('[data-testid="spread-stage"]').dataset.pageOffsets);
  await shot(page, 'R34-spread');
  const l = C.locks[ids.b], nb = C.nodes[ids.b];
  n.push(`unit ${J.dataView ? 'spread' : '?'}; page offsets ${offsets}; selection ${J.selection.length}; border ${JSON.stringify(C.border)} vs node union ${JSON.stringify(unionOf(Object.values(C.nodes)))}; recto padlock ${JSON.stringify(l)} vs node ${JSON.stringify(nb)}`);
  return offsets.split(' ').length === 2 && J.selection.length === 2 && sameRect(C.border, unionOf(Object.values(C.nodes)))
    && l && near(l.x, nb.x + 2, 0.6) && near(l.y - 0.5, nb.y + 2, 0.6) && C.handles === 0;
});

await check('R35 tools (lock = programmatic setup; keys = real): R hides the border with the selection kept, padlocks stay; H shows the border; V shows it', 'mixed', async (page, n) => {
  await commitDoc(page, LOCK('ellipse'));
  await clickSelect(page, 'rect', 'ellipse');
  const at = async () => { const J = await info(page); const C = await chrome(page, [J.ids.rect, J.ids.ellipse]); return { tool: J.tool, sel: J.selection.length, border: !!C.border, locks: Object.keys(C.locks).length }; };
  const s0 = await at();
  await page.keyboard.press('r');
  const s1 = await at();
  await shot(page, 'R35-creation-tool');
  await page.keyboard.press('h');
  const s2 = await at();
  await page.keyboard.press('v');
  const s3 = await at();
  n.push(`clicks ${clickSelect.log?.splice(0).join(' ')}; ` + JSON.stringify([s0, s1, s2, s3]));
  return s0.border && s0.locks === 1 && s1.tool === 'rect' && !s1.border && s1.sel === 2 && s1.locks === 1
    && s2.tool === 'hand' && s2.border && s3.tool === 'select' && s3.border && s3.locks === 1;
});

await check('R36 a locked single (lock = programmatic setup; click = real): solid outline + padlock, no handles, no dashed border', 'mixed', async (page, n) => {
  await commitDoc(page, LOCK('rect'));
  await clickSelect(page, 'rect');
  const J = await info(page);
  const C = await chrome(page, [J.ids.rect]);
  await shot(page, 'R36-locked-single');
  n.push(`selection ${J.selection.length}; outlines ${C.outlines}; border ${!!C.border}; handles ${C.handles}; padlock ${!!C.locks[J.ids.rect]}`);
  return J.selection.length === 1 && C.outlines === 1 && !C.border && C.handles === 0 && !!C.locks[J.ids.rect];
});

/* ----------------------------------------------------------------- report */
await browser.close();
server.close();
fs.rmSync(build, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const passed = results.filter((r) => r.pass).length;
const lines = [
  '# Slice D stage 5 — real-Konva probe results',
  '',
  `Browser: Chromium ${version} (headless, Playwright ${pkgVersion('@playwright/test')}), device pixel ratio 1, viewport 1280 × 900.`,
  `Konva ${pkgVersion('konva')}, react-konva ${pkgVersion('react-konva')}. Firefox and WebKit: NOT EXECUTED (no builds in this environment).`,
  '',
  `**${passed} / ${results.length} PASS.**`,
  '',
  '| Case | Input | Result | Notes |',
  '|---|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.kind} | ${r.pass ? 'PASS' : 'FAIL'} | ${(r.notes.join('; ') + (r.error ? ` ERROR ${r.error.split('\n')[0]}` : '')).replace(/\|/g, '/')} |`),
  '',
  'Input kinds: **real** = the behaviour under test is driven only by Playwright mouse and keyboard input (setup before it may be programmatic: the initial selection through the UI dispatch in R1–R27, and the Hand tool the same way in R14 and R33); **mixed** = real input plus a named programmatic step inside the case or a programmatic document change (window blur/focus; `focus()` on the button during the drag, because a pointer press on the canvas moves focus off it; R15–R16 and R25: one synthetic `mousemove` and `Escape` keydown dispatched in a single browser task, after a real anchor press, to force the before-render ordering; R28 and R30–R36: locks and added elements are applied by a programmatic document COMMIT, named in each case).',
];
fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ browser: `chromium ${version}`, results }, null, 2) + '\n');
console.log(lines.join('\n'));
process.exit(passed === results.length ? 0 : 1);
