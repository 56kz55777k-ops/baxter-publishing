/**
 * The cursor resolver's priority chain (contract #21) as a pure function, so
 * the table is testable without mounting Konva. SpreadStage remains the ONE
 * writer: it calls this and writes the result to the OUTER wrapper, pre-paint.
 *
 * Chain for the surfaces that exist through Slice C:
 *   object drag (`move`, held across anything the pointer crosses)
 *   → active pan (grabbing) → hand available (grab, outranks hover)
 *   → creation tool (crosshair, stable through the gesture)
 *   → marquee / other gesture (default, stable)
 *   → object hover (`move` unlocked / default locked — lock looked up live)
 *   → default.
 */
export interface CursorInputs {
  dragging: boolean;
  panning: boolean;
  handAvailable: boolean;
  creationTool: boolean;
  gestureActive: boolean;
  /** The hovered object's live lock state, or undefined when nothing is hovered. */
  hoveredLocked: boolean | undefined;
}

export function resolveCursor(c: CursorInputs): 'move' | 'grabbing' | 'grab' | 'crosshair' | 'default' {
  if (c.dragging) return 'move';
  if (c.panning) return 'grabbing';
  if (c.handAvailable) return 'grab';
  if (c.creationTool) return 'crosshair';
  if (c.gestureActive) return 'default';
  if (c.hoveredLocked === undefined) return 'default';
  return c.hoveredLocked ? 'default' : 'move';
}
