/**
 * Stage 8A matrix — anchors, page offsets, margins, the gutter, ratio, Q7 and Alt in the real styled
 * editor (plan §8.2, R9 T1–T18 subset). Real mouse and keyboard; selection by real clicks; the Keep
 * proportions toggle by a real click. Saved geometry is read from the mock's PUT bodies.
 */
import { test, expect } from '@playwright/test';
import { openEditor, expectFenced, ID, H, ANCHORS, type Anchor, type Editor } from './spec-kit';

const canonical = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;
/** Fixed and moving edges of an anchor. */
const moves = (a: Anchor) => ({
  left: a.includes('left'),
  right: a.includes('right'),
  top: a.startsWith('top'),
  bottom: a.startsWith('bottom'),
});

async function centreH(ed: Editor, id: string) {
  const l = await ed.live(id);
  // Rect node attrs are its box (mm); doubled hundredths of the centre.
  return { cx2: H(2 * l.geom.x! + l.geom.width!), cy2: H(2 * l.geom.y! + l.geom.height!), w: l.geom.width!, h: l.geom.height!, x: l.geom.x!, y: l.geom.y! };
}

test.describe('all eight anchors (cover rect 40 × 30 at (20, 20))', () => {
  for (const a of ANCHORS) {
    test(`${a}: the moving edges follow the pointer; the fixed edges keep their stored numbers; saved = pill`, async ({ page, context }) => {
      const ed = await openEditor(page, context, 'basic');
      await ed.click(ID.rect);
      const m = moves(a);
      const target = { x: m.left ? 14 : m.right ? 66 : 40, y: m.top ? 15 : m.bottom ? 55 : 35 };
      const { pill } = await ed.drag(await ed.anchorPoint(ID.rect, a), [target], { mm: true });
      await ed.waitForPuts(1);
      const g = ed.lastPut(ID.rect)!;
      expect(pill).toBe(`${g.width} × ${g.height} mm`);
      expect([g.x, g.y, g.width, g.height].every(canonical)).toBe(true);
      // Fixed edges: exact in H (AC-2); untouched stored fields keep their numbers (Object.is).
      if (!m.left) expect(g.x).toBe(20);
      if (!m.top) expect(g.y).toBe(20);
      if (m.left) expect(H(g.x) + H(g.width)).toBe(6000);
      if (m.top) expect(H(g.y) + H(g.height)).toBe(5000);
      if (!m.left && !m.right) expect(g.width).toBe(40);
      if (!m.top && !m.bottom) expect(g.height).toBe(30);
      // Moving edges: where the pointer went (within half a screen pixel, no snap target nearby).
      const tol = 0.5;
      if (m.left) expect(Math.abs(g.x - 14)).toBeLessThan(tol);
      if (m.right) expect(Math.abs(g.x + g.width - 66)).toBeLessThan(tol);
      if (m.top) expect(Math.abs(g.y - 15)).toBeLessThan(tol);
      if (m.bottom) expect(Math.abs(g.y + g.height - 55)).toBeLessThan(tol);
      expectFenced(ed);
    });
  }
});

