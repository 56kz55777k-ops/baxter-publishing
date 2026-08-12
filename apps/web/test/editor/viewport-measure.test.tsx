// @vitest-environment jsdom
/**
 * useViewportMeasure — the production stage incident's regression suite.
 * Targets the MECHANISM: an observer that never delivers (hidden page: RO
 * callbacks ride rendering frames; hidden pages run none) must not prevent
 * initialization, because the initial measurement is synchronous.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useViewportMeasure, type ViewportSize } from '@/components/editor/use-viewport-measure';

/** Controllable ResizeObserver stub: never fires on its own. */
class ROStub {
  static instances: ROStub[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private cb: ResizeObserverCallback) {
    ROStub.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  fire() {
    this.cb([], this as unknown as ResizeObserver);
  }
}

let rect = { width: 1349, height: 805 };
let container: HTMLDivElement;
let root: Root;
let latest: ViewportSize;
let mirror: React.MutableRefObject<ViewportSize>;

function Harness() {
  const ref = useRef<HTMLDivElement | null>(null);
  mirror = useRef<ViewportSize>({ w: 0, h: 0 });
  latest = useViewportMeasure(ref, mirror);
  return React.createElement('div', { ref });
}

beforeEach(() => {
  ROStub.instances = [];
  rect = { width: 1349, height: 805 };
  vi.stubGlobal('ResizeObserver', ROStub);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: rect.width, height: rect.height }) as DOMRect
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useViewportMeasure — frame-independent initialization (ADR-001)', () => {
  it('THE INCIDENT: observer never fires, yet the synchronous measure initializes the viewport', () => {
    act(() => {
      root.render(React.createElement(Harness));
    });
    // No ROStub.fire() anywhere — delivery is starved, as in a hidden page.
    expect(latest).toEqual({ w: 1349, h: 805 });
    expect(mirror.current).toEqual({ w: 1349, h: 805 });
    expect(ROStub.instances).toHaveLength(1);
    expect(ROStub.instances[0]!.observed).toHaveLength(1);
  });

  it('a later observer delivery updates dimensions', () => {
    act(() => {
      root.render(React.createElement(Harness));
    });
    rect = { width: 900, height: 700 };
    act(() => {
      ROStub.instances[0]!.fire();
    });
    expect(latest).toEqual({ w: 900, h: 700 });
    expect(mirror.current).toEqual({ w: 900, h: 700 });
  });

  it('zero dimensions are rejected: state never enters 0×0 after a real measure', () => {
    act(() => {
      root.render(React.createElement(Harness));
    });
    rect = { width: 0, height: 0 };
    act(() => {
      ROStub.instances[0]!.fire();
    });
    expect(latest).toEqual({ w: 1349, h: 805 }); // guarded — kept the last real size
    // And a zero INITIAL measure leaves the pre-measure state untouched:
    act(() => root.unmount());
    root = createRoot(container);
    act(() => {
      root.render(React.createElement(Harness));
    });
    expect(latest).toEqual({ w: 0, h: 0 }); // no real measurement accepted yet
    rect = { width: 640, height: 480 };
    act(() => {
      ROStub.instances[1]!.fire();
    });
    expect(latest).toEqual({ w: 640, h: 480 }); // recovers when real dims arrive
  });

  it('cleanup disconnects the observer this mount created', () => {
    act(() => {
      root.render(React.createElement(Harness));
    });
    const ro = ROStub.instances[0]!;
    expect(ro.disconnected).toBe(false);
    act(() => root.unmount());
    expect(ro.disconnected).toBe(true);
    root = createRoot(container); // afterEach unmounts safely
  });

  it('remounting neither leaks nor duplicates observers', () => {
    act(() => {
      root.render(React.createElement(Harness));
    });
    act(() => root.unmount());
    root = createRoot(container);
    act(() => {
      root.render(React.createElement(Harness));
    });
    expect(ROStub.instances).toHaveLength(2);
    expect(ROStub.instances[0]!.disconnected).toBe(true); // first mount cleaned up
    expect(ROStub.instances[1]!.disconnected).toBe(false); // only the live one observes
    expect(ROStub.instances[1]!.observed).toHaveLength(1);
  });
});
