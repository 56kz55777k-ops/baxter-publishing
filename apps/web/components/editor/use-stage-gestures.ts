'use client';

/**
 * The stage's pointer state machine: shape creation, click selection and
 * marquee (contracts #3, #4, #6).
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
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildTargets,
  newEllipseElement,
  newRectElement,
  quantizeCreate,
  snapCreationAxis,
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

export interface ElementBox {
  id: string;
  locked: boolean;
  /** Unit-space, normalised (positive width/height). */
  box: Box;
}

type Gesture =
  | { kind: 'create'; shape: 'rect' | 'ellipse'; anchor: { x: number; y: number }; pageIndex: number }
  | { kind: 'marquee'; anchor: { x: number; y: number }; additive: boolean };

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
  /** The stage wrapper — window-level listeners convert client coords against it. */
  hostRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  onCreate: (pageIndex: number, element: EditorElement, label: string) => void;
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
    hostRef,
    enabled,
    onCreate,
    onSelect,
    onToggleSelect,
    onAddSelect,
    onClearSelection,
  } = args;

  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

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

  const reset = useCallback(() => {
    setGesture(null);
    setCurrent(null);
    setGuides({ x: null, y: null });
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
          {
            pageWidthMm: pageWidthMm(g),
            pageHeightMm: g.heightMm,
            pageOffsetsMm: g.pageOffsetsMm,
            marginMm: g.marginMm,
          },
          boxesRef.current.map((b): SnapBox => b.box)
        );
        setGesture({ kind: 'create', shape: tool, anchor: unit, pageIndex });
        setCurrent(unit);
        return;
      }

      if (tool !== 'select') return;

      if (hitElementId) {
        if (shiftKey) onToggleSelect([hitElementId]);
        else onSelect([hitElementId]);
        return;
      }

      // Empty page or pasteboard: a marquee that may turn out to be a click.
      setGesture({ kind: 'marquee', anchor: unit, additive: shiftKey });
      setCurrent(unit);
    },
    [enabled, tool, onSelect, onToggleSelect]
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
  }, [gesture, reset, hostRef, onCreate, onSelect, onAddSelect, onClearSelection]);

  // Escape cancels an in-flight gesture without committing.
  useEffect(() => {
    if (!gesture) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') reset();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gesture, reset]);

  const creating = gesture?.kind === 'create' ? gesture : null;
  const marqueeing = gesture?.kind === 'marquee' ? gesture : null;
  const liveBox = gesture && current ? normalizedBox(gesture.anchor, current) : null;
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
