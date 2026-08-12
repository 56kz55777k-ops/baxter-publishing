'use client';

/**
 * The editor surface (Slice A): the current unit rendered at preset trim with
 * bleed/trim/margin/safe guides, plus stage-local viewport interaction —
 * wheel pan, pointer-centred zoom, Space/Hand drag-pan (contract #27).
 * No elements yet.
 *
 * Ownership boundaries (hardening pass):
 * - Keyboard lives in the shell's useEditorKeyboard — this component only
 *   CONSUMES `spaceHeld`. Pointer-gesture state (panning) stays here, with
 *   its own window-blur cancellation: blur must end an in-flight drag.
 * - Viewport measurement lives in useViewportMeasure (ADR-001: synchronous
 *   initial measure; observer for subsequent changes only).
 *
 * Cursor ownership (contract #21, approved architecture): ONE resolver writes
 * the cursor to this OUTER wrapper element, pre-paint. Konva's inner content
 * element stays untouched — when the Transformer arrives (Slice D) its anchor
 * cursors own the inner element and win by CSS containment. No other writer
 * is permitted, in any slice.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Group, Layer, Stage } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { fitUnitView, panBy, zoomAt, type UnitGeometry } from './geometry';
import { StageGuides } from './StageGuides';
import { useViewportMeasure, type ViewportSize } from './use-viewport-measure';
import { useEditorUi, useEditorUiDispatch } from './state/editor-ui-context';

const PASTEBOARD = '#eae7e0';

export const SpreadStage = memo(function SpreadStage({
  geom,
  viewportRef,
  spaceHeld,
}: {
  geom: UnitGeometry;
  viewportRef: React.MutableRefObject<ViewportSize>;
  spaceHeld: boolean;
}) {
  const ui = useEditorUi();
  const uiDispatch = useEditorUiDispatch();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [panning, setPanning] = useState(false);
  const panOrigin = useRef<{ sx: number; sy: number; vx: number; vy: number; scale: number } | null>(null);
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const viewRef = useRef(ui.view);
  viewRef.current = ui.view;
  const firstDrawDone = useRef(false);

  const size = useViewportMeasure(wrapRef, viewportRef);

  // First measure + viewport resizes: fit the current unit. Unit NAVIGATION
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

  // --- pan gesture (window-level while active, the spike's architecture).
  // Blur cancels an in-flight drag — a gesture concern, so it lives here.
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
    function onBlur() {
      setPanning(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onBlur);
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
});
