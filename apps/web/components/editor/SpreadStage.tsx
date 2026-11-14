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
import type { EditorElement, EditorPage, StoredGeometry } from '@baxter/domain';
import { resolveCursor } from './cursor';
import { panMayStart } from './resize-session';
import { SelectionTransformer, type ResizableElement } from './SelectionTransformer';
import { useResizeHost } from './use-resize-host';
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
  onResize,
  onSpaceSync,
}: {
  geom: UnitGeometry;
  pages: readonly EditorPage[];
  viewportRef: React.MutableRefObject<ViewportSize>;
  spaceHeld: boolean;
  readOnly: boolean;
  onCreate: (pageIndex: number, element: EditorElement, label: string) => void;
  onMove: (ids: readonly string[], dx: number, dy: number) => void;
  /** Slice D: a resize release's bounded payload → the shell's one COMMIT 'Resize'. */
  onResize: (id: string, payload: StoredGeometry) => void;
  /** Slice D: Space as the resize session saw it at its end (it swallows Space while live). */
  onSpaceSync: (held: boolean) => void;
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

  // --- Slice D resize: the session's owner (behaviour lives in ResizeSession) -------------
  const resize = useResizeHost({
    geom,
    boxes,
    view: ui.view,
    pageIndexOf: (id) => pages.findIndex((p) => p.elements.some((e) => e.id === id)),
    onResize,
    onSpaceSync,
    onRefit: (s) => uiDispatch({ type: 'SET_VIEW', view: fitUnitView(geomRef.current, s.w, s.h) }),
  });
  // Handles: exactly one selected rect/ellipse on the shown unit, unlocked, under Select or Hand,
  // writable (plan §4.2). Under Hand or Space they stay visible but inactive (D-4).
  const resizeTarget = useMemo((): ResizableElement | null => {
    if (readOnly || ui.selection.length !== 1 || (ui.tool !== 'select' && ui.tool !== 'hand')) return null;
    for (const page of pages) {
      const el = page.elements.find((e) => e.id === ui.selection[0]);
      if (el) return (el.type === 'rect' || el.type === 'ellipse') && !el.locked ? el : null;
    }
    return null;
  }, [readOnly, ui.selection, ui.tool, pages]);
  const handlesActive = ui.tool === 'select' && !spaceHeld;
  // readOnly (a save conflict, a closed window) cancels a live resize (§4.4).
  useEffect(() => {
    if (readOnly) resize.liveRef.current?.cancel('readOnly');
  }, [readOnly, resize.liveRef]);

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
  // A live resize defers it: one refit with the latest size after the session ends (§4.6).
  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    if (resize.liveRef.current?.noteViewportSize(size)) return;
    uiDispatch({ type: 'SET_VIEW', view: fitUnitView(geomRef.current, size.w, size.h) });
  }, [size, uiDispatch, resize.liveRef]);

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
      resizing: resize.cursor,
      dragging: gestures.dragging,
      panning,
      handAvailable: spaceHeld || ui.tool === 'hand',
      creationTool: isCreationTool(ui.tool),
      gestureActive: gestures.active,
      hoveredLocked: hovered?.locked,
    });
  }, [resize.cursor, gestures.dragging, panning, spaceHeld, ui.tool, gestures.active, hoverId, boxes]);

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

  // A pan starts only on a new press, never while a resize session lives (Q2 (a), §0.11).
  const panAvailable = panMayStart({ spaceHeld, tool: ui.tool, session: resize.liveRef.current });

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
    // An anchor press belongs to the Transformer: it must never also start a marquee or a pan (§4.7).
    if (e.target.findAncestor?.('Transformer', true)) return;
    if (panMayStart({ spaceHeld, tool: ui.tool, session: resize.liveRef.current })) {
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
    // Viewport freeze (§4.6): from the anchor press, threshold-pending included.
    if (resize.liveRef.current?.handleWheel(e.evt)) return;
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
  // Outlines travel with a drag or resize preview so the selection never lags its objects. They
  // show under Select AND Hand — hidden only under creation tools (#4, D-4; plan §4.8, §11 C3).
  const resizePreview = resize.preview;
  const selectedBoxes = useMemo(
    () =>
      !isCreationTool(ui.tool)
        ? boxes
            .filter((b) => ui.selection.includes(b.id))
            .map((b) => {
              if (resizePreview?.id === b.id) {
                const pi = pages.findIndex((p) => p.elements.some((e) => e.id === b.id));
                return { ...resizePreview.geometry, x: resizePreview.geometry.x + (geom.pageOffsetsMm[pi] ?? 0) };
              }
              return dragPreview?.ids.has(b.id)
                ? { ...b.box, x: b.box.x + dragPreview.dx, y: b.box.y + dragPreview.dy }
                : b.box;
            })
        : [],
    [boxes, ui.selection, ui.tool, dragPreview, resizePreview, pages, geom]
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
                resizePreview={resizePreview ? { id: resizePreview.id, geometry: resizePreview.geometry } : null}
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
                x={gestures.guideX ?? resizePreview?.guideX ?? null}
                y={gestures.guideY ?? resizePreview?.guideY ?? null}
                extent={{ widthMm: geom.widthMm, heightMm: geom.heightMm, bleedMm: geom.bleedMm }}
              />
            </Group>
          </Layer>
          {/* Resize handles: their own listening layer above the overlays, outside the zoomed Group (§4.2). */}
          <Layer>
            <SelectionTransformer
              target={resizeTarget}
              active={handlesActive}
              startContext={{ spaceHeld, tool: ui.tool, readOnly, selectionCount: ui.selection.length }}
              host={resize}
            />
          </Layer>
        </Stage>
      )}
      <SizeReadout
        readout={
          gestures.readout ??
          (resizePreview ? { widthMm: resizePreview.geometry.width, heightMm: resizePreview.geometry.height } : null)
        }
      />
    </div>
  );
});
