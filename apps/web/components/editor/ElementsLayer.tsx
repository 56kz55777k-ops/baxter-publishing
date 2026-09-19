'use client';

/**
 * The publication's elements (Slice B: rect + ellipse).
 *
 * This layer is presentation only. It maps document elements to Konva nodes
 * and reports pointer-downs upward by id; it holds no document semantics, no
 * geometry maths and no selection logic. Element meaning lives in the pure
 * helpers in `@baxter/domain` (ADR-003 §1), which keeps the renderer
 * survivable if Konva is ever swapped (Risk 11).
 *
 * Elements are stored page-relative (contract #1) and drawn in unit space by
 * offsetting each page's group — so an element whose `x` exceeds its page
 * width simply renders across the gutter, which is the accepted cross-gutter
 * behaviour (contract #2), not a special case.
 *
 * Z-order is the element array's order (Part 5); Konva draws in child order,
 * so the two agree without an index field.
 */
import { memo } from 'react';
import { Ellipse, Group, Rect } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { EditorElement, EditorPage } from '@baxter/domain';
import type { UnitGeometry } from './geometry';

export const ElementsLayer = memo(function ElementsLayer({
  pages,
  geom,
  onElementPointerDown,
  onHoverChange,
}: {
  pages: readonly EditorPage[];
  geom: UnitGeometry;
  onElementPointerDown: (id: string, e: KonvaEventObject<MouseEvent>) => void;
  /** Hover reports only the id — lock state is looked up live (contract #21). */
  onHoverChange: (id: string | null) => void;
}) {
  return (
    <>
      {pages.map((page, pageIndex) => (
        <Group key={page.id} x={geom.pageOffsetsMm[pageIndex] ?? 0}>
          {page.elements.map((el) => (
            <ElementNode
              key={el.id}
              element={el}
              onPointerDown={onElementPointerDown}
              onHoverChange={onHoverChange}
            />
          ))}
        </Group>
      ))}
    </>
  );
});

const ElementNode = memo(function ElementNode({
  element,
  onPointerDown,
  onHoverChange,
}: {
  element: EditorElement;
  onPointerDown: (id: string, e: KonvaEventObject<MouseEvent>) => void;
  onHoverChange: (id: string | null) => void;
}) {
  const handleDown = (e: KonvaEventObject<MouseEvent>) => onPointerDown(element.id, e);
  const handleEnter = () => onHoverChange(element.id);
  const handleLeave = () => onHoverChange(null);

  if (element.type === 'rect') {
    return (
      <Rect
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        fill={element.fill}
        // `stroke: null` is None — Konva must receive undefined, not null,
        // or it paints a default hairline (contract #18: None ≠ thin).
        stroke={element.stroke ?? undefined}
        strokeWidth={element.stroke === null ? 0 : element.strokeWidth}
        cornerRadius={element.cornerRadius}
        opacity={element.opacity}
        onMouseDown={handleDown}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        perfectDrawEnabled={false}
      />
    );
  }

  if (element.type === 'ellipse') {
    // Konva's Ellipse is centre-origin; the model is top-left like every
    // other element, so the conversion happens here and nowhere else.
    return (
      <Ellipse
        x={element.x + element.width / 2}
        y={element.y + element.height / 2}
        radiusX={element.width / 2}
        radiusY={element.height / 2}
        fill={element.fill}
        stroke={element.stroke ?? undefined}
        strokeWidth={element.stroke === null ? 0 : element.strokeWidth}
        opacity={element.opacity}
        onMouseDown={handleDown}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        perfectDrawEnabled={false}
      />
    );
  }

  // image / text / line arrive in Slices E, G and H. Rendering nothing is
  // deliberate: a document containing them stays loadable and saveable, and
  // no half-built renderer ships early.
  return null;
});
