/**
 * Slice D stage 8A — shared helpers for the harness specs.
 *
 * Everything is read from the real application in the browser:
 * - geometry aim: the stage's approved `data-view` / `data-page-offsets`;
 * - live Konva state: `window.Konva` (Konva registers its own global; the app
 *   adds nothing for this);
 * - selection and the unit's ids: `data-selected-ids` / `data-unit-element-ids`,
 *   which exist only in a harness build (stage 8A seam; not Q6);
 * - saves: the Node-side mock.
 * Input is Playwright's real mouse and keyboard unless a step says otherwise.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page-script globals (Konva's untyped stage, test counters) and loosely typed document elements */
import { expect, type Page, type BrowserContext } from '@playwright/test';
import type { EditorDoc } from '@baxter/domain';
import { EditorMock, fence, type Fence } from './mock';
import { fixtureDoc, type HarnessFixtureName } from './fixtures';

export type Anchor = 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
export const ANCHORS: Anchor[] = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
export interface Box { x: number; y: number; width: number; height: number }

export const H = (mm: number) => Math.round(mm * 100);

export class Editor {
  constructor(readonly page: Page, readonly mock: EditorMock, readonly net: Fence, readonly fixture: HarnessFixtureName) {}

  /** Wait for the island, the canvas and a stable view (the stage fits after its first measure). */
  async ready() {
    await this.page.waitForSelector('[data-testid="spread-stage"] canvas', { timeout: 30_000 });
    let last = '';
    let since = Date.now();
    for (;;) {
      const v = await this.page.evaluate(() => {
        const w = document.querySelector('[data-testid="spread-stage"]') as HTMLElement;
        return w.dataset.view + '|' + JSON.stringify(w.getBoundingClientRect());
      });
      if (v !== last) {
        last = v;
        since = Date.now();
      } else if (Date.now() - since > 300) return;
      await this.page.waitForTimeout(50);
    }
  }

