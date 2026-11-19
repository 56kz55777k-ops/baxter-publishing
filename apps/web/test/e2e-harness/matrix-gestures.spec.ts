/**
 * Stage 8A matrix — no-op paths, cancel, Space/Hand, cursor ownership, release before paint and the
 * stage 5 cancel restoration, in the real styled editor (plan §8.2).
 *
 * Input labels:
 * - REAL: Playwright mouse/keyboard (trusted input through the browser's input pipeline).
 * - SYNTHETIC SAME-TASK: events built and dispatched from page script inside ONE task, to force an
 *   ordering a human cannot reliably produce (a release or Escape before React paints the preview).
 *   Untrusted events; Konva 10.3 drives the Transformer from window mousemove/mouseup.
 * - DISPATCHED BLUR: `window.dispatchEvent(new Event('blur'))`. It is not real OS focus loss.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page-script globals (Konva's untyped stage, test counters) and loosely typed document elements */
import { test, expect } from '@playwright/test';
import { openEditor, expectFenced, ID, type Editor } from './spec-kit';

const contentCursor = (ed: Editor) =>
  ed.page.evaluate(() => (document.querySelector('[data-testid="spread-stage"] .konvajs-content') as HTMLElement).style.cursor);

/** Undo must find nothing to undo: no PUT follows and the element keeps its geometry. */
async function expectEmptyHistory(ed: Editor, id: string) {
  const before = await ed.live(id);
  await ed.page.keyboard.press('Control+z');
  await ed.expectNoPutsFor(3000);
  expect((await ed.live(id)).geom).toEqual(before.geom);
}

/** Press on an anchor and move by (dx, dy) screen px in one step from the press; the mouse stays down. */
async function pressAndNudge(ed: Editor, id: string, anchor: Parameters<Editor['anchorPoint']>[1], dx: number, dy: number) {
  const a = await ed.anchorPoint(id, anchor);
  const x = Math.round(a.x);
  const y = Math.round(a.y);
  await ed.page.mouse.move(x, y);
  await ed.page.mouse.down();
  await ed.page.mouse.move(x + dx, y + dy);
  await ed.page.waitForTimeout(40);
  return { x, y };
}

test.describe('no-op paths (REAL input): geometry, selection, history and saves unchanged', () => {
  test('a click on an anchor', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const before = await ed.live(ID.rect);
    const a = await ed.anchorPoint(ID.rect, 'bottom-right');
    await page.mouse.click(Math.round(a.x), Math.round(a.y));
    expect((await ed.live(ID.rect)).geom).toEqual(before.geom);
    expect((await ed.stage()).selected).toEqual([ID.rect]);
    await expectEmptyHistory(ed, ID.rect);
    expect(ed.mock.puts).toHaveLength(0);
    expectFenced(ed);
  });

  for (const [label, notches] of [['fitted zoom', 0], ['zoomed in (+8 notches)', 8], ['zoomed out (−3 notches)', -3]] as const) {
    test(`sub-threshold moves (2 px; then 2.8 px diagonal) at the ${label}: no preview, no save`, async ({ page, context }) => {
      const ed = await openEditor(page, context, 'basic');
      await ed.click(ID.rect);
      if (notches) {
        const c = await ed.anchorPoint(ID.rect, 'bottom-right');
        await ed.zoom({ x: c.x - 30, y: c.y - 30 }, notches);
      }
      const scale = (await ed.stage()).view.scale;
      const before = await ed.live(ID.rect);
      const p = await pressAndNudge(ed, ID.rect, 'bottom-right', 2, 0);
      expect((await ed.live(ID.rect)).geom).toEqual(before.geom);
      expect((await ed.stage()).pill).toBeNull();
      await page.mouse.move(p.x + 2, p.y + 2); // hypot 2.83 < 3
      await page.waitForTimeout(40);
      expect((await ed.live(ID.rect)).geom).toEqual(before.geom);
      await page.mouse.up();
      expect((await ed.live(ID.rect)).geom).toEqual(before.geom);
      expect((await ed.stage()).selected).toEqual([ID.rect]);
      await expectEmptyHistory(ed, ID.rect);
      expect(ed.mock.puts).toHaveLength(0);
      test.info().annotations.push({ type: 'scale', description: String(scale) });
      expectFenced(ed);
    });
  }

  test('an unchanged release: past the threshold, out and back to the press point', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const before = await ed.live(ID.rect);
    const p = await pressAndNudge(ed, ID.rect, 'middle-right', 25, 0);
    expect((await ed.live(ID.rect)).geom.width).toBeGreaterThan(before.geom.width!);
    await page.mouse.move(p.x, p.y, { steps: 5 });
    await page.mouse.up();
    expect((await ed.live(ID.rect)).geom).toEqual(before.geom);
    await expectEmptyHistory(ed, ID.rect);
    expect(ed.mock.puts).toHaveLength(0);
    expectFenced(ed);
  });
});

