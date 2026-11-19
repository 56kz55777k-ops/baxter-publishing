#!/usr/bin/env node
/**
 * Slice D stage 8A — build-exclusion check for the local editor harness (plan §8.2; Q5 as approved).
 * Test tooling only: reads a finished `next build` output directory; changes nothing.
 *
 *   node scripts/e2e-harness-verify.mjs default <distDir> [--baseline <distDir>]
 *     Expect NO harness: no route in any manifest, no harness page in server/app, and none of the
 *     harness markers anywhere in the output (fixtures, mock, seams, instrumentation, test code).
 *     With --baseline, the route lists must be identical to the baseline build's.
 *   node scripts/e2e-harness-verify.mjs harness <distDir>
 *     Expect the harness route to exist (positive control for the same checks).
 *
 * Exit 0 when the expectation holds, 1 otherwise. Prints a JSON report.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const [mode, dist, ...rest] = process.argv.slice(2);
if (!['default', 'harness'].includes(mode) || !dist) {
  console.error('usage: e2e-harness-verify.mjs default|harness <distDir> [--baseline <distDir>]');
  process.exit(2);
}
const baselineIdx = rest.indexOf('--baseline');
const baseline = baselineIdx >= 0 ? rest[baselineIdx + 1] : null;

/** Strings that exist only in harness code paths. */
const MARKERS = [
  'e2e-harness',
  'harnessDocRow',
  'EditorMock',
  'data-unit-element-ids',
  'data-selected-ids',
  'baxter:editor:resize-move',
  'baxter:editor:resize-frame',
  '00000000-0000-4000-8000-', // fixture ids
  'Editor harness',
  'test/e2e-harness',
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === 'cache') continue; // webpack/SWC caches are not shipped output
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

function routes(d) {
  const read = (f) => (existsSync(path.join(d, f)) ? JSON.parse(readFileSync(path.join(d, f), 'utf8')) : null);
  const appPaths = read('app-path-routes-manifest.json') ?? {};
  const serverApp = read('server/app-paths-manifest.json') ?? {};
  const rm = read('routes-manifest.json') ?? {};
  const list = new Set([
    ...Object.values(appPaths),
    ...Object.keys(serverApp),
    ...(rm.staticRoutes ?? []).map((r) => r.page),
    ...(rm.dynamicRoutes ?? []).map((r) => r.page),
  ]);
  return [...list].sort();
}

const report = { mode, dist, routes: routes(dist), harnessRoutes: [], serverAppHarness: [], markerHits: {}, baselineDiff: null, ok: false };
report.harnessRoutes = report.routes.filter((r) => r.includes('e2e-harness'));
const serverApp = path.join(dist, 'server', 'app');
report.serverAppHarness = existsSync(serverApp) ? walk(serverApp).filter((f) => f.includes('e2e-harness')).map((f) => path.relative(dist, f)) : [];

const files = walk(dist).filter((f) => /\.(js|mjs|cjs|json|html|rsc|txt|map|css|meta|body)$/.test(f) || !path.extname(f));
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const m of MARKERS) if (text.includes(m)) (report.markerHits[m] ??= []).push(path.relative(dist, f));
}
report.filesScanned = files.length;

if (baseline) {
  const b = routes(baseline);
  report.baselineDiff = { onlyHere: report.routes.filter((r) => !b.includes(r)), onlyBaseline: b.filter((r) => !report.routes.includes(r)) };
}

if (mode === 'default') {
  report.ok =
    report.harnessRoutes.length === 0 &&
    report.serverAppHarness.length === 0 &&
    Object.keys(report.markerHits).length === 0 &&
    (!report.baselineDiff || (report.baselineDiff.onlyHere.length === 0 && report.baselineDiff.onlyBaseline.length === 0));
} else {
  report.ok = report.harnessRoutes.length > 0 && report.serverAppHarness.length > 0;
}
console.log(JSON.stringify(report, (k, v) => (k === 'routes' ? undefined : v), 2));
console.log(`ROUTES ${JSON.stringify(report.routes)}`);
process.exit(report.ok ? 0 : 1);
