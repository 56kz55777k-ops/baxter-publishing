/**
 * Stage 8A matrix — persistence through the revision-aware mock (plan §8.2): undo/redo bodies,
 * reload fidelity, a conflict that lands DURING an active resize, and read-only behaviour.
 * Every answer comes from the Node-side mock; nothing reaches real persistence (the fence proves it).
 *
 * Conflict construction (Ben's 8A instruction): an EARLIER save is held by the mock, the next resize
 * gesture is started, and only then is the held save answered 409. No save is invented during a
 * resize preview — the editor does not save mid-gesture, and the test asserts that too.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page-script globals (Konva's untyped stage, test counters) and loosely typed document elements */
import { test, expect } from '@playwright/test';
import { openEditor, expectFenced, ID, fixtureDoc } from './spec-kit';

test('undo and redo send the exact documents: resized → original → resized, each on the previous revision', async ({ page, context }) => {
  const ed = await openEditor(page, context, 'basic');
  await ed.click(ID.rect);
  await ed.drag(await ed.anchorPoint(ID.rect, 'bottom-right'), [{ x: 72, y: 61 }], { mm: true });
  await ed.waitForPuts(1);
  const resized = ed.lastPut(ID.rect)!;
  expect(resized).not.toEqual({ x: 20, y: 20, width: 40, height: 30 });
  await page.keyboard.press('Control+z');
  await ed.waitForPuts(2);
  expect(ed.lastPut(ID.rect)).toEqual({ x: 20, y: 20, width: 40, height: 30 });
  await page.keyboard.press('Control+Shift+z');
  await ed.waitForPuts(3);
  expect(ed.lastPut(ID.rect)).toEqual(resized);
  expect(ed.mock.puts.map((w) => [w.baseRevision, w.status])).toEqual([[1, 200], [2, 200], [3, 200]]);
  expect(ed.mock.revision).toBe(4);
  // The live node matches the last saved document.
  const l = await ed.live(ID.rect);
  expect([l.geom.x, l.geom.y, l.geom.width, l.geom.height]).toEqual([resized.x, resized.y, resized.width, resized.height]);
  expectFenced(ed);
});

test('reload fidelity: after a resize, a reload loads the mock’s saved document and revision (create-if-absent route)', async ({ page, context }) => {
  const ed = await openEditor(page, context, 'create-if-absent', { seed: fixtureDoc('basic') });
  expect(ed.mock.writes.filter((w) => w.method === 'POST')).toHaveLength(1);
  await ed.click(ID.rect);
  await ed.drag(await ed.anchorPoint(ID.rect, 'top-left'), [{ x: 11.3, y: 14.7 }], { mm: true });
  await ed.waitForPuts(1);
  const saved = ed.saved(ID.rect)!;
  expect(ed.lastPut(ID.rect)).toEqual(saved);
  await page.reload();
  await ed.ready();
  expect(ed.mock.writes.filter((w) => w.method === 'POST')).toHaveLength(2);
  const l = await ed.live(ID.rect);
  expect([l.geom.x, l.geom.y, l.geom.width, l.geom.height]).toEqual([saved.x, saved.y, saved.width, saved.height]);
  // The next save is based on the reloaded revision (2), so the mock accepts it.
  await ed.click(ID.rect);
  await page.keyboard.press('ArrowDown');
  await ed.waitForPuts(2);
  expect(ed.mock.puts[1]!.baseRevision).toBe(2);
  expect(ed.mock.puts[1]!.status).toBe(200);
  expectFenced(ed);
});

test('conflict during an active resize: an earlier held save answers 409 mid-gesture → read-only, the resize cancels with zero trace, nothing more is saved', async ({ page, context }) => {
  const ed = await openEditor(page, context, 'basic');
  ed.mock.next({ kind: 'hold', commit: false });
  await ed.click(ID.rect);
  await page.keyboard.press('ArrowRight'); // the earlier edit: x 20 → 20.5
  await expect.poll(() => ed.mock.held.length, { timeout: 10_000 }).toBe(1);
  // Someone else commits meanwhile, so the held write's base is stale.
  ed.mock.humanEdit((d) => {
    (d.pages[0]!.elements.find((e) => e.id === ID.ellipse) as any).x = 33;
  });
  const before = await ed.live(ID.rect);
  expect(before.geom.x).toBe(20.5);
  // Start the next gesture and make it active (a rendered preview).
  const a = await ed.anchorPoint(ID.rect, 'bottom-right');
  await page.mouse.move(Math.round(a.x), Math.round(a.y));
  await page.mouse.down();
  await page.mouse.move(Math.round(a.x) + 60, Math.round(a.y) + 40, { steps: 6 });
  await page.waitForTimeout(60);
  expect((await ed.live(ID.rect)).geom).not.toEqual(before.geom);
  expect(ed.mock.puts).toHaveLength(1); // no save during the preview
  await ed.mock.held[0]!.release(); // 409
  await expect(page.locator('[data-testid="read-only-banner"]')).toBeVisible();
  await page.waitForTimeout(60);
  const after = await ed.live(ID.rect);
  expect(after.geom).toEqual(before.geom); // the preview is gone; the node is the current document
  expect((await ed.stage()).pill).toBeNull();
  // Continuing the drag and releasing does nothing.
  await page.mouse.move(Math.round(a.x) + 90, Math.round(a.y) + 60, { steps: 4 });
  await page.mouse.up();
  expect((await ed.live(ID.rect)).geom).toEqual(before.geom);
  // Read-only: no handles; a press on the former anchor point starts nothing; keys edit nothing.
  expect((await ed.chrome()).handles).toBe(0);
  await page.mouse.move(Math.round(a.x), Math.round(a.y));
  await page.mouse.down();
  await page.mouse.move(Math.round(a.x) + 40, Math.round(a.y) + 30, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Delete');
  await ed.expectNoPutsFor(3500);
  expect(ed.mock.puts.map((w) => w.status)).toEqual([409]);
  expect(ed.mock.revision).toBe(2); // only the human edit
  expect((ed.mock.element(ID.rect) as any).x).toBe(20);
  expectFenced(ed);
});

test('423 (window closed) from the mock → read-only with the window message; nothing more is saved', async ({ page, context }) => {
  const ed = await openEditor(page, context, 'basic');
  ed.mock.next({ kind: 'status', status: 423 });
  await ed.click(ID.rect);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-testid="read-only-banner"]')).toContainText('left the editing window');
  expect((await ed.chrome()).handles).toBe(0);
  await page.keyboard.press('ArrowRight');
  await ed.expectNoPutsFor(3000);
  expect(ed.mock.puts.map((w) => w.status)).toEqual([423]);
  expectFenced(ed);
});
