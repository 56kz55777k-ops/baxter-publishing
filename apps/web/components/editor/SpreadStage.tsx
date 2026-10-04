'use client';

/**
 * The editor surface: the current unit rendered at preset trim with
 * bleed/trim/margin/safe guides, the publication's elements, and the
 * transient chrome of an in-flight gesture — plus stage-local viewport
 * interaction (wheel pan, pointer-centred zoom, Space/Hand drag-pan,
 * contract #27).
 *
 * Ownership boundaries (hardening pass, extended in Slice B):
 * - Keyboard lives in the shell's useEditorKeyboard — this component only
 *   CONSUMES `spaceHeld`. Pointer-gesture state stays here, with window-blur
 *   cancellation: blur must end an in-flight drag or draw.
 * - Viewport measurement lives in useViewportMeasure (ADR-001: synchronous
 *   initial measure; observer for subsequent changes only).
 * - Creation/selection/marquee gesture state lives in useStageGestures, in
 *   refs and local state that never touch the document until one COMMIT.
 *
 * Cursor ownership (contract #21, approved architecture): ONE resolver writes
 * the cursor to this OUTER wrapper element, pre-paint. Konva's inner content
 * element stays untouched — when the Transformer arrives (Slice D) its anchor
 * cursors own the inner element and win by CSS containment. No other writer
 * is permitted, in any slice. Slice B extends the priority chain; it does not
 * fork it.
 *
 * Layers: guides and overlays never listen; only the elements layer does, so
 * hit-testing cost tracks the document rather than the chrome.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Group, Layer, Stage } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { EditorElement, EditorPage } from '@baxter/domain';
import { resolveCursor } from './cursor';
import { fitUnitView, panBy, zoomAt, type UnitGeometry } from './geometry';
import { ElementsLayer } from './ElementsLayer';
import { SizeReadout } from './SizeReadout';
import { StageGuides } from './StageGuides';
import { CreationPreview, MarqueeRect, SelectionOutlines, SnapGuides } from './StageOverlays';
import { elementBoxes, useStageGestures } from './use-stage-gestures';
import { useViewportMeasure, type ViewportSize } from './use-viewport-measure';
import { useEditorUi, useEditorUiDispatch } from './state/editor-ui-context';
import { isCreationTool } from './state/editor-ui';

const PASTEBOARD = '#eae7e0';

export const SpreadStage = memo(function SpreadStage({
  geom,
  pages,
  viewportRef,
  spaceHeld,
  readOnly,
  onCreate,
  onMove,
}: {
  geom: UnitGeometry;
  pages: readonly EditorPage[];
  viewportRef: React.MutableRefObject<ViewportSize>;
  spaceHeld: boolean;
  readOnly: boolean;
  onCreate: (pageIndex: number, element: EditorElement, label: string) => void;
  onMove: (ids: readonly string[], dx: number, dy: number) => void;
}) {
  const ui = useEditorUi();
  const uiDispatch = useEditorUiDispatch();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [panning, setPanning] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const panOrigin = useRef<{ sx: number; sy: number; vx: number; vy: number; scale: number } | null>(null);
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const viewRef = useRef(ui.view);
  viewRef.current = ui.view;
  const firstDrawDone = useRef(false);

  const size = useViewportMeasure(wrapRef, viewportRef);
  const boxes = useMemo(() => elementBoxes(pages, geom), [pages, geom]);

  const onSelect = useCallback(
    (ids: readonly string[]) => uiDispatch({ type: 'SET_SELECTION', ids }),
    [uiDispatch]
  );
  const onToggleSelect = useCallback(
    (ids: readonly string[]) => uiDispatch({ type: 'TOGGLE_SELECTION', ids }),
    [uiDispatch]
  );
  const onAddSelect = useCallback(
    (ids: readonly string[]) => uiDispatch({ type: 'ADD_TO_SELECTION', ids }),
    [uiDispatch]
  );
  const onClearSelection = useCallback(() => uiDispatch({ type: 'CLEAR_SELECTION' }), [uiDispatch]);

  const gestures = useStageGestures({
    geom,
    view: ui.view,
    tool: ui.tool,
    boxes,
    selection: ui.selection,
    hostRef: wrapRef,
    enabled: !readOnly && !spaceHeld && ui.tool !== 'hand',
    onCreate,
    onMove,
    onSelect,
    onToggleSelect,
    onAddSelect,
    onClearSelection,
  });

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
  // The priority chain lives in `resolveCursor` (contract #21). Hover stores
  // only the id; lock is looked up live, so toggling Lock updates the cursor
  // without pointer movement.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const hovered = hoverId ? boxes.find((b) => b.id === hoverId) : undefined;
    el.style.cursor = resolveCursor({
      dragging: gestures.dragging,
      panning,
      handAvailable: spaceHeld || ui.tool === 'hand',
      creationTool: isCreationTool(ui.tool),
      gestureActive: gestures.active,
      hoveredLocked: hovered?.locked,
    });
  }, [gestures.dragging, panning, spaceHeld, ui.tool, gestures.active, hoverId, boxes]);

  // Drag frame timing (blueprint performance budgets: measured from Slice C):
  // input (mousemove handler) → the next painted frame after React commits.
  const dragPreview = gestures.dragPreview;
  useEffect(() => {
    if (!dragPreview) return;
    requestAnimationFrame(() => {
      if (performance.getEntriesByName('baxter:editor:drag-move').length === 0) return;
      performance.measure('baxter:editor:drag-frame', 'baxter:editor:drag-move');
      performance.clearMarks('baxter:editor:drag-move');
    });
  }, [dragPreview]);

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

  const panAvailable = spaceHeld || ui.tool === 'hand';

  function startPan(e: KonvaEventObject<MouseEvent>) {
    panOrigin.current = {
      sx: e.evt.clientX,
      sy: e.evt.clientY,
      vx: viewRef.current.x,
      vy: viewRef.current.y,
      scale: viewRef.current.scale,
    };
    setPanning(true);
  }

  function stagePoint(e: KonvaEventObject<MouseEvent>) {
    return e.target.getStage()?.getPointerPosition() ?? { x: 0, y: 0 };
  }

  function onStageMouseDown(e: KonvaEventObject<MouseEvent>) {
    if (e.evt.button !== 0) return;
    if (panAvailable) {
      startPan(e);
      return;
    }
    if (readOnly) return;
    gestures.onStagePointerDown(stagePoint(e), e.evt.shiftKey, null);
  }

  // Elements handle their own mousedown so the hit id is known without
  // mapping Konva nodes back to the document. Pan still outranks it.
  const onElementPointerDown = useCallback(
    (id: string, e: KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0 || panAvailable || readOnly) return;
      e.cancelBubble = true;
      const point = e.target.getStage()?.getPointerPosition() ?? { x: 0, y: 0 };
      gestures.onStagePointerDown(point, e.evt.shiftKey, id);
    },
    [panAvailable, readOnly, gestures]
  );

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
  // Outlines travel with a drag preview so the selection never lags its objects.
  const selectedBoxes = useMemo(
    () =>
      ui.tool === 'select'
        ? boxes
            .filter((b) => ui.selection.includes(b.id))
            .map((b) =>
              dragPreview?.ids.has(b.id)
                ? { ...b.box, x: b.box.x + dragPreview.dx, y: b.box.y + dragPreview.dy }
                : b.box
            )
        : [],
    [boxes, ui.selection, ui.tool, dragPreview]
  );

  return (
    <div
      ref={wrapRef}
      data-testid="spread-stage"
      // View-only geometry for the browser layer, which must aim real pointer
      // gestures at model positions in every engine: "x y scale" and each
      // page's unit offset (mm). Read-only facts already on screen.
      data-view={`${view.x} ${view.y} ${view.scale}`}
      data-page-offsets={geom.pageOffsetsMm.join(' ')}
      className="relative h-full w-full overflow-hidden"
      style={{ backgroundColor: PASTEBOARD }}
    >
      {size.w > 0 && size.h > 0 && (
        <Stage width={size.w} height={size.h} onMouseDown={onStageMouseDown} onWheel={onWheel}>
          <Layer listening={false}>
            <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
              <StageGuides geom={geom} />
            </Group>
          </Layer>
          <Layer>
            <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
              <ElementsLayer
                pages={pages}
                geom={geom}
                dragPreview={dragPreview}
                onElementPointerDown={onElementPointerDown}
                onHoverChange={setHoverId}
              />
            </Group>
          </Layer>
          <Layer listening={false}>
            <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
              <SelectionOutlines boxes={selectedBoxes} />
              {gestures.previewShape && (
                <CreationPreview
                  shape={gestures.previewShape}
                  box={gestures.previewBox}
                  anchor={gestures.previewAnchor}
                />
              )}
              <MarqueeRect box={gestures.marqueeBox} />
              <SnapGuides
                x={gestures.guideX}
                y={gestures.guideY}
                extent={{ widthMm: geom.widthMm, heightMm: geom.heightMm, bleedMm: geom.bleedMm }}
              />
            </Group>
          </Layer>
        </Stage>
      )}
      <SizeReadout readout={gestures.readout} />
    </div>
  );
});
