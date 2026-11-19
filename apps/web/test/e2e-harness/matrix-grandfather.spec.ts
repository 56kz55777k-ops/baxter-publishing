/**
 * Stage 8A matrix — grandfathering (AC-21), the minimum, zero-H, S2-1 and rounding, in the real
 * styled editor (plan §8.2). Real mouse/keyboard for every behaviour under test; selection by real
 * clicks or a real marquee; the Keep proportions toggle by a real click.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page-script globals (Konva's untyped stage, test counters) and loosely typed document elements */
import { test, expect } from '@playwright/test';
import { openEditor, expectFenced, ID, H, type Editor } from './spec-kit';

const canonical = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;

async function liveMm(ed: Editor, id: string) {
  const l = await ed.live(id);
  return l.kind === 'Rect'
    ? { width: l.geom.width!, height: l.geom.height! }
    : { width: 2 * l.geom.radiusX!, height: 2 * l.geom.radiusY! };
}

test.describe('grandfathered shapes (AC-21)', () => {
  test('3.2 mm square: crossing the threshold and coming back moves nothing; no jump at the crossing; 0 saves', async ({ page, context }) => {
    // (The 2.5 mm rect is unsuitable here: its fixture snap target sits 0.7 mm from its right edge, so a
    // return to the press point legitimately snaps to 3.2 — seen while writing this case.)
    const ed = await openEditor(page, context, 'grandfathered');
    await ed.click(ID.gfRectSq);
    const a = await ed.anchorPoint(ID.gfRectSq, 'middle-right');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x - 6, a.y, { steps: 3 }); // past 3 px, shrinking direction
    expect(await liveMm(ed, ID.gfRectSq)).toEqual({ width: 3.2, height: 3.2 }); // no initial jump
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.up();
    await ed.expectNoPutsFor();
    expectFenced(ed);
  });

  test('2.5 mm-wide rect: shrinking the undersized axis is refused (stays 2.5, 0 saves); enlarging snaps to exactly 3.2', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'grandfathered');
    await ed.click(ID.gfRectW);
    const a = await ed.anchorPoint(ID.gfRectW, 'middle-right');
    await ed.drag(a, [{ x: 31, y: 40 }], { mm: true });
    expect(await liveMm(ed, ID.gfRectW)).toEqual({ width: 2.5, height: 20 });
    await ed.expectNoPutsFor();
    const { pill } = await ed.drag(await ed.anchorPoint(ID.gfRectW, 'middle-right'), [{ x: 33.5, y: 40 }], { mm: true });
    await ed.waitForPuts(1);
    expect(ed.lastPut(ID.gfRectW)).toEqual({ x: 30, y: 30, width: 3.2, height: 20 }); // snapped to the target's left edge, 33.2
    expect(pill).toBe('3.2 × 20 mm');
    expectFenced(ed);
  });

  test('2.5 mm ellipse: shrink refused; enlarge snaps to exactly 3.2', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'grandfathered');
    await ed.click(ID.gfEllipse);
    await ed.drag(await ed.anchorPoint(ID.gfEllipse, 'middle-right'), [{ x: 91, y: 40 }], { mm: true });
    expect(await liveMm(ed, ID.gfEllipse)).toEqual({ width: 2.5, height: 20 });
    await ed.expectNoPutsFor();
    await ed.drag(await ed.anchorPoint(ID.gfEllipse, 'middle-right'), [{ x: 93.5, y: 40 }], { mm: true });
    await ed.waitForPuts(1);
    expect(ed.lastPut(ID.gfEllipse)).toEqual({ x: 90, y: 30, width: 3.2, height: 20 });
    expectFenced(ed);
  });

  test('3.2 × 3.2 rect (both axes undersized): a free corner shrink is refused; no jump at the press', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'grandfathered');
    await ed.click(ID.gfRectSq);
    const a = await ed.anchorPoint(ID.gfRectSq, 'bottom-right');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x - 4, a.y - 4, { steps: 2 });
    expect(await liveMm(ed, ID.gfRectSq)).toEqual({ width: 3.2, height: 3.2 });
    await page.mouse.move(a.x - 8, a.y - 8, { steps: 4 }); // still inside the box: a shrink, not a drag-through
    expect(await liveMm(ed, ID.gfRectSq)).toEqual({ width: 3.2, height: 3.2 });
    await page.mouse.up();
    await ed.expectNoPutsFor();
    expectFenced(ed);
  });

  for (const via of ['toggle', 'Shift'] as const) {
    test(`ratio corner on the 2.5 × 20 rect via ${via}: down (shrink) → unchanged, 0 saves; up (enlarge) → both axes ≥ start`, async ({ page, context }) => {
      const ed = await openEditor(page, context, 'grandfathered');
      await ed.click(ID.gfRectW);
      if (via === 'toggle') await page.locator('[data-testid="keep-proportions"]').click();
      const key = via === 'Shift' ? 'Shift' : undefined;
      await ed.drag(await ed.anchorPoint(ID.gfRectW, 'bottom-right'), [{ x: 31.5, y: 45 }], { mm: true, key });
      expect(await liveMm(ed, ID.gfRectW)).toEqual({ width: 2.5, height: 20 });
      await ed.expectNoPutsFor();
      await ed.drag(await ed.anchorPoint(ID.gfRectW, 'bottom-right'), [{ x: 34, y: 62 }], { mm: true, key });
      await ed.waitForPuts(1);
      const g = ed.lastPut(ID.gfRectW)!;
      expect(g.width).toBeGreaterThanOrEqual(2.5);
      expect(g.height).toBeGreaterThan(20);
      expect({ x: g.x, y: g.y }).toEqual({ x: 30, y: 30 });
      expect(canonical(g.width) && canonical(g.height)).toBe(true);
      expectFenced(ed);
    });
  }

  test('inspector on the 2.5 mm width: type 2 → no-op; type 3 → 3; ↑ → 4; ↓ at the 4 mm floor → no-op', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'grandfathered');
    await ed.click(ID.gfRectW);
    const w = ed.field('w');
    await w.fill('2');
    await w.press('Enter');
    await ed.expectNoPutsFor();
    await w.fill('3');
    await w.press('Enter');
    await ed.waitForPuts(1);
    expect(ed.lastPut(ID.gfRectW)).toEqual({ x: 30, y: 30, width: 3, height: 20 });
    await w.press('ArrowUp');
    await ed.waitForPuts(2);
    expect(ed.lastPut(ID.gfRectW)!.width).toBe(4);
    await w.press('ArrowDown');
    await ed.expectNoPutsFor();
    expect(ed.saved(ID.gfRectW)!.width).toBe(4);
    expectFenced(ed);
  });
});

