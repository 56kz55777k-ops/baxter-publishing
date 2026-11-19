#!/usr/bin/env node
/**
 * Slice D stage 8A — one harness invocation = one artifact directory (Codex's 8A P3).
 *
 *   node scripts/e2e-harness-run.mjs <label> [playwright test args…]
 *   e.g. node scripts/e2e-harness-run.mjs matrix-A harness-smoke matrix-anchors
 *        HARNESS_STRACE=1 HARNESS_WORKERS=1 node scripts/e2e-harness-run.mjs perf perf-resize
 *
 * Creates ../../harness-artifacts/runs/<UTC stamp>-<label>/ (never reused) and runs
 * `playwright test -c playwright.harness.config.ts <args> --reporter=line,json` with HARNESS_RUN_DIR set to
 * it, so the JSON report, the console log, test output, screenshots, perf metrics, the canary log and the
 * strace connect log of THIS invocation all land together. manifest.json records the exact command, the
 * commit and tree, dirty files, the harness build's BUILD_ID, Node/Playwright/browser versions, the
 * platform, start/end, exit status and the report's summary. A failed precondition (port 3008 busy, no
 * harness build) is written as a failed attempt in its own directory and exits non-zero.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(WEB, '..', '..');
const [label, ...pwArgs] = process.argv.slice(2);
if (!label || !/^[A-Za-z0-9._-]+$/.test(label)) {
  console.error('usage: e2e-harness-run.mjs <label> [playwright test args…]');
  process.exit(2);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(REPO, 'harness-artifacts', 'runs', `${stamp}-${label}`);
fs.mkdirSync(runDir, { recursive: true });
if (fs.readdirSync(runDir).length) {
  console.error(`run directory not empty: ${runDir}`);
  process.exit(2);
}

const git = (...a) => {
  try {
    return execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};
const pwCli = path.join(REPO, 'node_modules', '@playwright', 'test', 'cli.js');
const args = [pwCli, 'test', '-c', 'playwright.harness.config.ts', ...pwArgs, '--reporter=line,json'];
const manifest = {
  label,
  runDir: path.relative(REPO, runDir),
  command: `cd apps/web && ${Object.entries(process.env)
    .filter(([k]) => k.startsWith('HARNESS_'))
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')} node scripts/e2e-harness-run.mjs ${[label, ...pwArgs].join(' ')}`.replace(/\s+/g, ' '),
  playwrightCommand: `node ${path.relative(WEB, pwCli)} ${args.slice(1).join(' ')}`,
  harnessEnv: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('HARNESS_'))),
  commit: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  dirty: (git('status', '--porcelain') ?? '').split('\n').filter(Boolean),
  harnessBuildId: null,
  node: process.version,
  playwright: null,
  browsers: {},
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: `${os.cpus()[0]?.model ?? '?'} × ${os.cpus().length}`,
  memGB: Math.round(os.totalmem() / 2 ** 30),
  startedAt: new Date().toISOString(),
  endedAt: null,
  status: 'running',
  exitCode: null,
  summary: null,
  files: [],
};
const save = () => fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const fail = (why) => {
  manifest.status = 'failed-precondition';
  manifest.failure = why;
  manifest.endedAt = new Date().toISOString();
  manifest.exitCode = 3;
  save();
  console.error(`FAILED ATTEMPT (${why}) — recorded in ${runDir}`);
  process.exit(3);
};

try {
  manifest.harnessBuildId = fs.readFileSync(path.join(WEB, '.next-harness', 'BUILD_ID'), 'utf8').trim();
} catch {
  /* recorded as null below */
}
try {
  manifest.playwright = JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')).version;
} catch {
  /* null */
}
save();
if (!manifest.harnessBuildId) fail('no harness build (.next-harness/BUILD_ID missing): run `node scripts/e2e-harness.mjs build` first');

const portBusy = await new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port: 3008 });
  s.once('connect', () => (s.destroy(), resolve(true)));
  s.once('error', () => resolve(false));
});
if (portBusy) fail('port 3008 already in use');

try {
  const pw = await import('@playwright/test');
  for (const name of ['chromium', 'firefox', 'webkit']) {
    try {
      const b = await pw[name].launch();
      manifest.browsers[name] = b.version();
      await b.close();
    } catch (e) {
      manifest.browsers[name] = `unavailable: ${String(e.message ?? e).split('\n')[0]}`;
    }
  }
} catch (e) {
  manifest.browsers = { error: String(e) };
}
save();

const log = fs.createWriteStream(path.join(runDir, 'output.log'));
log.write(`$ ${manifest.command}\n$ ${manifest.playwrightCommand}\n\n`);
const child = spawn(process.execPath, args, {
  cwd: WEB,
  env: { ...process.env, HARNESS_RUN_DIR: runDir, PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(runDir, 'results.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => (process.stdout.write(d), log.write(d)));
child.stderr.on('data', (d) => (process.stderr.write(d), log.write(d)));
const code = await new Promise((resolve) => child.on('exit', (c, sig) => resolve(c ?? (sig ? 128 : 1))));
log.end();

manifest.exitCode = code;
manifest.endedAt = new Date().toISOString();
try {
  const r = JSON.parse(fs.readFileSync(path.join(runDir, 'results.json'), 'utf8'));
  manifest.summary = r.stats ?? null;
  manifest.errors = (r.errors ?? []).map((e) => e.message?.split('\n')[0]);
} catch {
  manifest.summary = null;
}
manifest.status = code === 0 ? 'passed' : 'failed';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(runDir, path.join(d, e.name))]));
manifest.files = walk(runDir).filter((f) => !f.startsWith('test-output/')).sort();
save();
console.log(`RUN ${manifest.status.toUpperCase()} (exit ${code}) — ${runDir}`);
process.exit(code);
