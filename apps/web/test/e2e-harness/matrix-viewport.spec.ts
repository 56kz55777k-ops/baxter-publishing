/**
 * Stage 8A matrix — the viewport freeze, the deferred refit, wheel recovery, and native Space/Enter
 * activation on focused controls with residual suppression (plan §4.6, §8.2).
 *
 * Input labels: REAL = Playwright mouse/keyboard/wheel and `page.setViewportSize` (a real browser
 * window resize); PROGRAMMATIC FOCUS = `element.focus()` from the test; DISPATCHED BLUR =
 * `window.dispatchEvent(new Event('blur'))`. A held key's repeats are Playwright's
 * `keyboard.down` on an already-down key (a trusted keydown with repeat: true).
 *
 * Focus fact (checked in all three browsers): pressing the canvas moves focus to <body>, and Tab is
 * prevented mid-session, so a control cannot be focused by real input while a resize is live. The
 * real-input route to a focused control is AFTER the release, with the key still held.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page-script globals (Konva's untyped stage, test counters) and loosely typed document elements */
import { test, expect, type Page } from '@playwright/test';
import { openEditor, expectFenced, ID, type Editor } from './spec-kit';

async function pressAnchor(ed: Editor, dx = 0, dy = 0) {
  const a = await ed.anchorPoint(ID.rect, 'bottom-right');
  const x = Math.round(a.x);
  const y = Math.round(a.y);
  await ed.page.mouse.move(x, y);
  await ed.page.mouse.down();
  if (dx || dy) await ed.page.mouse.move(x + dx, y + dy, { steps: 4 });
  await ed.page.waitForTimeout(40);
  return { x, y };
}

/** Real wheel and Ctrl+wheel at a point; returns whether data-view changed for each. */
async function wheelBoth(ed: Editor, at: { x: number; y: number }) {
  const v0 = (await ed.stage()).dataView;
  await ed.page.mouse.wheel(0, 120);
  await ed.page.waitForTimeout(60);
  const v1 = (await ed.stage()).dataView;
  await ed.page.keyboard.down('Control');
  await ed.page.mouse.wheel(0, -250);
  await ed.page.keyboard.up('Control');
  await ed.page.waitForTimeout(60);
  const v2 = (await ed.stage()).dataView;
  void at;
  return { panned: v1 !== v0, zoomed: v2 !== v1, browserZoom: await ed.page.evaluate(() => window.visualViewport?.scale ?? 1) };
}

/** Count data-view mutations from now on. */
async function watchView(page: Page) {
  await page.evaluate(() => {
    const w = document.querySelector('[data-testid="spread-stage"]') as HTMLElement;
    (window as any).__views = [];
    new MutationObserver(() => (window as any).__views.push(w.dataset.view)).observe(w, { attributes: true, attributeFilter: ['data-view'] });
  });
  return () => page.evaluate(() => (window as any).__views.slice() as string[]);
}

test.describe('viewport freeze (REAL wheel)', () => {
  test('pending (pressed, below the threshold): wheel and Ctrl+wheel do nothing; release saves nothing', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const p = await pressAnchor(ed, 1, 0);
    const r = await wheelBoth(ed, p);
    expect(r).toEqual({ panned: false, zoomed: false, browserZoom: 1 });
    await page.mouse.up();
    await ed.expectNoPutsFor(3000);
    expectFenced(ed);
  });

  test('active: wheel and Ctrl+wheel do nothing; the resize continues and commits; afterwards wheel pans and Ctrl+wheel zooms', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const p = await pressAnchor(ed, 30, 20);
    const r = await wheelBoth(ed, p);
    expect(r).toEqual({ panned: false, zoomed: false, browserZoom: 1 });
    await page.mouse.move(p.x + 50, p.y + 35, { steps: 4 });
    await page.waitForTimeout(40);
    const pill = (await ed.stage()).pill;
    await page.mouse.up();
    await ed.waitForPuts(1);
    const g = ed.lastPut(ID.rect)!;
    expect(pill).toBe(`${g.width} × ${g.height} mm`);
    expect(await wheelBoth(ed, p)).toMatchObject({ panned: true, zoomed: true });
    expectFenced(ed);
  });

  for (const how of ['Escape', 'DISPATCHED BLUR'] as const) {
    test(`wheel recovers after ${how} cancels a live resize`, async ({ page, context }) => {
      const ed = await openEditor(page, context, 'basic');
      await ed.click(ID.rect);
      const p = await pressAnchor(ed, 30, 20);
      if (how === 'Escape') await page.keyboard.press('Escape');
      else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(40);
      // The button is still down: the freeze has ended with the session.
      expect(await wheelBoth(ed, p)).toMatchObject({ panned: true, zoomed: true });
      await page.mouse.up();
      await ed.expectNoPutsFor(3000);
      expectFenced(ed);
    });
  }

  test('window resized twice mid-resize (REAL setViewportSize): no refit while live; exactly one refit after the release, to the LATEST size', async ({ page, context, browser }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const views = await watchView(page);
    const v0 = (await ed.stage()).dataView;
    const p = await pressAnchor(ed, 25, 15);
    await page.setViewportSize({ width: 1300, height: 820 });
    await page.waitForTimeout(150);
    await page.setViewportSize({ width: 1200, height: 760 });
    await page.waitForTimeout(150);
    expect((await ed.stage()).dataView).toBe(v0);
    expect(await views()).toEqual([]);
    await page.mouse.move(p.x + 40, p.y + 25, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const changes = await views();
    expect(changes).toHaveLength(1);
    await ed.waitForPuts(1);
    // Reference: a fresh editor opened at the latest size fits to the same view.
    const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 760 }, serviceWorkers: 'block' });
    const ref = await openEditor(await ctx2.newPage(), ctx2, 'basic');
    expect(changes[0]).toBe((await ref.stage()).dataView);
    expectFenced(ref);
    await ctx2.close();
    expectFenced(ed);
  });
});

