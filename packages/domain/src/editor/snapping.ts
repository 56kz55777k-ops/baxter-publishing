/**
 * Snapping — magnetic, not controlling (contract #8).
 *
 * Target set: page edges, page centre-lines, margins, plus every *other*
 * element's edges and centres. Radius 1.6 mm; the nearest target inside the
 * radius wins; a thin oxblood guide renders while a snap is engaged and
 * vanishes at release.
 *
 * All values are unit-space millimetres (the spread's coordinate system, with
 * page 2 at `x + trimWidth`). Callers convert page-relative element geometry
 * to unit space before building targets — the page offset is the only
 * difference and it belongs to the caller, not to this pure module.
 *
 * Why candidates carry a `rate`: a gesture applies ONE delta to the thing it
 * is moving, but several features of the moving box track that delta at
 * different speeds. While drawing a rectangle the anchor edge is pinned, so
 * moving the far edge by `d` moves the far edge by `d` (rate 1) and the box
 * centre by `d/2` (rate 0.5). Snapping a centre to a target therefore needs a
 * different delta than snapping an edge to the same target. Encoding the rate
 * here keeps that arithmetic honest and lets Slice C reuse the same function
 * for whole-box movement, where every feature has rate 1.
 */

export const SNAP_RADIUS_MM = 1.6;

export interface SnapTargets {
  /** Vertical guide lines — x positions in unit space. */
  x: number[];
  /** Horizontal guide lines — y positions in unit space. */
  y: number[];
}

export interface SnapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapGeometry {
  /** Trim width of one page, mm. */
  pageWidthMm: number;
  /** Trim height, mm (all pages of a unit share it). */
  pageHeightMm: number;
  /** X offset of each page's trim origin inside the unit, mm. */
  pageOffsetsMm: readonly number[];
  /** Resolved page margin (D-034), mm in from trim. */
  marginMm: number;
}

/** One feature of the moving box that may snap. */
export interface SnapCandidate {
  /** Current position of the feature, unit-space mm. */
  value: number;
  /** How fast this feature moves per unit of applied delta (1 = edge, 0.5 = centre). */
  rate: number;
}

export interface AxisSnap {
  /** Delta to apply to the gesture's moving value. */
  delta: number;
  /** Where the guide line renders, unit-space mm. */
  guide: number;
}

/**
 * Page geometry targets: each page's four trim edges, its centre lines, and
 * its margin box. Locked elements are included as targets by contract #20 —
 * that inclusion happens in `elementTargets`, which does not look at `locked`.
 */
export function pageTargets(geom: SnapGeometry): SnapTargets {
  const x: number[] = [];
  const y: number[] = [];

  for (const offset of geom.pageOffsetsMm) {
    const left = offset;
    const right = offset + geom.pageWidthMm;
    x.push(left, right, (left + right) / 2, left + geom.marginMm, right - geom.marginMm);
  }

  const top = 0;
  const bottom = geom.pageHeightMm;
  y.push(top, bottom, (top + bottom) / 2, top + geom.marginMm, bottom - geom.marginMm);

  return { x: dedupe(x), y: dedupe(y) };
}

/** Every other element's edges and centres (contract #8). Boxes are unit-space. */
export function elementTargets(boxes: readonly SnapBox[]): SnapTargets {
  const x: number[] = [];
  const y: number[] = [];
  for (const b of boxes) {
    const left = Math.min(b.x, b.x + b.width);
    const right = Math.max(b.x, b.x + b.width);
    const top = Math.min(b.y, b.y + b.height);
    const bottom = Math.max(b.y, b.y + b.height);
    x.push(left, right, (left + right) / 2);
    y.push(top, bottom, (top + bottom) / 2);
  }
  return { x: dedupe(x), y: dedupe(y) };
}

export function mergeTargets(...sets: readonly SnapTargets[]): SnapTargets {
  return {
    x: dedupe(sets.flatMap((s) => s.x)),
    y: dedupe(sets.flatMap((s) => s.y)),
  };
}

/**
 * The full target set for a gesture on one unit: page geometry plus every
 * element except the ones the gesture is moving.
 */
export function buildTargets(
  geom: SnapGeometry,
  otherBoxes: readonly SnapBox[]
): SnapTargets {
  return mergeTargets(pageTargets(geom), elementTargets(otherBoxes));
}

/**
 * Nearest target within the radius wins; ties resolve to the smaller
 * correction, then to the lower target value so the result is deterministic.
 * Returns `null` when nothing is in range — the caller then draws no guide,
 * which is what "releases cleanly past the radius" means.
 */
export function bestSnap(
  candidates: readonly SnapCandidate[],
  targets: readonly number[],
  radiusMm: number = SNAP_RADIUS_MM
): AxisSnap | null {
  let best: { distance: number; delta: number; guide: number } | null = null;

  for (const candidate of candidates) {
    if (candidate.rate === 0) continue; // pinned features cannot be snapped
    for (const target of targets) {
      const distance = Math.abs(target - candidate.value);
      if (distance > radiusMm) continue;
      if (
        best === null ||
        distance < best.distance ||
        (distance === best.distance && target < best.guide)
      ) {
        best = { distance, delta: (target - candidate.value) / candidate.rate, guide: target };
      }
    }
  }

  return best === null ? null : { delta: best.delta, guide: best.guide };
}

/**
 * Creation convenience: the anchor corner is pinned and the pointer corner
 * moves, so the moving edge has rate 1 and the centre rate 0.5.
 */
export function snapCreationAxis(
  anchor: number,
  pointer: number,
  targets: readonly number[],
  radiusMm: number = SNAP_RADIUS_MM
): AxisSnap | null {
  return bestSnap(
    [
      { value: pointer, rate: 1 },
      { value: (anchor + pointer) / 2, rate: 0.5 },
    ],
    targets,
    radiusMm
  );
}

function dedupe(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
