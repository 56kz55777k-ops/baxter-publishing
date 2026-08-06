'use client';

/**
 * The editor surface (Slice A): the current unit rendered at preset trim with
 * bleed/trim/margin/safe guides, plus viewport interaction — wheel pan,
 * pointer-centred zoom, Space/Hand drag-pan (contract #27). No elements yet.
 *
 * Cursor ownership (contract #21, approved architecture): ONE resolver writes
 * the cursor to this OUTER wrapper element, pre-paint. Konva's inner content
 * element stays untouched — when the Transformer arrives (Slice D) its anchor
 * cursors own the inner element and win by CSS containment. No other writer
 * is permitted, in any slice.
 *
 * Auto-fit: first measure and every viewport resize refit the current unit
 * (contract #27 — auto-fit on navigation and window resize, never on mode
 * toggles). Navigation fits are dispatched by the shell with SET_UNIT.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Group, Layer, Stage } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { fitUnitView, panBy, zoomAt, type UnitGeometry } from './geometry';
import { StageGuides } from './StageGuides';
import { useEditorUi, useEditorUiDispatch } from './state/editor-ui-context';

const PASTEBOARD = '#eae7e0';

export function SpreadStage({
  geom,
  viewportRef,
}: {
  geom: UnitGeometry;
  viewportRef: React.MutableRefObject<{ w: number; h: number }>;
}) {
  const ui = useEditorUi();
  const uiDispatch = useEditorUiDispatch();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const panOrigin = useRef<{ sx: number; sy: number; vx: number; vy: number; scale: number } | null>(null);
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const viewRef = useRef(ui.view);
  viewRef.current = ui.view;
  const firstDrawDone = useRef(false);

  // --- viewport measurement -------------------------------------------------
  // Synchronous initial measure + ResizeObserver for subsequent changes.
  // The initial measurement MUST NOT depend on observer delivery: RO callbacks
  // ride the rendering-frame pipeline, and a page loaded in a hidden tab runs
  // no frames — the observation queues and never delivers until the tab is
  // shown (production stage incident, 2026-08-03). Layout, by contrast, is
  // computed on demand: getBoundingClientRect() returns real dimensions even
  // while hidden, so measuring synchronously mounts the stage unconditionally.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.round(r.width), h: Math.round(r.height) };
      if (next.w === 0 || next.h === 0) return; // never enter zero dimensions
      viewportRef.current = next;
      setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewportRef]);

  // First measure + window resizes: fit the current unit. Unit NAVIGATION
  // fits arrive via SET_UNIT from the shell; commits never refit.
  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    uiDispatch({ type: 'SET_VIEW', view: fitUnitView(geomRef.current, size.w, size.h) });
  }, [size, uiDispatch]);

  // First painted frame (performance budget P1's end mark).
  useEffect(() => {
    if (firstDrawDone.current || size.w === 0) return;
    firstDrawDone.current = true;
    requestAnimationFrame(() => {
      performance.mark('baxter:editor:first-draw');
      if (performance.getEntriesByName('baxter:editor:island-mounted').length > 0) {
        performance.measure('baxter:editor:mount-to-draw', 'baxter:editor:island-mounted', 'baxter:editor:first-draw');
      }
    });
  }, [size]);

  // --- cursor resolver (outer wrapper is the ONLY writer) --------------------
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.style.cursor = panning ? 'grabbing' : spaceHeld || ui.tool === 'hand' ? 'grab' : 'default';
  }, [panning, spaceHeld, ui.tool]);

  // --- keyboard: Space momentary hand, V/H tools (contract #26 typing guard) -
  useEffect(() => {
    function isTyping(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      if (!el) return false;
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      );
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isTyping(e.target)) return;
      if (e.key === ' ') {
        e.preventDefault();
        setSpaceHeld(true);
      } else if (e.key === 'v' || e.key === 'V') {
        uiDispatch({ type: 'SET_TOOL', tool: 'select' });
      } else if (e.key === 'h' || e.key === 'H') {
        uiDispatch({ type: 'SET_TOOL', tool: 'hand' });
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === ' ') setSpaceHeld(false);
    }
    function onBlur() {
      setSpaceHeld(false); // window blur clears modifier state (contract #26)
      setPanning(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [uiDispatch]);

  // --- pan gesture (window-level while active, the spike's architecture) -----
  useEffect(() => {
    if (!panning) return;
    function onMove(ev: MouseEvent) {
      const p = panOrigin.current;
      if (!p) return;
      uiDispatch({
        type: 'SET_VIEW',
        view: { x: p.vx + (ev.clientX - p.sx), y: p.vy + (ev.clientY - p.sy), scale: p.scale },
      });
    }
    function onUp() {
      setPanning(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [panning, uiDispatch]);

  function onMouseDown(e: KonvaEventObject<MouseEvent>) {
    if (!(spaceHeld || ui.tool === 'hand') || e.evt.button !== 0) return;
    panOrigin.current = {
      sx: e.evt.clientX,
      sy: e.evt.clientY,
      vx: viewRef.current.x,
      vy: viewRef.current.y,
      scale: viewRef.current.scale,
    };
    setPanning(true);
  }

  function onWheel(e: KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const view = viewRef.current;
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition() ?? { x: size.w / 2, y: size.h / 2 };
      uiDispatch({
        type: 'SET_VIEW',
        view: zoomAt(view, Math.pow(1.0018, -e.evt.deltaY), pointer),
      });
    } else {
      uiDispatch({ type: 'SET_VIEW', view: panBy(view, -e.evt.deltaX, -e.evt.deltaY) });
    }
  }

  const view = ui.view;

  return (
    <div
      ref={wrapRef}
      data-testid="spread-stage"
      className="relative h-full w-full overflow-hidden"
      style={{ backgroundColor: PASTEBOARD }}
    >
      {size.w > 0 && size.h > 0 && (
        <Stage width={size.w} height={size.h} onMouseDown={onMouseDown} onWheel={onWheel}>
          <Layer listening={false}>
            <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
              <StageGuides geom={geom} />
            </Group>
          </Layer>
        </Stage>
      )}
    </div>
  );
}