test.describe('spread: page offsets, the recto margin, the gutter', () => {
  test('recto element, bottom-left: saved page-relative (offset 148 removed); its right edge 70 stays exact', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'spread');
    await ed.goToUnit(1);
    expect((await ed.stage()).offsets).toEqual([0, 148]);
    await ed.click(ID.recto);
    await ed.drag(await ed.anchorPoint(ID.recto, 'bottom-left'), [{ x: 148 + 34, y: 96 }], { mm: true });
    await ed.waitForPuts(1);
    const g = ed.lastPut(ID.recto)!;
    expect(Math.abs(g.x - 34)).toBeLessThan(0.5);
    expect(H(g.x) + H(g.width)).toBe(7000);
    expect(g.y).toBe(50);
    expect(ed.mock.puts[0]!.doc!.pages[2]!.elements.some((e) => e.id === ID.recto)).toBe(true); // still the recto's
    expectFenced(ed);
  });

  test('T17 recto margin: the right edge snaps to the margin line at 136 mm (page-relative) — width exactly 36', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'spread');
    await ed.goToUnit(1);
    await ed.click(ID.rectoMargin);
    await ed.drag(await ed.anchorPoint(ID.rectoMargin, 'middle-right'), [{ x: 148 + 136.6, y: 135 }], { mm: true });
    await ed.waitForPuts(1);
    expect(ed.lastPut(ID.rectoMargin)).toEqual({ x: 100, y: 120, width: 36, height: 30 });
    expectFenced(ed);
  });

  test('T18 cross-gutter: a verso element stretched into the recto stays on the verso (no re-parent); it snaps to the recto margin at unit 160 → width exactly 40', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'spread');
    await ed.goToUnit(1);
    await ed.click(ID.gutter);
    await ed.drag(await ed.anchorPoint(ID.gutter, 'middle-right'), [{ x: 160.4, y: 160 }], { mm: true });
    await ed.waitForPuts(1);
    expect(ed.lastPut(ID.gutter)).toEqual({ x: 120, y: 150, width: 40, height: 20 });
    const doc = ed.mock.puts[0]!.doc!;
    expect(doc.pages[1]!.elements.some((e) => e.id === ID.gutter)).toBe(true);
    expect(doc.pages[2]!.elements.some((e) => e.id === ID.gutter)).toBe(false);
    expectFenced(ed);
  });

  test('drag-through (free): the right edge pulled through the left — the box resumes on the other side; saved = pill, ≥ 4 mm, canonical', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const { pill } = await ed.drag(await ed.anchorPoint(ID.rect, 'middle-right'), [{ x: 3, y: 35 }], { mm: true, steps: 14 });
    await ed.waitForPuts(1);
    const g = ed.lastPut(ID.rect)!;
    expect(pill).toBe(`${g.width} × ${g.height} mm`);
    expect(g.width).toBeGreaterThanOrEqual(4);
    expect(g.height).toBe(30);
    expect([g.x, g.width].every(canonical)).toBe(true);
    expectFenced(ed);
  });
});

test.describe('ratio: Keep proportions and Shift', () => {
  const proportional = (g: { width: number; height: number }, w0: number, h0: number) =>
    Math.abs(H(g.height) - (H(g.width) * h0) / w0) <= 0.5 || Math.abs(H(g.width) - (H(g.height) * w0) / h0) <= 0.5;

  for (const via of ['toggle', 'Shift', 'toggle+Shift'] as const) {
    for (const which of ['rect', 'ellipse'] as const) {
      test(`${which}, corner, ratio via ${via}: the gesture-start ratio holds; the fixed corner stays`, async ({ page, context }) => {
        const ed = await openEditor(page, context, 'basic');
        const id = which === 'rect' ? ID.rect : ID.ellipse;
        const [w0, h0, x0, y0] = which === 'rect' ? [40, 30, 20, 20] : [24, 18, 30, 60];
        await ed.click(id);
        if (via !== 'Shift') await page.locator('[data-testid="keep-proportions"]').click();
        await ed.drag(await ed.anchorPoint(id, 'bottom-right'), [{ x: x0 + w0 + 25, y: y0 + h0 + 6 }], { mm: true, key: via === 'toggle' ? undefined : 'Shift' });
        await ed.waitForPuts(1);
        const g = ed.lastPut(id)!;
        expect(proportional(g, w0, h0)).toBe(true);
        expect([g.x, g.y]).toEqual([x0, y0]);
        expect(g.width).toBeGreaterThan(w0);
        expectFenced(ed);
      });
    }
  }

  test('side handles stay independent with the toggle ON and Shift held', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    await page.locator('[data-testid="keep-proportions"]').click();
    await ed.drag(await ed.anchorPoint(ID.rect, 'middle-right'), [{ x: 75, y: 30 }], { mm: true, key: 'Shift' });
    await ed.waitForPuts(1);
    const g = ed.lastPut(ID.rect)!;
    expect(g.height).toBe(30);
    expect(g.width).toBeGreaterThan(40);
    await ed.drag(await ed.anchorPoint(ID.rect, 'bottom-center'), [{ x: 50, y: 60 }], { mm: true });
    await ed.waitForPuts(2);
    const g2 = ed.lastPut(ID.rect)!;
    expect(g2.width).toBe(g.width);
    expect(g2.height).toBeGreaterThan(30);
    expectFenced(ed);
  });

  test('gesture-start ratio: after a free resize to 2:1, the toggle keeps 2:1 (not the original 4:3)', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    await ed.drag(await ed.anchorPoint(ID.rect, 'middle-right'), [{ x: 80, y: 35 }], { mm: true }); // 60 × 30
    await ed.waitForPuts(1);
    const g1 = ed.lastPut(ID.rect)!;
    await page.locator('[data-testid="keep-proportions"]').click();
    await ed.drag(await ed.anchorPoint(ID.rect, 'bottom-right'), [{ x: 100, y: 62 }], { mm: true });
    await ed.waitForPuts(2);
    const g = ed.lastPut(ID.rect)!;
    expect(proportional(g, g1.width, g1.height)).toBe(true);
    expect(proportional(g, 40, 30)).toBe(false);
    expectFenced(ed);
  });

  test('Q7 (a): toggle ON, a fast drag far past the fixed corner holds it — the ratio minimum box 5.34 × 4.01 at (20, 20)', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    await page.locator('[data-testid="keep-proportions"]').click();
    // Far past the fixed corner (20, 20), but the release stays inside the browser viewport (y = −12 mm
    // is ~8 px below its top edge at the fitted zoom). Playwright's Firefox delivers no pointerup or
    // mouseup for a release outside the viewport (checked: zero events reach window), so an
    // off-viewport release is not covered in Firefox; Chromium and WebKit deliver it.
    const { pill } = await ed.drag(await ed.anchorPoint(ID.rect, 'bottom-right'), [{ x: -40, y: -12 }], { mm: true, steps: 6 });
    await ed.waitForPuts(1);
    expect(pill).toBe('5.34 × 4.01 mm');
    expect(ed.lastPut(ID.rect)).toEqual({ x: 20, y: 20, width: 5.34, height: 4.01 });
    expectFenced(ed);
  });
});

