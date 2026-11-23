/**
 * Slice D stage 8A — the build-exclusion verifier certifies only complete, valid builds
 * (Codex's 8A P2 #3, then his fresh review's two verifier findings: falsy JSON bypassing validation, and
 * incomplete artifacts — unchecked required-server-files entries and route-to-server completeness).
 *
 * The synthetic fixture below mirrors this application's REAL `next build` output (Next 15.5): the same
 * manifests and fields, route-group entry names such as `/(editor)/studio/editor/[id]/page`, a server entry
 * with its `_client-reference-manifest.js` and `.js.nft.json`, the pages manifest with /_app, /_error,
 * /_document and 404.html, a middleware manifest, required-server-files listing the core manifests under
 * `.next/`, and — for the harness — the client build entry keyed by its source extension
 * (`…/page.harness`). Real default, flag=0, harness and baseline builds are checked in the verification run.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type Report = {
  ok: boolean;
  valid: boolean;
  errors: string[];
  harnessRoutes: string[];
  markerHits: Record<string, string[]>;
  baselineDiff: { onlyHere: string[]; onlyBaseline: string[] } | null;
};
type Mod = { verifyBuild(o: { mode: 'default' | 'harness'; dist: string; baseline?: string | null }): Report; EXPECTED_APP_ROUTES: string[] };

const verifierPath = path.resolve(__dirname, '../../../scripts/e2e-harness-verify.mjs');
const load = async () => (await import(/* @vite-ignore */ verifierPath)) as Mod;

type Entry = { entry: string; route: string };
/** Route entries as Next names them in this app (route groups kept in the entry, dropped from the route). */
const APP: Entry[] = [
  { entry: '/_not-found/page', route: '/_not-found' },
  { entry: '/(marketing)/page', route: '/' },
  { entry: '/(marketing)/publications/page', route: '/publications' },
  { entry: '/(auth)/sign-in/page', route: '/sign-in' },
  { entry: '/(editor)/studio/editor/[id]/page', route: '/studio/editor/[id]' },
  { entry: '/api/editor/[id]/route', route: '/api/editor/[id]' },
];
const HARNESS: Entry = { entry: '/(editor)/e2e-harness/[fixture]/page', route: '/e2e-harness/[fixture]' };
const EDITOR = APP[4];
const ID = 'AbCdEf123456';
const CORE = ['BUILD_ID', 'build-manifest.json', 'app-build-manifest.json', 'app-path-routes-manifest.json', 'routes-manifest.json', 'prerender-manifest.json', 'required-server-files.json', 'server/app-paths-manifest.json', 'server/pages-manifest.json', 'server/middleware-manifest.json'];
const MANIFESTS = CORE.filter((f) => f.endsWith('.json'));
const serverJs = (e: string) => `app${e}.js`;
const MIDDLEWARE = {
  files: ['server/edge-runtime-webpack.js', 'server/middleware.js'],
  name: 'middleware',
  page: '/',
  matchers: [{ regexp: '^(?:\\/(_next\\/data\\/[^/]{1,}))?(?:\\/((?!_next\\/static|_next\\/image|favicon.ico).*))$', originalSource: '/((?!_next/static|_next/image|favicon.ico).*)' }],
  wasm: [] as { name: string; filePath: string }[],
  assets: [] as { name: string; filePath: string }[],
  env: { __NEXT_BUILD_ID: 'AbCdEf123456' },
};

