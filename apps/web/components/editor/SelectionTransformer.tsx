'use client';

/**
 * The resize handles — a thin adapter between Konva's Transformer and the
 * `ResizeSession` (Slice D stage 5, plan §4.1–§4.2, §4.4, §4.7).
 *
 * It decides nothing. Konva's callbacks are passed straight to the session,
 * which owns the threshold, segments, the Q7 ratio clamp, the bounded box,
 * the payload, cancel and the key guard:
 *
 *   transformstart       → host.begin(...)  (only when `resizeMayStart`)
 *   anchorDragBoundFunc  → session.anchorBound(oldAbs, newAbs, pointer, mods, activeAnchor)
 *   boundBoxFunc         → session.boxBound(oldBox, newBox, activeAnchor, mods)
 *   transform            → the node's attributes = nodeAttrsFor(payload), scale 1
 *   transformend         → session.transformEnd(hadMouseUp) — on the TRANSFORMER (F4): a real
 *                          mouseup releases; an eventless stopTransform/destroy cancels
 *
 * When the session cancels (Escape, blur, readOnly, eventless transformend),
 * this stops Konva's transform too, then writes the element's CURRENT model
 * geometry (scale 1) back onto the live node and re-fits the handles. The
 * adapter's `transform` writes are imperative; react-konva re-applies only
 * props that changed, and React may coalesce the preview and its clearing so
 * that no prop changes at all — so a cancel must not rely on a render to
 * undo them (stage 5 correction, Codex finding 1). "Current" means the
 * element in the latest rendered document (`elementById`), never the
 * geometry captured at the press; a newer document that has not rendered yet
 * reaches the node as changed props when it does.
 *
 * Under Hand or Space the handles stay visible but do not
 * listen (D-4), and an anchor cursor left on Konva's inner element is
 * cleared (§4.7: the only write to it outside Konva, and it only clears).
 *
 * Konva's own options are set explicitly (its defaults are keepRatio,
 * flip and rotate ON). Ratio comes from Shift through Konva's
 * `keepProportion = keepRatio() || evt.shiftKey` and the session's own
 * `keepProportions || shift`; the Keep proportions toggle is stage 6.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Transformer } from 'react-konva';
import type Konva from 'konva';
import type { Box } from 'konva/lib/shapes/Transformer';
import type { Vector2d } from 'konva/lib/types';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { EditorElement, ResizeAnchor } from '@baxter/domain';
import { nodeAttrsFor } from './node-attrs';
import { resizeMayStart, type ResizeModifiers } from './resize-session';
import type { ResizeHost } from './use-resize-host';
import type { EditorTool } from './state/editor-ui';

const OXBLOOD = '#8a2820';
const ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];

export type ResizableElement = Extract<EditorElement, { type: 'rect' | 'ellipse' }>;

export interface SelectionTransformerProps {
  /** The one element the handles attach to, or null (no handles). */
  target: ResizableElement | null;
  /** False under Hand or Space (D-4): visible, inactive. */
  active: boolean;
  /** For the defensive start check (the same rule that decides `active`). */
  startContext: { spaceHeld: boolean; tool: EditorTool; readOnly: boolean; selectionCount: number };
  host: ResizeHost;
  /** The element with this id in the latest rendered document, if it is a rect or ellipse — the
   *  authoritative geometry a cancel restores (it may no longer be `target`: a conflict nulls it). */
  elementById: (id: string) => ResizableElement | null;
  /** D-2 Keep proportions — stage 6. False until then. */
  keepProportions?: boolean;
}

