// @vitest-environment jsdom
/**
 * useEditorKeyboard (hardening item 1) — proves the pre-hardening SpreadStage
 * keyboard behaviour survived the move to shell level unchanged: Space
 * momentary hand with page-scroll prevention, V/H tool switches, the typing
 * guard, and window-blur clearing the Space modifier (contract #26).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { isTypingTarget, useEditorKeyboard } from '@/components/editor/use-editor-keyboard';
import type { EditorUiAction } from '@/components/editor/state/editor-ui';

let container: HTMLDivElement;
let root: Root;
let spaceNow = false;
let dispatched: EditorUiAction[] = [];

function Harness() {
  const { spaceHeld } = useEditorKeyboard((a) => {
    dispatched.push(a);
  });
  spaceNow = spaceHeld;
  return null;
}

function key(type: 'keydown' | 'keyup', key: string, target?: EventTarget) {
  const e = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
  if (target) Object.defineProperty(e, 'target', { value: target });
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
}

beforeEach(() => {
  dispatched = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useEditorKeyboard — Slice A map preserved at shell level', () => {
  it('Space press holds the modifier, prevents page scroll, and release clears it', () => {
    const down = key('keydown', ' ');
    expect(spaceNow).toBe(true);
    expect(down.defaultPrevented).toBe(true); // page must not scroll
    key('keyup', ' ');
    expect(spaceNow).toBe(false);
  });

  it('V and H switch tools; case-insensitive', () => {
    key('keydown', 'h');
    key('keydown', 'V');
    expect(dispatched).toEqual([
      { type: 'SET_TOOL', tool: 'hand' },
      { type: 'SET_TOOL', tool: 'select' },
    ]);
  });

  it('typing guard: keys from editable targets are ignored entirely', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const down = key('keydown', ' ', input);
    key('keydown', 'h', input);
    expect(spaceNow).toBe(false);
    expect(dispatched).toEqual([]);
    expect(down.defaultPrevented).toBe(false); // the field keeps its space
    input.remove();
  });

  it('window blur clears the Space modifier (contract #26)', () => {
    key('keydown', ' ');
    expect(spaceNow).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(spaceNow).toBe(false);
  });

  it('unmount removes every listener (no ghost tool switches)', () => {
    act(() => root.unmount());
    root = createRoot(container);
    key('keydown', 'h');
    expect(dispatched).toEqual([]);
  });

  it('isTypingTarget covers input, textarea, select and contentEditable', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isTypingTarget(document.createElement(tag))).toBe(true);
    }
    const div = document.createElement('div');
    expect(isTypingTarget(div)).toBe(false);
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isTypingTarget(div)).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});
