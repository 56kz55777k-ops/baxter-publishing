#!/usr/bin/env node
/**
 * Slice D stage 8A — build-exclusion check for the local editor harness (plan §8.2; Q5 as approved;
 * corrected after Codex's 8A P2 #3). Test tooling only: reads a finished `next build` output directory.
 *
 *   node scripts/e2e-harness-verify.mjs default <distDir> [--baseline <distDir>]
 *   node scripts/e2e-harness-verify.mjs harness <distDir>
 *
 * Every input must first prove it is a COMPLETED, VALID Next build — positive evidence, never the absence
 * of something. Missing, malformed or unreadable required artifacts are ERRORS (never empty route lists):
 *   - BUILD_ID: present, one token;
 *   - build-manifest.json (rootMainFiles: a non-empty list of files that exist), app-build-manifest.json
 *     (pages: non-empty, every listed file exists), app-path-routes-manifest.json (non-empty),
 *     server/app-paths-manifest.json (non-empty; every listed server file exists), routes-manifest.json
 *     (version, staticRoutes[], dynamicRoutes[]), prerender-manifest.json (version, routes{}),
 *     required-server-files.json (config{});
 *   - the normal application: the routes in EXPECTED_APP_ROUTES, each with its server file;
 *   - every scanned output file readable (a read error is an error, not a skip).
 * A supplied --baseline must pass the same validation.
 * Then: default mode — no harness route, no harness server file, none of MARKERS in any output file, and
 * (with --baseline) the route list identical to the baseline's; harness mode — the harness route and its
 * server files present (the positive control).
 * Exit 0 only when the input is valid AND the expectation holds; 1 otherwise; 2 for a usage error.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Strings that exist only in harness code paths. */
export const MARKERS = [
  'e2e-harness',
  'harnessDocRow',
  'EditorMock',
  'data-unit-element-ids',
  'data-selected-ids',
  '__baxterResizeTiming',
  'createResizeTimingRecorder',
  'harnessResizeTiming',
  'baxter:editor:resize-move',
  'baxter:editor:resize-frame',
  '00000000-0000-4000-8000-', // fixture ids
  'Editor harness',
  'test/e2e-harness',
];

/** Routes a complete build of this application must contain (from app-path-routes-manifest values). */
export const EXPECTED_APP_ROUTES = ['/', '/sign-in', '/studio/editor/[id]', '/api/editor/[id]'];

const HARNESS_ROUTE = '/e2e-harness/[fixture]';

