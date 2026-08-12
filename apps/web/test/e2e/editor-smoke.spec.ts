/**
 * Editor browser smoke (hardening item 8) — narrow by design.
 *
 * Covers: authorized route entry → stage mounts with non-zero dimensions
 * WITHOUT any interaction → one real document commit → autosave completes →
 * reload hydrates the saved revision → zero console errors or hydration
 * warnings across the whole run.
 *
 * Hidden-tab coverage, honestly stated: headless Chromium keeps producing
 * rendering frames for unfocused/background pages, so the exact
 * hidden-page observer starvation CANNOT be reproduced deterministically
 * here. The incident mechanism is pinned by the unit-level regression
 * (viewport-measure.test.tsx: observer never fires, synchronous measure
 * still initializes). The closest browser analogue below asserts the
 * mount happens with no resize, no focus event, and no user gesture —
 * the no-intervention path the incident violated.
 */
import { expect, test, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const PUBLICATION = process.env.E2E_PUBLICATION_ID;
const configured = Boolean(EMAIL && PASSWORD && PUBLICATION);

test.describe('editor smoke', () => {
  test.skip(
    !configured,
    'E2E_EMAIL / E2E_PASSWORD / E2E_PUBLICATION_ID missing (apps/web/.env.e2e.local) — smoke requires a real signed-in session'
  );

  let consoleProblems: string[] = [];

  function watchConsole(page: Page) {
    consoleProblems = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' || /hydrat|mismatch/i.test(text)) {
        consoleProblems.push(`[${msg.type()}] ${text}`);
      }
    });
    page.on('pageerror', (err) => {
      consoleProblems.push(`[pageerror] ${err.message}`);
    });
  }

  test('mounts, commits, saves, and rehydrates without interaction or console noise', async ({
    page,
  }) => {
    watchConsole(page);

    // Sign in (the user's own fixture credentials; typed by the runner).
    await page.goto('/sign-in');
    await page.getByLabel(/email/i).fill(EMAIL!);
    await page.getByLabel(/password/i).fill(PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/(studio|settings)/, { timeout: 20_000 });

    // Authorized editor route opens; stage mounts with NO interaction:
    // no resize, no focus nudge, no clicks before the assertion.
    await page.goto(`/studio/editor/${PUBLICATION}`);
    const canvas = page.locator('[data-testid="spread-stage"] canvas');
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    const dims = await canvas.evaluate((el) => ({
      w: (el as HTMLCanvasElement).width,
      h: (el as HTMLCanvasElement).height,
    }));
    expect(dims.w).toBeGreaterThan(0);
    expect(dims.h).toBeGreaterThan(0);
    await expect(page.getByTestId('save-state')).toHaveText(/All changes saved/);

    // One real commit through the dev handle → autosave completes.
    await page.evaluate(() => {
      (window as unknown as { __baxterEditorDevCommit: (l?: string) => void }).__baxterEditorDevCommit(
        'e2e smoke'
      );
    });
    await expect(page.getByTestId('save-state')).toHaveText(/Unsaved changes|Saving…/);
    await expect(page.getByTestId('save-state')).toHaveText(/All changes saved/, {
      timeout: 15_000,
    });

    // Reload hydrates the saved revision: a fresh commit from the reloaded
    // client saves cleanly — impossible with a stale base revision.
    await page.reload();
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('save-state')).toHaveText(/All changes saved/);
    await page.evaluate(() => {
      (window as unknown as { __baxterEditorDevCommit: (l?: string) => void }).__baxterEditorDevCommit(
        'e2e post-reload'
      );
    });
    await expect(page.getByTestId('save-state')).toHaveText(/All changes saved/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('read-only-banner')).toHaveCount(0);

    expect(consoleProblems, consoleProblems.join('\n')).toEqual([]);
  });
});
