// @vitest-environment jsdom
/**
 * NumField display = model exactly, in the SAME commit (contract #19, R12).
 *
 * Regression for a defect found during Slice B behavioural acceptance: an
 * unfocused field re-synced its displayed draft from the model in a passive
 * effect, i.e. after paint. On a selection switch the incoming element's panel
 * painted the outgoing element's numbers for one or two frames (measured in a
 * real browser: rect panel showing the ellipse's W), and an undo painted the
 * old value first. The probe below reads the input in a layout effect — after
 * the DOM commit, before paint — which is exactly where the stale value lived.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GEOMETRY_BOUNDS, NumField } from '@/components/editor/inspector/NumField';

let container: HTMLDivElement;
let root: Root;
let painted: string[] = [];

function Probe({ value }: { value: number }) {
  useLayoutEffect(() => {
    const input = container.querySelector('input') as HTMLInputElement;
    painted.push(input.value);
  });
  return React.createElement(NumField, { label: 'W', value, bounds: GEOMETRY_BOUNDS, onCommit: () => {} });
}

function render(value: number) {
  act(() => {
    root.render(React.createElement(Probe, { value }));
  });
}

beforeEach(() => {
  painted = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('an unfocused field never paints a value the model does not hold', () => {
  it('shows the new model value in the very commit that delivers it', () => {
    render(35.1);
    painted = [];
    render(31.6); // a selection switch or an undo: the model changes underneath
    expect(painted[0]).toBe('31.6');
    expect(painted.every((v) => v === '31.6')).toBe(true);
  });

  it('a focused draft is still left alone by an external change', () => {
    render(10);
    const input = container.querySelector('input') as HTMLInputElement;
    act(() => input.focus());
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '12.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    render(20); // external change while the person is typing
    expect(input.value).toBe('12.');
  });

  it('focusing starts the draft from the current model value', () => {
    render(10);
    render(25);
    const input = container.querySelector('input') as HTMLInputElement;
    act(() => input.focus());
    expect(input.value).toBe('25');
  });
});
