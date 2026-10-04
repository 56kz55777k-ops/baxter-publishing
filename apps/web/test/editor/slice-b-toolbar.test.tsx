// @vitest-environment jsdom
/**
 * The toolbar arms every creation tool (contract #3, Slice B plan §3).
 *
 * Regression for the gap found during Slice B behavioural acceptance: the
 * creation engine supported rect AND ellipse, but the only way to arm a
 * creation tool was the R key, and ellipse has no letter in contract #26's
 * map — so ellipse creation was unreachable in the product. The unit suite
 * had exercised the gesture engine with the tool set directly, which is why
 * nothing failed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StatusBar } from '@/components/editor/StatusBar';
import { EditorUiProvider, useEditorUi } from '@/components/editor/state/editor-ui-context';

let container: HTMLDivElement;
let root: Root;
let seenTool = '';

function ToolProbe() {
  seenTool = useEditorUi().tool;
  return null;
}

function render() {
  act(() => {
    root.render(
      React.createElement(
        EditorUiProvider,
        null,
        React.createElement(StatusBar, {
          onFitPage: () => {},
          onFitSpread: () => {},
          onHundred: () => {},
          spreadFitLabel: 'Fit spread',
        }),
        React.createElement(ToolProbe)
      )
    );
  });
}

function button(label: string) {
  const b = [...container.querySelectorAll('button')].find((x) => x.textContent === label);
  expect(b, label).toBeDefined();
  return b as HTMLButtonElement;
}

function click(b: HTMLButtonElement) {
  act(() => {
    b.click();
  });
}

beforeEach(() => {
  seenTool = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('toolbar — every tool is reachable by click', () => {
  it.each([
    ['Rectangle', 'rect'],
    ['Ellipse', 'ellipse'],
    ['Hand', 'hand'],
    ['Select', 'select'],
  ])('%s arms the %s tool', (label, tool) => {
    render();
    if (tool === 'select') click(button('Hand')); // leave Select first
    click(button(label));
    expect(seenTool).toBe(tool);
  });

  it('announces exactly one armed tool via aria-pressed', () => {
    render();
    click(button('Ellipse'));
    const pressed = [...container.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent);
    expect(pressed).toEqual(['Ellipse']);
    for (const label of ['Select', 'Hand', 'Rectangle']) {
      expect(button(label).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('leaves the fit and zoom controls as plain buttons, not toggles', () => {
    render();
    for (const label of ['Fit page', 'Fit spread', '100%']) {
      expect(button(label).hasAttribute('aria-pressed')).toBe(false);
    }
  });
});