test.describe('cancel (stage 5 restoration): live geometry, scale and handle fit come back exactly; the next resize works', () => {
  for (const which of ['rect', 'ellipse'] as const) {
    const id = which === 'rect' ? ID.rect : ID.ellipse;

    test(`${which}: Escape AFTER a rendered preview (REAL) — restored; held Escape repeats do not deselect; a fresh Escape does`, async ({ page, context }) => {
      const ed = await openEditor(page, context, 'basic');
      await ed.click(id);
      const before = await ed.live(id);
      await pressAndNudge(ed, id, 'bottom-right', 40, 30);
      const mid = await ed.live(id);
      expect(mid.geom).not.toEqual(before.geom);
      expect((await ed.stage()).pill).not.toBeNull();
      await page.keyboard.down('Escape');
      await page.waitForTimeout(40);
      const after = await ed.live(id);
      expect(after.geom).toEqual(before.geom);
      expect(after.rect).toEqual(before.rect);
      expect([after.geom.scaleX, after.geom.scaleY]).toEqual([1, 1]);
      expect(after.fits).toBe(true);
      expect(after.attached).toBe(1);
      expect((await ed.stage()).pill).toBeNull();
      // Keep the button down and move: nothing resumes.
      await page.mouse.move(700, 500, { steps: 4 });
      expect((await ed.live(id)).geom).toEqual(before.geom);
      await page.keyboard.down('Escape'); // auto-repeat (Playwright sends repeat: true for a held key)
      await page.mouse.up();
      await page.keyboard.up('Escape');
      expect((await ed.stage()).selected).toEqual([id]);
      expect(ed.mock.puts).toHaveLength(0);
      await expectEmptyHistory(ed, id);
      // The next resize works from the restored box and saves exactly the pill.
      const { pill } = await ed.drag(await ed.anchorPoint(id, 'bottom-right'), [{ x: 75, y: 70 }], { mm: true });
      await ed.waitForPuts(1);
      const g = ed.lastPut(id)!;
      expect(pill).toBe(`${g.width} × ${g.height} mm`);
      expect([g.x, g.y]).toEqual(which === 'rect' ? [20, 20] : [30, 60]);
      // A fresh Escape press (resting state) deselects.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
      expect((await ed.stage()).selected).toEqual([]);
      expectFenced(ed);
    });

    test(`${which}: Escape BEFORE React paints the preview (SYNTHETIC SAME-TASK move + Escape) — restored`, async ({ page, context }) => {
      const ed = await openEditor(page, context, 'basic');
      await ed.click(id);
      const before = await ed.live(id);
      const p = await pressAndNudge(ed, id, 'bottom-right', 1, 0); // pending (below the threshold)
      const inTask = await page.evaluate(
        ({ x, y, id }) => {
          const st = (window as any).Konva.stages[0];
          window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 1, bubbles: true }));
          const n = st.findOne('#' + id);
          const moved = { x: n.x(), y: n.y(), w: n.width(), h: n.height() };
          // Aimed where a real key event lands (the focused element, else body). Aimed at `window` itself, the
          // shell's bubble listener ran before the session's capture listener (checked in Chromium) — an
          // ordering real keyboard input never produces, since real key events never target window.
          (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          return { moved, restored: { x: n.x(), y: n.y(), w: n.width(), h: n.height() } };
        },
        { x: p.x + 45, y: p.y + 35, id }
      );
      // The synthetic move did reach Konva (the node moved in the same task), then Escape restored it.
      expect(inTask.moved).not.toEqual(inTask.restored);
      await page.evaluate(() => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })));
      await page.waitForTimeout(80);
      const after = await ed.live(id);
      expect(after.geom).toEqual(before.geom);
      expect(after.fits).toBe(true);
      await page.mouse.up();
      expect((await ed.stage()).selected).toEqual([id]);
      expect(ed.mock.puts).toHaveLength(0);
      const { pill } = await ed.drag(await ed.anchorPoint(id, 'middle-right'), [{ x: 80, y: 40 }], { mm: true });
      await ed.waitForPuts(1);
      expect(pill).toBe(`${ed.lastPut(id)!.width} × ${ed.lastPut(id)!.height} mm`);
      expectFenced(ed);
    });

    test(`${which}: DISPATCHED BLUR mid-resize — restored, selection kept, no save; the next resize works`, async ({ page, context }) => {
      const ed = await openEditor(page, context, 'basic');
      await ed.click(id);
      const before = await ed.live(id);
      await pressAndNudge(ed, id, 'top-left', -30, -20);
      expect((await ed.live(id)).geom).not.toEqual(before.geom);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(40);
      const after = await ed.live(id);
      expect(after.geom).toEqual(before.geom);
      expect(after.fits).toBe(true);
      await page.mouse.up();
      expect((await ed.stage()).selected).toEqual([id]);
      expect(ed.mock.puts).toHaveLength(0);
      await ed.drag(await ed.anchorPoint(id, 'bottom-center'), [{ x: 40, y: 90 }], { mm: true });
      await ed.waitForPuts(1);
      expectFenced(ed);
    });
  }
});

