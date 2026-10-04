'use client';

/**
 * The stage's pointer state machine: shape creation, click selection,
 * marquee, and object drag (contracts #3, #4, #6, #7, #8).
 *
 * Everything this hook holds is transient. The anchor, the live box, the snap
 * guides and the marquee live in refs and local state that exist only between
 * mousedown and mouseup; the document is touched exactly once, at the commit
 * boundary, through the caller's `onCreate`. That is why no preview frame can
 * reach history or autosave — not by discipline, but because `state.doc` keeps
 * its reference until the single COMMIT (ADR-003 §4).
 *
 * Window-level move/up listeners mirror the pan gesture's existing shape in
 * SpreadStage, including blur cancellation: losing the window ends a gesture
 * without committing anything.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildTargets,
  dragDelta,
  newEllipseElement,
  newRectElement,
  quantizeCreate,
  snapCreationAxis,
  snapUnion,
  unionBox,
  type EditorElement,
  type EditorPage,
  type SnapBox,
  type SnapTargets,
} from '@baxter/domain';
import {
  pageBoxToUnit,
  pageIndexForUnitX,
  pageWidthMm,
  screenToUnitMm,
  unitToPageMm,
  type UnitGeometry,
} from './geometry';
import type { ViewTransform } from './state/editor-ui';
import type { Box } from './StageOverlays';

/** Contract #3: a drag under this is a click, creating the default-size element. */
export const CREATE_CLICK_THRESHOLD_MM = 3;
/** Contract #6: marquee movement under this is a click (deselect). */
export const MARQUEE_CLICK_THRESHOLD_MM = 2;
/** Contract #11: shapes are at least this per axis. Applied to the preview so preview == commit. */
export const MIN_SHAPE_MM = 4;
/**
 * A press on an object becomes a drag only once the pointer has travelled
 * this far on screen — a click with hand jitter must never move (or snap)
 * anything. Screen px, so it feels the same at every zoom.
 */
export const DRAG_THRESHOLD_PX = 3;

export interface ElementBox {
  id: string;
  locked: boolean;
  /** Unit-space, normalised (positive width/height). */
  box: Box;
}

type Gesture =
  | { kind: 'create'; shape: 'rect' | 'ellipse'; anchor: { x: number; y: number }; pageIndex: number }
  | { kind: 'marquee'; anchor: { x: number; y: number }; additive: boolean }
  | {
      kind: 'drag';
      anchor: { x: number; y: number };
      /** Screen-px press point — the drag threshold is measured on screen. */
      screen: { x: number; y: number };
      /** The unlocked members that move (#7, #20). */
      ids: readonly string[];
      /** Their union box at press, unit space (#8). */
      union: Box;
      /** The pressed object; a click without movement narrows to it. */
      pressedId: string;
      narrowOnClick: boolean;
    };

/** The live, not-yet-committed offset of a drag. Preview == commit (C-1). */
export interface DragPreview {
  ids: ReadonlySet<string>;
  dx: number;
  dy: number;
}

export interface StageGestures {
  /** Live creation box in unit space, or null. */
  previewBox: Box | null;
  previewShape: 'rect' | 'ellipse' | null;
  previewAnchor: { x: number; y: number } | null;
  marqueeBox: Box | null;
  guideX: number | null;
  guideY: number | null;
  /** `W × H mm` readout content while creating, or null. */
  readout: { widthMm: number; heightMm: number } | null;
  /** The moving set and its shared delta while a drag is past its threshold. */
  dragPreview: DragPreview | null;
  /** True from the moment a drag passes its threshold until it ends (#21: `move`, held). */
  dragging: boolean;
  onStagePointerDown: (screen: { x: number; y: number }, shiftKey: boolean, hitElementId: string | null) => void;
  cancel: () => void;
  active: boolean;
}

/** Normalised unit-space boxes for every element of the unit's pages. */
export function elementBoxes(pages: readonly EditorPage[], geom: UnitGeometry): ElementBox[] {
  const out: ElementBox[] = [];
  pages.forEach((page, pageIndex) => {
    for (const el of page.elements) {
      const box = boxOf(el);
      if (!box) continue;
      out.push({ id: el.id, locked: el.locked, box: pageBoxToUnit(geom, pageIndex, box) });
    }
  });
  return out;
}

