/**
 * Slice D — the cursor chain extended with `resizing` (plan §4.7, §7
 * `slice-d-cursor.test.ts`). One resolver, one writer (the outer wrapper);
 * the existing Slice C rows are unchanged (`slice-c-cursor.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { anchorCursor, RESIZE_ANCHORS } from '@baxter/domain';
import { resolveCursor, type CursorInputs } from '@/components/editor/cursor';

const idle: CursorInputs = {
  dragging: false,
  panning: false,
  handAvailable: false,
  creationTool: false,
  gestureActive: false,
  hoveredLocked: undefined,
};

describe('Slice D — resizing tops the chain and holds', () => {
  it.each(['nwse-resize', 'nesw-resize', 'ns-resize', 'ew-resize'] as const)('%s outranks pan, hand, creation, gesture and hover', (c) => {
    expect(resolveCursor({ ...idle, resizing: c, panning: true, handAvailable: true, creationTool: true, gestureActive: true, hoveredLocked: false })).toBe(c);
    expect(resolveCursor({ ...idle, resizing: c, hoveredLocked: true })).toBe(c); // held over a locked object
  });

  it('each anchor names its own directional cursor (the session\'s held cursor comes from the press anchor)', () => {
    expect(Object.fromEntries(RESIZE_ANCHORS.map((a) => [a, anchorCursor(a)]))).toEqual({
      'top-left': 'nwse-resize',
      'top-center': 'ns-resize',
      'top-right': 'nesw-resize',
      'middle-left': 'ew-resize',
      'middle-right': 'ew-resize',
      'bottom-left': 'nesw-resize',
      'bottom-center': 'ns-resize',
      'bottom-right': 'nwse-resize',
    });
  });

  it('no resize (null or absent): Hand/Space → grab; after a cancel or blur nothing stale remains', () => {
    expect(resolveCursor({ ...idle, resizing: null, handAvailable: true })).toBe('grab');
    expect(resolveCursor({ ...idle, handAvailable: true })).toBe('grab');
    expect(resolveCursor({ ...idle, resizing: null })).toBe('default');
  });
});
