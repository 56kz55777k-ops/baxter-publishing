/**
 * Slice D stage 8A correction — the build-exclusion verifier rejects incomplete inputs (Codex's 8A P2 #3).
 * Synthetic build trees (written to a temp dir) exercise every path of scripts/e2e-harness-verify.mjs:
 * a complete default build and a complete harness build pass; empty, partial, malformed, unreadable and
 * leaked inputs fail, and so does an invalid baseline. Real builds are checked in the stage's verification
 * run (recorded in the evidence).
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type Report = { ok: boolean; valid: boolean; errors: string[]; harnessRoutes: string[]; markerHits: Record<string, string[]>; baselineDiff: { onlyHere: string[]; onlyBaseline: string[] } | null };
type Mod = { verifyBuild(o: { mode: 'default' | 'harness'; dist: string; baseline?: string | null }): Report; EXPECTED_APP_ROUTES: string[] };

const verifierPath = path.resolve(__dirname, '../../../scripts/e2e-harness-verify.mjs');
const load = async () => (await import(/* @vite-ignore */ verifierPath)) as Mod;

const ROUTES = ['/', '/sign-in', '/studio/editor/[id]', '/api/editor/[id]', '/publications'];
const pageKey = (r: string) => (r === '/' ? '/page' : r.startsWith('/api/') ? `${r}/route` : `${r}/page`);
const serverFile = (r: string) => `app${r === '/' ? '' : r}/${r.startsWith('/api/') ? 'route' : 'page'}.js`;

/** Write a complete synthetic Next build. `harness` adds the harness route; `extra` adds/overrides files. */
function makeBuild(opts: { harness?: boolean; routes?: string[]; extra?: Record<string, string> } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'baxter-build-'));
  const routes = [...(opts.routes ?? ROUTES), ...(opts.harness ? ['/e2e-harness/[fixture]'] : [])];
  const w = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  };
  w('BUILD_ID', 'AbCdEf123456');
  w('static/chunks/main-app.js', 'console.log("app")');
  w('static/chunks/webpack.js', 'console.log("rt")');
  w('build-manifest.json', JSON.stringify({ rootMainFiles: ['static/chunks/webpack.js', 'static/chunks/main-app.js'], pages: {} }));
  w('app-build-manifest.json', JSON.stringify({ pages: Object.fromEntries(routes.map((r) => [pageKey(r), ['static/chunks/main-app.js']])) }));
  w('app-path-routes-manifest.json', JSON.stringify(Object.fromEntries(routes.map((r) => [pageKey(r), r]))));
  w('server/app-paths-manifest.json', JSON.stringify(Object.fromEntries(routes.map((r) => [pageKey(r), serverFile(r)]))));
  for (const r of routes) w(`server/${serverFile(r)}`, `/* ${r} */`);
  w('routes-manifest.json', JSON.stringify({ version: 3, staticRoutes: [], dynamicRoutes: [] }));
  w('prerender-manifest.json', JSON.stringify({ version: 4, routes: {} }));
  w('required-server-files.json', JSON.stringify({ version: 1, config: { distDir: '.next' } }));
  for (const [rel, content] of Object.entries(opts.extra ?? {})) w(rel, content);
  return dir;
}

const errs = (r: Report) => r.errors.join(' | ');

