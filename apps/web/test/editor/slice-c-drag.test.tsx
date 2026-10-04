// @vitest-environment jsdom
/**
 * Slice C — the object-drag gesture (contracts #7, #8, #20, #21, #24 and the
 * approved decisions C-1 and C-5 / decision 2).
 *
 * The hook is driven with real window mouse events. The view is 1 px/mm with
 * the unit at the origin, so screen px and unit mm coincide.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStageGestures, DRAG_THRESHOLD_PX, type ElementBox } from '@/components/editor/use-stage-gestures';
import type { UnitGeometry } from '@/components/editor/geometry';

const geom: UnitGeometry = { widthMm: 296, heightMm: 210, pageOffsetsMm: [0, 148], bleedMm: 3, marginMm: 12, safeMm: 5 };

let boxes: ElementBox[] = [];
let selection: string[] = [];
let calls: { kind: string; ids?: readonly string[]; dx?: number; dy?: number }[] = [];
let api: ReturnType<typeof useStageGestures> | null = null;
let container: HTMLDivElement;
let root: Root;

function Harness() {
  const host = React.useRef<HTMLDivElement | null>(document.createElement('div'));
  api = useStageGestures({
    geom,
    view: { x: 0, y: 0, scale: 1 },
    tool: 'select',
    boxes,
    selection,
    hostRef: host,
    enabled: true,
    onCreate: () => {},
    onMove: (ids, dx, dy) => void calls.push({ kind: 'move', ids, dx, dy }),
    onSelect: (ids) => void calls.push({ kind: 'select', ids }),
    onToggleSelect: (ids) => void calls.push({ kind: 'toggle', ids }),
    onAddSelect: (ids) => void calls.push({ kind: 'add', ids }),
    onClearSelection: () => void calls.push({ kind: 'clear' }),
  });
  return null;
}

function render() {
  act(() => root.render(React.createElement(Harness)));
}
function mouse(type: string, x: number, y: number) {
  act(() => void window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })));
}
function press(x: number, y: number, id: string | null, shift = false) {
  act(() => api!.onStagePointerDown({ x, y }, shift, id));
}

beforeEach(() => {
  calls = [];
  selection = [];
  boxes = [
    { id: 'a', locked: false, box: { x: 40, y: 40, width: 20, height: 10 } },
    { id: 'b', locked: false, box: { x: 70, y: 40, width: 20, height: 10 } },
    { id: 'L', locked: true, box: { x: 40, y: 100, width: 20, height: 10 } },
  ];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  render();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('#7 · object drag', () => {
  it('pressing an unselected object selects it and drags it alone — one move call at release', () => {
    press(45, 45, 'a');
    expect(calls).toEqual([{ kind: 'select', ids: ['a'] }]);
    mouse('mousemove', 40, 50);
    // free (no target within 1.6 mm): the raw delta rounds to the 0.1 grid
    mouse('mousemove', 45 - 15.26, 45 + 23.04);
    expect(api!.dragging).toBe(true);
    mouse('mouseup', 45 - 15.26, 45 + 23.04);
    expect(calls.slice(1)).toEqual([{ kind: 'move', ids: ['a'], dx: -15.3, dy: 23 }]);
    expect(api!.dragging).toBe(false);
  });

  it('pressing a selected member drags the whole set by one shared delta', () => {
    selection = ['a', 'b'];
    render();
    press(45, 45, 'a');
    mouse('mousemove', 60, 75);
    mouse('mouseup', 60, 75);
    expect(calls).toEqual([{ kind: 'move', ids: ['a', 'b'], dx: 15, dy: 30 }]);
  });

  it('locked members of the set do not move; the rest do (#20)', () => {
    selection = ['a', 'L'];
    render();
    press(45, 45, 'a');
    mouse('mousemove', 55, 45);
    mouse('mouseup', 55, 45);
    expect(calls).toEqual([{ kind: 'move', ids: ['a'], dx: 10, dy: 0 }]);
  });

  it('pressing a locked object never drags anything (#20)', () => {
    selection = ['a', 'L'];
    render();
    press(45, 105, 'L');
    mouse('mousemove', 80, 140);
    mouse('mouseup', 80, 140);
    expect(calls.filter((c) => c.kind === 'move')).toEqual([]);
    expect(api!.dragging).toBe(false);
  });

  it(`movement under ${DRAG_THRESHOLD_PX} px is a click — nothing moves or snaps`, () => {
    press(45, 45, 'a');
    mouse('mousemove', 46.5, 46.5);
    mouse('mouseup', 46.5, 46.5);
    expect(calls).toEqual([{ kind: 'select', ids: ['a'] }]);
  });

  it('a click (no drag) on a member of a multi-selection narrows to it', () => {
    selection = ['a', 'b'];
    render();
    press(75, 45, 'b');
    mouse('mouseup', 75, 45);
    expect(calls).toEqual([{ kind: 'select', ids: ['b'] }]);
  });

  it('Shift-click toggles and never starts a drag', () => {
    press(45, 45, 'a', true);
    mouse('mousemove', 70, 70);
    mouse('mouseup', 70, 70);
    expect(calls).toEqual([{ kind: 'toggle', ids: ['a'] }]);
  });

  it('a drag that returns to its start commits nothing (zero delta → no history)', () => {
    press(45, 45, 'a');
    mouse('mousemove', 60, 45);
    mouse('mousemove', 45.02, 45.01);
    mouse('mouseup', 45.02, 45.01);
    expect(calls.filter((c) => c.kind === 'move')).toEqual([]);
  });
});

describe('#8 + C-1 · union snapping, preview == commit', () => {
  it('the union snaps to the margin and the committed delta is exactly the previewed one', () => {
    // a's left edge 40 → target margin 12 needs dx −28; drop at raw −27.3
    press(45, 45, 'a');
    mouse('mousemove', 45 - 27.3, 45);
    const preview = api!.dragPreview!;
    expect(preview.dx).toBe(-28);
    expect(api!.guideX).toBe(12);
    mouse('mouseup', 45 - 27.3, 45);
    expect(calls.at(-1)).toEqual({ kind: 'move', ids: ['a'], dx: preview.dx, dy: preview.dy });
  });

  it('locked objects are targets: a union edge snaps to a locked object’s edge', () => {
    // a moves down so its left edge (40) aligns with L's left (40) — x is
    // already aligned; drag so the bottom edge (50) approaches L's top (100)
    press(45, 45, 'a');
    mouse('mousemove', 45.4, 94.2); // bottom 99.2 → snaps to 100
    expect(api!.guideY).toBe(100);
    expect(api!.dragPreview!.dy).toBe(50);
    mouse('mouseup', 45.4, 94.2);
  });

  it('guides vanish at release', () => {
    press(45, 45, 'a');
    mouse('mousemove', 45 - 27.3, 45);
    mouse('mouseup', 45 - 27.3, 45);
    expect(api!.guideX).toBeNull();
    expect(api!.dragPreview).toBeNull();
  });
});

describe('C-5 / decision 2 · cancel', () => {
  it('Escape during a drag cancels only the drag — nothing moves, the selection is kept', () => {
    selection = ['a'];
    render();
    let shellSawEscape = 0;
    const shell = (e: KeyboardEvent) => {
      if (e.key === 'Escape') shellSawEscape++;
    };
    window.addEventListener('keydown', shell); // the shell's resting-state handler
    press(45, 45, 'a');
    mouse('mousemove', 70, 70);
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    mouse('mouseup', 70, 70);
    expect(calls).toEqual([]); // no move, no clear
    expect(shellSawEscape).toBe(0); // one meaning per press
    expect(api!.dragging).toBe(false);
    // the NEXT Escape, with no drag, reaches the shell (deselect + Select)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(shellSawEscape).toBe(1);
    window.removeEventListener('keydown', shell);
  });

  it('window blur during a drag cancels it with zero trace', () => {
    press(45, 45, 'a');
    mouse('mousemove', 70, 70);
    act(() => void window.dispatchEvent(new Event('blur')));
    mouse('mouseup', 70, 70);
    expect(calls.filter((c) => c.kind === 'move')).toEqual([]);
  });
});
