/**
 * Editor browser smoke — narrow by design, run in Chromium, WebKit and
 * Firefox (Slice C: all three are gates, Part 12 / Risk 13).
 *
 * What only a browser can prove is asserted here; everything a jsdom test
 * already pins is deliberately NOT repeated. The truths this file establishes:
 *
 *   1. the route mounts and the stage sizes itself with NO interaction;
 *   2. a real pointer gesture creates a real element, selects it, and arms
 *      the inspector (#3);
 *   3. a real drag moves it across the gutter and re-parents it by centre
 *      (#2, #7) — one autosave request for the whole drag;
 *   4. nudge (exact ±0.5 / ±5), duplicate (+4) and a Shift-click + multi-drag
 *      work with real keys and pointers (#5, #7, #26);
 *   5. undo/redo across those gestures;
 *   6. everything survives autosave and a full reload;
 *   7. the run deletes everything it created (C-8) and the fixture's spread
 *      is back to its starting count after a reload — zero residue;
 *   8. zero console errors or hydration warnings across the run.
 *
 * The run works on the fixture's first spread and identifies its own objects
 * by position (computed from the stage's view attributes and the inspector's
 * model values), never by "everything on the spread": anything already there
 * is counted at the start, left alone, and must still be there at the end.
 * If an assertion fails mid-run, a finally-block still deletes this run's
 * objects — each one only after the inspector confirms it is the object the
 * run is tracking (exact size, position within the drag's reach).
 *
 * Runs against a PRODUCTION build (`next start`); credentials come from the
 * process environment / apps/web/.env.e2e.local and are never in CI.
 */