function boxOf(el: EditorElement): Box | null {
  if (el.type === 'rect' || el.type === 'ellipse' || el.type === 'image') {
    return { x: el.x, y: el.y, width: el.width, height: el.height };
  }
  if (el.type === 'line') {
    // Signed deltas — normalise so intersection maths stays simple.
    return {
      x: Math.min(el.x, el.x + el.width),
      y: Math.min(el.y, el.y + el.height),
      width: Math.abs(el.width),
      height: Math.abs(el.height),
    };
  }
  return null; // text has no stored height (contract #15) — Slice G supplies it
}

export function rectsIntersect(a: Box, b: Box): boolean {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}

export function useStageGestures(args: {
  geom: UnitGeometry;
  view: ViewTransform;
  tool: 'select' | 'hand' | 'rect' | 'ellipse';
  boxes: readonly ElementBox[];
  /** The current selection — a press on a selected member drags the whole set. */
  selection: readonly string[];
  /** The stage wrapper — window-level listeners convert client coords against it. */
  hostRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  onCreate: (pageIndex: number, element: EditorElement, label: string) => void;
  /** One drag session → one call → one COMMIT (#7, #24). Never called for a zero delta. */
  onMove: (ids: readonly string[], dx: number, dy: number) => void;
  onSelect: (ids: readonly string[]) => void;
  onToggleSelect: (ids: readonly string[]) => void;
  /** Union into the selection — the additive marquee (#6). */
  onAddSelect: (ids: readonly string[]) => void;
  onClearSelection: () => void;
}): StageGestures {
  const {
    geom,
    view,
    tool,
    boxes,
    selection,
    hostRef,
    enabled,
    onCreate,
    onMove: onMoveCommit,
    onSelect,
    onToggleSelect,
    onAddSelect,
    onClearSelection,
  } = args;

  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);

  // Refs keep the window listeners stable and free of stale closures.
  const gestureRef = useRef<Gesture | null>(null);
  gestureRef.current = gesture;
  const viewRef = useRef(view);
  viewRef.current = view;
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const targetsRef = useRef<SnapTargets>({ x: [], y: [] });
  const currentRef = useRef<{ x: number; y: number } | null>(null);
  currentRef.current = current;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  dragRef.current = drag;

  const reset = useCallback(() => {
    setGesture(null);
    setCurrent(null);
    setGuides({ x: null, y: null });
    setDrag(null);
  }, []);

  const snapGeometry = useCallback(() => {
    const g = geomRef.current;
    return { pageWidthMm: pageWidthMm(g), pageHeightMm: g.heightMm, pageOffsetsMm: g.pageOffsetsMm, marginMm: g.marginMm };
  }, []);

  const onStagePointerDown = useCallback(
    (screen: { x: number; y: number }, shiftKey: boolean, hitElementId: string | null) => {
      if (!enabled) return;
      const g = geomRef.current;
      const unit = screenToUnitMm(viewRef.current, screen);

      if (tool === 'rect' || tool === 'ellipse') {
        const pageIndex = pageIndexForUnitX(g, unit.x);
        // Targets are computed once per gesture: the set cannot change while
        // the pointer is down, and recomputing per move would be wasteful.
        targetsRef.current = buildTargets(
          snapGeometry(),
          boxesRef.current.map((b): SnapBox => b.box)
        );
        setGesture({ kind: 'create', shape: tool, anchor: unit, pageIndex });
        setCurrent(unit);
        return;
      }

      if (tool !== 'select') return;

      if (hitElementId) {
        if (shiftKey) {
          onToggleSelect([hitElementId]); // #5: Shift-click toggles; it never drags
          return;
        }
        const sel = selectionRef.current;
        const wasSelected = sel.includes(hitElementId);
        // Pressing an unselected object selects it alone and drags it alone;
        // pressing a selected one drags the whole set (#7) and only narrows
        // the selection if the press turns out to be a click.
        if (!wasSelected) onSelect([hitElementId]);
        const all = boxesRef.current;
        const pressed = all.find((b) => b.id === hitElementId);
        // Locked: selectable, never draggable (#20). Nothing moves.
        if (!pressed || pressed.locked) return;
        const memberIds = wasSelected ? sel : [hitElementId];
        const movers = all.filter((b) => memberIds.includes(b.id) && !b.locked);
        const union = unionBox(movers.map((b) => b.box));
        if (!union) return;
        const moving = new Set(movers.map((b) => b.id));
        // Targets: page geometry + every element NOT moving — locked ones
        // included (#20: locked elements are snap targets).
        targetsRef.current = buildTargets(
          snapGeometry(),
          all.filter((b) => !moving.has(b.id)).map((b): SnapBox => b.box)
        );
        setGesture({
          kind: 'drag',
          anchor: unit,
          screen,
          ids: movers.map((b) => b.id),
          union,
          pressedId: hitElementId,
          narrowOnClick: wasSelected && sel.length > 1,
        });
        setCurrent(unit);
        return;
      }

      // Empty page or pasteboard: a marquee that may turn out to be a click.
      setGesture({ kind: 'marquee', anchor: unit, additive: shiftKey });
      setCurrent(unit);
    },
    [enabled, tool, onSelect, onToggleSelect, snapGeometry]
  );

  useEffect(() => {
    if (!gesture) return;

    function pointFromEvent(ev: MouseEvent): { x: number; y: number } {
      // The stage fills its wrapper, so stage coords are client coords minus
      // the wrapper's origin. Konva's own pointer position is unavailable to
      // window-level listeners, which is why the gesture keeps a host ref.
      const rect = hostRef.current?.getBoundingClientRect();
      return { x: ev.clientX - (rect?.left ?? 0), y: ev.clientY - (rect?.top ?? 0) };
    }

    function onMove(ev: MouseEvent) {
      const g = gestureRef.current;
      if (!g) return;
      const unit = screenToUnitMm(viewRef.current, pointFromEvent(ev));

      if (g.kind === 'create') {
        const sx = snapCreationAxis(g.anchor.x, unit.x, targetsRef.current.x);
        const sy = snapCreationAxis(g.anchor.y, unit.y, targetsRef.current.y);
        setCurrent({ x: unit.x + (sx?.delta ?? 0), y: unit.y + (sy?.delta ?? 0) });
        setGuides({ x: sx?.guide ?? null, y: sy?.guide ?? null });
      } else if (g.kind === 'drag') {
        const p = pointFromEvent(ev);
        if (!dragRef.current && Math.hypot(p.x - g.screen.x, p.y - g.screen.y) < DRAG_THRESHOLD_PX) return;
        performance.mark('baxter:editor:drag-move');
        // The union box snaps (#8); the SAME delta function previews and
        // commits, so what is shown at release is exactly what is written.
        const rawX = unit.x - g.anchor.x;
        const rawY = unit.y - g.anchor.y;
        const snap = snapUnion(
          { x: g.union.x + rawX, y: g.union.y + rawY, width: g.union.width, height: g.union.height },
          targetsRef.current
        );
        setDrag({ dx: dragDelta(rawX, snap.x), dy: dragDelta(rawY, snap.y) });
        setGuides({ x: snap.x?.guide ?? null, y: snap.y?.guide ?? null });
      } else {
        setCurrent(unit);
      }
    }

    function onUp() {
      const g = gestureRef.current;
      const end = currentRef.current;
      if (!g || !end) {
        reset();
        return;
      }

      if (g.kind === 'drag') {
        const d = dragRef.current;
        if (d && (d.dx !== 0 || d.dy !== 0)) onMoveCommit(g.ids, d.dx, d.dy);
        else if (!d && g.narrowOnClick) onSelect([g.pressedId]); // a click on a member of a set
        reset();
        return;
      }

      if (g.kind === 'create') {
        const dx = Math.abs(end.x - g.anchor.x);
        const dy = Math.abs(end.y - g.anchor.y);
        const tiny = Math.max(dx, dy) < CREATE_CLICK_THRESHOLD_MM;
        const gm = geomRef.current;

        const unitBox = tiny ? null : normalizedBox(g.anchor, end);
        const at = unitToPageMm(gm, g.pageIndex, tiny ? g.anchor : { x: unitBox!.x, y: unitBox!.y });

        const base =
          g.shape === 'rect'
            ? newRectElement({ x: quantizeCreate(at.x), y: quantizeCreate(at.y) })
            : newEllipseElement({ x: quantizeCreate(at.x), y: quantizeCreate(at.y) });

        const element: EditorElement = tiny
          ? base
          : {
              ...base,
              width: quantizeCreate(Math.max(MIN_SHAPE_MM, unitBox!.width)),
              height: quantizeCreate(Math.max(MIN_SHAPE_MM, unitBox!.height)),
            };

        onCreate(g.pageIndex, element, g.shape === 'rect' ? 'Create rectangle' : 'Create ellipse');
        reset();
        return;
      }

      const dx = Math.abs(end.x - g.anchor.x);
      const dy = Math.abs(end.y - g.anchor.y);
      if (Math.max(dx, dy) < MARQUEE_CLICK_THRESHOLD_MM) {
        // A click on empty space: deselect (contract #6). Shift-click on empty
        // space leaves the existing set alone rather than clearing it.
        if (!g.additive) onClearSelection();
        reset();
        return;
      }

      // Release selects every element whose bounds INTERSECT the marquee —
      // not full enclosure (contract #6). Locked elements are selectable
      // (contract #20), so they are not filtered out here.
      const area = normalizedBox(g.anchor, end);
      const hits = boxesRef.current.filter((b) => rectsIntersect(area, b.box)).map((b) => b.id);
      // Shift-marquee ADDS (#6): a toggle here would deselect hits that were
      // already selected. Shift-click alone is the toggle (#5).
      if (g.additive) onAddSelect(hits);
      else onSelect(hits);
      reset();
    }

    function onBlur() {
      reset(); // a lost window cancels the gesture; nothing is committed
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [gesture, reset, hostRef, onCreate, onMoveCommit, onSelect, onAddSelect, onClearSelection]);

  // Escape cancels an in-flight gesture without committing.
  useEffect(() => {
    if (!gesture) return;
    const isDrag = gesture.kind === 'drag';
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== 'Escape') return;
      if (isDrag) {
        // Decision 2 (2026-10-04): Escape during a drag cancels ONLY the drag
        // and keeps the selection. Captured on window ahead of the shell's
        // keyboard handler, whose resting-state Escape deselects — one
        // meaning per press. The next Escape deselects as usual.
        ev.stopImmediatePropagation();
        ev.preventDefault();
      }
      reset();
    }
    // Capture phase only for drag; creation/marquee keep Slice B's behaviour.
    window.addEventListener('keydown', onKey, isDrag);
    return () => window.removeEventListener('keydown', onKey, isDrag);
  }, [gesture, reset]);

  const creating = gesture?.kind === 'create' ? gesture : null;
  const marqueeing = gesture?.kind === 'marquee' ? gesture : null;
  const dragging = gesture?.kind === 'drag' && drag !== null ? gesture : null;
  const liveBox = gesture && current && gesture.kind !== 'drag' ? normalizedBox(gesture.anchor, current) : null;
  const dragIds = dragging?.ids;
  const dragPreview = useMemo(
    () => (dragIds && drag ? { ids: new Set(dragIds), dx: drag.dx, dy: drag.dy } : null),
    [dragIds, drag]
  );
  const previewBox =
    creating && liveBox
      ? {
          ...liveBox,
          width: Math.max(MIN_SHAPE_MM, liveBox.width),
          height: Math.max(MIN_SHAPE_MM, liveBox.height),
        }
      : null;

  return {
    previewBox,
    previewShape: creating?.shape ?? null,
    previewAnchor: creating?.anchor ?? null,
    marqueeBox: marqueeing && liveBox ? liveBox : null,
    guideX: guides.x,
    guideY: guides.y,
    readout: previewBox ? { widthMm: previewBox.width, heightMm: previewBox.height } : null,
    dragPreview,
    dragging: dragging !== null,
    onStagePointerDown,
    cancel: reset,
    active: gesture !== null,
  };
}

function normalizedBox(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
