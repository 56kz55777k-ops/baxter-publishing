/**
 * Stage 8A — the harness itself: the real styled editor loads from a fixture through the normal
 * parser, saves go only to the mock, nothing leaves the allowlist.
 */
import { test, expect } from '@playwright/test';
import { openEditor, expectFenced, ID } from './spec-kit';

test('the harness loads the real, styled editor from a fixture; a change saves to the mock only', async ({ page, context }) => {
  const ed = await openEditor(page, context, 'basic');
  // Application CSS is present: Tailwind's utilities lay the shell out (inspector at its token width).
  const inspectorWidth = await page.locator('[data-testid="inspector"]').evaluate((e) => e.getBoundingClientRect().width);
  expect(inspectorWidth).toBe(280);
  expect(await page.title()).toContain('Editor harness');
  const s = await ed.stage();
  expect(s.unitIds.sort()).toEqual([ID.rect, ID.ellipse, ID.lockedEllipse].sort());
  await ed.click(ID.rect);
  expect((await ed.stage()).selected).toEqual([ID.rect]);
  await page.keyboard.press('ArrowRight');
  await ed.waitForPuts(1);
  expect(ed.mock.puts[0]!.status).toBe(200);
  expect(ed.saved(ID.rect)).toEqual({ x: 20.5, y: 20, width: 40, height: 30 });
  expectFenced(ed);
});

test('create-if-absent: no stored document → the island POSTs, the mock answers, the editor boots', async ({ page, context }) => {
  const ed = await openEditor(page, context, 'create-if-absent');
  expect(ed.mock.writes.filter((w) => w.method === 'POST')).toHaveLength(1);
  expect((await ed.stage()).unitIds).toContain(ID.rect);
  expectFenced(ed);
});

test('an unknown fixture name is a 404 (allowlist)', async ({ page, context }) => {
  const ed0 = await openEditor(page, context, 'basic');
  const res = await page.goto('/e2e-harness/..%2F..%2Fpackage.json');
  expect(res?.status()).toBe(404);
  const res2 = await page.goto('/e2e-harness/not-a-fixture');
  expect(res2?.status()).toBe(404);
  expectFenced(ed0);
});
