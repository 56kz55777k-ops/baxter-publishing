'use client';

/**
 * The unit's paper and guide geometry, in mm space inside the view-transform
 * group: paper (bleed box) with lift, bleed edge, per-page trim / margin /
 * safe rectangles, and the gutter line between spread pages. Hairlines keep
 * constant screen width (strokeScaleEnabled false); nothing here listens.
 */
import { Group, Line, Rect } from 'react-konva';
import type { UnitGeometry } from './geometry';

const PAPER = '#fdfcf9';
const TRIM_LINE = 'rgba(26, 26, 26, 0.32)';
const BLEED_LINE = 'rgba(26, 26, 26, 0.10)';
const MARGIN_LINE = 'rgba(138, 40, 32, 0.30)';
const SAFE_LINE = 'rgba(26, 26, 26, 0.14)';
const GUTTER_LINE = 'rgba(26, 26, 26, 0.18)';

export function StageGuides({ geom }: { geom: UnitGeometry }) {
  const pageW = geom.widthMm / geom.pageOffsetsMm.length;
  const bleedBox = {
    x: -geom.bleedMm,
    y: -geom.bleedMm,
    width: geom.widthMm + 2 * geom.bleedMm,
    height: geom.heightMm + 2 * geom.bleedMm,
  };

  return (
    <>
      <Rect
        {...bleedBox}
        fill={PAPER}
        shadowColor="rgba(26, 26, 26, 0.28)"
        shadowBlur={4}
        shadowOffsetY={1.2}
      />
      <Rect {...bleedBox} stroke={BLEED_LINE} strokeWidth={1} strokeScaleEnabled={false} />
      {geom.pageOffsetsMm.map((ox, i) => (
        <Group key={i} x={ox}>
          <Rect
            width={pageW}
            height={geom.heightMm}
            stroke={TRIM_LINE}
            strokeWidth={1}
            strokeScaleEnabled={false}
          />
          <Rect
            x={geom.marginMm}
            y={geom.marginMm}
            width={pageW - 2 * geom.marginMm}
            height={geom.heightMm - 2 * geom.marginMm}
            stroke={MARGIN_LINE}
            dash={[4, 3]}
            strokeWidth={1}
            strokeScaleEnabled={false}
          />
          <Rect
            x={geom.safeMm}
            y={geom.safeMm}
            width={pageW - 2 * geom.safeMm}
            height={geom.heightMm - 2 * geom.safeMm}
            stroke={SAFE_LINE}
            dash={[2, 3]}
            strokeWidth={1}
            strokeScaleEnabled={false}
          />
        </Group>
      ))}
      {geom.pageOffsetsMm.length === 2 && (
        <Line
          points={[pageW, 0, pageW, geom.heightMm]}
          stroke={GUTTER_LINE}
          strokeWidth={1}
          strokeScaleEnabled={false}
        />
      )}
    </>
  );
}
