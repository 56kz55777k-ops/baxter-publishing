#!/usr/bin/env node
/**
 * Slice D stage 8A — build-exclusion check for the local editor harness (plan §8.2; Q5 as approved;
 * corrected after Codex's 8A P2 #3). Test tooling only: reads a finished `next build` output directory.
 *
 *   node scripts/e2e-harness-verify.mjs default <distDir> [--baseline <distDir>]
 *   node scripts/e2e-harness-verify.mjs harness <distDir>
 *
 * Every input must first prove it is a COMPLETED, VALID Next build — positive evidence, never the absence
 * of something (corrected again after Codex's fresh 8A review: falsy JSON and incomplete artifacts).
 *   - BUILD_ID: a readable regular file holding one token;
 *   - every required manifest (SCHEMAS below: build, app-build, app-path-routes, server/app-paths,
 *     server/pages, server/middleware, routes, prerender, required-server-files) is a readable regular file
 *     whose parsed value is an object of the expected shape — null, false, 0, "", arrays and wrongly typed
 *     fields fail, and are checked before any field is used;
 *   - every file a manifest references is a readable regular file inside the build: client chunks
 *     (build-manifest, app-build-manifest), server pages (server/pages-manifest), each server entry with its
 *     client-reference manifest and trace (server/app-paths-manifest), and every file required-server-files
 *     lists (which must include the core manifests);
 *   - every route entry has its server entry and client build entry, and every server entry its route;
 *   - the normal application: each route in EXPECTED_APP_ROUTES is named, has its server entry and files,
 *     its client build entry, and appears in routes-manifest.json;
 *   - every scanned output file readable (a read error is an error, not a skip).
 * Rules taken from this application's real build output (Next 15.5); missing, not-a-file, unreadable,
 * malformed and wrongly shaped are distinct errors. The verifier never throws: an unexpected exception is a
 * failure report. A directory substituted for a file is "not a regular file".
 * A supplied --baseline must pass the same validation.
 * Then: default mode — no harness route, no harness server file, none of MARKERS in any output file, and
 * (with --baseline) the route list identical to the baseline's; harness mode — the harness route and its
 * server files present (the positive control).
 * Exit 0 only when the input is valid AND the expectation holds; 1 otherwise; 2 for a usage error.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isStrArr = (v) => Array.isArray(v) && v.every(isStr);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * Read one artifact of the build. Distinguishes: outside the build (rejected), missing, not a regular file
 * (e.g. a directory substituted for a file), unreadable (read error) — each recorded as an error.
 * Returns the text, or null when it could not be read.
 */
function readArtifact(dist, rel, errors, label = rel) {
  if (!isStr(rel) || path.isAbsolute(rel)) {
    errors.push(`${label}: invalid path ${JSON.stringify(rel)}`);
    return null;
  }
  const f = path.resolve(dist, rel);
  if (f !== dist && !f.startsWith(dist + path.sep)) {
    errors.push(`${label}: path escapes the build directory: ${rel}`);
    return null;
  }
  let st;
  try {
    st = lstatSync(f);
  } catch (e) {
    errors.push(e.code === 'ENOENT' ? `missing ${label}` : `unreadable ${label}: ${e.code ?? e.message}`);
    return null;
  }
  if (!st.isFile()) {
    errors.push(`not a regular file: ${label} (${st.isDirectory() ? 'directory' : 'not a file'})`);
    return null;
  }
  try {
    return readFileSync(f, 'utf8');
  } catch (e) {
    errors.push(`unreadable ${label}: ${e.code ?? e.message}`);
    return null;
  }
}

/** Read and parse a JSON artifact. `{ parsed: false }` on any read/parse failure (already recorded);
 *  `{ parsed: true, value }` otherwise — `value` may be null/false/0, which the caller's schema must reject. */
function readJson(dist, rel, errors) {
  const text = readArtifact(dist, rel, errors);
  if (text === null) return { parsed: false };
  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch {
    errors.push(`malformed JSON in ${rel}`);
    return { parsed: false };
  }
}

/**
 * Required manifests and their schemas (taken from this application's real `next build` output, Next 15.5;
 * the verification run checks real default, flag=0, harness and baseline builds against them). Each schema
 * returns a list of problems; a parsed value of null, false, 0, "" or an array fails because the top level
 * must be an object. Checked BEFORE any field is used for path operations or iteration.
 */
const strArrMap = (v) => isObj(v) && Object.values(v).every(isStrArr);
const strMap = (v) => isObj(v) && Object.values(v).every(isStr);
const pageEntries = (v) => Array.isArray(v) && v.every((r) => isObj(r) && isStr(r.page));
/**
 * One `middleware` or `functions` entry of server/middleware-manifest.json, as Next 15.5 writes it (this app's
 * real build: middleware["/"] = { files: ["server/edge-runtime-webpack.js", "server/middleware.js"],
 * name: "middleware", page: "/", matchers: [{ regexp, originalSource }], wasm: [], assets: [], env: {…} }).
 * Edge functions use the same shape. wasm/assets items are { name, filePath }. Checked before any field is
 * used; the files themselves are read in validateInto.
 */