test.describe('Alt (centred)', () => {
  test('Alt held from the press through ≥ 100 delivered moves: the centre (40, 35) stays within 0.005 mm at every sampled step; saved centred', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const a = await ed.anchorPoint(ID.rect, 'bottom-right');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.keyboard.down('Alt');
    const path = [{ x: 70, y: 60 }, { x: 52, y: 41 }, { x: 75, y: 45 }, { x: 58, y: 62 }, { x: 66, y: 52 }];
    let moves = 0;
    const samples: { cx2: number; cy2: number }[] = [];
    for (const mm of path) {
      const p = await ed.at(mm);
      await page.mouse.move(Math.round(p.x), Math.round(p.y), { steps: 22 });
      moves += 22;
      samples.push(await centreH(ed, ID.rect));
    }
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await ed.waitForPuts(1);
    const g = ed.lastPut(ID.rect)!;
    expect(moves).toBeGreaterThanOrEqual(100);
    for (const s of samples) {
      expect(Math.abs(s.cx2 - 8000)).toBeLessThanOrEqual(1);
      expect(Math.abs(s.cy2 - 7000)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(H(2 * g.x + g.width) - 8000)).toBeLessThanOrEqual(1);
    expect(Math.abs(H(2 * g.y + g.height) - 7000)).toBeLessThanOrEqual(1);
    expectFenced(ed);
  });

  test('Alt pressed mid-gesture captures the centre of the last box; released, the box is free again from the last box; saved = pill', async ({ page, context }) => {
    const ed = await openEditor(page, context, 'basic');
    await ed.click(ID.rect);
    const a = await ed.anchorPoint(ID.rect, 'bottom-right');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    const go = async (mm: { x: number; y: number }) => {
      const p = await ed.at(mm);
      await page.mouse.move(Math.round(p.x), Math.round(p.y), { steps: 8 });
    };
    await go({ x: 70, y: 60 }); // free: top-left fixed at (20, 20)
    const free = await centreH(ed, ID.rect);
    expect([free.x, free.y]).toEqual([20, 20]);
    await page.keyboard.down('Alt');
    await go({ x: 74, y: 64 });
    const c1 = await centreH(ed, ID.rect);
    await go({ x: 66, y: 57 });
    const c2 = await centreH(ed, ID.rect);
    // The centre captured at the Alt press (the free box's centre) is carried while Alt is held.
    expect(Math.abs(c1.cx2 - free.cx2)).toBeLessThanOrEqual(1);
    expect(Math.abs(c2.cx2 - free.cx2)).toBeLessThanOrEqual(1);
    expect(Math.abs(c2.cy2 - free.cy2)).toBeLessThanOrEqual(1);
    await page.keyboard.up('Alt');
    await go({ x: 72, y: 66 });
    const after = await centreH(ed, ID.rect);
    // Free again from the last (centred) box: its top-left is now the fixed corner.
    expect([after.x, after.y]).toEqual([c2.x, c2.y]);
    const pill = (await ed.stage()).pill;
    await page.mouse.up();
    await ed.waitForPuts(1);
    const g = ed.lastPut(ID.rect)!;
    expect(pill).toBe(`${g.width} × ${g.height} mm`);
    expectFenced(ed);
  });
});
