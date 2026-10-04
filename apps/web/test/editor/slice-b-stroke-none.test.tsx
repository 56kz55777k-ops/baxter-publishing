// @vitest-environment jsdom
/**
 * Stroke None — the swatch shows "none", and any colour activates the stroke
 * in one intentional action (contract #18: None is first-class).
 *
 * Regression for the defect found during Slice B preview acceptance: with
 * Stroke = none the swatch rendered the latent #000000 as a solid black chip,
 * as though a black stroke were active; and because a native colour input
 * reports a choice only when its value CHANGES, choosing black from None did
 * nothing — the stroke could not be activated in black in one step.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { newEllipseElement, newRectElement, type EditorElement } from '@baxter/domain';
import { Inspector } from '@/components/editor/inspector/Inspector';

let container: HTMLDivElement;
let root: Root;
let patches: { patch: Record<string, unknown>; label: string }[] = [];

function render(element: EditorElement) {
  act(() => {
    root.render(
      React.createElement(Inspector, {
        element,
        page: { formatName: 'A5 zine', marginMm: 12, safeMm: 5 },
        selectionCount: 1,
        disabled: false,
        onPatch: (patch: Record<string, unknown>, label: string) => patches.push({ patch, label }),
        onArrange: () => {},
        onSetLocked: () => {},
      })
    );
  });
}

const swatch = () => container.querySelector('[data-testid="swatch-stroke"]') as HTMLElement;
const strokeInput = () => swatch().querySelector('input[type="color"]') as HTMLInputElement;

/** What a native picker does on a real choice: set the value, fire input + change. */
function choose(input: HTMLInputElement, hex: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, hex);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function typeWidth(text: string) {
  const w = container.querySelector('[data-testid="num-stroke-width"]') as HTMLInputElement;
  act(() => w.focus());
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(w, text);
    w.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Enter is the commit boundary. (No blur afterwards: with a mocked onPatch the
  // element never re-renders, so a blur would re-commit a value the real app
  // would already hold — the NumField suite pins that blur-after-commit is a no-op.)
  act(() => w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
}

const none = (make: () => EditorElement) => ({ ...make(), stroke: null, strokeWidth: 0 }) as EditorElement;
const stroked = (make: () => EditorElement, stroke: string, strokeWidth: number) =>
  ({ ...make(), stroke, strokeWidth }) as EditorElement;

beforeEach(() => {
  patches = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe.each([
  ['rect', () => newRectElement({ x: 10, y: 10 })],
  ['ellipse', () => newEllipseElement({ x: 10, y: 10 })],
])('Stroke control on a %s', (_type, make) => {
  it('1 · none has a visually distinct swatch state — never the latent black chip', () => {
    render(none(make));
    expect(swatch().getAttribute('data-state')).toBe('none');
    expect(container.querySelector('[data-testid="swatch-stroke-none"]')).not.toBeNull();
    // the colour control is still there, but it is not what you see
    expect(strokeInput()).not.toBeNull();
    expect(strokeInput().value).not.toBe('#000000');
    // its accessible name carries the state; no extra visible text is added
    expect(strokeInput().getAttribute('aria-label')).toBe('Stroke colour: none');

    render(stroked(make, '#c0392b', 1));
    expect(swatch().getAttribute('data-state')).toBe('set');
    expect(container.querySelector('[data-testid="swatch-stroke-none"]')).toBeNull();
    expect(strokeInput().value).toBe('#c0392b');
    expect(strokeInput().getAttribute('aria-label')).toBe('Stroke colour');
  });

  it('2 · choosing black from none activates a black stroke — one action, one commit', () => {
    render(none(make));
    choose(strokeInput(), '#000000');
    expect(patches).toEqual([{ patch: { stroke: '#000000', strokeWidth: 0.5 }, label: 'Set stroke' }]);
  });

  it('3 · choosing another colour from none activates that colour', () => {
    render(none(make));
    choose(strokeInput(), '#2e5e8a');
    expect(patches).toEqual([{ patch: { stroke: '#2e5e8a', strokeWidth: 0.5 }, label: 'Set stroke' }]);
  });

  it('4 · disabling and restoring the stroke is predictable', () => {
    // disable: width 0 returns the stroke to None
    render(stroked(make, '#2e5e8a', 1));
    typeWidth('0');
    expect(patches).toEqual([{ patch: { stroke: null, strokeWidth: 0 }, label: 'Set stroke width' }]);

    // restore by colour: the chosen colour at the default width
    patches = [];
    render(none(make));
    choose(strokeInput(), '#2e5e8a');
    expect(patches).toEqual([{ patch: { stroke: '#2e5e8a', strokeWidth: 0.5 }, label: 'Set stroke' }]);

    // restore by width: the default colour at the typed width
    patches = [];
    render(none(make));
    typeWidth('2');
    expect(patches).toEqual([{ patch: { stroke: '#1a1a1a', strokeWidth: 2 }, label: 'Set stroke width' }]);

    // recolouring an active stroke keeps its width
    patches = [];
    render(stroked(make, '#2e5e8a', 2));
    choose(strokeInput(), '#000000');
    expect(patches).toEqual([{ patch: { stroke: '#000000' }, label: 'Set stroke' }]);
  });

  it('5 · no extra history or autosave entry beyond the change itself', () => {
    // merely rendering the None state, or the active state, commits nothing
    render(none(make));
    render(stroked(make, '#2e5e8a', 1));
    render(none(make));
    expect(patches).toEqual([]);
    // one choice is exactly one commit, never an activate-then-recolour pair
    choose(strokeInput(), '#000000');
    expect(patches).toHaveLength(1);
    // re-choosing the active colour is not a change and commits nothing
    patches = [];
    render(stroked(make, '#000000', 0.5));
    choose(strokeInput(), '#000000');
    expect(patches).toEqual([]);
  });
});