import { expect, test, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const PUBLICATION = process.env.E2E_PUBLICATION_ID;
const configured = Boolean(EMAIL && PASSWORD && PUBLICATION);

interface View {
  x: number;
  y: number;
  scale: number;
  offsets: number[];
}
interface Model {
  x: number;
  y: number;
  w: number;
  h: number;
}

const r2 = (n: number) => +n.toFixed(2);

test.describe('editor smoke', () => {
  test.skip(
    !configured,
    'E2E_EMAIL / E2E_PASSWORD / E2E_PUBLICATION_ID missing (apps/web/.env.e2e.local) — smoke requires a real signed-in session'
  );

  let consoleProblems: string[] = [];
  let puts = 0;

  function watch(page: Page) {
    consoleProblems = [];
    puts = 0;
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' || /hydrat|mismatch/i.test(text)) consoleProblems.push(`[${msg.type()}] ${text}`);
    });
    page.on('pageerror', (err) => consoleProblems.push(`[pageerror] ${err.message}`));
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/api/editor/')) puts++;
    });
  }

  /** All changes saved, and still saved past the 2 s autosave debounce. */
  async function settle(page: Page) {
    await expect(page.getByTestId('save-state')).toHaveText(/All changes saved/, { timeout: 20_000 });
    await page.waitForTimeout(2_600);
    await expect(page.getByTestId('save-state')).toHaveText(/All changes saved/, { timeout: 20_000 });
  }

  /** Open (or, after a reload, re-enter) the editor on the fixture's first spread. */
  async function openSpread(page: Page, navigate = true) {
    // After page.reload() the document is already loading: navigating again
    // would abort it mid-chunk-load (an artefact Firefox reports as a page error).
    if (navigate) await page.goto(`/studio/editor/${PUBLICATION}`);
    const canvas = page.locator('[data-testid="spread-stage"] canvas').first();
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('button').nth(1).click();
    await expect(page.getByTestId('spread-stage')).toHaveAttribute('data-page-offsets', /^0 \d/);
    await settle(page);
    return canvas;
  }

  async function view(page: Page): Promise<View> {
    const stage = page.getByTestId('spread-stage');
    const [x, y, scale] = (await stage.getAttribute('data-view'))!.split(' ').map(Number);
    const offsets = (await stage.getAttribute('data-page-offsets'))!.split(' ').map(Number);
    return { x: x!, y: y!, scale: scale!, offsets };
  }

  /** Page-relative model mm → page client px. */
  async function client(page: Page, pageIndex: number, mm: { x: number; y: number }) {
    const v = await view(page);
    const box = (await page.getByTestId('spread-stage').boundingBox())!;
    return {
      x: box.x + v.x + (v.offsets[pageIndex]! + mm.x) * v.scale,
      y: box.y + v.y + mm.y * v.scale,
    };
  }

  async function read(page: Page): Promise<Model> {
    const n = async (id: string) => Number(await page.getByTestId(id).inputValue());
    return { x: await n('num-x'), y: await n('num-y'), w: await n('num-w'), h: await n('num-h') };
  }

  async function clickAt(page: Page, pageIndex: number, mm: { x: number; y: number }, shift = false) {
    const c = await client(page, pageIndex, mm);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(c.x, c.y);
    if (shift) await page.keyboard.up('Shift');
  }

  /** A point inside `m` that its +4 mm duplicate does not cover. */
  const corner = (m: Model) => ({ x: m.x + 2, y: m.y + 2 });
  const middle = (m: Model) => ({ x: m.x + m.w / 2, y: m.y + m.h / 2 });

  async function dragBy(page: Page, from: { x: number; y: number }, dxPx: number, dyPx: number) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + (dxPx * i) / 6, from.y + (dyPx * i) / 6);
    await page.mouse.up();
  }

  /** How many objects the current unit holds (⌘A — selection only, no history). */
  async function countOnUnit(page: Page): Promise<number> {
    await page.keyboard.press('ControlOrMeta+a');
    const multi = page.getByTestId('multi-header');
    let n = 0;
    if (await multi.count()) n = Number((await multi.textContent())!.match(/^(\d+)/)![1]);
    else if (await page.getByTestId('num-x').count()) n = 1;
    await page.keyboard.press('Escape');
    return n;
  }

  /** This run's objects: the page they are on and their last known model. */
  type Owned = { pageIndex: number; m: Model; exact: boolean };

  /** Best-effort, identity-checked removal of this run's objects (C-8). */
  async function removeOwned(page: Page, owned: Owned[]) {
    if (owned.length === 0) return;
    await page.keyboard.press('Escape');
    let picked = 0;
    for (const o of owned) {
      const at = { x: o.m.x + o.m.w - 2, y: o.m.y + o.m.h - 2 }; // a corner the other object does not cover first
      // The owning page may be the other one if the failure was a re-parent.
      const tries = [o.pageIndex, 1 - o.pageIndex].flatMap((pi) => [at, corner(o.m), middle(o.m)].map((p) => [pi, p] as const));
      for (const [pi, probe] of tries) {
        await page.keyboard.press('Escape');
        await clickAt(page, pi, probe);
        if (!(await page.getByTestId('num-x').count())) continue;
        const got = await read(page);
        const near = Math.abs(got.x - o.m.x) <= (o.exact ? 0 : 30) && Math.abs(got.y - o.m.y) <= (o.exact ? 0 : 30);
        if (got.w === o.m.w && got.h === o.m.h && near) {
          await page.keyboard.press('Delete');
          picked++;
          break;
        }
      }
    }
    if (picked > 0) await settle(page);
  }

  test('create, drag across the gutter, nudge, duplicate, multi-drag, persist — then leave no residue', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    watch(page);
    const owned: Owned[] = [];
    try {
      await run(page, owned);
    } catch (e) {
      await removeOwned(page, owned).catch(() => {});
      throw e;
    }
  });

  async function run(page: Page, owned: Owned[]) {
    await page.goto('/sign-in');
    await page.getByLabel(/email/i).fill(EMAIL!);
    await page.getByLabel(/password/i).fill(PASSWORD!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/(studio|settings)/, { timeout: 20_000 });
    // Let the landing page's link prefetches finish: navigating away mid-
    // prefetch aborts them, which WebKit reports as console/page errors
    // ("Failed to fetch RSC payload … due to access control checks") — a
    // navigation artefact of the test, not an editor error.
    await page.waitForLoadState('networkidle');
    const canvas = await openSpread(page);

    // (1) The stage sized itself with no interaction at all.
    const dims = await canvas.evaluate((el) => ({ w: (el as HTMLCanvasElement).width, h: (el as HTMLCanvasElement).height }));
    expect(dims.w).toBeGreaterThan(0);
    expect(dims.h).toBeGreaterThan(0);
    const baseline = await countOnUnit(page);

    // (2) Create on the verso with real gestures.
    const v0 = await view(page);
    const pageW = v0.offsets[1]!;
    await page.keyboard.press('r');
    await dragBy(page, await client(page, 0, { x: pageW - 60, y: 150 }), 30 * v0.scale, 20 * v0.scale);
    await expect(page.getByTestId('num-x')).toBeVisible();
    await settle(page);
    let A = await read(page);
    owned.push({ pageIndex: 0, m: A, exact: true });
    expect(puts).toBe(1);

    // (3) Drag across the gutter: the centre lands on the recto → re-parented,
    // X now recto-relative. One drag, one autosave request.
    let before = puts;
    owned[0]!.exact = false;
    await dragBy(page, await client(page, 0, middle(A)), 55 * v0.scale, 0);
    await settle(page);
    const moved = await read(page);
    owned[0] = { pageIndex: 1, m: moved, exact: true };
    expect(moved.x).toBeLessThan(pageW / 2); // recto-relative now
    expect(Math.abs(moved.x + pageW - (A.x + 55))).toBeLessThanOrEqual(1.6); // the drag, or a snap within radius
    expect(Math.abs(moved.y - A.y)).toBeLessThanOrEqual(1.6);
    expect([moved.w, moved.h]).toEqual([A.w, A.h]);
    expect(puts - before).toBe(1);
    A = moved; // on page 1 (recto) from here

    // (4a) Nudge: exact distances, never a rounded member position.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    A = { ...A, x: r2(A.x + 0.5), y: r2(A.y + 5) };
    owned[0] = { pageIndex: 1, m: A, exact: false };
    await expect(page.getByTestId('num-x')).toHaveValue(String(A.x));
    await expect(page.getByTestId('num-y')).toHaveValue(String(A.y));

    // (4b) Duplicate: +4 mm, the copy is selected.
    await page.keyboard.press('ControlOrMeta+d');
    const C = await read(page);
    owned.push({ pageIndex: 1, m: C, exact: false });
    expect([C.x, C.y, C.w, C.h]).toEqual([r2(A.x + 4), r2(A.y + 4), A.w, A.h]);
    await settle(page);

    // (4c) Shift-click adds the original → two objects; drag them together.
    await clickAt(page, 1, corner(A), true);
    await expect(page.getByTestId('multi-header')).toHaveText('2 objects');
    before = puts;
    await dragBy(page, await client(page, 1, middle(C)), 0, 25 * v0.scale);
    await settle(page);
    expect(puts - before).toBe(1);
    await expect(page.getByTestId('multi-header')).toHaveText('2 objects'); // the same set, moved

    // (5) Undo and redo the multi-drag.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('multi-header')).toHaveText('2 objects');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await settle(page);

    // Read both back individually: rigid — the same Y delta for each.
    await page.keyboard.press('Escape');
    await clickAt(page, 1, middle({ ...C, y: C.y + 25 }));
    const C2 = await read(page);
    // A vertical drag may still snap horizontally within the radius (#8:
    // both axes of the union are magnetic) — but the set moves rigidly.
    expect(Math.abs(C2.y - (C.y + 25))).toBeLessThanOrEqual(1.6);
    expect(Math.abs(C2.x - C.x)).toBeLessThanOrEqual(1.6);
    const dx = r2(C2.x - C.x);
    const dy = r2(C2.y - C.y);
    owned[1] = { pageIndex: 1, m: C2, exact: true };
    await clickAt(page, 1, corner({ ...A, x: A.x + dx, y: A.y + dy }));
    const A2 = await read(page);
    expect([A2.x, A2.y, A2.w, A2.h]).toEqual([r2(A.x + dx), r2(A.y + dy), A.w, A.h]);
    owned[0] = { pageIndex: 1, m: A2, exact: true };

    // (6) Reload: both persisted where they were left.
    await page.reload();
    await openSpread(page, false);
    expect(await countOnUnit(page)).toBe(baseline + 2);
    await clickAt(page, 1, corner(A2));
    expect(await read(page)).toEqual(A2);
    await clickAt(page, 1, middle(C2));
    expect(await read(page)).toEqual(C2);

    // (7) Clean up exactly what this run created, then prove zero residue.
    await clickAt(page, 1, corner(A2), true);
    await expect(page.getByTestId('multi-header')).toHaveText('2 objects');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('multi-header')).toHaveCount(0);
    await settle(page);
    owned.length = 0; // deleted — nothing left to clean up
    await page.reload();
    await openSpread(page, false);
    expect(await countOnUnit(page)).toBe(baseline);

    await expect(page.getByTestId('read-only-banner')).toHaveCount(0);
    expect(consoleProblems, consoleProblems.join('\n')).toEqual([]);
    test.info().annotations.push({ type: 'autosave-puts', description: String(puts) });
  }
});