type Opts = { harness?: boolean; entries?: Entry[]; extra?: Record<string, string>; emptyMiddleware?: boolean };
/** Write a complete synthetic build mirroring the real output. `extra` overrides files after writing. */
function makeBuild(opts: Opts = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'baxter-build-'));
  const entries = [...(opts.entries ?? APP), ...(opts.harness ? [HARNESS] : [])];
  const w = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  };
  const json = (rel: string, v: unknown) => w(rel, JSON.stringify(v));
  w('BUILD_ID', ID);
  const c = {
    webpack: 'static/chunks/webpack-1a2b.js',
    framework: 'static/chunks/framework-1a2b.js',
    main: 'static/chunks/main-1a2b.js',
    mainApp: 'static/chunks/main-app-1a2b.js',
    polyfills: 'static/chunks/polyfills-1a2b.js',
    app: 'static/chunks/pages/_app-1a2b.js',
    error: 'static/chunks/pages/_error-1a2b.js',
    page: 'static/chunks/app/page-1a2b.js',
  };
  for (const f of Object.values(c)) w(f, `/* ${f} */`);
  w(`static/${ID}/_buildManifest.js`, '/* bm */');
  w(`static/${ID}/_ssgManifest.js`, '/* ssg */');
  json('build-manifest.json', {
    polyfillFiles: [c.polyfills],
    devFiles: [],
    ampDevFiles: [],
    lowPriorityFiles: [`static/${ID}/_buildManifest.js`, `static/${ID}/_ssgManifest.js`],
    rootMainFiles: [c.webpack, c.mainApp],
    rootMainFilesTree: {},
    pages: { '/_app': [c.webpack, c.framework, c.main, c.app], '/_error': [c.webpack, c.framework, c.main, c.error] },
    ampFirstPages: [],
  });
  const clientKey = (e: Entry) => (e === HARNESS ? `${e.entry}.harness` : e.entry);
  json('app-build-manifest.json', {
    pages: { '/layout': [c.webpack, c.mainApp], ...Object.fromEntries(entries.map((e) => [clientKey(e), [c.webpack, c.mainApp, c.page]])) },
  });
  json('app-path-routes-manifest.json', Object.fromEntries(entries.map((e) => [e.entry, e.route])));
  json('server/app-paths-manifest.json', Object.fromEntries(entries.map((e) => [e.entry, serverJs(e.entry)])));
  for (const e of entries) {
    const base = `server/app${e.entry}`;
    w(`${base}.js`, `/* ${e.route} */`);
    w(`${base}_client-reference-manifest.js`, '/* crm */');
    w(`${base}.js.nft.json`, JSON.stringify({ version: 1, files: [] }));
  }
  json('server/pages-manifest.json', { '/_app': 'pages/_app.js', '/_error': 'pages/_error.js', '/_document': 'pages/_document.js', '/404': 'pages/404.html' });
  for (const f of ['pages/_app.js', 'pages/_error.js', 'pages/_document.js', 'pages/404.html']) w(`server/${f}`, `/* ${f} */`);
  if (opts.emptyMiddleware) json('server/middleware-manifest.json', { version: 3, middleware: {}, functions: {}, sortedMiddleware: [] });
  else {
    // Active middleware, as in this app's real build (env values are build-generated; placeholders here).
    json('server/middleware-manifest.json', { version: 3, middleware: { '/': MIDDLEWARE }, functions: {}, sortedMiddleware: ['/'] });
    for (const f of MIDDLEWARE.files) w(f, `/* ${f} */`);
  }
  const isDyn = (r: string) => r.includes('[');
  json('routes-manifest.json', {
    version: 3,
    pages404: true,
    basePath: '',
    redirects: [],
    headers: [],
    rewrites: { beforeFiles: [], afterFiles: [], fallback: [] },
    staticRoutes: entries.filter((e) => !isDyn(e.route)).map((e) => ({ page: e.route, regex: '^/$' })),
    dynamicRoutes: entries.filter((e) => isDyn(e.route)).map((e) => ({ page: e.route, regex: '^/x$' })),
    dataRoutes: [],
  });
  json('prerender-manifest.json', { version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview: {} });
  json('required-server-files.json', { version: 1, config: { distDir: '.next' }, appDir: '/app/apps/web', relativeAppDir: 'apps/web', files: CORE.map((f) => `.next/${f}`), ignore: [] });
  for (const [rel, content] of Object.entries(opts.extra ?? {})) w(rel, content);
  return dir;
}

const errs = (r: Report) => r.errors.join(' | ');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
/** A complete build with `rel`'s parsed JSON changed by `edit`. */
function mutated(rel: string, edit: (v: Json) => Json, opts: Opts = {}) {
  const d = makeBuild(opts);
  writeFileSync(path.join(d, rel), JSON.stringify(edit(JSON.parse(readFileSync(path.join(d, rel), 'utf8')))));
  return d;
}
const without = (key: string) => (v: Json) => {
  delete v[key];
  return v;
};
/** `dir` must fail as the candidate AND as the baseline of a clean build, citing `needle` both times. */
async function failsBothWays(dir: string, needle: string) {
  const { verifyBuild } = await load();
  const asCandidate = verifyBuild({ mode: 'default', dist: dir });
  expect(asCandidate.ok, needle).toBe(false);
  expect(asCandidate.valid, needle).toBe(false);
  expect(errs(asCandidate)).toContain(needle);
  const asBaseline = verifyBuild({ mode: 'default', dist: makeBuild(), baseline: dir });
  expect(asBaseline.ok, needle).toBe(false);
  expect(asBaseline.errors.some((e) => e.startsWith('baseline: ') && e.includes(needle)), `${needle} :: ${errs(asBaseline)}`).toBe(true);
}

