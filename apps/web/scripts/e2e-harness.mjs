#!/usr/bin/env node
/**
 * Slice D stage 8A — build and serve the local application harness with an
 * explicit, sanitized environment (plan §8.2; Q5 approved by Ben 2026-11-18).
 *
 *   node scripts/e2e-harness.mjs build            # next build → .next-harness (BAXTER_E2E_HARNESS=1)
 *   node scripts/e2e-harness.mjs start [--strace] # next start on 127.0.0.1:3008 + the Supabase canary
 *
 * Nothing is inherited from the calling shell. Each child gets exactly the
 * variables listed below — no .env file is read (a fresh clone has none, and
 * Next would only read apps/web/.env* files, which this script refuses to run
 * beside), and no credential-shaped variable from the caller can leak in.
 *
 * - BUILD also gets HTTPS_PROXY / NO_PROXY / NODE_EXTRA_CA_CERTS when the
 *   caller has them: `next/font/google` downloads the two fonts at build time,
 *   as every default build (CI, Vercel) does. These are NOT inherently
 *   credential-free — a proxy URL can embed a user name and password — so the
 *   build REFUSES a proxy URL that carries userinfo, and build-env.json records
 *   only facts about them (present, scheme, loopback host, userinfo: false),
 *   never their values. NODE_EXTRA_CA_CERTS is a path to a CA certificate
 *   bundle (public certificates; no private key is passed).
 * - START gets no proxy and no network configuration at all. Its public
 *   Supabase URL points at a local CANARY (127.0.0.1:59321) that records every
 *   connection: the middleware creates a Supabase client on every request, and
 *   a session-less `getUser()` must make no request — any connection is a test
 *   failure (<run dir>/canary.log).
 * - `--strace` wraps `next start` in `strace -f -e trace=connect` and writes
 *   every connect() the server makes to <run dir>/server-connect.log.
 *
 * Artifacts go to $HARNESS_RUN_DIR when set (scripts/e2e-harness-run.mjs sets one per run), else
 * ../../harness-artifacts.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = process.env.HARNESS_RUN_DIR ? path.resolve(WEB, process.env.HARNESS_RUN_DIR) : path.join(WEB, '..', '..', 'harness-artifacts');
export const HARNESS_PORT = 3008;
export const CANARY_PORT = 59321;
const nextBin = path.join(WEB, '..', '..', 'node_modules', 'next', 'dist', 'bin', 'next');

for (const f of fs.readdirSync(WEB)) {
  if (/^\.env/.test(f)) {
    console.error(`refusing to run: ${f} exists in apps/web — the harness runs only from a clone with no .env files`);
    process.exit(2);
  }
}

const base = () => ({
  PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
  HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'baxter-harness-home-')),
  NEXT_TELEMETRY_DISABLED: '1',
  BAXTER_E2E_HARNESS: '1',
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${CANARY_PORT}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_placeholder',
});

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: WEB, env, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const [mode, ...flags] = process.argv.slice(2);
fs.mkdirSync(ART, { recursive: true });

if (mode === 'build') {
  fs.rmSync(path.join(WEB, '.next-harness'), { recursive: true, force: true });
  const env = { ...base(), NODE_ENV: 'production' };
  const proxyFacts = {};
  for (const k of ['HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS']) if (process.env[k]) env[k] = process.env[k];
  if (env.HTTPS_PROXY) {
    let u;
    try {
      u = new URL(env.HTTPS_PROXY);
    } catch {
      console.error('refusing to build: HTTPS_PROXY is not a URL');
      process.exit(2);
    }
    if (u.username || u.password) {
      console.error('refusing to build: HTTPS_PROXY carries credentials (userinfo); the harness build passes no credentials');
      process.exit(2);
    }
    proxyFacts.HTTPS_PROXY = { present: true, scheme: u.protocol.replace(':', ''), loopbackHost: ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname), userinfo: false };
  }
  if (env.NODE_EXTRA_CA_CERTS) proxyFacts.NODE_EXTRA_CA_CERTS = { present: true, isFile: fs.existsSync(env.NODE_EXTRA_CA_CERTS) };
  if (env.NO_PROXY) proxyFacts.NO_PROXY = { present: true };
  fs.writeFileSync(path.join(ART, 'build-env.json'), JSON.stringify({ keys: Object.keys(env).sort(), proxyFacts }, null, 2));
  // `next build` with a custom distDir rewrites tsconfig.json (adds `.next-harness/types/**/*.ts` and
  // reformats it). Snapshot and restore it so a harness build never leaves the working tree dirty.
  const tsconfig = path.join(WEB, 'tsconfig.json');
  const original = fs.readFileSync(tsconfig);
  let code;
  try {
    code = await run(process.execPath, [nextBin, 'build'], env);
  } finally {
    fs.writeFileSync(tsconfig, original);
  }
  process.exit(code);
} else if (mode === 'start') {
  const canaryLog = path.join(ART, 'canary.log');
  fs.writeFileSync(canaryLog, '');
  const canary = net.createServer((sock) => {
    fs.appendFileSync(canaryLog, `${new Date().toISOString()} connection from ${sock.remoteAddress}:${sock.remotePort}\n`);
    sock.destroy();
  });
  await new Promise((r) => canary.listen(CANARY_PORT, '127.0.0.1', r));
  const env = { ...base(), NODE_ENV: 'production', PORT: String(HARNESS_PORT) };
  fs.writeFileSync(path.join(ART, 'start-env.json'), JSON.stringify(Object.keys(env).sort(), null, 2));
  const args = [nextBin, 'start', '-H', '127.0.0.1', '-p', String(HARNESS_PORT)];
  const strace = flags.includes('--strace');
  const child = strace
    ? spawn('strace', ['-f', '-qq', '-e', 'trace=connect', '-o', path.join(ART, 'server-connect.log'), process.execPath, ...args], { cwd: WEB, env, stdio: 'inherit' })
    : spawn(process.execPath, args, { cwd: WEB, env, stdio: 'inherit' });
  const stop = () => {
    child.kill('SIGTERM');
    canary.close();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  child.on('exit', (code) => {
    canary.close();
    process.exit(code ?? 0);
  });
} else {
  console.error('usage: node scripts/e2e-harness.mjs build | start [--strace]');
  process.exit(2);
}
