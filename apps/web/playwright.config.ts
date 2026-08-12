/**
 * Playwright — the editor browser smoke (hardening item 8; blueprint
 * amendment 1: browser coverage begins BEFORE Slice B because the hidden-page
 * production incident was invisible to every unit test and to dev usage).
 *
 * Credentials/fixture come from apps/web/.env.e2e.local (gitignored,
 * user-created; KEY=VALUE lines): E2E_EMAIL, E2E_PASSWORD,
 * E2E_PUBLICATION_ID (a draft publication owned by that user). The smoke
 * SKIPS with a clear message when they are absent — it never fabricates a
 * session.
 *
 * The web server is `next dev` deliberately: Slice A ships no production
 * editing surface, and the smoke's "one real document commit" uses the
 * dev-only commit handle. The reducer→scheduler→fetch→DB→reload seam it
 * exercises is identical in production builds; production-mode mounting is
 * separately evidenced (see the hardening report). When Slice B lands real
 * editing tools, this config flips to `next start`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

function loadE2EEnv(): void {
  try {
    const raw = readFileSync(path.join(__dirname, '.env.e2e.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!;
    }
  } catch {
    /* absent: the smoke will skip */
  }
}
loadE2EEnv();

const PORT = 3007;

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/sign-in`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
