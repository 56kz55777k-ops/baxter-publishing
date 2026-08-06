// @vitest-environment jsdom
/**
 * Desk gate (DoD F8): a coarse pointer or small viewport gets the desk
 * message and the island component is never rendered. next/dynamic is
 * mocked to a marker — whether the real chunk downloads is proven in the
 * live-browser verification; THIS test proves the gate's decision logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/dynamic', () => ({
  default: () =>
    function IslandMarker() {
      return React.createElement('div', { 'data-testid': 'island-marker' });
    },
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));

import { EditorGate } from '@/app/(editor)/studio/editor/[id]/editor-gate';

let container: HTMLDivElement;
let root: Root;

function setEnvironment({ coarse, width }: { coarse: boolean; width: number }) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('pointer: coarse') ? coarse : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const props = {
  publicationId: '7d9f4c2e-1b3a-4f6d-9e8c-2a5b7c9d1e3f',
  title: 'Test',
  docRow: null,
};

describe('EditorGate — desktop-only gate', () => {
  it('coarse pointer → desk message, island never rendered', async () => {
    setEnvironment({ coarse: true, width: 1400 });
    await act(async () => {
      root.render(React.createElement(EditorGate, props));
    });
    expect(container.querySelector('[data-testid="desk-gate"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="island-marker"]')).toBeNull();
    expect(container.textContent).toContain('The editor opens at a desk.');
  });

  it('small viewport → desk message even with a fine pointer', async () => {
    setEnvironment({ coarse: false, width: 720 });
    await act(async () => {
      root.render(React.createElement(EditorGate, props));
    });
    expect(container.querySelector('[data-testid="desk-gate"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="island-marker"]')).toBeNull();
  });

  it('fine pointer + wide viewport → the island renders', async () => {
    setEnvironment({ coarse: false, width: 1400 });
    await act(async () => {
      root.render(React.createElement(EditorGate, props));
    });
    expect(container.querySelector('[data-testid="island-marker"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="desk-gate"]')).toBeNull();
  });
});
