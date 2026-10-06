/**
 * Contract #21 — the cursor resolver's priority table through Slice C.
 * Every row is one rule of the chain; the "outranks" rows pin the order.
 */
import { describe, expect, it } from 'vitest';
import { resolveCursor, type CursorInputs } from '@/components/editor/cursor';

const idle: CursorInputs = {
  dragging: false,
  panning: false,
  handAvailable: false,
  creationTool: false,
  gestureActive: false,
  hoveredLocked: undefined,
};

describe('#21 cursor table', () => {
  it.each<[string, Partial<CursorInputs>, string]>([
    ['nothing', {}, 'default'],
    ['hover unlocked', { hoveredLocked: false }, 'move'],
    ['hover locked — neutral, never not-allowed', { hoveredLocked: true }, 'default'],
    ['marquee stays default while crossing objects', { gestureActive: true, hoveredLocked: false }, 'default'],
    ['creation tool', { creationTool: true, hoveredLocked: false }, 'crosshair'],
    ['hand outranks hover', { handAvailable: true, hoveredLocked: false }, 'grab'],
    ['active pan', { panning: true, handAvailable: true }, 'grabbing'],
    ['drag: move', { dragging: true, gestureActive: true }, 'move'],
    ['drag holds move while crossing a locked object', { dragging: true, gestureActive: true, hoveredLocked: true }, 'move'],
    ['drag outranks everything below it', { dragging: true, handAvailable: true, creationTool: true }, 'move'],
  ])('%s', (_name, over, expected) => {
    expect(resolveCursor({ ...idle, ...over })).toBe(expected);
  });

  it('lock toggles change the hover cursor with no pointer movement (lock is read live)', () => {
    expect(resolveCursor({ ...idle, hoveredLocked: false })).toBe('move');
    expect(resolveCursor({ ...idle, hoveredLocked: true })).toBe('default');
  });
});