  async stage() {
    return this.page.evaluate(() => {
      const w = document.querySelector('[data-testid="spread-stage"]') as HTMLElement;
      const r = w.getBoundingClientRect();
      const [x, y, scale] = w.dataset.view!.split(' ').map(Number) as [number, number, number];
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        view: { x, y, scale },
        dataView: w.dataset.view!,
        offsets: w.dataset.pageOffsets!.split(' ').map(Number),
        cursor: w.style.cursor,
        selected: (w.dataset.selectedIds ?? '').split(' ').filter(Boolean),
        unitIds: (w.dataset.unitElementIds ?? '').split(' ').filter(Boolean),
        pill: document.querySelector('[data-testid="size-readout"]')?.textContent ?? null,
      };
    });
  }

  /** Page coordinates of a unit-space mm point. */
  async at(mm: { x: number; y: number }) {
    const s = await this.stage();
    return { x: s.left + s.view.x + mm.x * s.view.scale, y: s.top + s.view.y + mm.y * s.view.scale };
  }

  /** Unit-space box of an element in the mock's stored document (page offset added). */
  async unitBoxOf(id: string, doc: EditorDoc = this.mock.doc!): Promise<Box> {
    const s = await this.stage();
    const units = unitPagesOf(doc);
    for (const pages of units) {
      const k = pages.findIndex((p) => p.elements.some((e) => e.id === id));
      if (k >= 0) {
        const e = pages[k]!.elements.find((x) => x.id === id) as unknown as Box;
        return { x: (s.offsets[k] ?? 0) + e.x, y: e.y, width: e.width, height: e.height };
      }
    }
    throw new Error(`element ${id} not found`);
  }

  async anchorPoint(id: string, anchor: Anchor, doc?: EditorDoc) {
    const b = await this.unitBoxOf(id, doc);
    const fx = anchor.includes('left') ? b.x : anchor.includes('right') ? b.x + b.width : b.x + b.width / 2;
    const fy = anchor.startsWith('top') ? b.y : anchor.startsWith('bottom') ? b.y + b.height : b.y + b.height / 2;
    const p = await this.at({ x: fx, y: fy });
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  /** A real click inside the element's rendered node (Konva client rect), optionally with Shift. */
  async click(id: string, shift = false) {
    const p = await this.page.evaluate((id) => {
      const st = (window as any).Konva.stages[0];
      const r = st.findOne('#' + id).getClientRect({ skipStroke: true });
      const c = st.container().getBoundingClientRect();
      return { x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2 };
    }, id);
    if (shift) await this.page.keyboard.down('Shift');
    await this.page.mouse.click(p.x, p.y);
    if (shift) await this.page.keyboard.up('Shift');
    await this.page.waitForTimeout(60);
  }

  /** Live Konva state of an element node and the Transformer, in stage px. */
  async live(id: string) {
    return this.page.evaluate((id) => {
      const st = (window as any).Konva.stages[0];
      const n = st.findOne('#' + id);
      const tr = st.findOne('Transformer');
      const nb = n.getClientRect({ skipStroke: true });
      const isRect = n.getClassName() === 'Rect';
      const geom = isRect
        ? { x: n.x(), y: n.y(), width: n.width(), height: n.height(), scaleX: n.scaleX(), scaleY: n.scaleY() }
        : { x: n.x(), y: n.y(), radiusX: n.radiusX(), radiusY: n.radiusY(), scaleX: n.scaleX(), scaleY: n.scaleY() };
      const attached = tr ? tr.nodes().length : 0;
      const handles = attached ? { x: tr.x(), y: tr.y(), width: tr.width(), height: tr.height() } : null;
      const fits = !handles || (Math.abs(handles.x - nb.x) < 0.5 && Math.abs(handles.y - nb.y) < 0.5 && Math.abs(handles.width - nb.width) < 0.5 && Math.abs(handles.height - nb.height) < 0.5);
      return { kind: n.getClassName() as string, geom, attached, fits, rect: { x: nb.x, y: nb.y, width: nb.width, height: nb.height } };
    }, id);
  }

  /** Rendered selection/lock chrome, through Konva. */
  async chrome() {
    return this.page.evaluate(() => {
      const st = (window as any).Konva.stages[0];
      const rect = (n: any) => { const r = n.getClientRect({ skipStroke: true }); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const border = st.findOne('.multi-selection-border');
      const tr = st.findOne('Transformer');
      return {
        border: border ? { ...rect(border), dash: border.dash(), listening: border.listening(), layerListening: border.getLayer().listening() } : null,
        outlines: st.find('.selection-outline').length,
        handles: tr ? tr.nodes().length : 0,
        locks: Object.fromEntries(st.find('.lock-indicator').map((g: any) => [g.id().replace(/^lock-/, ''), { ...rect(g), absScale: g.getAbsoluteScale().x, listening: g.listening(), layerListening: g.getLayer().listening() }])),
      };
    });
  }

  /** Wait until the mock has received `n` PUTs (autosave debounce is 2 s). */
  async waitForPuts(n: number, timeout = 10_000) {
    await expect.poll(() => this.mock.puts.length, { timeout }).toBeGreaterThanOrEqual(n);
  }

  /** Assert no PUT arrives within `ms` (longer than the 2 s debounce). */
  async expectNoPutsFor(ms = 3_000) {
    const before = this.mock.puts.length;
    await this.page.waitForTimeout(ms);
    expect(this.mock.puts.length - before).toBe(0);
  }

  /** The stored element's geometry after the last save. */
  saved(id: string) {
    const e = this.mock.element(id) as unknown as Box | undefined;
    return e && { x: e.x, y: e.y, width: e.width, height: e.height };
  }

  /** The element as carried by the last PUT body. */
  lastPut(id: string) {
    const w = this.mock.puts.at(-1);
    for (const p of w?.doc?.pages ?? []) for (const e of p.elements) if (e.id === id) return { x: (e as any).x, y: (e as any).y, width: (e as any).width, height: (e as any).height };
    return undefined;
  }

  /**
   * A real resize drag: press at `from` (page px), move to each `to` in turn (page px or unit mm via `mm`),
   * optional modifier held from the press, read the pill before releasing, then release (unless `release: false`).
   */
  async drag(
    from: { x: number; y: number },
    path: { x: number; y: number }[],
    opts: { mm?: boolean; key?: 'Shift' | 'Alt'; steps?: number; release?: boolean } = {}
  ) {
    const pts = [];
    for (const p of path) pts.push(opts.mm ? await this.at(p) : p);
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    if (opts.key) await this.page.keyboard.down(opts.key);
    for (const p of pts) await this.page.mouse.move(Math.round(p.x), Math.round(p.y), { steps: opts.steps ?? 8 });
    await this.page.waitForTimeout(40);
    const pill = (await this.stage()).pill;
    if (opts.release !== false) {
      await this.page.mouse.up();
      if (opts.key) await this.page.keyboard.up(opts.key);
      await this.page.waitForTimeout(40);
    }
    return { pill };
  }

  /** Marquee-select by a real drag on empty canvas between two unit-mm points. */
  async marquee(a: { x: number; y: number }, b: { x: number; y: number }) {
    const p = await this.at(a);
    const q = await this.at(b);
    await this.page.mouse.move(p.x, p.y);
    await this.page.mouse.down();
    await this.page.mouse.move(q.x, q.y, { steps: 6 });
    await this.page.mouse.up();
    await this.page.waitForTimeout(60);
  }

  /** The inspector's numeric field ('w' | 'h' | 'x' | 'y'). */
  field(name: 'w' | 'h' | 'x' | 'y') {
    return this.page.locator(`[data-testid="num-${name}"]`);
  }

  /** Real Ctrl+wheel zoom about a page point. */
  async zoom(at: { x: number; y: number }, notches: number) {
    await this.page.mouse.move(at.x, at.y);
    await this.page.keyboard.down('Control');
    for (let i = 0; i < Math.abs(notches); i++) await this.page.mouse.wheel(0, notches > 0 ? -250 : 250);
    await this.page.keyboard.up('Control');
    await this.page.waitForTimeout(120);
  }

  /** The current unit by its unit-list button (real click). */
  async goToUnit(index: number) {
    await this.page.locator('ul li button').nth(index).click();
    await this.ready();
  }
}

/** Pages grouped by unit, as `computeUnits` groups them (cover | spreads | back). */
export function unitPagesOf(doc: EditorDoc) {
  const cover = doc.pages.filter((p) => p.kind === 'cover');
  const back = doc.pages.filter((p) => p.kind === 'back');
  const interior = doc.pages.filter((p) => p.kind !== 'cover' && p.kind !== 'back');
  const out = [cover];
  for (let i = 0; i < interior.length; i += 2) out.push(interior.slice(i, i + 2));
  out.push(back);
  return out.filter((u) => u.length);
}

/**
 * Open the harness on a fixture: a fresh mock seeded from the same fixture, the network fence
 * installed BEFORE navigation, then the page loaded and the editor ready.
 */
export async function openEditor(page: Page, context: BrowserContext, fixture: HarnessFixtureName, opts: { seed?: EditorDoc | null } = {}) {
  const seed = opts.seed !== undefined ? opts.seed : fixtureDoc(fixture);
  const mock = new EditorMock(seed ?? fixtureDoc('basic'), 1);
  const net = await fence(context, mock);
  await page.goto(`/e2e-harness/${fixture}`);
  const ed = new Editor(page, mock, net, fixture);
  await ed.ready();
  return ed;
}

/** Every test ends here: no request left the allowlist. */
export function expectFenced(ed: Editor) {
  expect(ed.net.unexpected, `unexpected requests: ${ed.net.unexpected.join(', ')}`).toEqual([]);
}