test.describe('release before paint (SYNTHETIC SAME-TASK move + mouseup)', () => {
  test('the PUT equals the bounded box Konva held at the release — the last bounded preview, not a stale React one', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const p = await pressAndNudge(ed, ID.rect, 'bottom-right', 30, 20); // a rendered preview exists
    const held = await page.evaluate(
      ({ x, y, id }) => {
        const st = (window as any).Konva.stages[0];
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 1, bubbles: true }));
        const n = st.findOne('#' + id);
        const box = { x: n.x(), y: n.y(), width: n.width(), height: n.height() };
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, button: 0, bubbles: true }));
        return box;
      },
      { x: p.x + 61, y: p.y + 47, id: ID.rect }
    );
    await page.mouse.up(); // the real button; the session has already ended
    await ed.waitForPuts(1);
    const g = ed.lastPut(ID.rect)!;
    expect(g).toEqual(held);
    expect(ed.mock.puts).toHaveLength(1);
    expectFenced(ed);
  });
});

test.describe('Space and Hand (REAL input): handles visible but inactive; pan is a new press', () => {
  test('Space held, press on an anchor: a pan, not a resize — cursor grab → grabbing; no save', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const before = await ed.live(ID.rect);
    const v0 = (await ed.stage()).view;
    await page.keyboard.down(' ');
    await page.waitForTimeout(40);
    expect((await ed.stage()).cursor).toBe('grab');
    expect((await ed.chrome()).handles).toBe(1);
    const a = await ed.anchorPoint(ID.rect, 'bottom-right');
    await page.mouse.move(Math.round(a.x), Math.round(a.y));
    await page.mouse.down();
    await page.mouse.move(Math.round(a.x) + 40, Math.round(a.y) + 25, { steps: 5 });
    await page.waitForTimeout(40);
    expect((await ed.stage()).cursor).toBe('grabbing');
    expect(await contentCursor(ed)).toBe('');
    await page.mouse.up();
    await page.keyboard.up(' ');
    const v1 = (await ed.stage()).view;
    expect([Math.round(v1.x - v0.x), Math.round(v1.y - v0.y)]).toEqual([40, 25]);
    expect((await ed.live(ID.rect)).geom).toEqual(before.geom);
    await ed.expectNoPutsFor(3000);
    expectFenced(ed);
  });

  test('Hand tool (H), press on an anchor: a pan; handles stay visible; no save; V restores resizing', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const before = await ed.live(ID.rect);
    await page.keyboard.press('h');
    await page.waitForTimeout(40);
    expect((await ed.chrome()).handles).toBe(1);
    expect((await ed.stage()).cursor).toBe('grab');
    const v0 = (await ed.stage()).view;
    const a = await ed.anchorPoint(ID.rect, 'middle-right');
    await page.mouse.move(Math.round(a.x), Math.round(a.y));
    await page.mouse.down();
    await page.mouse.move(Math.round(a.x) - 30, Math.round(a.y), { steps: 5 });
    await page.mouse.up();
    expect(Math.round((await ed.stage()).view.x - v0.x)).toBe(-30);
    expect((await ed.live(ID.rect)).geom).toEqual(before.geom);
    await ed.expectNoPutsFor(3000);
    await page.keyboard.press('v');
    await ed.drag(await ed.anchorPoint(ID.rect, 'middle-right'), [{ x: 70, y: 35 }], { mm: true });
    await ed.waitForPuts(1);
    expect(ed.lastPut(ID.rect)!.height).toBe(30);
    expectFenced(ed);
  });

  test('Space pressed MID-resize does not change the session (Q2 (a)); the release commits; then Space shows grab', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const v0 = (await ed.stage()).dataView;
    const p = await pressAndNudge(ed, ID.rect, 'bottom-right', 20, 10);
    await page.keyboard.down(' ');
    await page.mouse.move(p.x + 50, p.y + 30, { steps: 5 });
    await page.waitForTimeout(40);
    expect((await ed.stage()).cursor).toBe('nwse-resize');
    expect((await ed.stage()).dataView).toBe(v0); // no pan
    const pill = await ed.settledPill();
    await page.mouse.up();
    await page.waitForTimeout(40);
    expect((await ed.stage()).cursor).toBe('grab'); // the tracked Space is handed back
    await page.keyboard.up(' ');
    await ed.waitForPuts(1);
    const g = ed.lastPut(ID.rect)!;
    expect(pill).toBe(`${g.width} × ${g.height} mm`);
    expect((await ed.stage()).dataView).toBe(v0);
    expectFenced(ed);
  });
});

