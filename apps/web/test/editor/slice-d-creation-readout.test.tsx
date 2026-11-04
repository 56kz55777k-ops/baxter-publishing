// @vitest-environment jsdom
/**
 * Slice D stage 3 — the creation-pill correction (plan §4.9, §7
 * `slice-d-creation-readout.test.tsx`; AC-16).
 *
 * Before: the creation preview and its `W × H mm` pill showed the raw,
 * unquantized drag box, while release committed `quantizeCreate` values — and
 * under the 3 mm click threshold they showed a 4 mm box although release
 * creates the default-size element. Now one function (`creationGeometry`)
 * feeds release, preview and pill:
 *
 * - past the threshold, the preview box (converted to unit space) and the pill
 *   are exactly the committed element's geometry;
 * - under it, only the anchor dot shows — no box, no pill (plan choice #12;
 *   Ben, 2026-11-04) — and release creates the default-size element.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { formatNum, newEllipseElement, newRectElement, quantizeCreate, type EditorElement } from '@baxter/domain';
import {
  CREATE_CLICK_THRESHOLD_MM,
  creationGeometry,
  useStageGestures,
  type ElementBox,
} from '@/components/editor/use-stage-gestures';
import { pageBoxToUnit, type UnitGeometry } from '@/components/editor/geometry';

const geom: UnitGeometry = { widthMm: 296, heightMm: 210, pageOffsetsMm: [0, 148], bleedMm: 3, marginMm: 12, safeMm: 5 };
let tool: 'rect' | 'ellipse' = 'rect';
let view = { x: 0, y: 0, scale: 1 };
let boxes: ElementBox[] = [];
let created: { pageIndex: number; el: EditorElement }[] = [];
let api: ReturnType<typeof useStageGestures> | null = null;
let container: HTMLDivElement;
let root: Root;

function Harness() {
  const host = React.useRef<HTMLDivElement | null>(document.createElement('div'));
  api = useStageGestures({
    geom,
    view,
    tool,
    boxes,
    selection: [],
    hostRef: host,
    enabled: true,
    onCreate: (pageIndex, el) => void created.push({ pageIndex, el }),
    onMove: () => {},
    onSelect: () => {},
    onToggleSelect: () => {},
    onAddSelect: () => {},
    onClearSelection: () => {},
  });
  return null;
}

const ev = (type: string, x: number, y: number) => new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
const sized = (el: EditorElement) => el as EditorElement & { width: number; height: number };

beforeEach(() => {
  created = [];
  tool = 'rect';
  view = { x: 0, y: 0, scale: 1 };
  boxes = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(React.createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Screen px for a unit-space mm point under the current view. */
const px = (mm: { x: number; y: number }) => ({ x: mm.x * view.scale + view.x, y: mm.y * view.scale + view.y });

function press(mm: { x: number; y: number }) {
  act(() => {
    root.render(React.createElement(Harness)); // pick up tool/view/boxes changes
  });
  act(() => api!.onStagePointerDown(px(mm), false, null));
}
function move(mm: { x: number; y: number }) {
  const p = px(mm);
  act(() => void window.dispatchEvent(ev('mousemove', p.x, p.y)));
}
function release(mm: { x: number; y: number }) {
  const p = px(mm);
  act(() => void window.dispatchEvent(ev('mouseup', p.x, p.y)));
}

