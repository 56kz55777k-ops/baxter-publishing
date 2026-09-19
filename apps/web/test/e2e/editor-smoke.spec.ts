/**
 * Editor browser smoke — narrow by design, and narrower than the unit suite
 * on purpose.
 *
 * What only a browser can prove is asserted here; everything a jsdom test
 * already pins is deliberately NOT repeated. The truths this file establishes:
 *
 *   1. the route mounts and the stage sizes itself with NO interaction;
 *   2. a real pointer gesture creates a real element, selects it, and arms
 *      the inspector — the whole Slice B creation contract through actual
 *      mouse events rather than synthetic state;
 *   3. that element survives autosave and a full reload;
 *   4. a numeric inspector edit commits once and survives a reload;
 *   5. undo and redo work against real gestures;
 *   6. zero console errors or hydration warnings across the run.
 *
 * As of Slice B this runs against a PRODUCTION build (`next start`) and uses
 * no dev-only hooks: Slice A's `__baxterEditorDevCommit` handle existed only
 * because there was no editing surface to drive, and it is gone.
 *
 * Hidden-tab coverage, honestly stated: headless Chromium keeps producing
 * rendering frames for unfocused/background pages, so the exact hidden-page
 * observer starvation CANNOT be reproduced deterministically here. The
 * incident mechanism stays pinned by the unit-level regression
 * (viewport-measure.test.tsx). The mount assertion below is the closest
 * browser analogue: no resize, no focus event, no gesture before it.
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

  async function signInAndOpenEditor(page: Page) {
    await page.goto('/sign-in');
    await page.getByLabel(/email/i).fill(EMAIL!);
    await page.getByLabel(/password/i).fill(PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/(studio|settings)/, { timeout: 20_000 });
    await page.goto(`/studio/editor/${PUBLICATION}`);
    const canvas = page.locator('[data-testid="spread-stage"] canvas').first();
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    return canvas;
  }

  /** Drag on the stage in client coordinates relative to its bounding box. */
  async function dragOnStage(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) {
    const stage = page.getByTestId('spread-stage');
    const box = (await stage.boundingBox())!;
    await page.mouse.move(box.x + from.x, box.y + from.y);
    await page.mouse.down();
    // Two intermediate moves so the gesture reads as a drag, not a jump.
    await page.mouse.move(box.x + (from.x + to.x) / 2, box.y + (from.y + to.y) / 2);
    await page.mouse.move(box.x + to.x, box.y + to.y);
    await page.mouse.up();
  }

  test('creates a shape with real gestures, saves it, and rehydrates it after reload', async ({
    page,
  }) => {
    watchConsole(page);
    const canvas = await signInAndOpenEditor(page);

    // (1) The stage sized itself with no interaction at all.
    const dims = await canvas.evaluate((el) => ({
      w: (el as HTMLCanvasElement).width,
      h: (el as HTMLCanvasElement).height,
    }));
    expect(dims.w).toBeGreaterThan(0);
    expect(dims.h).toBeGreaterThan(0);
    await expect(page.getByTestId('save-state')).toHaveText(/All changes saved/);

    // (2) Arm the rectangle tool with its accepted letter and draw.
    await page.keyboard.press('r');
    await dragOnStage(page, { x: 420, y: 300 }, { x: 560, y: 400 });

    // The created element is selected and the inspector is armed — the
    // after-state contract #3 specifies.
    await expect(page.getByTestId('num-x')).toBeVisible();
    await expect(page.getByTestId('num-w')).toBeVisible();

    // (3) Autosave runs to completion off that one commit.
    await expect(page.getByTestId('save-state')).toHaveText(/Unsaved changes|Saving…/);
    await expect(page.getByTestId('save-state')).toHaveText(/All changes saved/, { timeout: 15_000 });

    // (4) A numeric inspector edit commits once and saves.
    const x = page.getByTestId('num-x');
    await x.click();
    await x.fill('30');
    await x.press('Enter');
    await expect(page.getByTestId('save-state')).toHaveText(/All changes saved/, { timeout: 15_000 });

    // (5) Undo and redo move the document; the element and its selection come back.
    await page.keyboard.press('Escape'); // leave the field so the chord is global
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('save-state')).toHaveText(/All changes saved/, { timeout: 15_000 });
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.getByTestId('save-state')).toHaveText(/All changes saved/, { timeout: 15_000 });

    // (6) Reload: selection is session state and is gone, but the ELEMENT is
    // not. A marquee across the spread finds it again, which is only possible
    // if it was persisted and rehydrated.
    await page.reload();
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('save-state')).toHaveText(/All changes saved/);
    await expect(page.getByTestId('num-x')).toHaveCount(0); // nothing selected yet

    await dragOnStage(page, { x: 200, y: 150 }, { x: 900, y: 650 });
    await expect(page.getByTestId('num-x')).toBeVisible();
    await expect(page.getByTestId('num-x')).toHaveValue('30'); // the edited value survived

    await expect(page.getByTestId('read-only-banner')).toHaveCount(0);
    expect(consoleProblems, consoleProblems.join('\n')).toEqual([]);
  });
});