describe('e2e-harness-verify: valid builds pass', () => {
  it('a complete default build passes — alone and against a valid baseline', async () => {
    const { verifyBuild } = await load();
    const d = makeBuild();
    const alone = verifyBuild({ mode: 'default', dist: d });
    expect(alone.ok, errs(alone)).toBe(true);
    const r = verifyBuild({ mode: 'default', dist: d, baseline: makeBuild() });
    expect(r.ok, errs(r)).toBe(true);
    expect(r.baselineDiff).toEqual({ onlyHere: [], onlyBaseline: [] });
  });

  it('a complete harness build passes in harness mode (its client entry keyed `…/page.harness`) and fails in default mode', async () => {
    const { verifyBuild } = await load();
    const d = makeBuild({ harness: true });
    const h = verifyBuild({ mode: 'harness', dist: d });
    expect(h.ok, errs(h)).toBe(true);
    const r = verifyBuild({ mode: 'default', dist: d });
    expect(r.ok).toBe(false);
    expect(r.harnessRoutes).toContain('/e2e-harness/[fixture]');
  });

  it('a well-typed falsy field (routes-manifest version 0) is accepted — falsy is not the same as missing', async () => {
    const { verifyBuild } = await load();
    const r = verifyBuild({ mode: 'default', dist: mutated('routes-manifest.json', (v) => ({ ...v, version: 0 })) });
    expect(r.ok, errs(r)).toBe(true);
  });
});

describe("Codex's six fresh-review reproductions, applied to a complete build: each fails with its own error", () => {
  const cases: [string, () => string, string][] = [
    ['null build manifest', () => makeBuild({ extra: { 'build-manifest.json': 'null' } }), 'build-manifest.json: expected a JSON object, got null'],
    ['false app build manifest', () => makeBuild({ extra: { 'app-build-manifest.json': 'false' } }), 'app-build-manifest.json: expected a JSON object, got boolean'],
    ['null server paths', () => makeBuild({ extra: { 'server/app-paths-manifest.json': 'null' } }), 'server/app-paths-manifest.json: expected a JSON object, got null'],
    ['null routes manifest', () => makeBuild({ extra: { 'routes-manifest.json': 'null' } }), 'routes-manifest.json: expected a JSON object, got null'],
    ['required server file missing', () => mutated('required-server-files.json', (v) => ({ ...v, files: [...v.files, '.next/server/missing.js'] })), 'missing required-server-files.json → server/missing.js'],
    [
      'expected route server entry omitted and its server subtree deleted',
      () => {
        const d = mutated('server/app-paths-manifest.json', without(EDITOR.entry));
        rmSync(path.join(d, 'server/app/(editor)/studio'), { recursive: true });
        return d;
      },
      `expected application route /studio/editor/[id]: no server entry for ${EDITOR.entry}`,
    ],
  ];
  for (const [name, build, needle] of cases) it(name, async () => failsBothWays(build(), needle));
});

