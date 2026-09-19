'use client';

/**
 * Transient stage overlays — selection outline, creation preview, marquee and
 * snap guides.
 *
 * Everything here is drawn from state that exists only between mousedown and
 * mouseup (or from the UI context's selection), never from the document. None
 * of it can reach history or autosave: the document reference is untouched
 * while these render, which is exactly what the commit observer keys off
 * (contracts #24, #25). Grouped in one module because they share that single
 * property — they are the editor's chrome on the canvas, not its content.
 *
 * Hairlines use `strokeScaleEnabled={false}` so guides stay one screen pixel
 * at every zoom, matching StageGuides.
 */
import { Ellipse, Line, Rect } from 'react-konva';

const OXBLOOD = '#8a2820';
const SELECTION = 'rgba(138, 40, 32, 0.85)';
const MARQUEE = 'rgba(26, 26, 26, 0.55)';
const PREVIEW_FILL = 'rgba(26, 26, 26, 0.08)';
const PREVIEW_LINE = 'rgba(26, 26, 26, 0.45)';
const ANCHOR = 'rgba(26, 26, 26, 0.65)';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Selection outline. Rendered only while the Select tool is active — a creation
 * tool hides the affordance while the selection itself persists underneath
 * (contract #4). Locked elements keep the outline and gain the badge; Slice B
 * shows the outline, and the Locked identity lives in the inspector.
 */
export function SelectionOutlines({ boxes }: { boxes: readonly Box[] }) {
  return (
    <>
      {boxes.map((b, i) => (
        <Rect
          key={i}
          x={b.x}
          y={b.y}
          width={b.width}
          height={b.height}
          stroke={SELECTION}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          listening={false}
        />
      ))}
    </>
  );
}

/** The live creation draft: anchor dot plus the previewed shape. */
export function CreationPreview({
  shape,
  box,
  anchor,
}: {
  shape: 'rect' | 'ellipse';
  box: Box | null;
  anchor: { x: number; y: number } | null;
}) {
  return (
    <>
      {anchor && (
        <Rect
          x={anchor.x - 0.6}
          y={anchor.y - 0.6}
          width={1.2}
          height={1.2}
          fill={ANCHOR}
          listening={false}
        />
      )}
      {box &&
        (shape === 'rect' ? (
          <Rect
            {...box}
            fill={PREVIEW_FILL}
            stroke={PREVIEW_LINE}
            strokeWidth={1}
            strokeScaleEnabled={false}
            listening={false}
          />
        ) : (
          <Ellipse
            x={box.x + box.width / 2}
            y={box.y + box.height / 2}
            radiusX={box.width / 2}
            radiusY={box.height / 2}
            fill={PREVIEW_FILL}
            stroke={PREVIEW_LINE}
            strokeWidth={1}
            strokeScaleEnabled={false}
            listening={false}
          />
        ))}
    </>
  );
}

/** The quiet dashed marquee (contract #6). */
export function MarqueeRect({ box }: { box: Box | null }) {
  if (!box) return null;
  return (
    <Rect
      {...box}
      stroke={MARQUEE}
      dash={[3, 3]}
      strokeWidth={1}
      strokeScaleEnabled={false}
      listening={false}
    />
  );
}

/**
 * Thin oxblood guide lines while a snap is engaged; they vanish at release
 * (contract #8). Guides span the whole unit's bleed box so the alignment they
 * describe is visible across the gutter.
 */
export function SnapGuides({
  x,
  y,
  extent,
}: {
  x: number | null;
  y: number | null;
  extent: { widthMm: number; heightMm: number; bleedMm: number };
}) {
  const x0 = -extent.bleedMm;
  const x1 = extent.widthMm + extent.bleedMm;
  const y0 = -extent.bleedMm;
  const y1 = extent.heightMm + extent.bleedMm;
  return (
    <>
      {x !== null && (
        <Line
          points={[x, y0, x, y1]}
          stroke={OXBLOOD}
          strokeWidth={1}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      {y !== null && (
        <Line
          points={[x0, y, x1, y]}
          stroke={OXBLOOD}
          strokeWidth={1}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
    </>
  );
}
