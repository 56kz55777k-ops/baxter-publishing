// @vitest-environment jsdom
/**
 * Slice C (approved C-9) — Shift-marquee ADDS; Shift-click TOGGLES.
 *
 * Defect found while planning Slice C: an additive marquee was routed to the
 * toggle action, so a Shift-marquee over a mix of selected and unselected
 * objects deselected the ones already selected. Contract #6: "Shift-marquee
 * adds to the existing set". Contract #5: "Shift-click toggles membership".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { editorUiReducer, type EditorUiState } from '@/components/editor/state/editor-ui';
import { useStageGestures, type ElementBox } from '@/components/editor/use-stage-gestures';
import type { UnitGeometry } from '@/components/editor/geometry';

const geom: UnitGeometry = {
  widthMm: 296,
  heightMm: 210,
  pageOffsetsMm: [0, 148],
  bleedMm: 3,
  marginMm: 12,
  safeMm: 5,
};
const boxes: ElementBox[] = [
  { id: 'a', locked: false, box: { x: 10, y: 10, width: 20, height: 20 } },
  { id: 'b', locked: false, box: { x: 50, y: 10, width: 20, height: 20 } },
];

const base: EditorUiState = { unitIndex: 0, view: { x: 0, y: 0, scale: 1 }, tool: 'select', selection: ['a'] };

describe('selection reducer', () => {
  it('ADD_TO_SELECTION unions in order and never removes an already-selected id', () => {
    const next = editorUiReducer(base, { type: 'ADD_TO_SELECTION', ids: ['a', 'b'] });
    expect(next.selection).toEqual(['a', 'b']);
  });

  it('ADD_TO_SELECTION of ids already selected is a no-op (same state)', () => {
    const s = { ...base, selection: ['a', 'b'] };
    expect(editorUiReducer(s, { type: 'ADD_TO_SELECTION', ids: ['b', 'a'] })).toBe(s);
  });

  it('TOGGLE_SELECTION (Shift-click) still toggles membership', () => {
    const off = editorUiReducer(base, { type: 'TOGGLE_SELECTION', ids: ['a'] });
    expect(off.selection).toEqual([]);
    const on = editorUiReducer(off, { type: 'TOGGLE_SELECTION', ids: ['a'] });
    expect(on.selection).toEqual(['a']);
  });
});

/* -------------------------------------------------------------------------- */

let container: HTMLDivElement;
let root: Root;
let calls: { kind: string; ids: readonly string[] }[] = [];
let api: ReturnType<typeof useStageGestures> | null = null;

function Harness() {
  const host = React.useRef<HTMLDivElement | null>(document.createElement('div'));
  api = useStageGestures({
    geom,
    view: { x: 0, y: 0, scale: 1 },
    tool: 'select',
    boxes,
    selection: [],
    hostRef: host,
    enabled: true,
    onCreate: () => {},
    onMove: () => {},
    onSelect: (ids) => void calls.push({ kind: 'select', ids }),
    onToggleSelect: (ids) => void calls.push({ kind: 'toggle', ids }),
    onAddSelect: (ids) => void calls.push({ kind: 'add', ids }),
    onClearSelection: () => void calls.push({ kind: 'clear', ids: [] }),
  });
  return null;
}

function mouse(type: string, x: number, y: number) {
  act(() => void window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })));
}

beforeEach(() => {
  calls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(React.createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the gesture routes each Shift gesture to the right action', () => {
  it('Shift-marquee over a selected and an unselected object ADDS both', () => {
    act(() => api!.onStagePointerDown({ x: 5, y: 5 }, true, null));
    mouse('mousemove', 80, 40);
    mouse('mouseup', 80, 40);
    expect(calls).toEqual([{ kind: 'add', ids: ['a', 'b'] }]);
  });

  it('a plain marquee replaces the selection', () => {
    act(() => api!.onStagePointerDown({ x: 5, y: 5 }, false, null));
    mouse('mousemove', 80, 40);
    mouse('mouseup', 80, 40);
    expect(calls).toEqual([{ kind: 'select', ids: ['a', 'b'] }]);
  });

  it('Shift-click on an object toggles it', () => {
    act(() => api!.onStagePointerDown({ x: 15, y: 15 }, true, 'a'));
    mouse('mouseup', 15, 15);
    expect(calls[0]).toEqual({ kind: 'toggle', ids: ['a'] });
  });
});