describe('e2e-harness-verify: positive evidence of a complete build is required', () => {
  it('a complete default build passes (with and without a valid baseline)', async () => {
    const { verifyBuild } = await load();
    const d = makeBuild();
    expect(verifyBuild({ mode: 'default', dist: d })).toMatchObject({ ok: true, valid: true });
    const r = verifyBuild({ mode: 'default', dist: d, baseline: makeBuild() });
    expect(r.ok, errs(r)).toBe(true);
    expect(r.baselineDiff).toEqual({ onlyHere: [], onlyBaseline: [] });
  });

  it('a complete harness build passes in harness mode and fails in default mode', async () => {
    const { verifyBuild } = await load();
    const d = makeBuild({ harness: true });
    expect(verifyBuild({ mode: 'harness', dist: d }).ok).toBe(true);
    const r = verifyBuild({ mode: 'default', dist: d });
    expect(r.ok).toBe(false);
    expect(r.harnessRoutes).toContain('/e2e-harness/[fixture]');
  });

  it("Codex's case: an empty directory fails — alone, with an empty baseline, and in harness mode", async () => {
    const { verifyBuild } = await load();
    const empty = mkdtempSync(path.join(tmpdir(), 'baxter-empty-'));
    for (const r of [verifyBuild({ mode: 'default', dist: empty }), verifyBuild({ mode: 'default', dist: empty, baseline: mkdtempSync(path.join(tmpdir(), 'baxter-empty-')) }), verifyBuild({ mode: 'harness', dist: empty })]) {
      expect(r.ok).toBe(false);
      expect(r.valid).toBe(false);
      expect(r.errors).toContain('missing BUILD_ID (not a completed build)');
    }
    expect(verifyBuild({ mode: 'default', dist: path.join(empty, 'does-not-exist') }).ok).toBe(false);
  });

  for (const rel of ['BUILD_ID', 'build-manifest.json', 'app-build-manifest.json', 'app-path-routes-manifest.json', 'server/app-paths-manifest.json', 'routes-manifest.json', 'prerender-manifest.json', 'required-server-files.json']) {
    it(`missing ${rel} → invalid`, async () => {
      const { verifyBuild } = await load();
      const d = makeBuild();
      rmSync(path.join(d, rel));
      const r = verifyBuild({ mode: 'default', dist: d });
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain(rel);
    });
  }

  it('malformed or wrongly shaped manifests → invalid', async () => {
    const { verifyBuild } = await load();
    const cases: Record<string, string> = {
      'build-manifest.json': '{not json',
      'app-path-routes-manifest.json': '{}',
      'routes-manifest.json': JSON.stringify({ version: '3' }),
      'prerender-manifest.json': JSON.stringify({ routes: [] }),
      'required-server-files.json': JSON.stringify({ version: 1 }),
      'BUILD_ID': '',
    };
    for (const [rel, content] of Object.entries(cases)) {
      const r = verifyBuild({ mode: 'default', dist: makeBuild({ extra: { [rel]: content } }) });
      expect(r.ok, rel).toBe(false);
      expect(r.valid, rel).toBe(false);
    }
  });

  it('a partial / interrupted build (manifests list chunks or server files that are not there) → invalid', async () => {
    const { verifyBuild } = await load();
    const d1 = makeBuild();
    rmSync(path.join(d1, 'static/chunks/main-app.js'));
    expect(verifyBuild({ mode: 'default', dist: d1 }).errors.join()).toContain('lists a missing file');
    const d2 = makeBuild();
    rmSync(path.join(d2, 'server/app/studio/editor/[id]/page.js'));
    expect(verifyBuild({ mode: 'default', dist: d2 }).errors.join()).toContain('missing server file');
  });

  it('a build without the normal application routes → invalid (absence of harness strings is not enough)', async () => {
    const { verifyBuild, EXPECTED_APP_ROUTES } = await load();
    const r = verifyBuild({ mode: 'default', dist: makeBuild({ routes: ['/publications'] }) });
    expect(r.ok).toBe(false);
    for (const route of EXPECTED_APP_ROUTES) expect(r.errors).toContain(`expected application route missing: ${route}`);
  });

  it('a missing or invalid baseline → fail, even when the build itself is clean', async () => {
    const { verifyBuild } = await load();
    const d = makeBuild();
    const partial = makeBuild();
    rmSync(path.join(partial, 'routes-manifest.json'));
    for (const b of [path.join(d, 'nope'), mkdtempSync(path.join(tmpdir(), 'baxter-empty-')), partial]) {
      const r = verifyBuild({ mode: 'default', dist: d, baseline: b });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.startsWith('baseline: '))).toBe(true);
    }
  });

  it('an unreadable required artifact → invalid (a directory where a manifest must be; EISDIR)', async () => {
    const { verifyBuild } = await load();
    const d = makeBuild();
    rmSync(path.join(d, 'routes-manifest.json'));
    mkdirSync(path.join(d, 'routes-manifest.json'));
    const r = verifyBuild({ mode: 'default', dist: d });
    expect(r.ok).toBe(false);
    expect(errs(r)).toContain('unreadable routes-manifest.json');
  });

  it.skipIf(process.getuid?.() === 0)('an unreadable required artifact → invalid (mode 000; skipped as root, where permissions do not apply)', async () => {
    const { verifyBuild } = await load();
    const d = makeBuild();
    chmodSync(path.join(d, 'build-manifest.json'), 0o000);
    const r = verifyBuild({ mode: 'default', dist: d });
    chmodSync(path.join(d, 'build-manifest.json'), 0o644);
    expect(r.ok).toBe(false);
    expect(errs(r)).toContain('unreadable build-manifest.json');
  });

  it('a leaked harness route or marker in a default build → fail', async () => {
    const { verifyBuild } = await load();
    const leakedRoute = verifyBuild({ mode: 'default', dist: makeBuild({ harness: true }) });
    expect(leakedRoute.ok).toBe(false);
    for (const marker of ['__baxterResizeTiming', 'data-unit-element-ids', '00000000-0000-4000-8000-000000000101']) {
      const r = verifyBuild({ mode: 'default', dist: makeBuild({ extra: { 'static/chunks/leak.js': `var x="${marker}"` } }) });
      expect(r.ok, marker).toBe(false);
      expect(Object.values(r.markerHits).flat()).toContain(path.join('static', 'chunks', 'leak.js'));
    }
  });

  it('a route list differing from the baseline → fail', async () => {
    const { verifyBuild } = await load();
    const r = verifyBuild({ mode: 'default', dist: makeBuild({ routes: [...ROUTES, '/extra'] }), baseline: makeBuild() });
    expect(r.ok).toBe(false);
    expect(r.baselineDiff!.onlyHere).toContain('/extra'); // (and its server key '/extra/page')
    expect(r.baselineDiff!.onlyBaseline).toEqual([]);
  });

  it('harness mode needs the harness route AND its server files (a valid build without them fails)', async () => {
    const { verifyBuild } = await load();
    expect(verifyBuild({ mode: 'harness', dist: makeBuild() }).ok).toBe(false);
  });
});
