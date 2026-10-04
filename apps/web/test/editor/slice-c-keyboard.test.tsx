// @vitest-environment jsdom
/**
 * Contract #26 — the Slice C object map in the one shell keyboard handler,
 * and its isolation: a focused text field keeps Delete, arrows, ⌘A, ⌘C/X/V.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NUDGE_MM, NUDGE_SHIFT_MM, useEditorKeyboard } from '@/components/editor/use-editor-keyboard';

let log: string[] = [];
let container: HTMLDivElement;
let root: Root;

function Harness() {
  useEditorKeyboard(() => {}, {
    onUndo: () => void log.push('undo'),
    onRedo: () => void log.push('redo'),
    onDelete: () => void log.push('delete'),
    onNudge: (dx, dy) => void log.push(`nudge ${dx},${dy}`),
    onDuplicate: () => void log.push('duplicate'),
    onCopy: () => void log.push('copy'),
    onCut: () => void log.push('cut'),
    onPaste: () => void log.push('paste'),
    onSelectAll: () => void log.push('all'),
  });
  return null;
}

function key(k: string, mods: KeyboardEventInit = {}, target?: EventTarget) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods });
  if (target) Object.defineProperty(e, 'target', { value: target });
  act(() => void window.dispatchEvent(e));
  return e;
}

beforeEach(() => {
  log = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(React.createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('#26 object map', () => {
  it('nudge: arrows 0.5 mm, Shift 5 mm, page scroll prevented', () => {
    expect(NUDGE_MM).toBe(0.5);
    expect(NUDGE_SHIFT_MM).toBe(5);
    const e = key('ArrowLeft');
    key('ArrowRight', { shiftKey: true });
    key('ArrowUp');
    key('ArrowDown', { shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(log).toEqual(['nudge -0.5,0', 'nudge 5,0', 'nudge 0,-0.5', 'nudge 0,5']);
  });

  it('Delete and Backspace delete', () => {
    key('Delete');
    key('Backspace');
    expect(log).toEqual(['delete', 'delete']);
  });

  it('⌘D ⌘C ⌘X ⌘V ⌘A (and Ctrl on other platforms), each preventing the browser default', () => {
    const events = ['d', 'c', 'x', 'v', 'a'].map((k) => key(k, { metaKey: true }));
    key('a', { ctrlKey: true });
    expect(log).toEqual(['duplicate', 'copy', 'cut', 'paste', 'all', 'all']);
    expect(events.every((e) => e.defaultPrevented)).toBe(true);
  });

  it('⌘+arrow is not a nudge (left to the platform)', () => {
    key('ArrowLeft', { metaKey: true });
    expect(log).toEqual([]);
  });

  it('a focused text field keeps Delete, arrows, ⌘A and the clipboard', () => {
    const field = document.createElement('input');
    for (const [k, m] of [
      ['Delete', {}],
      ['Backspace', {}],
      ['ArrowLeft', {}],
      ['a', { metaKey: true }],
      ['c', { metaKey: true }],
      ['v', { metaKey: true }],
      ['d', { metaKey: true }],
    ] as const)
      expect(key(k, m, field).defaultPrevented).toBe(false);
    expect(log).toEqual([]);
  });

  it('a focused colour input does not (C-6): Delete deletes, arrows nudge', () => {
    const swatch = document.createElement('input');
    swatch.type = 'color';
    key('Delete', {}, swatch);
    key('ArrowUp', {}, swatch);
    expect(log).toEqual(['delete', 'nudge 0,-0.5']);
  });
});
