/**
 * The cursor resolver's priority chain (contract #21) as a pure function, so
 * the table is testable without mounting Konva. SpreadStage remains the ONE
 * writer: it calls this and writes the result to the OUTER wrapper, pre-paint.
 *
 * Chain for the surfaces that exist through Slice D:
 *   resize (the active anchor's directional cursor, held — Slice D plan §4.7)
 *   / object drag (`move`, held across anything the pointer crosses)
 *   → active pan (grabbing) → hand available (grab, outranks hover)
 *   → creation tool (crosshair, stable through the gesture)
 *   → marquee / other gesture (default, stable)
 *   → object hover (`move` unlocked / default locked — lock looked up live)
 *   → default.
 */
export type ResizeCursorName = 'nwse-resize' | 'nesw-resize' | 'ns-resize' | 'ew-resize';

export interface CursorInputs {
  /** A live resize session's cursor (from the anchor at its press), or null/absent. Outranks everything. */
  resizing?: ResizeCursorName | null;
  dragging: boolean;
  panning: boolean;
  handAvailable: boolean;
  creationTool: boolean;
  gestureActive: boolean;
  /** The hovered object's live lock state, or undefined when nothing is hovered. */
  hoveredLocked: boolean | undefined;
}

export function resolveCursor(c: CursorInputs): ResizeCursorName | 'move' | 'grabbing' | 'grab' | 'crosshair' | 'default' {
  if (c.resizing) return c.resizing;
  if (c.dragging) return 'move';
  if (c.panning) return 'grabbing';
  if (c.handAvailable) return 'grab';
  if (c.creationTool) return 'crosshair';
  if (c.gestureActive) return 'default';
  if (c.hoveredLocked === undefined) return 'default';
  return c.hoveredLocked ? 'default' : 'move';
}
