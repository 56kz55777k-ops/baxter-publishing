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
  'Input kinds: **real** = only Playwright mouse and keyboard input; **mixed** = real input plus the named programmatic step (window blur/focus; `focus()` on the button during the drag, because a pointer press on the canvas moves focus off it).',
];
fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ browser: `chromium ${version}`, results }, null, 2) + '\n');
console.log(lines.join('\n'));
process.exit(passed === results.length ? 0 : 1);