const isNamedFile = (v) => isObj(v) && isStr(v.name) && isStr(v.filePath);
function edgeEntryProblems(section, key, e) {
  const at = `${section}[${JSON.stringify(key)}]`;
  if (!isObj(e)) return [`${at} must be an object, got ${kind(e)}`];
  return [
    !(isStrArr(e.files) && e.files.length) && `${at}.files must be a non-empty list of file paths`,
    !isStr(e.name) && `${at}.name must be a non-empty string`,
    !(isStr(e.page) && e.page === key) && `${at}.page must equal its key`,
    !(Array.isArray(e.matchers) && e.matchers.every((x) => isObj(x) && isStr(x.regexp))) && `${at}.matchers must be a list of { regexp }`,
    !(Array.isArray(e.wasm) && e.wasm.every(isNamedFile)) && `${at}.wasm must be a list of { name, filePath }`,
    !(Array.isArray(e.assets) && e.assets.every(isNamedFile)) && `${at}.assets must be a list of { name, filePath }`,
    !isObj(e.env) && `${at}.env must be an object`,
  ].filter(Boolean);
}

const SCHEMAS = {
  'build-manifest.json': (m) => [
    !(isStrArr(m.rootMainFiles) && m.rootMainFiles.length) && 'rootMainFiles must be a non-empty list of file paths',
    !isStrArr(m.polyfillFiles) && 'polyfillFiles must be a list of file paths',
    !isStrArr(m.lowPriorityFiles) && 'lowPriorityFiles must be a list of file paths',
    !strArrMap(m.pages) && 'pages must map page names to lists of file paths',
    strArrMap(m.pages) && !(m.pages['/_app'] && m.pages['/_error']) && 'pages must include /_app and /_error',
  ],
  'app-build-manifest.json': (m) => [!(strArrMap(m.pages) && Object.keys(m.pages).length) && 'pages must be a non-empty map of entry names to lists of file paths'],
  'app-path-routes-manifest.json': (m) => [
    !(strMap(m) && Object.keys(m).length) && 'must be a non-empty map of entry names to routes',
    strMap(m) && Object.values(m).some((r) => !r.startsWith('/')) && 'every route must start with "/"',
  ],
  'server/app-paths-manifest.json': (m) => [!(strMap(m) && Object.keys(m).length) && 'must be a non-empty map of entry names to server files'],
  'server/pages-manifest.json': (m) => [
    !strMap(m) && 'must map page names to server files',
    strMap(m) && !['/_app', '/_error', '/_document'].every((k) => isStr(m[k])) && 'must include /_app, /_error and /_document',
  ],
  'server/middleware-manifest.json': (m) => [
    !isNum(m.version) && 'version must be a number',
    !isObj(m.middleware) && 'middleware must be an object',
    !isObj(m.functions) && 'functions must be an object',
    !isStrArr(m.sortedMiddleware) && 'sortedMiddleware must be a list',
    ...(isObj(m.middleware) ? Object.entries(m.middleware).flatMap(([k, e]) => edgeEntryProblems('middleware', k, e)) : []),
    ...(isObj(m.functions) ? Object.entries(m.functions).flatMap(([k, e]) => edgeEntryProblems('functions', k, e)) : []),
    ...(isObj(m.middleware) && isStrArr(m.sortedMiddleware)
      ? [
          ...m.sortedMiddleware.filter((k) => !Object.hasOwn(m.middleware, k)).map((k) => `sortedMiddleware lists ${JSON.stringify(k)}, which has no middleware entry`),
          ...Object.keys(m.middleware).filter((k) => !m.sortedMiddleware.includes(k)).map((k) => `middleware entry ${JSON.stringify(k)} is missing from sortedMiddleware`),
        ]
      : []),
  ],
  'routes-manifest.json': (m) => [
    !isNum(m.version) && 'version must be a number',
    !pageEntries(m.staticRoutes) && 'staticRoutes must be a list of { page }',
    !pageEntries(m.dynamicRoutes) && 'dynamicRoutes must be a list of { page }',
  ],
  'prerender-manifest.json': (m) => [
    !isNum(m.version) && 'version must be a number',
    !isObj(m.routes) && 'routes must be an object',
    !isObj(m.dynamicRoutes) && 'dynamicRoutes must be an object',
  ],
  'required-server-files.json': (m) => [
    !isNum(m.version) && 'version must be a number',
    !(isObj(m.config) && isStr(m.config.distDir)) && 'config.distDir must be a non-empty string',
    !(isStrArr(m.files) && m.files.length) && 'files must be a non-empty list of file paths',
  ],
};
/** Files Next always lists in required-server-files.json `files` (relative to the build directory). */
const RSF_MUST_LIST = ['BUILD_ID', 'build-manifest.json', 'app-build-manifest.json', 'app-path-routes-manifest.json', 'routes-manifest.json', 'prerender-manifest.json', 'required-server-files.json', 'server/app-paths-manifest.json', 'server/pages-manifest.json', 'server/middleware-manifest.json'];