test.describe('minimum, zero-H, S2-1, rounding', () => {
  test('minimum: a free side drag to 1 mm from the opposite edge stops at 4 mm, pinned to the fixed edge; release saves 4 exactly', async ({ page, context }) => {
    // (Dragging THROUGH the opposite edge is the drag-through rule — freeze one move, then Konva renames the
    // anchor and the box resumes on the other side, AC-6 / #11 — not the minimum; checked in the anchors spec.)
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    await ed.drag(await ed.anchorPoint(ID.rect, 'middle-right'), [{ x: 21, y: 35 }], { mm: true });
    await ed.waitForPuts(1);
    expect(ed.lastPut(ID.rect)).toEqual({ x: 20, y: 20, width: 4, height: 30 });
    expectFenced(ed);
  });

  test('zero-H (x 0, width 0.004 mm): a ratio corner move holds (0 saves); a vertical-only free move is skipped by Konva (F1: extent under 1 px, 0 saves); a move that gives it width writes a canonical width, never 0', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'grandfathered');
    await ed.marquee({ x: -6, y: 115 }, { x: 4, y: 145 }); // real marquee: the only way to grab a 0.01 px-wide shape
    expect((await ed.stage()).selected).toEqual([ID.zeroH]);
    const corner = await ed.anchorPoint(ID.zeroH, 'bottom-right');
    await ed.drag(corner, [{ x: 8, y: 150 }], { mm: true, key: 'Shift' });
    await ed.expectNoPutsFor();
    // All eight anchors sit on the same 0.01 px column; Konva hands the press to the topmost (a corner).
    await ed.drag(corner, [{ x: 0, y: 150 }], { mm: true });
    await ed.expectNoPutsFor(); // F1: every move's proposed width is under 1 px, so Konva skips it
    await ed.drag(corner, [{ x: 8, y: 150 }], { mm: true });
    await ed.waitForPuts(1);
    const g = ed.lastPut(ID.zeroH)!;
    expect(g.x).toBe(0);
    expect(g.width).toBeGreaterThan(0);
    expect(g.height).toBeGreaterThan(20);
    expect(canonical(g.width) && canonical(g.height)).toBe(true);
    expectFenced(ed);
  });

  test('S2-1 (plan §8.2, pinned in slice-d-resize-math): 3.00 × 3.04 at (50, 40), Shift; inside → 3 × 3.04; out → snaps 4.06 × 4.11; back inside → stays 4.06 × 4.11; saved 4.06 × 4.11', async ({ page, context }) => {
    const ed = await openEditor(page, context, 's21');
    await ed.goToUnit(1);
    // Zoom in about the rect so one screen pixel is a few hundredths of a millimetre.
    await ed.zoom(await ed.at({ x: 52, y: 42 }), 12);
    expect((await ed.stage()).view.scale).toBeGreaterThan(15);
    await ed.click(ID.s21);
    const a = await ed.anchorPoint(ID.s21, 'bottom-right');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    const go = async (mm: { x: number; y: number }) => {
      const p = await ed.at(mm);
      await page.mouse.move(Math.round(p.x), Math.round(p.y), { steps: 6 });
      await page.waitForTimeout(40);
      return ed.settledPill();
    };
    const guide = () =>
      page.evaluate(() => (window as any).Konva.stages[0].find('Line').filter((l: any) => l.stroke() === '#8a2820' && l.visible()).length);
    const p1 = await go({ x: 51.5, y: 41.5 });
    const g1 = await guide();
    const p2 = await go({ x: 53.3, y: 43.34 });
    const g2 = await guide();
    const p3 = await go({ x: 51.5, y: 41.5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await ed.waitForPuts(1);
    expect([null, '3 × 3.04 mm']).toContain(p1); // held at the start box (S2-1 step 1) …
    expect(g1).toBe(0); // … with no guide
    expect([p2, g2]).toEqual(['4.06 × 4.11 mm', 1]);
    expect(p3).toBe('4.06 × 4.11 mm');
    expect(ed.lastPut(ID.s21)).toEqual({ x: 50, y: 40, width: 4.06, height: 4.11 });
    expectFenced(ed);
  });

  test('rounding: every value a resize writes is on the 0.01 grid and equals the pill at release (G3)', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const { pill } = await ed.drag(await ed.anchorPoint(ID.rect, 'bottom-right'), [{ x: 71.237, y: 61.071 }], { mm: true });
    await ed.waitForPuts(1);
    const g = ed.lastPut(ID.rect)!;
    expect(pill).toBe(`${g.width} × ${g.height} mm`);
    expect([g.x, g.y]).toEqual([20, 20]);
    expect(canonical(g.width) && canonical(g.height)).toBe(true);
    expect(H(g.width) / 100).toBe(g.width);
    expectFenced(ed);
  });
});