export function SelectionTransformer({ target, active, startContext, host, elementById, keepProportions = false }: SelectionTransformerProps) {
  const trRef = useRef<Konva.Transformer | null>(null);
  const mods = useRef<ResizeModifiers>({ shift: false, alt: false });
  const latest = useRef({ target, startContext, keepProportions, elementById });
  latest.current = { target, startContext, keepProportions, elementById };

  // Attach by node id (plan §4.2). The node is rendered by ElementsLayer with `id={element.id}`.
  useLayoutEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = target ? tr.getStage()?.findOne(`#${target.id}`) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [target]);

  // D-4: inactive handles never leave a resize cursor on Konva's inner element (§4.7).
  useEffect(() => {
    if (active || host.liveRef.current) return;
    const content = trRef.current?.getStage()?.content;
    if (content && content.style.cursor) content.style.cursor = '';
  }, [active, host.liveRef]);

  const anchorName = (tr: Konva.Transformer) => tr.getActiveAnchor() as ResizeAnchor;

  function onTransformStart() {
    const tr = trRef.current;
    const { target: t, startContext: c, keepProportions: keep } = latest.current;
    if (!tr) return;
    if (!t || !resizeMayStart({ ...c, locked: t.locked })) {
      tr.stopTransform();
      return;
    }
    const pointer = tr.getStage()?.getPointerPosition() ?? { x: 0, y: 0 };
    host.begin({
      element: t,
      anchor: anchorName(tr),
      pressPoint: { x: pointer.x, y: pointer.y },
      keepProportions: keep,
      onEnded: (end) => {
        if (end.committed) return; // the COMMIT's render carries the new geometry as changed props
        // A cancel ends the session while Konva still holds the press: stop Konva too. Its eventless
        // transformend then reaches an ended session — a no-op.
        if (end.reason !== 'release' && tr.isTransforming()) tr.stopTransform();
        restoreLiveNode(tr, t.id);
      },
    });
  }

  /** Write the element's current model geometry (scale 1) onto its live node; re-fit the handles. */
  function restoreLiveNode(tr: Konva.Transformer, id: string) {
    const current = latest.current.elementById(id);
    const node = tr.getStage()?.findOne(`#${id}`);
    if (!node || !current) return; // the element is gone: its node is unmounted with it
    node.setAttrs(nodeAttrsFor(current.type, current));
    tr.forceUpdate();
    tr.getLayer()?.batchDraw();
  }

  function anchorDragBoundFunc(oldAbs: Vector2d, newAbs: Vector2d, evt: MouseEvent) {
    const tr = trRef.current;
    const s = host.liveRef.current;
    if (!tr || !s) return oldAbs;
    mods.current = { shift: !!evt?.shiftKey, alt: !!evt?.altKey };
    const pointer = tr.getStage()?.getPointerPosition() ?? newAbs;
    return s.anchorBound(oldAbs, newAbs, pointer, mods.current, anchorName(tr));
  }

  function boundBoxFunc(oldBox: Box, newBox: Box) {
    const tr = trRef.current;
    const s = host.liveRef.current;
    if (!tr || !s) return oldBox;
    // Konva has already renamed the anchor on a negative extent; read it now (§4.1).
    return s.boxBound(oldBox, newBox, anchorName(tr), mods.current) as Box;
  }

  function onTransform() {
    const tr = trRef.current;
    const s = host.liveRef.current;
    const t = latest.current.target;
    if (!tr || !s || !t) return;
    const node = tr.nodes()[0];
    if (node) node.setAttrs(nodeAttrsFor(t.type, s.snapshot().payload));
  }

  function onTransformEnd(e: KonvaEventObject<Event>) {
    host.liveRef.current?.transformEnd(e.evt !== undefined && e.evt !== null);
  }

  return (
    <Transformer
      ref={trRef}
      listening={active}
      rotateEnabled={false}
      flipEnabled={false}
      keepRatio={keepProportions}
      shiftBehavior="default"
      centeredScaling={false}
      ignoreStroke
      padding={0}
      borderEnabled={false}
      enabledAnchors={ANCHORS}
      anchorSize={7}
      anchorStroke={OXBLOOD}
      anchorFill="#ffffff"
      anchorCornerRadius={2}
      anchorDragBoundFunc={anchorDragBoundFunc}
      boundBoxFunc={boundBoxFunc}
      onTransformStart={onTransformStart}
      onTransform={onTransform}
      onTransformEnd={onTransformEnd}
    />
  );
}