function loadManifests(dist, errors) {
  const m = {};
  for (const [rel, schema] of Object.entries(SCHEMAS)) {
    const r = readJson(dist, rel, errors);
    if (!r.parsed) continue;
    if (!isObj(r.value)) {
      errors.push(`${rel}: expected a JSON object, got ${kind(r.value)}`);
      continue;
    }
    const problems = schema(r.value).filter(Boolean);
    if (problems.length) errors.push(...problems.map((p) => `${rel}: ${p}`));
    else m[rel] = r.value;
  }
  return m;
}

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

/** The client build entry for route entry `e`. Next keys app-build-manifest by the SOURCE file name, so a
 *  page built through an extra page extension appears with that extension: in the real harness build the
 *  route entry `/(editor)/e2e-harness/[fixture]/page` (page.harness.tsx) is built as `…/page.harness`. */
const hasClientEntry = (abm, e) => e in abm.pages || Object.keys(abm.pages).some((k) => k.startsWith(`${e}.`) && /^[A-Za-z0-9-]+$/.test(k.slice(e.length + 1)));

function validateInto(dist, errors) {
  let buildId = null;
  const idText = readArtifact(dist, 'BUILD_ID', errors, 'BUILD_ID (not a completed build)');
  if (idText !== null) {
    buildId = idText.trim();
    if (!/^[A-Za-z0-9_-]{6,}$/.test(buildId)) errors.push('invalid BUILD_ID');
  }
  const m = loadManifests(dist, errors);
  const bm = m['build-manifest.json'];
  const abm = m['app-build-manifest.json'];
  const apr = m['app-path-routes-manifest.json'];
  const sap = m['server/app-paths-manifest.json'];
  const spm = m['server/pages-manifest.json'];
  const rm = m['routes-manifest.json'];
  const rsf = m['required-server-files.json'];

  // Every file a manifest references must be a readable regular file inside the build.
  const readEach = (files, label) => {
    for (const f of new Set(files)) readArtifact(dist, f, errors, `${label} → ${f}`);
  };
  if (bm) readEach([...bm.rootMainFiles, ...bm.polyfillFiles, ...bm.lowPriorityFiles, ...Object.values(bm.pages).flat()], 'build-manifest.json');
  if (abm) readEach(Object.values(abm.pages).flat(), 'app-build-manifest.json');
  if (spm) for (const [page, f] of Object.entries(spm)) readArtifact(dist, path.join('server', f), errors, `server/pages-manifest.json ${page} → server/${f}`);
  const mw = m['server/middleware-manifest.json'];
  if (mw)
    // Middleware and edge-function executables are declared only here (required-server-files lists the
    // manifest, not these files), so each declared file must be a readable regular file in the build.
    for (const kind of ['middleware', 'functions'])
      for (const [key, e] of Object.entries(mw[kind])) {
        const label = `server/middleware-manifest.json ${kind}[${JSON.stringify(key)}]`;
        readEach(e.files, label);
        readEach([...e.wasm, ...e.assets].map((x) => x.filePath), label);
      }
  if (sap)
    for (const [entry, f] of Object.entries(sap)) {
      if (!f.endsWith('.js')) {
        errors.push(`server/app-paths-manifest.json ${entry}: server file is not a .js file: ${f}`);
        continue;
      }
      const base = path.join('server', f.slice(0, -3));
      for (const g of [`${base}.js`, `${base}_client-reference-manifest.js`, `${base}.js.nft.json`]) readArtifact(dist, g, errors, `server/app-paths-manifest.json ${entry} → ${g}`);
    }
  if (rsf) {
    const prefix = `${rsf.config.distDir}/`;
    const listed = new Set();
    for (const f of rsf.files) {
      if (!f.startsWith(prefix)) {
        errors.push(`required-server-files.json: file outside ${rsf.config.distDir}: ${f}`);
        continue;
      }
      const rel = f.slice(prefix.length);
      listed.add(rel);
      readArtifact(dist, rel, errors, `required-server-files.json → ${rel}`);
    }
    for (const rel of RSF_MUST_LIST) if (!listed.has(rel)) errors.push(`required-server-files.json: files does not list ${rel}`);
  }

  // Cross-manifest consistency: every route entry has its server entry and client build entry, and vice versa.
  if (apr && sap) {
    for (const e of Object.keys(apr)) if (!(e in sap)) errors.push(`route entry ${e} (${apr[e]}) has no server/app-paths-manifest.json entry`);
    for (const e of Object.keys(sap)) if (!(e in apr)) errors.push(`server entry ${e} has no app-path-routes-manifest.json entry`);
  }
  if (apr && abm) for (const e of Object.keys(apr)) if (!hasClientEntry(abm, e)) errors.push(`route entry ${e} (${apr[e]}) has no app-build-manifest.json entry`);

  // The normal application: each expected route must be a complete route — named, served, built, routed.
  const appRoutes = apr ? Object.values(apr) : [];
  const rmPages = rm ? [...rm.staticRoutes, ...rm.dynamicRoutes].map((r) => r.page) : [];
  for (const r of EXPECTED_APP_ROUTES) {
    const entries = apr ? Object.keys(apr).filter((e) => apr[e] === r) : [];
    if (!entries.length) {
      errors.push(`expected application route missing: ${r}`);
      continue;
    }
    for (const e of entries) {
      if (sap && !(e in sap)) errors.push(`expected application route ${r}: no server entry for ${e}`);
      if (abm && !hasClientEntry(abm, e)) errors.push(`expected application route ${r}: no client build entry for ${e}`);
    }
    if (rm && !rmPages.includes(r)) errors.push(`expected application route ${r}: not in routes-manifest.json`);
  }

  const routes = new Set([...appRoutes, ...(sap ? Object.keys(sap) : []), ...rmPages]);
  return { routes: [...routes].sort(), buildId };
}

