// @vitest-environment jsdom
/**
 * Defect found by the Slice C Firefox gate: the commit used the pointer
 * position from the last RENDERED mousemove. When a browser delivers mouseup
 * before React renders the final mousemove (routine in Firefox), creation and
 * drag committed the second-to-last position — a 30 × 20 mm drag created a
 * 25.2 × 16.5 mm rectangle. The release point is now processed from the
 * mouseup's own coordinates, independent of render timing.
 *
 * Simulated here by dispatching the final mousemove and the mouseup inside a
 * single act(), so React cannot render between them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EditorElement } from '@baxter/domain';
import { useStageGestures, type ElementBox } from '@/components/editor/use-stage-gestures';
import type { UnitGeometry } from '@/components/editor/geometry';

const geom: UnitGeometry = { widthMm: 296, heightMm: 210, pageOffsetsMm: [0, 148], bleedMm: 3, marginMm: 12, safeMm: 5 };
let tool: 'select' | 'rect' = 'select';
let created: EditorElement[] = [];
let moves: { dx: number; dy: number }[] = [];
let api: ReturnType<typeof useStageGestures> | null = null;
let container: HTMLDivElement;
let root: Root;
const boxes: ElementBox[] = [{ id: 'a', locked: false, box: { x: 40, y: 40, width: 20, height: 10 } }];

function Harness() {
  const host = React.useRef<HTMLDivElement | null>(document.createElement('div'));
  api = useStageGestures({
    geom,
    view: { x: 0, y: 0, scale: 1 },
    tool,
    boxes,
    selection: [],
    hostRef: host,
    enabled: true,
    onCreate: (_p, el) => void created.push(el),
    onMove: (_ids, dx, dy) => void moves.push({ dx, dy }),
    onSelect: () => {},
    onToggleSelect: () => {},
    onAddSelect: () => {},
    onClearSelection: () => {},
  });
  return null;
}

const ev = (type: string, x: number, y: number) => new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });

beforeEach(() => {
  created = [];
  moves = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the release point commits, whatever the render timing', () => {
  it('creation: final move + mouseup in one tick → the full drag size', () => {
    tool = 'rect';
    act(() => root.render(React.createElement(Harness)));
    act(() => api!.onStagePointerDown({ x: 80.3, y: 120.4 }, false, null));
    act(() => void window.dispatchEvent(ev('mousemove', 95.3, 130.4)));
    act(() => {
      window.dispatchEvent(ev('mousemove', 110.3, 140.4));
      window.dispatchEvent(ev('mouseup', 110.3, 140.4));
    });
    expect(created).toHaveLength(1);
    expect([created[0]!.x, created[0]!.y, (created[0] as { width: number }).width, (created[0] as { height: number }).height]).toEqual([
      80.3, 120.4, 30, 20,
    ]);
  });

  it('drag: final move + mouseup in one tick → the full delta', () => {
    tool = 'select';
    act(() => root.render(React.createElement(Harness)));
    act(() => api!.onStagePointerDown({ x: 45, y: 45 }, false, 'a'));
    act(() => void window.dispatchEvent(ev('mousemove', 55, 70)));
    act(() => {
      window.dispatchEvent(ev('mousemove', 65, 95.3));
      window.dispatchEvent(ev('mouseup', 65, 95.3));
    });
    expect(moves).toEqual([{ dx: 20, dy: 50.3 }]);
  });

  it('drag: a mouseup with no preceding move at its position still commits the release point', () => {
    tool = 'select';
    act(() => root.render(React.createElement(Harness)));
    act(() => api!.onStagePointerDown({ x: 45, y: 45 }, false, 'a'));
    act(() => void window.dispatchEvent(ev('mousemove', 55, 70)));
    act(() => void window.dispatchEvent(ev('mouseup', 75.4, 95)));
    expect(moves).toEqual([{ dx: 30.4, dy: 50 }]);
  });
});
