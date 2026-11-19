/**
 * Geometry for the selection chrome of Slice D stage 7 (D-6, plan §4.8,
 * implementation choices 10–11). Pure: unit-space mm in, unit-space mm out.
 * Presentation only — nothing here touches the document, selection, history
 * or autosave.
 */
import type { EditorPage } from '@baxter/domain';
import type { UnitGeometry } from './geometry';
import type { Box } from './StageOverlays';

/** The smallest box containing every given box, or null for none. */
export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The top-left of every LOCKED element on the shown unit, in unit-space mm:
 * the displayed bounds' top-left, never a Konva node origin (an ellipse node is
 * centre-origin; a line's stored origin is one endpoint with signed deltas).
 *
 * - rect, ellipse, image: (x, y) — the stored box's top-left.
 * - line: (min(x, x + w), min(y, y + h)) — its normalised bounds.
 * - text: (x, y) — its stored top-left (it has no stored height, so no box).
 *
 * The page offset is added for the element's page in this unit.
 */
export function lockAnchors(pages: readonly EditorPage[], geom: UnitGeometry): { id: string; x: number; y: number }[] {
  const out: { id: string; x: number; y: number }[] = [];
  pages.forEach((page, pageIndex) => {
    const off = geom.pageOffsetsMm[pageIndex] ?? 0;
    for (const el of page.elements) {
      if (!el.locked) continue;
      if (el.type === 'line') {
        out.push({ id: el.id, x: off + Math.min(el.x, el.x + el.width), y: Math.min(el.y, el.y + el.height) });
      } else {
        out.push({ id: el.id, x: off + el.x, y: el.y });
      }
    }
  });
  return out;
}