describe('falsy and wrongly typed JSON never bypasses validation', () => {
  const TOP: [string, string][] = [
    ['null', 'null'],
    ['false', 'boolean'],
    ['0', 'number'],
    ['""', 'string'],
    ['"text"', 'string'],
    ['[]', 'array'],
  ];
  for (const rel of MANIFESTS)
    for (const [value, kind] of TOP)
      it(`${rel} = ${value} → invalid`, async () => failsBothWays(makeBuild({ extra: { [rel]: value } }), `${rel}: expected a JSON object, got ${kind}`));

  const FIELDS: [string, string, (v: Json) => Json, string][] = [
    ['build-manifest.json', 'rootMainFiles null', (v) => ({ ...v, rootMainFiles: null }), 'rootMainFiles must be'],
    ['build-manifest.json', 'rootMainFiles []', (v) => ({ ...v, rootMainFiles: [] }), 'rootMainFiles must be'],
    ['build-manifest.json', 'rootMainFiles a string', (v) => ({ ...v, rootMainFiles: 'static/chunks/webpack-1a2b.js' }), 'rootMainFiles must be'],
    ['build-manifest.json', 'rootMainFiles [0, false]', (v) => ({ ...v, rootMainFiles: [0, false] }), 'rootMainFiles must be'],
    ['build-manifest.json', 'rootMainFiles [""]', (v) => ({ ...v, rootMainFiles: [''] }), 'rootMainFiles must be'],
    ['build-manifest.json', 'polyfillFiles absent', (v) => ({ ...v, polyfillFiles: undefined }), 'polyfillFiles must be'],
    ['build-manifest.json', 'lowPriorityFiles false', (v) => ({ ...v, lowPriorityFiles: false }), 'lowPriorityFiles must be'],
    ['build-manifest.json', 'pages null', (v) => ({ ...v, pages: null }), 'pages must map'],
    ['build-manifest.json', 'pages with a string file list', (v) => ({ ...v, pages: { '/_app': 'x.js', '/_error': [] } }), 'pages must map'],
    ['build-manifest.json', 'pages without /_app', (v) => ({ ...v, pages: { '/_error': v.pages['/_error'] } }), 'pages must include /_app and /_error'],
    ['app-build-manifest.json', 'no pages', () => ({}), 'pages must be'],
    ['app-build-manifest.json', 'pages {}', () => ({ pages: {} }), 'pages must be'],
    ['app-build-manifest.json', 'pages 0', () => ({ pages: 0 }), 'pages must be'],
    ['app-build-manifest.json', 'a string file list', (v) => ({ pages: { ...v.pages, '/layout': 'static/chunks/webpack-1a2b.js' } }), 'pages must be'],
    ['app-path-routes-manifest.json', '{}', () => ({}), 'must be a non-empty map'],
    ['app-path-routes-manifest.json', 'a numeric route', (v) => ({ ...v, [EDITOR.entry]: 5 }), 'must be a non-empty map'],
    ['app-path-routes-manifest.json', 'an empty route', (v) => ({ ...v, [EDITOR.entry]: '' }), 'must be a non-empty map'],
    ['app-path-routes-manifest.json', 'a route without "/"', (v) => ({ ...v, [EDITOR.entry]: 'studio/editor/[id]' }), 'every route must start'],
    ['server/app-paths-manifest.json', '{}', () => ({}), 'must be a non-empty map'],
    ['server/app-paths-manifest.json', 'a null server file', (v) => ({ ...v, [EDITOR.entry]: null }), 'must be a non-empty map'],
    ['server/app-paths-manifest.json', 'an array server file', (v) => ({ ...v, [EDITOR.entry]: ['app/x.js'] }), 'must be a non-empty map'],
    ['server/pages-manifest.json', 'no /_document', (v) => ({ ...v, '/_document': undefined }), 'must include /_app, /_error and /_document'],
    ['server/pages-manifest.json', 'a numeric file', (v) => ({ ...v, '/404': 404 }), 'must map page names'],
    ['server/middleware-manifest.json', 'sortedMiddleware null', (v) => ({ ...v, sortedMiddleware: null }), 'sortedMiddleware must be'],
    ['server/middleware-manifest.json', 'version "3"', (v) => ({ ...v, version: '3' }), 'version must be'],
    ['routes-manifest.json', 'version "3"', (v) => ({ ...v, version: '3' }), 'version must be'],
    ['routes-manifest.json', 'staticRoutes null', (v) => ({ ...v, staticRoutes: null }), 'staticRoutes must be'],
    ['routes-manifest.json', 'staticRoutes [{}]', (v) => ({ ...v, staticRoutes: [{}] }), 'staticRoutes must be'],
    ['routes-manifest.json', 'a numeric dynamic page', (v) => ({ ...v, dynamicRoutes: [{ page: 7 }] }), 'dynamicRoutes must be'],
    ['prerender-manifest.json', 'routes []', (v) => ({ ...v, routes: [] }), 'routes must be an object'],
    ['prerender-manifest.json', 'dynamicRoutes absent', (v) => ({ ...v, dynamicRoutes: undefined }), 'dynamicRoutes must be'],
    ['prerender-manifest.json', 'version null', (v) => ({ ...v, version: null }), 'version must be'],
    ['required-server-files.json', 'config null', (v) => ({ ...v, config: null }), 'config.distDir must be'],
    ['required-server-files.json', 'distDir ""', (v) => ({ ...v, config: { distDir: '' } }), 'config.distDir must be'],
    ['required-server-files.json', 'files []', (v) => ({ ...v, files: [] }), 'files must be'],
    ['required-server-files.json', 'files [3]', (v) => ({ ...v, files: [3] }), 'files must be'],
    ['required-server-files.json', 'files a string', (v) => ({ ...v, files: '.next/BUILD_ID' }), 'files must be'],
    ['required-server-files.json', 'version false', (v) => ({ ...v, version: false }), 'version must be'],
  ];
  for (const [rel, label, edit, needle] of FIELDS) it(`${rel}: ${label} → invalid`, async () => failsBothWays(mutated(rel, edit), `${rel}: ${needle}`));
});

describe('required artifacts: missing, not a regular file, unreadable, malformed', () => {
  for (const rel of CORE) {
    it(`missing ${rel} → invalid`, async () => {
      const d = makeBuild();
      rmSync(path.join(d, rel));
      await failsBothWays(d, `missing ${rel}`);
    });
    it(`a directory in place of ${rel} → invalid`, async () => {
      const d = makeBuild();
      rmSync(path.join(d, rel));
      mkdirSync(path.join(d, rel));
      await failsBothWays(d, `not a regular file: ${rel}`);
    });
  }

  it('malformed JSON is reported differently from a parsed-but-invalid value', async () => {
    await failsBothWays(makeBuild({ extra: { 'routes-manifest.json': '{not json' } }), 'malformed JSON in routes-manifest.json');
    await failsBothWays(makeBuild({ extra: { 'routes-manifest.json': 'null' } }), 'routes-manifest.json: expected a JSON object, got null');
  });

  it('an empty or invalid BUILD_ID → invalid', async () => {
    await failsBothWays(makeBuild({ extra: { BUILD_ID: '' } }), 'invalid BUILD_ID');
    await failsBothWays(makeBuild({ extra: { BUILD_ID: 'a b' } }), 'invalid BUILD_ID');
  });

  it.skipIf(process.getuid?.() === 0)('mode-000 manifest or server entry → "unreadable" (skipped as root, where permissions do not apply)', async () => {
    const { verifyBuild } = await load();
    for (const rel of ['build-manifest.json', `server/${serverJs(EDITOR.entry)}`]) {
      const d = makeBuild();
      chmodSync(path.join(d, rel), 0o000);
      const r = verifyBuild({ mode: 'default', dist: d });
      chmodSync(path.join(d, rel), 0o644);
      expect(r.ok, rel).toBe(false);
      expect(errs(r)).toContain('unreadable');
    }
  });
});

