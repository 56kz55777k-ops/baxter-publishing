/**
 * One mapping from model geometry to Konva node attributes (Slice D plan
 * §4.3 `nodeAttrsFor`). `ElementsLayer` renders with it and the resize
 * adapter re-applies it to the live node on every Transformer `transform`,
 * so the preview a resize draws and the element it commits can never be two
 * different calculations. Scale is always 1: Konva's Transformer scales the
 * node while it fits it into the bounded box, and that scale is replaced by
 * real width/height (or radii), so stroke and corner radius never scale.
 *
 * Geometry is the model's: page-relative mm, top-left origin (contract #1).
 * Konva's Ellipse is centre-origin, so the conversion happens here and
 * nowhere else.
 */
import type { StoredGeometry } from '@baxter/domain';

export interface RectNodeAttrs { x: number; y: number; width: number; height: number; scaleX: 1; scaleY: 1 }
export interface EllipseNodeAttrs { x: number; y: number; radiusX: number; radiusY: number; scaleX: 1; scaleY: 1 }

/** `dx`/`dy`: Slice C's transient drag offset (zero for a resize preview). */
export function rectNodeAttrs(g: StoredGeometry, dx = 0, dy = 0): RectNodeAttrs {
  return { x: g.x + dx, y: g.y + dy, width: g.width, height: g.height, scaleX: 1, scaleY: 1 };
}

export function ellipseNodeAttrs(g: StoredGeometry, dx = 0, dy = 0): EllipseNodeAttrs {
  return { x: g.x + dx + g.width / 2, y: g.y + dy + g.height / 2, radiusX: g.width / 2, radiusY: g.height / 2, scaleX: 1, scaleY: 1 };
}

/** The one dispatch both the renderer and the resize adapter use. */
export function nodeAttrsFor(type: 'rect' | 'ellipse', g: StoredGeometry, dx = 0, dy = 0): RectNodeAttrs | EllipseNodeAttrs {
  return type === 'rect' ? rectNodeAttrs(g, dx, dy) : ellipseNodeAttrs(g, dx, dy);
}
