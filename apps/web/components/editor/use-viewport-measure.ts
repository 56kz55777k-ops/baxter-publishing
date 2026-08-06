'use client';

/**
 * Viewport measurement — the extracted, testable unit of the production
 * stage incident fix (2026-08-03; see docs/adr/ADR-001).
 *
 * Contract, in order:
 *   1. SYNCHRONOUS initial measurement via getBoundingClientRect in a layout
 *      effect — layout is computed on demand even in a hidden page, so the
 *      initial size never depends on a rendering frame being produced.
 *   2. Zero dimensions are rejected — the consumer never enters a 0×0 state.
 *   3. One ResizeObserver per mount for SUBSEQUENT changes only (observer
 *      delivery rides the rendering-frame pipeline and may be starved in
 *      hidden pages; that is acceptable for *updates*, never for *boot*).
 *   4. Cleanup disconnects exactly the observer this mount created.
 *
 * `mirrorRef`, when provided, receives every accepted measurement — the
 * shell reads it imperatively for navigation/fit math without re-rendering.
 */
import { useLayoutEffect, useState } from 'react';

export interface ViewportSize {
  w: number;
  h: number;
}

export function useViewportMeasure(
  targetRef: React.RefObject<HTMLElement | null>,
  mirrorRef?: React.MutableRefObject<ViewportSize>
): ViewportSize {
  const [size, setSize] = useState<ViewportSize>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.round(r.width), h: Math.round(r.height) };
      if (next.w === 0 || next.h === 0) return; // never enter zero dimensions
      if (mirrorRef) mirrorRef.current = next;
      setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // targetRef/mirrorRef are stable ref objects for the life of the mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return size;
}