describe('referenced artifacts: entry kept, file deleted or replaced by a directory', () => {
  const EDITOR_SERVER = `server/app-paths-manifest.json ${EDITOR.entry} → server/app${EDITOR.entry}`;
  const REFS: [string, string][] = [
    ['static/chunks/webpack-1a2b.js', 'build-manifest.json → static/chunks/webpack-1a2b.js'], // rootMainFiles
    ['static/chunks/polyfills-1a2b.js', 'build-manifest.json → static/chunks/polyfills-1a2b.js'],
    [`static/${ID}/_buildManifest.js`, `build-manifest.json → static/${ID}/_buildManifest.js`],
    ['static/chunks/pages/_error-1a2b.js', 'build-manifest.json → static/chunks/pages/_error-1a2b.js'],
    ['static/chunks/app/page-1a2b.js', 'app-build-manifest.json → static/chunks/app/page-1a2b.js'],
    ['server/pages/_document.js', 'server/pages-manifest.json /_document → server/pages/_document.js'],
    ['server/pages/404.html', 'server/pages-manifest.json /404 → server/pages/404.html'],
    [`server/app${EDITOR.entry}.js`, `${EDITOR_SERVER}.js`],
    [`server/app${EDITOR.entry}_client-reference-manifest.js`, `${EDITOR_SERVER}_client-reference-manifest.js`],
    [`server/app${EDITOR.entry}.js.nft.json`, `${EDITOR_SERVER}.js.nft.json`],
    ['server/app/api/editor/[id]/route.js', 'server/app-paths-manifest.json /api/editor/[id]/route → server/app/api/editor/[id]/route.js'],
    ['server/app/(marketing)/publications/page.js', 'server/app-paths-manifest.json /(marketing)/publications/page'], // a non-expected route counts too
  ];
  for (const [rel, needle] of REFS) {
    it(`deleted ${rel}, its entry kept → invalid`, async () => {
      const d = makeBuild();
      rmSync(path.join(d, rel));
      await failsBothWays(d, needle);
    });
    it(`a directory in place of ${rel} → invalid`, async () => {
      const d = makeBuild();
      rmSync(path.join(d, rel));
      mkdirSync(path.join(d, rel));
      await failsBothWays(d, 'not a regular file');
    });
  }

  it('required-server-files: a declared file that is missing, a directory, outside the dist dir or escaping it → invalid', async () => {
    await failsBothWays(mutated('required-server-files.json', (v) => ({ ...v, files: [...v.files, '.next/server/chunks/gone.js'] })), 'missing required-server-files.json → server/chunks/gone.js');
    const d = mutated('required-server-files.json', (v) => ({ ...v, files: [...v.files, '.next/server/chunks'] }));
    mkdirSync(path.join(d, 'server/chunks'), { recursive: true });
    await failsBothWays(d, 'not a regular file: required-server-files.json → server/chunks');
    await failsBothWays(mutated('required-server-files.json', (v) => ({ ...v, files: [...v.files, 'node_modules/x.js'] })), 'file outside .next');
    await failsBothWays(mutated('required-server-files.json', (v) => ({ ...v, files: [...v.files, '.next/../../etc/passwd'] })), 'escapes the build directory');
  });

  it('required-server-files: omitting a core manifest from `files` → invalid', async () => {
    for (const core of ['server/pages-manifest.json', 'server/app-paths-manifest.json', 'BUILD_ID'])
      await failsBothWays(mutated('required-server-files.json', (v) => ({ ...v, files: v.files.filter((f: string) => f !== `.next/${core}`) })), `files does not list ${core}`);
  });

  it('a referenced path that escapes the build directory → invalid', async () => {
    await failsBothWays(mutated('build-manifest.json', (v) => ({ ...v, rootMainFiles: ['../outside.js'] })), 'escapes the build directory');
    await failsBothWays(mutated('server/app-paths-manifest.json', (v) => ({ ...v, [EDITOR.entry]: '../../outside.js' })), 'escapes the build directory');
  });
});