describe('past the click threshold: the preview box and the pill are the committed element', () => {
  it('a drag of 30.33 × 20.27 mm from (80.34, 120.46): preview and pill show 30.3 × 20.3 at (80.3, 120.5), which is what commits', () => {
    press({ x: 80.34, y: 120.46 });
    move({ x: 110.67, y: 140.73 });
    expect(api!.previewBox).toEqual({ x: 80.3, y: 120.5, width: 30.3, height: 20.3 });
    expect(api!.readout).toEqual({ widthMm: 30.3, heightMm: 20.3 });
    release({ x: 110.67, y: 140.73 });
    const el = sized(created[0]!.el);
    expect([el.x, el.y, el.width, el.height]).toEqual([80.3, 120.5, 30.3, 20.3]);
  });

  it('dragged up-left by less than 4 mm on one axis: the 4 mm floor extends from the box origin in preview and commit alike', () => {
    press({ x: 50, y: 50 });
    move({ x: 40.02, y: 47.5 }); // 9.98 × 2.5 up-left
    expect(api!.previewBox).toEqual({ x: 40, y: 47.5, width: 10, height: 4 });
    expect(api!.readout).toEqual({ widthMm: 10, heightMm: 4 });
    release({ x: 40.02, y: 47.5 });
    const el = sized(created[0]!.el);
    expect([el.x, el.y, el.width, el.height]).toEqual([40, 47.5, 10, 4]);
  });

  it('on the right-hand page the preview is the committed page-relative box plus the page offset', () => {
    tool = 'ellipse';
    press({ x: 160.04, y: 30.01 });
    move({ x: 191.38, y: 52.31 });
    const committedPreview = api!.previewBox;
    release({ x: 191.38, y: 52.31 });
    const c = created[0]!;
    const el = sized(c.el);
    expect(c.pageIndex).toBe(1);
    expect([el.type, el.x, el.y, el.width, el.height]).toEqual(['ellipse', 12, 30, 31.3, 22.3]);
    expect(committedPreview).toEqual(pageBoxToUnit(geom, 1, { x: 12, y: 30, width: 31.3, height: 22.3 }));
  });

  it('random paths at several zooms, with snap targets: the last preview and pill equal the commit, and their text matches formatNum of the stored numbers', () => {
    let s = 12345;
    const R = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    boxes = [
      { id: 't1', locked: false, box: { x: 60, y: 60, width: 20.05, height: 15 } },
      { id: 't2', locked: true, box: { x: 200, y: 100, width: 10, height: 33.3 } },
    ];
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      tool = i % 2 ? 'rect' : 'ellipse';
      view = { x: R() * 200 - 100, y: R() * 100 - 50, scale: [0.51, 1, 3.4, 13.6, 27.2][i % 5]! };
      created = [];
      const a = { x: 5 + R() * 280, y: 5 + R() * 200 };
      press(a);
      let p = a;
      for (let k = 0; k < 6; k++) {
        p = { x: p.x + (R() * 2 - 1) * 12, y: p.y + (R() * 2 - 1) * 12 };
        move(p);
      }
      const shown = { box: api!.previewBox, readout: api!.readout };
      release(p);
      const c = created[0]!;
      const el = sized(c.el);
      if (shown.box === null) {
        // under the click threshold at release: the default-size element, and nothing was drawn but the dot
        expect(shown.readout).toBeNull();
        const def = (tool === 'rect' ? newRectElement : newEllipseElement)({ x: 0, y: 0 });
        expect([el.width, el.height]).toEqual([def.width, def.height]);
        continue;
      }
      expect(shown.box).toEqual(pageBoxToUnit(geom, c.pageIndex, { x: el.x, y: el.y, width: el.width, height: el.height }));
      expect(shown.readout).toEqual({ widthMm: el.width, heightMm: el.height });
      expect([formatNum(shown.readout!.widthMm), formatNum(shown.readout!.heightMm)]).toEqual([formatNum(el.width), formatNum(el.height)]);
      expect([el.x, el.y, el.width, el.height].every((v) => quantizeCreate(v) === v)).toBe(true);
      expect(el.width >= 4 && el.height >= 4).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe('under the click threshold: anchor dot only, and release creates the default-size element', () => {
  it('a 2.9 mm wiggle shows the anchor dot, no box and no pill; release creates the default 50 × 36 rect at the quantized press point', () => {
    press({ x: 40.34, y: 40.66 }); // away from every snap target
    for (const d of [0.5, 1.7, 2.9, 2.1]) {
      move({ x: 40.34 + d, y: 40.66 - d / 2 });
      expect(api!.previewAnchor).toEqual({ x: 40.34, y: 40.66 });
      expect(api!.previewBox).toBeNull();
      expect(api!.readout).toBeNull();
    }
    release({ x: 42.44, y: 39.61 });
    const el = sized(created[0]!.el);
    expect([el.type, el.x, el.y, el.width, el.height]).toEqual(['rect', 40.3, 40.7, 50, 36]);
  });

  it('creation snaps the pointer: a 2.9 mm move that snaps to the page centre line (74) is past the threshold, and the preview says so', () => {
    press({ x: 70.34, y: 40.66 });
    move({ x: 73.24, y: 40.66 }); // raw 2.9 mm, snapped to 74 → 3.66 mm
    expect(api!.guideX).toBe(74);
    expect(api!.previewBox).toEqual({ x: 70.3, y: 40.7, width: 4, height: 4 });
    release({ x: 73.24, y: 40.66 });
    const el = sized(created[0]!.el);
    expect([el.x, el.y, el.width, el.height]).toEqual([70.3, 40.7, 4, 4]);
  });

  it('the threshold boundary: 2.99 mm is a click (no preview); 3 mm shows the committed box', () => {
    press({ x: 20, y: 20 });
    move({ x: 22.99, y: 20 });
    expect(api!.previewBox).toBeNull();
    move({ x: 20 + CREATE_CLICK_THRESHOLD_MM, y: 20 });
    expect(api!.previewBox).toEqual({ x: 20, y: 20, width: 4, height: 4 });
    expect(api!.readout).toEqual({ widthMm: 4, heightMm: 4 });
    release({ x: 23, y: 20 });
    const el = sized(created[0]!.el);
    expect([el.x, el.y, el.width, el.height]).toEqual([20, 20, 4, 4]);
  });

  it('crossing back under the threshold hides the box again: what release would do is a click', () => {
    tool = 'ellipse';
    press({ x: 100, y: 100 });
    move({ x: 110, y: 108 });
    expect(api!.previewBox).not.toBeNull();
    move({ x: 101, y: 101 });
    expect([api!.previewBox, api!.readout]).toEqual([null, null]);
    release({ x: 101, y: 101 });
    const el = sized(created[0]!.el);
    expect([el.width, el.height]).toEqual([50, 50]);
  });

  it('creationGeometry is the single source: tiny below 3 mm, else quantized page-relative geometry', () => {
    expect(creationGeometry(geom, 0, { x: 10.04, y: 10.06 }, { x: 12.9, y: 10 })).toEqual({ tiny: true, at: { x: 10, y: 10.1 } });
    expect(creationGeometry(geom, 1, { x: 160, y: 10 }, { x: 170.06, y: 12 })).toEqual({ tiny: false, x: 12, y: 10, width: 10.1, height: 4 });
  });
});