test.describe('cursor ownership (REAL input)', () => {
  test('the anchor cursor is held on the outer wrapper across other objects and empty canvas; after release the inner element clears on the first move; hover resumes', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const cursors: string[] = [];
    const p = await pressAndNudge(ed, ID.rect, 'bottom-left', -6, 6);
    cursors.push((await ed.stage()).cursor);
    const over = await ed.at({ x: 42, y: 69 }); // over the ellipse
    await page.mouse.move(Math.round(over.x), Math.round(over.y), { steps: 4 });
    cursors.push((await ed.stage()).cursor);
    const empty = await ed.at({ x: 120, y: 20 }); // empty page
    await page.mouse.move(Math.round(empty.x), Math.round(empty.y), { steps: 4 });
    cursors.push((await ed.stage()).cursor);
    expect(cursors).toEqual(['nesw-resize', 'nesw-resize', 'nesw-resize']);
    await page.mouse.up();
    await page.waitForTimeout(60);
    // OBSERVED (reported to review, not changed in 8A): Konva fires no mouseout while transforming, so after
    // a release away from the anchor its cursor stays on the inner element — and is what the user sees —
    // until the first pointer move, which delivers the anchor's mouseout and clears it. §4.7 describes the
    // clear as happening when the pointer leaves the anchor. Same in Chromium, Firefox and WebKit.
    expect(await contentCursor(ed)).toBe('nesw-resize');
    expect((await ed.stage()).cursor).toBe('default');
    await page.mouse.move(Math.round(empty.x) + 1, Math.round(empty.y));
    await page.waitForTimeout(60);
    expect(await contentCursor(ed)).toBe('');
    expect(await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, { x: Math.round(empty.x) + 1, y: Math.round(empty.y) })).toBe('default');
    const onEllipse = await ed.at({ x: 42, y: 69 });
    await page.mouse.move(Math.round(onEllipse.x), Math.round(onEllipse.y));
    await page.waitForTimeout(60);
    expect((await ed.stage()).cursor).toBe('move');
    const onLocked = await ed.at({ x: 95, y: 130 });
    await page.mouse.move(Math.round(onLocked.x), Math.round(onLocked.y));
    await page.waitForTimeout(60);
    expect((await ed.stage()).cursor).toBe('default');
    void p;
    expectFenced(ed);
  });
});
