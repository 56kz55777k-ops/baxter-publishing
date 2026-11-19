/**
 * Slice D stage 8A — the local application harness (plan §8.2; Q5 approved by
 * Ben 2026-11-18). Separate from playwright.config.ts (the production smoke):
 * its own test directory, its own port (3008), its own server.
 *
 *   node scripts/e2e-harness.mjs build
 *   npx playwright test -c playwright.harness.config.ts --project=chromium|firefox|webkit
 *
 * The server is `next start` of the harness build (`.next-harness`), started by
 * scripts/e2e-harness.mjs with an explicit sanitized environment and a local
 * Supabase canary. Every editor API request is answered in the browser by the
 * Node-side mock (test/e2e-harness/mock.ts); every request outside the
 * allowlist is aborted and fails the test. Service workers are blocked.
 * Never run in CI (plan §8.1); no production URL, credential or document.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 3008;
/** Every artifact of one invocation goes here (scripts/e2e-harness-run.mjs gives each run its own). */
const RUN_DIR = process.env.HARNESS_RUN_DIR || '../../harness-artifacts';
const viewport = { width: 1440, height: 900 };

export default defineConfig({
  testDir: './test/e2e-harness',
  testMatch: /.*\.spec\.ts$/,
  timeout: 90_000,
  retries: 0,
  workers: Number(process.env.HARNESS_WORKERS ?? 2),
  reporter: [['list'], ['json', { outputFile: `${RUN_DIR}/results.json` }]],
  outputDir: `${RUN_DIR}/test-output`,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport,
    serviceWorkers: 'block',
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport } },
  ],
  webServer: {
    command: `node scripts/e2e-harness.mjs start${process.env.HARNESS_STRACE === '1' ? ' --strace' : ''}`,
    url: `http://127.0.0.1:${PORT}/e2e-harness/basic`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
