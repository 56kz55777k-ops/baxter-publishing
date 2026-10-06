// @vitest-environment jsdom
/**
 * Slice C decision C-6 — the typing guard covers text-entry surfaces only.
 *
 * Regression for the bounded follow-up recorded at Slice B acceptance: after a
 * colour pick, focus stays on the colour input; the guard treated every
 * <input> as a text field, so ⌘Z went to the browser and document undo did
 * nothing until focus moved. Slice C adds Delete, arrows, ⌘D and ⌘C/X/V to the
 * same handler — every one of them would have been silenced the same way.
 *
 * Control inputs (colour, checkbox, button-likes) and <button> no longer
 * silence document shortcuts. Space and Enter stay native on them, because
 * that is how the keyboard activates a control.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { isTypingTarget, useEditorKeyboard } from '@/components/editor/use-editor-keyboard';
import type { EditorUiAction } from '@/components/editor/state/editor-ui';

let container: HTMLDivElement;
let root: Root;
let dispatched: EditorUiAction[] = [];
let undos = 0;
let spaceNow = false;

function Harness() {
  const { spaceHeld } = useEditorKeyboard((a) => void dispatched.push(a), {
    onUndo: () => void (undos += 1),
    onRedo: () => {},
  });
  spaceNow = spaceHeld;
  return null;
}

function input(type: string) {
  const el = document.createElement('input');
  el.type = type;
  document.body.appendChild(el);
  return el;
}

function key(k: string, target: EventTarget, mods: { metaKey?: boolean } = {}) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods });
  Object.defineProperty(e, 'target', { value: target });
  act(() => void window.dispatchEvent(e));
  return e;
}

beforeEach(() => {
  dispatched = [];
  undos = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(React.createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.querySelectorAll('input,button').forEach((n) => n.remove());
});

describe('C-6 · the typing guard is for typing', () => {
  it('⌘Z with focus on a colour input undoes the document', () => {
    const e = key('z', input('color'), { metaKey: true });
    expect(undos).toBe(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('checkbox and button-like inputs do not silence shortcuts either', () => {
    key('z', input('checkbox'), { metaKey: true });
    key('z', document.body.appendChild(document.createElement('button')), { metaKey: true });
    expect(undos).toBe(2);
  });

  it('Space and Enter stay native on a focused control (keyboard activation)', () => {
    const swatch = input('color');
    const space = key(' ', swatch);
    const enter = key('Enter', swatch);
    expect(spaceNow).toBe(false);
    expect(space.defaultPrevented).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
  });

  it('text-entry surfaces keep the guard: text, number, search, textarea, select, range, radio', () => {
    for (const t of ['text', 'number', 'search', 'email', 'range', 'radio']) {
      expect(isTypingTarget(input(t))).toBe(true);
    }
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
    key('z', input('text'), { metaKey: true });
    expect(undos).toBe(0); // in-field undo stays native
  });

  it('controls are not typing targets', () => {
    for (const t of ['color', 'checkbox', 'button', 'submit', 'reset']) {
      expect(isTypingTarget(input(t))).toBe(false);
    }
  });
});
