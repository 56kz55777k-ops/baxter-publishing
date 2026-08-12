/**
 * Viewport geometry — pure math for the editor surface (contract #27).
 *
 * The view is `{ x, y, scale }`: screen-px offset of the current unit's
 * origin plus screen px per mm. Zoom is expressed relative to the base
 * density (3.4 px/mm, the Spike C v2 accepted baseline): allowed zoom is
 * 0.15–8×, i.e. scale 0.51–27.2 px/mm. All functions are pure; the stage
 * merely applies the numbers.
 */
import type { PublicationFormatPreset, UnitOfView } from '@baxter/domain';
import type { ViewTransform } from './state/editor-ui';

export const PX_PER_MM = 3.4;
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 8;
export const FIT_PADDING_PX = 48;

export interface UnitGeometry {
  /** Trim-box size of the whole unit (pages side by side), mm. */
  widthMm: number;
  heightMm: number;
  /** X offset of each page's trim origin inside the unit, mm. */
  pageOffsetsMm: number[];
  bleedMm: number;
  marginMm: number;
  safeMm: number;
}

export function unitGeometry(
  unit: Pick<UnitOfView, 'pages'>,
  preset: PublicationFormatPreset,
  layout: { marginMm: number; safeMm: number }
): UnitGeometry {
  const n = unit.pages.length;
  return {
    widthMm: n * preset.trimWidthMm,
    heightMm: preset.trimHeightMm,
    pageOffsetsMm: unit.pages.map((_, i) => i * preset.trimWidthMm),
    bleedMm: preset.rules.bleedMm,
    marginMm: layout.marginMm,
    safeMm: layout.safeMm,
  };
}

export function clampScale(scale: number): number {
  return Math.min(MAX_ZOOM * PX_PER_MM, Math.max(MIN_ZOOM * PX_PER_MM, scale));
}

/** Current zoom factor relative to the 3.4 px/mm base. */
export function zoomOf(view: ViewTransform): number {
  return view.scale / PX_PER_MM;
}

/**
 * Zoom about a fixed screen point: the mm position under the pointer before
 * equals the mm position under it after (pointer-centred zoom).
 */
export function zoomAt(view: ViewTransform, factor: number, screen: { x: number; y: number }): ViewTransform {
  const scale = clampScale(view.scale * factor);
  if (scale === view.scale) return view;
  const worldX = (screen.x - view.x) / view.scale;
  const worldY = (screen.y - view.y) / view.scale;
  return { x: screen.x - worldX * scale, y: screen.y - worldY * scale, scale };
}

export function panBy(view: ViewTransform, dxPx: number, dyPx: number): ViewTransform {
  if (dxPx === 0 && dyPx === 0) return view;
  return { ...view, x: view.x + dxPx, y: view.y + dyPx };
}

/**
 * Fit a rect of the unit (its bleed box, so the whole printable object is in
 * view) into the viewport with breathing room, centred. Fit never exceeds
 * 100% zoom — a tiny viewport zooms out, a huge one shows true size.
 */
export function fitView(
  contentWmm: number,
  contentHmm: number,
  viewportWpx: number,
  viewportHpx: number,
  contentOffsetXmm = 0
): ViewTransform {
  const availW = Math.max(1, viewportWpx - 2 * FIT_PADDING_PX);
  const availH = Math.max(1, viewportHpx - 2 * FIT_PADDING_PX);
  const scale = clampScale(Math.min(availW / contentWmm, availH / contentHmm, PX_PER_MM));
  return {
    x: (viewportWpx - contentWmm * scale) / 2 - contentOffsetXmm * scale,
    y: (viewportHpx - contentHmm * scale) / 2,
    scale,
  };
}

/** Fit the whole unit (both pages of a spread) including bleed. */
export function fitUnitView(geom: UnitGeometry, vpW: number, vpH: number): ViewTransform {
  return fitView(geom.widthMm + 2 * geom.bleedMm, geom.heightMm + 2 * geom.bleedMm, vpW, vpH, -geom.bleedMm);
}

/** Fit a single page of the unit (page 0), including bleed. */
export function fitPageView(geom: UnitGeometry, vpW: number, vpH: number): ViewTransform {
  const pageW = geom.widthMm / geom.pageOffsetsMm.length;
  return fitView(pageW + 2 * geom.bleedMm, geom.heightMm + 2 * geom.bleedMm, vpW, vpH, -geom.bleedMm);
}

/** True-size (100%): 3.4 px/mm, unit centred. */
export function hundredView(geom: UnitGeometry, vpW: number, vpH: number): ViewTransform {
  return {
    x: (vpW - geom.widthMm * PX_PER_MM) / 2,
    y: (vpH - geom.heightMm * PX_PER_MM) / 2,
    scale: PX_PER_MM,
  };
}
