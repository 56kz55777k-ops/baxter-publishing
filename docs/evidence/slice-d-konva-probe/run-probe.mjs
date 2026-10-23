#!/usr/bin/env node
// Slice D stage 1 — isolated Konva probe runner. NOT production code: not imported, not linted, not built, not run
// by CI. Uses only what the repo already has installed (npm ci): the locked konva 10.3.0 and @playwright/test 1.62.1.
//
//   node docs/evidence/slice-d-konva-probe/run-probe.mjs [--browsers chromium,firefox,webkit] [--out <dir>]
//
// Needs the Playwright browser builds for @playwright/test 1.62.1 (PLAYWRIGHT_BROWSERS_PATH, or the default cache).
// Serves the probe page on 127.0.0.1 only. No credentials, no network beyond localhost, no repository writes except
// the results directory.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CASES, pxPath } from './cases.mjs';
import { analyseCase } from './analyse.mjs';
import { extractModel, loadModel } from './model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const requireRepo = createRequire(path.join(REPO, 'apps/web/package.json'));
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const BROWSERS = opt('--browsers', 'chromium,firefox,webkit').split(',');
const OUT = path.resolve(opt('--out', path.join(HERE, 'results')));
const ONLY = opt('--only', null);
// Negative controls (supplementary): replay against a deliberately WRONG model in Node only (the browser keeps the
// reviewed one), to show the comparison detects a model that differs from Konva. Never used for the recorded results.
const MUTATE = opt('--mutate', null);
const MUTATIONS = {
  inclusiveSkip: ['const inRange = (val, left, right) => left <= val && val < right;', 'const inRange = (val, left, right) => left <= val && val <= right;'], // r3's wrong [-1, 1] interval
  noCarry: ['let CARRY_CENTRE = true;', 'let CARRY_CENTRE = false;'], // r2: centre re-captured at each rename
};
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---------- environment and integrity ----------
const konvaDir = path.resolve(path.dirname(requireRepo.resolve('konva')), '..'); // resolves lib/index.js, the app's entry
const konvaPkg = JSON.parse(fs.readFileSync(path.join(konvaDir, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'package-lock.json'), 'utf8'));
const installedLock = JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules/.package-lock.json'), 'utf8'));
const pwPkg = JSON.parse(fs.readFileSync(requireRepo.resolve('@playwright/test/package.json'), 'utf8'));
const lockKonva = lock.packages['node_modules/konva'];
const instKonva = installedLock.packages['node_modules/konva'];
const KONVA_FILES = ['lib/shapes/Transformer.js', 'lib/Util.js', 'lib/Node.js', 'lib/Stage.js', 'lib/Container.js', 'lib/DragAndDrop.js', 'lib/index.js', 'lib/_FullInternals.js', 'lib/_CoreInternals.js', 'lib/Core.js', 'lib/Global.js'];
const konvaHashes = Object.fromEntries(KONVA_FILES.map((f) => [f, sha256(fs.readFileSync(path.join(konvaDir, f)))]));
if (konvaPkg.version !== '10.3.0' || lockKonva.version !== '10.3.0' || instKonva.integrity !== lockKonva.integrity) {
  console.error('konva is not the locked 10.3.0 install', konvaPkg.version, lockKonva.version, instKonva.integrity, lockKonva.integrity);
  process.exit(3);
}
const evidencePath = path.join(REPO, 'docs/evidence/slice-d-math-check.js');
const model = extractModel(evidencePath);
let nodeModelText = model.shared;
if (MUTATE) {
  if (MUTATE !== 'noClamp') {
    const [from, to] = MUTATIONS[MUTATE] || [];
    if (!from || nodeModelText.split(from).length !== 2) { console.error('unknown mutation or pattern not found once: ' + MUTATE); process.exit(3); }
    nodeModelText = nodeModelText.replace(from, to);
  }
  console.log(`NEGATIVE CONTROL: Node-side model mutated (${MUTATE}); the browser runs the reviewed model`);
}
const M = loadModel(nodeModelText);
if (MUTATE === 'noClamp') M.__noClamp = true;
const osRelease = (() => { try { return fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="([^"]+)"/)[1]; } catch { return os.type(); } })();
const env = {
  os: `${osRelease}; kernel ${os.release()}; ${os.arch()}`,
  node: process.version,
  playwright: `@playwright/test ${pwPkg.version}`,
  konva: { version: konvaPkg.version, lockIntegrity: lockKonva.integrity, installedIntegrity: instKonva.integrity, files: konvaHashes, served: 'node_modules/konva/lib (ESM, the build the app resolves)' },
  model: { file: 'docs/evidence/slice-d-math-check.js', sha256: model.sha256Full, sharedSectionSha256: model.sha256Shared, sharedSectionLines: model.sharedLines },
  probeFiles: Object.fromEntries(['probe.html', 'probe-page.js', 'model.mjs', 'cases.mjs', 'analyse.mjs', 'report.mjs', 'run-probe.mjs'].map((f) => [f, sha256(fs.readFileSync(path.join(HERE, f)))])),
};

// ---------- local static server (127.0.0.1, ephemeral port) ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let body = null, type = 'text/plain';
  if (url.pathname === '/' || url.pathname === '/probe.html') { body = fs.readFileSync(path.join(HERE, 'probe.html')); type = TYPES['.html']; }
  else if (url.pathname === '/probe-page.js') { body = fs.readFileSync(path.join(HERE, 'probe-page.js')); type = TYPES['.js']; }
  else if (url.pathname === '/model.js') { body = Buffer.from(model.shared); type = TYPES['.js']; }
  else if (url.pathname.startsWith('/konva/lib/')) {
    const f = path.normalize(path.join(konvaDir, url.pathname.slice('/konva/'.length)));
    if (f.startsWith(path.join(konvaDir, 'lib') + path.sep) && fs.existsSync(f)) { body = fs.readFileSync(f); type = TYPES[path.extname(f)] || type; }
  }
  if (!body) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ---------- run ----------
const pw = requireRepo('@playwright/test');
const results = { env: { ...env, negativeControl: MUTATE }, browsers: {} };
fs.mkdirSync(OUT, { recursive: true });
const cases = ONLY ? CASES.filter((c) => ONLY.split(',').includes(c.id)) : CASES;

for (const bname of BROWSERS) {
  const B = { name: bname, cases: [], launchError: null };
  results.browsers[bname] = B;
  let browser;
  try {
    browser = await pw[bname].launch();
  } catch (e) {
    B.launchError = String(e.message || e).split('\n')[0];
    console.log(`${bname}: COULD NOT LAUNCH — ${B.launchError}`);
    continue;
  }
  B.version = browser.version();
  const pageErrors = [];
  // a fresh context and page per case: no state (browser zoom, Konva drag state, listeners) carries between cases
  const openPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') pageErrors.push(`console.${m.type()}: ${m.text()}`); });
    page.on('request', (r) => { if (!r.url().startsWith(ORIGIN)) pageErrors.push('non-local request: ' + r.url()); });
    await page.goto(ORIGIN + '/probe.html');
    await page.waitForFunction(() => window.probe && window.probe.ready);
    return { context, page };
  };
  {
    const { context, page } = await openPage();
    B.userAgent = await page.evaluate(() => navigator.userAgent);
    B.pageKonvaVersion = await page.evaluate(() => window.probe.konvaVersion);
    B.viewport = await page.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio }));
    await context.close();
  }
  const traceLines = [];
  for (const c of cases) {
    const { context, page } = await openPage();
    const acc = [];
    const sent = [];
    let mods = { Shift: false, Alt: false, Control: false };
    let cur = null;
    const take = async () => { acc.push(...(await page.evaluate(() => window.probe.takeLog()))); };
    const ctx = {
      async setup(cfg) { await take(); const info = await page.evaluate((c2) => window.probe.setup(c2), cfg); acc.push({ e: 'setup', cfg, anchors: info.anchors }); return info; },
      async hover(p) { await page.mouse.move(p[0], p[1]); sent.push({ x: p[0], y: p[1], ...mods, hover: true }); cur = p; },
      async move(p) { await page.mouse.move(p[0], p[1]); sent.push({ x: p[0], y: p[1], ...mods }); cur = p; },
      async path(p0, p1) { for (const q of pxPath(p0, p1)) await ctx.move(q); },
      async down() { await page.mouse.down(); },
      async up() { await page.mouse.up(); },
      async keyDown(k) { await page.keyboard.down(k); mods = { ...mods, [k]: true }; },
      async keyUp(k) { await page.keyboard.up(k); mods = { ...mods, [k]: false }; },
      async press(k) { await page.keyboard.press(k); },
      async wheel(dx, dy) { await page.mouse.wheel(dx, dy); },
      async call(name, arg) { return page.evaluate(([n, a]) => window.probe.call(n, a), [name, arg]); },
      async mark(label) { await page.evaluate((l) => window.probe.call('mark', l), label); sent.push({ mark: label }); },
    };
    let runOut = {}, runError = null;
    try {
      const info = await ctx.setup(c.setup);
      runOut = (await c.run(ctx, info)) || {};
      await take();
    } catch (e) {
      runError = String(e && e.stack ? e.stack : e).split('\n').slice(0, 3).join(' | ');
      try { await page.mouse.up(); } catch {}
      for (const k of ['Shift', 'Alt', 'Control']) { try { await page.keyboard.up(k); } catch {} }
      try { await take(); } catch {}
    }
    await context.close();
    const a = analyseCase(M, c, acc, sent, runOut, runError, bname);
    B.cases.push(a.summary);
    for (const t of a.trace) traceLines.push(JSON.stringify({ case: c.id, ...t }));
    process.stdout.write(`${bname} ${c.id}: ${a.summary.status}${a.summary.failures.length ? ' — ' + a.summary.failures.slice(0, 3).join('; ') : ''}\n`);
  }
  B.pageErrors = pageErrors;
  await browser.close();
  fs.writeFileSync(path.join(OUT, `trace-${bname}.jsonl.gz`), zlib.gzipSync(Buffer.from(traceLines.join('\n') + '\n'), { level: 9 }));
}
server.close();

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1) + '\n');
const { renderSummary } = await import('./report.mjs');
fs.writeFileSync(path.join(OUT, 'summary.md'), renderSummary(results, cases));
let fail = 0, notExec = 0;
for (const b of BROWSERS) {
  const B = results.browsers[b];
  if (B.launchError) { notExec++; continue; }
  for (const s of B.cases) { if (s.status === 'FAIL') fail++; else if (s.status === 'NOT EXECUTED') notExec++; }
  if (B.pageErrors && B.pageErrors.length) fail++;
}
console.log(`\nwritten: ${path.relative(REPO, OUT)}/summary.md, results.json, trace-*.jsonl.gz`);
console.log(fail ? `RESULT: ${fail} failure(s)` : notExec ? `RESULT: no failures, ${notExec} not executed` : 'RESULT: all cases passed in every browser');
process.exit(fail ? 1 : notExec ? 2 : 0);