function readJson(dist, rel, errors) {
  const f = path.join(dist, rel);
  if (!existsSync(f)) {
    errors.push(`missing ${rel}`);
    return null;
  }
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch (e) {
    errors.push(`unreadable ${rel}: ${e.code ?? e.message}`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    errors.push(`malformed JSON in ${rel}`);
    return null;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function walk(dir, out = [], errors = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    errors.push(`unreadable directory ${dir}: ${e.code ?? e.message}`);
    return out;
  }
  for (const name of names) {
    const p = path.join(dir, name);
    let s;
    try {
      s = statSync(p);
    } catch (e) {
      errors.push(`unreadable ${p}: ${e.code ?? e.message}`);
      continue;
    }
    if (s.isDirectory()) {
      if (name === 'cache') continue; // webpack/SWC caches are not shipped output
      walk(p, out, errors);
    } else out.push(p);
  }
  return out;
}

/** Validate that `dist` is a completed Next build of this application. Returns { errors, routes, buildId, serverApp }. */
export function validateBuild(dist) {
  const errors = [];
  if (!dist || !existsSync(dist) || !statSync(dist).isDirectory()) {
    return { errors: [`not a directory: ${dist}`], routes: [], buildId: null };
  }
  let buildId = null;
  const idFile = path.join(dist, 'BUILD_ID');
  if (!existsSync(idFile)) errors.push('missing BUILD_ID (not a completed build)');
  else {
    try {
      buildId = readFileSync(idFile, 'utf8').trim();
      if (!/^[A-Za-z0-9_-]{6,}$/.test(buildId)) errors.push('invalid BUILD_ID');
    } catch (e) {
      errors.push(`unreadable BUILD_ID: ${e.code ?? e.message}`);
    }
  }

  const bm = readJson(dist, 'build-manifest.json', errors);
  if (bm) {
    if (!Array.isArray(bm.rootMainFiles) || bm.rootMainFiles.length === 0) errors.push('build-manifest.json: rootMainFiles missing or empty');
    else for (const f of bm.rootMainFiles) if (typeof f !== 'string' || !existsSync(path.join(dist, f))) errors.push(`build-manifest.json lists a missing file: ${f}`);
  }
  const abm = readJson(dist, 'app-build-manifest.json', errors);
  if (abm) {
    if (!isObj(abm.pages) || Object.keys(abm.pages).length === 0) errors.push('app-build-manifest.json: pages missing or empty');
    else
      for (const [page, files] of Object.entries(abm.pages)) {
        if (!Array.isArray(files)) errors.push(`app-build-manifest.json: ${page} has no file list`);
        else for (const f of files) if (!existsSync(path.join(dist, f))) errors.push(`app-build-manifest.json lists a missing file: ${f}`);
      }
  }
  const apr = readJson(dist, 'app-path-routes-manifest.json', errors);
  if (apr && (!isObj(apr) || Object.keys(apr).length === 0)) errors.push('app-path-routes-manifest.json: empty or not an object');
  const sap = readJson(dist, 'server/app-paths-manifest.json', errors);
  if (sap) {
    if (!isObj(sap) || Object.keys(sap).length === 0) errors.push('server/app-paths-manifest.json: empty or not an object');
    else for (const [route, f] of Object.entries(sap)) if (typeof f !== 'string' || !existsSync(path.join(dist, 'server', f))) errors.push(`server/app-paths-manifest.json: missing server file for ${route}: ${f}`);
  }
  const rm = readJson(dist, 'routes-manifest.json', errors);
  if (rm && (typeof rm.version !== 'number' || !Array.isArray(rm.staticRoutes) || !Array.isArray(rm.dynamicRoutes))) errors.push('routes-manifest.json: unexpected structure');
  const pm = readJson(dist, 'prerender-manifest.json', errors);
  if (pm && (typeof pm.version !== 'number' || !isObj(pm.routes))) errors.push('prerender-manifest.json: unexpected structure');
  const rsf = readJson(dist, 'required-server-files.json', errors);
  if (rsf && !isObj(rsf.config)) errors.push('required-server-files.json: unexpected structure');

  const appRoutes = isObj(apr) ? Object.values(apr) : [];
  for (const r of EXPECTED_APP_ROUTES) if (!appRoutes.includes(r)) errors.push(`expected application route missing: ${r}`);

  const routes = new Set([...appRoutes, ...(isObj(sap) ? Object.keys(sap) : []), ...(rm?.staticRoutes ?? []).map((r) => r.page), ...(rm?.dynamicRoutes ?? []).map((r) => r.page)]);
  return { errors, routes: [...routes].sort(), buildId, apr, sap };
}

/** Full check. Returns a report; `report.ok` is the verdict. */
export function verifyBuild({ mode, dist, baseline = null }) {
  if (!['default', 'harness'].includes(mode)) throw new Error(`unknown mode ${mode}`);
  const v = validateBuild(dist);
  const report = { mode, dist, buildId: v.buildId, valid: v.errors.length === 0, errors: [...v.errors], routes: v.routes, harnessRoutes: [], serverAppHarness: [], markerHits: {}, filesScanned: 0, baseline: null, baselineDiff: null, ok: false };

  if (baseline !== null) {
    const b = validateBuild(baseline);
    report.baseline = { dist: baseline, buildId: b.buildId, valid: b.errors.length === 0, errors: b.errors };
    if (b.errors.length) report.errors.push(...b.errors.map((e) => `baseline: ${e}`));
    else report.baselineDiff = { onlyHere: v.routes.filter((r) => !b.routes.includes(r)), onlyBaseline: b.routes.filter((r) => !v.routes.includes(r)) };
  }
  if (!report.valid) return report; // an invalid input is never certified, whatever it lacks

  report.harnessRoutes = v.routes.filter((r) => r.includes('e2e-harness'));
  const walkErrors = [];
  const serverApp = path.join(dist, 'server', 'app');
  report.serverAppHarness = existsSync(serverApp) ? walk(serverApp, [], walkErrors).filter((f) => f.includes('e2e-harness')).map((f) => path.relative(dist, f)) : [];
  const files = walk(dist, [], walkErrors).filter((f) => /\.(js|mjs|cjs|json|html|rsc|txt|map|css|meta|body)$/.test(f) || !path.extname(f));
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, 'utf8');
    } catch (e) {
      walkErrors.push(`unreadable ${path.relative(dist, f)}: ${e.code ?? e.message}`);
      continue;
    }
    report.filesScanned += 1;
    for (const m of MARKERS) if (text.includes(m)) (report.markerHits[m] ??= []).push(path.relative(dist, f));
  }
  report.errors.push(...walkErrors);

  if (mode === 'default') {
    report.ok =
      report.errors.length === 0 &&
      report.harnessRoutes.length === 0 &&
      report.serverAppHarness.length === 0 &&
      Object.keys(report.markerHits).length === 0 &&
      (baseline === null || (report.baselineDiff !== null && report.baselineDiff.onlyHere.length === 0 && report.baselineDiff.onlyBaseline.length === 0));
  } else {
    report.ok = report.errors.length === 0 && report.harnessRoutes.includes(HARNESS_ROUTE) && report.serverAppHarness.length > 0;
  }
  return report;
}

function main(argv) {
  const [mode, dist, ...rest] = argv;
  if (!['default', 'harness'].includes(mode) || !dist) {
    console.error('usage: e2e-harness-verify.mjs default|harness <distDir> [--baseline <distDir>]');
    return 2;
  }
  const i = rest.indexOf('--baseline');
  if (i >= 0 && !rest[i + 1]) {
    console.error('--baseline needs a directory');
    return 2;
  }
  const report = verifyBuild({ mode, dist, baseline: i >= 0 ? rest[i + 1] : null });
  console.log(JSON.stringify(report, (k, v) => (k === 'routes' ? undefined : v), 2));
  console.log(`ROUTES ${JSON.stringify(report.routes)}`);
  console.log(report.ok ? 'VERDICT OK' : `VERDICT FAIL${report.errors.length ? ` (${report.errors.length} error(s))` : ''}`);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
export { main, fileURLToPath };