describe('route ↔ server ↔ client completeness (omitted entries, not only deleted files)', () => {
  it('editor route entry kept, its server entry omitted (files still present) → invalid', async () => {
    const d = mutated('server/app-paths-manifest.json', without(EDITOR.entry));
    await failsBothWays(d, `route entry ${EDITOR.entry} (/studio/editor/[id]) has no server/app-paths-manifest.json entry`);
    await failsBothWays(d, `expected application route /studio/editor/[id]: no server entry for ${EDITOR.entry}`);
  });

  it('editor client build entry omitted → invalid', async () => {
    const d = mutated('app-build-manifest.json', (v) => ({ pages: without(EDITOR.entry)(v.pages) }));
    await failsBothWays(d, `expected application route /studio/editor/[id]: no client build entry for ${EDITOR.entry}`);
  });

  it('editor route name omitted while its server entry remains → invalid', async () => {
    const d = mutated('app-path-routes-manifest.json', without(EDITOR.entry));
    await failsBothWays(d, `server entry ${EDITOR.entry} has no app-path-routes-manifest.json entry`);
    await failsBothWays(d, 'expected application route missing: /studio/editor/[id]');
  });

  it('editor route omitted from routes-manifest → invalid', async () => {
    const d = mutated('routes-manifest.json', (v) => ({ ...v, dynamicRoutes: v.dynamicRoutes.filter((r: { page: string }) => r.page !== '/studio/editor/[id]') }));
    await failsBothWays(d, 'expected application route /studio/editor/[id]: not in routes-manifest.json');
  });

  it('a non-expected route with no server entry is caught too (completeness is not only the expected list)', async () => {
    const d = mutated('server/app-paths-manifest.json', without('/(marketing)/publications/page'));
    await failsBothWays(d, 'route entry /(marketing)/publications/page (/publications) has no server/app-paths-manifest.json entry');
  });

  it('a build without the normal application routes → invalid (absence of harness strings is not enough)', async () => {
    const { verifyBuild, EXPECTED_APP_ROUTES } = await load();
    const r = verifyBuild({ mode: 'default', dist: makeBuild({ entries: [APP[0], APP[2]] }) });
    expect(r.ok).toBe(false);
    for (const route of EXPECTED_APP_ROUTES) expect(r.errors).toContain(`expected application route missing: ${route}`);
  });

  it('an extension-keyed client entry counts only for its own entry (no prefix confusion)', async () => {
    const d = mutated('app-build-manifest.json', (v) => {
      delete v.pages[EDITOR.entry];
      v.pages[`${EDITOR.entry}-other`] = v.pages['/layout'];
      return v;
    });
    await failsBothWays(d, `no client build entry for ${EDITOR.entry}`);
  });
});

describe('inputs that are not a build, invalid baselines, leaks, the harness positive control, the CLI', () => {
  it('an empty directory fails — alone, with an empty baseline, and in harness mode; a missing path fails', async () => {
    const { verifyBuild } = await load();
    const empty = mkdtempSync(path.join(tmpdir(), 'baxter-empty-'));
    for (const r of [
      verifyBuild({ mode: 'default', dist: empty }),
      verifyBuild({ mode: 'default', dist: empty, baseline: mkdtempSync(path.join(tmpdir(), 'baxter-empty-')) }),
      verifyBuild({ mode: 'harness', dist: empty }),
    ]) {
      expect(r.ok).toBe(false);
      expect(r.valid).toBe(false);
      expect(errs(r)).toContain('missing BUILD_ID');
    }
    expect(verifyBuild({ mode: 'default', dist: path.join(empty, 'does-not-exist') }).ok).toBe(false);
  });

  it('a missing, empty or partial baseline → fail, even when the build itself is clean', async () => {
    const { verifyBuild } = await load();
    const d = makeBuild();
    const partial = makeBuild();
    rmSync(path.join(partial, 'server/pages-manifest.json'));
    for (const b of [path.join(d, 'nope'), mkdtempSync(path.join(tmpdir(), 'baxter-empty-')), partial]) {
      const r = verifyBuild({ mode: 'default', dist: d, baseline: b });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.startsWith('baseline: '))).toBe(true);
    }
  });

  it('a leaked harness route or marker in a default build → fail', async () => {
    const { verifyBuild } = await load();
    expect(verifyBuild({ mode: 'default', dist: makeBuild({ harness: true }) }).ok).toBe(false);
    for (const marker of ['__baxterResizeTiming', 'data-unit-element-ids', '00000000-0000-4000-8000-000000000101']) {
      const r = verifyBuild({ mode: 'default', dist: makeBuild({ extra: { 'static/chunks/leak.js': `var x="${marker}"` } }) });
      expect(r.ok, marker).toBe(false);
      expect(Object.values(r.markerHits).flat()).toContain(path.join('static', 'chunks', 'leak.js'));
    }
  });

  it('a route list differing from the baseline → fail', async () => {
    const { verifyBuild } = await load();
    const extra = { entry: '/(marketing)/extra/page', route: '/extra' };
    const r = verifyBuild({ mode: 'default', dist: makeBuild({ entries: [...APP, extra] }), baseline: makeBuild() });
    expect(r.valid, errs(r)).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.baselineDiff!.onlyHere).toContain('/extra');
    expect(r.baselineDiff!.onlyBaseline).toEqual([]);
  });

  it('harness mode needs the harness route AND its server files (a valid build without them fails)', async () => {
    const { verifyBuild } = await load();
    expect(verifyBuild({ mode: 'harness', dist: makeBuild() }).ok).toBe(false);
  });

  it('the CLI reports invalid input as a controlled failure: exit 1, VERDICT FAIL, no stack trace', () => {
    const invalid: Record<string, string>[] = [{ 'build-manifest.json': 'null' }, { 'server/app-paths-manifest.json': 'false' }, { 'routes-manifest.json': '[]' }];
    for (const extra of invalid) {
      const d = makeBuild({ extra });
      for (const args of [['default', d], ['default', makeBuild(), '--baseline', d], ['harness', d]]) {
        const p = spawnSync(process.execPath, [verifierPath, ...args], { encoding: 'utf8' });
        expect(p.status, `${JSON.stringify(extra)} ${args[0]}`).toBe(1);
        expect(p.stdout).toMatch(/VERDICT FAIL \(\d+ error\(s\)\)/);
        expect(p.stderr).not.toMatch(/at .*\.mjs:\d+/);
      }
    }
    const ok = spawnSync(process.execPath, [verifierPath, 'default', makeBuild(), '--baseline', makeBuild()], { encoding: 'utf8' });
    expect(ok.status, ok.stdout).toBe(0);
    expect(ok.stdout).toContain('VERDICT OK');
    expect(spawnSync(process.execPath, [verifierPath, 'nonsense'], { encoding: 'utf8' }).status).toBe(2);
  });
});

