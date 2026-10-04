// @vitest-environment jsdom
/**
 * Inspector field identity — every control has a unique accessible name and a
 * unique test id (contract #18, accessibility floor).
 *
 * Regression for the defect the Slice B browser smoke found on its first
 * execution: the geometry "W" and the stroke "W" both derived
 * `aria-label="W"` and `data-testid="num-w"` from their shared visible label.
 * A screen reader announced two indistinguishable "W" fields, and the smoke's
 * `getByTestId('num-w')` resolved to two elements. Visible labels may repeat
 * across sections; names and ids may not.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { newEllipseElement, newRectElement, type EditorElement } from '@baxter/domain';
import { Inspector } from '@/components/editor/inspector/Inspector';

let container: HTMLDivElement;
let root: Root;

function render(element: EditorElement) {
  act(() => {
    root.render(
      React.createElement(Inspector, {
        element,
        page: { formatName: 'A5 zine', marginMm: 12, safeMm: 5 },
        selectionCount: 1,
        disabled: false,
        onPatch: () => {},
        onArrange: () => {},
        onSetLocked: () => {},
      })
    );
  });
  return [...container.querySelectorAll('input')];
}

function duplicates(values: (string | null)[]) {
  return values.filter((v, i) => values.indexOf(v) !== i);
}

beforeEach(() => {
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
])('single-object inspector for a %s', (_type, make) => {
  it('gives every input a unique, non-empty accessible name', () => {
    const names = render(make()).map((i) => i.getAttribute('aria-label'));
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n && n.trim().length > 0)).toBe(true);
    expect(duplicates(names)).toEqual([]);
  });

  it('gives every input a unique test id', () => {
    const ids = render(make()).map((i) => i.getAttribute('data-testid'));
    expect(ids.every((id) => id && id.length > 0)).toBe(true);
    expect(duplicates(ids)).toEqual([]);
  });

  it('keeps the geometry ids and names the browser smoke relies on', () => {
    const inputs = render(make());
    for (const [id, name] of [
      ['num-x', 'X'],
      ['num-y', 'Y'],
      ['num-w', 'W'],
      ['num-h', 'H'],
    ]) {
      const input = inputs.find((i) => i.getAttribute('data-testid') === id);
      expect(input, id).toBeDefined();
      expect(input!.getAttribute('aria-label')).toBe(name);
    }
  });

  it('names the stroke width as stroke width, not as a second "W"', () => {
    const stroke = render(make()).find((i) => i.getAttribute('data-testid') === 'num-stroke-width');
    expect(stroke).toBeDefined();
    expect(stroke!.getAttribute('aria-label')).toBe('Stroke width');
  });
});