test.describe('native Space/Enter on focused controls and residual suppression', () => {
  async function tabTo(page: Page, testid: string) {
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate((t) => (document.activeElement as HTMLElement | null)?.dataset.testid === t, testid)) return;
    }
    throw new Error(`Tab never reached ${testid}`);
  }
  const isLocked = (ed: Editor) => ed.page.locator('[data-testid="lock-toggle"]').textContent().then((t) => t === 'Unlock');
  const keepOn = (ed: Editor) => ed.page.locator('[data-testid="keep-proportions"]').isChecked();

  test('REAL: Enter held from mid-resize; after the release Tab to Lock — the held Enter’s repeats do not press it; a fresh Enter does', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    await pressAnchor(ed, 30, 20);
    await page.keyboard.down('Enter');
    await page.mouse.up();
    await ed.waitForPuts(1);
    await tabTo(page, 'lock-toggle');
    await page.keyboard.down('Enter'); // repeat
    await page.keyboard.down('Enter'); // repeat
    await page.waitForTimeout(60);
    expect(await isLocked(ed)).toBe(false);
    await page.keyboard.up('Enter');
    await page.waitForTimeout(60);
    expect(await isLocked(ed)).toBe(false);
    await ed.expectNoPutsFor(2500);
    expect(ed.mock.puts).toHaveLength(1);
    await page.keyboard.press('Enter'); // fresh press: native activation works again
    await expect.poll(() => isLocked(ed)).toBe(true);
    await ed.waitForPuts(2);
    expectFenced(ed);
  });

  for (const target of ['lock-toggle', 'keep-proportions'] as const) {
    test(`REAL: Space held from mid-resize; after the release Tab to ${target} — the held Space’s keyup does not activate it; a fresh Space does`, async ({ page, context }) => {
      const ed = await openEditor(page, context, 'basic');
      await ed.click(ID.rect);
      const p = await pressAnchor(ed, 30, 20);
      await page.keyboard.down(' ');
      await page.mouse.move(p.x + 40, p.y + 30, { steps: 3 });
      await page.mouse.up();
      await ed.waitForPuts(1);
      await tabTo(page, target);
      await page.keyboard.down(' '); // repeat
      await page.keyboard.up(' ');
      await page.waitForTimeout(80);
      expect(await isLocked(ed)).toBe(false);
      expect(await keepOn(ed)).toBe(false);
      await ed.expectNoPutsFor(2500);
      await page.keyboard.press(' ');
      if (target === 'lock-toggle') await expect.poll(() => isLocked(ed)).toBe(true);
      else await expect.poll(() => keepOn(ed)).toBe(true);
      expectFenced(ed);
    });
  }

  for (const key of ['Enter', ' '] as const) {
    test(`PROGRAMMATIC FOCUS on Lock during a live resize: ${key === ' ' ? 'Space' : 'Enter'} pressed and released (after the mouse) does not activate it; the resize commits`, async ({ page, context }) => {
      const ed = await openEditor(page, context, 'basic');
      await ed.click(ID.rect);
      const p = await pressAnchor(ed, 30, 20);
      await page.locator('[data-testid="lock-toggle"]').evaluate((b: HTMLElement) => b.focus());
      await page.keyboard.down(key);
      await page.keyboard.down(key); // repeat
      await page.mouse.move(p.x + 45, p.y + 30, { steps: 3 });
      await page.waitForTimeout(40);
      expect(await isLocked(ed)).toBe(false);
      await page.mouse.up();
      await page.keyboard.up(key);
      await page.waitForTimeout(80);
      expect(await isLocked(ed)).toBe(false);
      await ed.waitForPuts(1);
      await ed.expectNoPutsFor(2500);
      expect(ed.mock.puts).toHaveLength(1);
      expect(ed.mock.puts[0]!.doc!.pages[0]!.elements.find((e) => e.id === ID.rect)!.locked ?? false).toBe(false);
      expectFenced(ed);
    });
  }
});