describe('middleware and edge-function references (Codex 8A verifier review P2)', () => {
  const MWM = 'server/middleware-manifest.json';
  const at = (k = '/') => `${MWM} middleware[${JSON.stringify(k)}]`;

  it('a valid build with ACTIVE middleware passes (the fixture default), and legitimate empty maps pass too', async () => {
    const { verifyBuild } = await load();
    const active = verifyBuild({ mode: 'default', dist: makeBuild(), baseline: makeBuild() });
    expect(active.ok, errs(active)).toBe(true);
    const empty = verifyBuild({ mode: 'default', dist: makeBuild({ emptyMiddleware: true }), baseline: makeBuild({ emptyMiddleware: true }) });
    expect(empty.ok, errs(empty)).toBe(true);
  });

  for (const rel of MIDDLEWARE.files) {
    it(`missing ${rel} (declared by middleware["/"]) → invalid`, async () => {
      const d = makeBuild();
      rmSync(path.join(d, rel));
      await failsBothWays(d, `missing ${at()} → ${rel}`);
    });
    it(`a directory in place of ${rel} → invalid`, async () => {
      const d = makeBuild();
      rmSync(path.join(d, rel));
      mkdirSync(path.join(d, rel));
      await failsBothWays(d, `not a regular file: ${at()} → ${rel} (directory)`);
    });
  }

  it.skipIf(process.getuid?.() === 0)('a mode-000 middleware executable → "unreadable" (skipped as root, where permissions do not apply)', async () => {
    const { verifyBuild } = await load();
    const d = makeBuild();
    chmodSync(path.join(d, 'server/middleware.js'), 0o000);
    const r = verifyBuild({ mode: 'default', dist: d });
    chmodSync(path.join(d, 'server/middleware.js'), 0o644);
    expect(r.ok).toBe(false);
    expect(errs(r)).toContain(`unreadable ${at()} → server/middleware.js`);
  });

  const ENTRY: [string, (v: Json) => Json, string][] = [
    ['entry null', (v) => ({ ...v, middleware: { '/': null } }), 'middleware["/"] must be an object, got null'],
    ['entry false', (v) => ({ ...v, middleware: { '/': false } }), 'middleware["/"] must be an object, got boolean'],
    ['entry 0', (v) => ({ ...v, middleware: { '/': 0 } }), 'middleware["/"] must be an object, got number'],
    ['entry ""', (v) => ({ ...v, middleware: { '/': '' } }), 'middleware["/"] must be an object, got string'],
    ['entry []', (v) => ({ ...v, middleware: { '/': [] } }), 'middleware["/"] must be an object, got array'],
    ['files null', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, files: null } } }), 'middleware["/"].files must be'],
    ['files false', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, files: false } } }), 'middleware["/"].files must be'],
    ['files []', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, files: [] } } }), 'middleware["/"].files must be'],
    ['files a string', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, files: 'server/middleware.js' } } }), 'middleware["/"].files must be'],
    ['files [0]', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, files: [0] } } }), 'middleware["/"].files must be'],
    ['files [""]', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, files: [''] } } }), 'middleware["/"].files must be'],
    ['files absent', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, files: undefined } } }), 'middleware["/"].files must be'],
    ['name ""', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, name: '' } } }), 'middleware["/"].name must be'],
    ['page not its key', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, page: '/other' } } }), 'middleware["/"].page must equal its key'],
    ['matchers null', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, matchers: null } } }), 'middleware["/"].matchers must be'],
    ['matchers [{}]', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, matchers: [{}] } } }), 'middleware["/"].matchers must be'],
    ['wasm false', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, wasm: false } } }), 'middleware["/"].wasm must be'],
    ['wasm [{ name }]', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, wasm: [{ name: 'w' }] } } }), 'middleware["/"].wasm must be'],
    ['assets null', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, assets: null } } }), 'middleware["/"].assets must be'],
    ['env null', (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, env: null } } }), 'middleware["/"].env must be'],
    ['sortedMiddleware lists an absent entry', (v) => ({ ...v, sortedMiddleware: ['/', '/missing'] }), 'sortedMiddleware lists "/missing", which has no middleware entry'],
    ['a middleware entry missing from sortedMiddleware', (v) => ({ ...v, sortedMiddleware: [] }), 'middleware entry "/" is missing from sortedMiddleware'],
    ['sortedMiddleware [null]', (v) => ({ ...v, sortedMiddleware: [null] }), 'sortedMiddleware must be a list'],
    ['function entry null', (v) => ({ ...v, functions: { '/api/x/route': null } }), 'functions["/api/x/route"] must be an object, got null'],
    ['function files false', (v) => ({ ...v, functions: { '/api/x/route': { ...MIDDLEWARE, page: '/api/x/route', files: false } } }), 'functions["/api/x/route"].files must be'],
    ['function page not its key', (v) => ({ ...v, functions: { '/api/x/route': { ...MIDDLEWARE } } }), 'functions["/api/x/route"].page must equal its key'],
  ];
  for (const [label, editFn, needle] of ENTRY) it(`${MWM}: ${label} → invalid`, async () => failsBothWays(mutated(MWM, editFn), `${MWM}: ${needle}`));

  it('invalid or escaping declared paths → invalid', async () => {
    await failsBothWays(mutated(MWM, (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, files: ['../../outside.js'] } } })), 'escapes the build directory');
    await failsBothWays(mutated(MWM, (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, files: ['/etc/passwd'] } } })), 'invalid path "/etc/passwd"');
  });

  it('a wasm or asset filePath that is missing → invalid', async () => {
    await failsBothWays(mutated(MWM, (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, wasm: [{ name: 'wasm_x', filePath: 'server/edge-chunks/wasm_x.wasm' }] } } })), `missing ${at()} → server/edge-chunks/wasm_x.wasm`);
    await failsBothWays(mutated(MWM, (v) => ({ ...v, middleware: { '/': { ...MIDDLEWARE, assets: [{ name: 'a', filePath: 'server/edge-chunks/asset_a' }] } } })), `missing ${at()} → server/edge-chunks/asset_a`);
  });

  it('an edge-function entry is validated like middleware: present files pass, a missing file fails', async () => {
    const { verifyBuild } = await load();
    const fn = { ...MIDDLEWARE, name: 'x', page: '/api/x/route', files: ['server/edge-runtime-webpack.js', 'server/edge-fn-x.js'] };
    const ok = mutated(MWM, (v) => ({ ...v, functions: { '/api/x/route': fn } }));
    writeFileSync(path.join(ok, 'server/edge-fn-x.js'), '/* edge fn */');
    const r = verifyBuild({ mode: 'default', dist: ok, baseline: makeBuild() });
    expect(r.ok, errs(r)).toBe(true);
    await failsBothWays(mutated(MWM, (v) => ({ ...v, functions: { '/api/x/route': fn } })), `missing ${MWM} functions["/api/x/route"] → server/edge-fn-x.js`);
  });

  it('the CLI reports a missing middleware executable and a null middleware entry as controlled failures', () => {
    const missing = makeBuild();
    rmSync(path.join(missing, 'server/middleware.js'));
    const nullEntry = mutated(MWM, (v) => ({ ...v, middleware: { '/': null } }));
    for (const d of [missing, nullEntry])
      for (const args of [['default', d], ['default', makeBuild(), '--baseline', d], ['harness', d]]) {
        const p = spawnSync(process.execPath, [verifierPath, ...args], { encoding: 'utf8' });
        expect(p.status).toBe(1);
        expect(p.stdout).toMatch(/VERDICT FAIL \(\d+ error\(s\)\)/);
        expect(p.stderr).toBe('');
      }
  });
});
