/**
 * Stage 8A matrix — stage 6 (Keep proportions: keyboard, lifetime, typed and stepped W/H) and stage 7
 * (multi-selection border, mixed locked drag, spread offsets, constant-size padlocks, pass-through,
 * visibility) in the real styled editor, with screenshots (plan §8.2).
 *
 * Every behaviour here is driven by REAL Playwright input, including the locks (the inspector's Lock
 * button, really clicked) — where the stage 7 probe used a programmatic COMMIT. The `basic` fixture's
 * third element is stored locked; that is fixture setup, entering through the normal parser.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page-script globals (Konva's untyped stage, test counters) and loosely typed document elements */
import { test, expect } from '@playwright/test';
import { openEditor, expectFenced, ID, type Editor } from './spec-kit';

const SHOTS = '../../harness-artifacts/screens';
const shot = (ed: Editor, name: string) => ed.page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png` });
const keep = (ed: Editor) => ed.page.locator('[data-testid="keep-proportions"]');
const union = (rs: { x: number; y: number; width: number; height: number }[]) => {
  const l = Math.min(...rs.map((r) => r.x));
  const t = Math.min(...rs.map((r) => r.y));
  const r = Math.max(...rs.map((q) => q.x + q.width));
  const b = Math.max(...rs.map((q) => q.y + q.height));
  return { x: l, y: t, width: r - l, height: b - t };
};
const near = (a: { x: number; y: number; width: number; height: number }, b: typeof a, tol = 0.75) =>
  Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.width - b.width) <= tol && Math.abs(a.height - b.height) <= tol;

async function tabTo(ed: Editor, testid: string) {
  for (let i = 0; i < 80; i++) {
    await ed.page.keyboard.press('Tab');
    if (await ed.page.evaluate((t) => (document.activeElement as HTMLElement | null)?.dataset.testid === t, testid)) return;
  }
  throw new Error(`Tab never reached ${testid}`);
}

test.describe('stage 6 — Keep proportions', () => {
  test('keyboard: Tab to the checkbox, Space toggles it (no history, no save); Ctrl+Z still undoes the document; H selects Hand; focus stays', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    await ed.drag(await ed.anchorPoint(ID.rect, 'middle-right'), [{ x: 70, y: 35 }], { mm: true });
    await ed.waitForPuts(1);
    await tabTo(ed, 'keep-proportions');
    await page.keyboard.press(' ');
    await expect(keep(ed)).toBeChecked();
    await ed.expectNoPutsFor(2500);
    await page.keyboard.press('Control+z');
    await ed.waitForPuts(2);
    expect(ed.lastPut(ID.rect)).toEqual({ x: 20, y: 20, width: 40, height: 30 });
    await expect(keep(ed)).toBeChecked();
    await page.keyboard.press('h');
    await page.waitForTimeout(60);
    expect((await ed.stage()).cursor).toBe('grab');
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.testid)).toBe('keep-proportions');
    expectFenced(ed);
  });

  test('lifetime: the setting survives selection changes; a reload starts it OFF', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    await keep(ed).click();
    await ed.click(ID.ellipse);
    await expect(keep(ed)).toBeChecked();
    await page.keyboard.press('Escape');
    await ed.click(ID.rect);
    await expect(keep(ed)).toBeChecked();
    await page.reload();
    await ed.ready();
    await ed.click(ID.rect);
    await expect(keep(ed)).not.toBeChecked();
    expect(ed.mock.puts).toHaveLength(0);
    expectFenced(ed);
  });

  test('typed and stepped W/H stay independent with the toggle ON: W pins the left edge; ↑ +1, Shift+↑ +5', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    await keep(ed).click();
    await ed.field('w').fill('50');
    await page.keyboard.press('Enter');
    await ed.waitForPuts(1);
    expect(ed.lastPut(ID.rect)).toEqual({ x: 20, y: 20, width: 50, height: 30 });
    await ed.field('h').focus();
    await page.keyboard.press('ArrowUp');
    await ed.waitForPuts(2);
    expect(ed.lastPut(ID.rect)).toEqual({ x: 20, y: 20, width: 50, height: 31 });
    await page.keyboard.press('Shift+ArrowUp');
    await ed.waitForPuts(3);
    expect(ed.lastPut(ID.rect)).toEqual({ x: 20, y: 20, width: 50, height: 36 });
    expectFenced(ed);
  });
});

test.describe('stage 7 — selection and lock chrome in the styled app', () => {
  test('multi-selection by real clicks: one dashed border = the union of the rendered nodes; no outlines, no handles; not listening', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    await ed.click(ID.ellipse, true);
    expect((await ed.stage()).selected.sort()).toEqual([ID.rect, ID.ellipse].sort());
    const c = await ed.chrome();
    const u = union([(await ed.live(ID.rect)).rect, (await ed.live(ID.ellipse)).rect]);
    expect(c.border).not.toBeNull();
    expect(near(c.border!, u)).toBe(true);
    expect(c.border!.dash).toEqual([3, 2]);
    expect([c.border!.listening, c.border!.layerListening]).toEqual([false, false]);
    expect([c.outlines, c.handles]).toEqual([0, 0]);
    await shot(ed, 'multi-border');
    expectFenced(ed);
  });

  test('mixed locked drag: the unlocked member moves, the locked one stays; the border follows the displayed nodes; one save', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    await ed.click(ID.lockedEllipse, true);
    const r0 = (await ed.live(ID.rect)).rect;
    const l0 = (await ed.live(ID.lockedEllipse)).rect;
    const from = { x: Math.round(r0.x + r0.width / 2 + (await ed.stage()).left), y: Math.round(r0.y + r0.height / 2 + (await ed.stage()).top) };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 120, from.y - 30, { steps: 8 });
    await page.waitForTimeout(60);
    const r1 = (await ed.live(ID.rect)).rect;
    const l1 = (await ed.live(ID.lockedEllipse)).rect;
    // The drag's own threshold/snap make the moved distance close to, not equal to, the pointer's.
    const d = { x: r1.x - r0.x, y: r1.y - r0.y };
    expect(d.x).toBeGreaterThan(100);
    expect(d.y).toBeLessThan(-20);
    expect(l1).toEqual(l0);
    const c = await ed.chrome();
    expect(near(c.border!, union([r1, l1]))).toBe(true);
    expect(near(c.border!, union([{ ...r0, x: r0.x + d.x, y: r0.y + d.y }, { ...l0, x: l0.x + d.x, y: l0.y + d.y }]))).toBe(false);
    expect(Object.keys(c.locks)).toContain(ID.lockedEllipse);
    await shot(ed, 'mixed-locked-drag');
    await page.mouse.up();
    await ed.waitForPuts(1);
    await ed.expectNoPutsFor(2500);
    const s = ed.mock.puts[0]!.doc!.pages[0]!.elements;
    const rect = s.find((e) => e.id === ID.rect) as any;
    const locked = s.find((e) => e.id === ID.lockedEllipse) as any;
    expect(rect.x).not.toBe(20);
    expect([locked.x, locked.y]).toEqual([80, 120]);
    expect(near((await ed.chrome()).border!, union([(await ed.live(ID.rect)).rect, (await ed.live(ID.lockedEllipse)).rect]))).toBe(true);
    expectFenced(ed);
  });

  test('padlocks keep a constant on-screen size and inset across real zooms (in and out)', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    const sample = async () => {
      const lock = (await ed.chrome()).locks[ID.lockedEllipse]!;
      const node = (await ed.live(ID.lockedEllipse)).rect;
      return { w: lock.width, h: lock.height, abs: lock.absScale, dx: lock.x - node.x, dy: lock.y - node.y, scale: (await ed.stage()).view.scale, listening: lock.listening };
    };
    const s0 = await sample();
    const n = await ed.live(ID.lockedEllipse);
    const at = { x: (await ed.stage()).left + n.rect.x, y: (await ed.stage()).top + n.rect.y };
    await ed.zoom(at, 10);
    const s1 = await sample();
    await shot(ed, 'padlock-zoomed-in');
    await ed.zoom(at, -16);
    const s2 = await sample();
    expect(s1.scale).toBeGreaterThan(s0.scale * 2);
    expect(s2.scale).toBeLessThan(s0.scale);
    for (const s of [s0, s1, s2]) {
      expect(Math.abs(s.w - s0.w)).toBeLessThan(0.01);
      expect(Math.abs(s.h - s0.h)).toBeLessThan(0.01);
      expect(Math.abs(s.abs - 1)).toBeLessThan(1e-6);
      expect(Math.abs(s.dx - s0.dx)).toBeLessThan(0.01);
      expect(Math.abs(s.dy - s0.dy)).toBeLessThan(0.01);
      expect(s.listening).toBe(false);
    }
    test.info().annotations.push({ type: 'padlock', description: JSON.stringify({ s0, s1, s2 }) });
    expectFenced(ed);
  });

  test('pass-through (a rect locked by a real click): the hit at the padlock is the rect; the cursor there = elsewhere on it; a real click there selects it; under Hand a press there pans', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    await page.locator('[data-testid="lock-toggle"]').click();
    await ed.waitForPuts(1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    const lock = (await ed.chrome()).locks[ID.rect]!;
    const st = await ed.stage();
    const p = { x: Math.round(st.left + lock.x + lock.width / 2), y: Math.round(st.top + lock.y + lock.height / 2) };
    const hit = await page.evaluate(({ x, y }) => (window as any).Konva.stages[0].getIntersection({ x, y })?.id(), { x: p.x - st.left, y: p.y - st.top });
    expect(hit).toBe(ID.rect);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(60);
    const overLock = (await ed.stage()).cursor;
    const node = (await ed.live(ID.rect)).rect;
    await page.mouse.move(Math.round(st.left + node.x + node.width / 2), Math.round(st.top + node.y + node.height / 2));
    await page.waitForTimeout(60);
    expect((await ed.stage()).cursor).toBe(overLock);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(60);
    expect((await ed.stage()).selected).toEqual([ID.rect]);
    const c = await ed.chrome();
    expect([c.outlines, c.handles, c.border]).toEqual([1, 0, null]);
    await shot(ed, 'locked-single');
    await page.keyboard.press('h');
    const v0 = (await ed.stage()).view;
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 35, p.y + 15, { steps: 4 });
    await page.mouse.up();
    const v1 = (await ed.stage()).view;
    expect([Math.round(v1.x - v0.x), Math.round(v1.y - v0.y)]).toEqual([35, 15]);
    await ed.expectNoPutsFor(2500);
    expect(ed.mock.puts).toHaveLength(1);
    expectFenced(ed);
  });

  test('spread: a selection across the gutter has one border = the rendered union; the recto padlock sits at its node (lock by a real click)', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'spread');
    await ed.goToUnit(1);
    expect((await ed.stage()).offsets).toEqual([0, 148]);
    await ed.click(ID.recto);
    await page.locator('[data-testid="lock-toggle"]').click();
    await ed.waitForPuts(1);
    expect((ed.mock.element(ID.recto) as any).locked).toBe(true);
    await ed.click(ID.verso);
    await ed.click(ID.recto, true);
    const c = await ed.chrome();
    const rv = (await ed.live(ID.verso)).rect;
    const rr = (await ed.live(ID.recto)).rect;
    expect(near(c.border!, union([rv, rr]))).toBe(true);
    expect(c.handles).toBe(0);
    const lock = c.locks[ID.recto]!;
    expect(lock.x - rr.x).toBeGreaterThan(0);
    expect(lock.x - rr.x).toBeLessThan(4);
    expect(lock.y - rr.y).toBeGreaterThan(0);
    expect(lock.y - rr.y).toBeLessThan(4);
    await shot(ed, 'spread-multi');
    expectFenced(ed);
  });

  test('visibility: R hides the border (selection kept, padlock shown); H and V show it', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    await ed.click(ID.lockedEllipse, true);
    expect((await ed.chrome()).border).not.toBeNull();
    await page.keyboard.press('r');
    await page.waitForTimeout(60);
    let c = await ed.chrome();
    expect(c.border).toBeNull();
    expect(Object.keys(c.locks)).toContain(ID.lockedEllipse);
    expect((await ed.stage()).selected).toHaveLength(2);
    await page.keyboard.press('h');
    await page.waitForTimeout(60);
    expect((await ed.chrome()).border).not.toBeNull();
    await page.keyboard.press('v');
    await page.waitForTimeout(60);
    c = await ed.chrome();
    expect(c.border).not.toBeNull();
    expect(ed.mock.puts).toHaveLength(0);
    expectFenced(ed);
  });
});