/** Validate that `dist` is a completed Next build of this application. Returns { errors, routes, buildId }.
 *  Never throws: an unexpected exception becomes an error (an input that breaks the checker is not valid). */
export function validateBuild(dist) {
  const errors = [];
  try {
    if (!isStr(dist)) return { errors: [`not a directory: ${dist}`], routes: [], buildId: null };
    const abs = path.resolve(dist);
    let st;
    try {
      st = statSync(abs);
    } catch {
      return { errors: [`not a directory: ${dist}`], routes: [], buildId: null };
    }
    if (!st.isDirectory()) return { errors: [`not a directory: ${dist}`], routes: [], buildId: null };
    const r = validateInto(abs, errors);
    return { errors, ...r };
  } catch (e) {
    errors.push(`verifier error while validating ${dist}: ${e?.message ?? e}`);
    return { errors, routes: [], buildId: null };
  }
}

/** Full check. Returns a report; `report.ok` is the verdict. */
export function verifyBuild({ mode, dist, baseline = null }) {
  if (!['default', 'harness'].includes(mode)) throw new Error(`unknown mode ${mode}`);
  try {
    return check(mode, dist, baseline);
  } catch (e) {
    // Never an uncaught exception or a pass: anything unexpected is a controlled failure.
    return { mode, dist, buildId: null, valid: false, errors: [`verifier error: ${e?.message ?? e}`], routes: [], harnessRoutes: [], serverAppHarness: [], markerHits: {}, filesScanned: 0, baseline: null, baselineDiff: null, ok: false };
  }
}

function check(mode, dist, baseline) {
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
  const root = path.resolve(dist);
  const serverApp = path.join(root, 'server', 'app');
  report.serverAppHarness = existsSync(serverApp) ? walk(serverApp, [], walkErrors).filter((f) => f.includes('e2e-harness')).map((f) => path.relative(root, f)) : [];
  const files = walk(root, [], walkErrors).filter((f) => /\.(js|mjs|cjs|json|html|rsc|txt|map|css|meta|body)$/.test(f) || !path.extname(f));
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, 'utf8');
    } catch (e) {
      walkErrors.push(`unreadable ${path.relative(root, f)}: ${e.code ?? e.message}`);
      continue;
    }
    report.filesScanned += 1;
    for (const m of MARKERS) if (text.includes(m)) (report.markerHits[m] ??= []).push(path.relative(root, f));
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
  let report;
  try {
    report = verifyBuild({ mode, dist, baseline: i >= 0 ? rest[i + 1] : null });
  } catch (e) {
    console.error(`verifier error: ${e?.message ?? e}`);
    console.log('VERDICT FAIL (verifier error)');
    return 1;
  }
  console.log(JSON.stringify(report, (k, v) => (k === 'routes' ? undefined : v), 2));
  console.log(`ROUTES ${JSON.stringify(report.routes)}`);
  console.log(report.ok ? 'VERDICT OK' : `VERDICT FAIL${report.errors.length ? ` (${report.errors.length} error(s))` : ''}`);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
export { main, fileURLToPath };
