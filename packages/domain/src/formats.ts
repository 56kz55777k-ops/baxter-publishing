/**
 * Publication format presets and category list.
 *
 * Pure rules: no I/O, no DB, no React. The format presets seed the
 * publication-creation form. The chosen trim dimensions are stored
 * directly on the publication row; no publication_formats table exists
 * yet (the implementation plan called for one; the v0 schema does not).
 *
 * Categories are a controlled vocabulary for browse and editorial sort.
 */

export interface PublicationFormatPreset {
  id: string;
  name: string;
  trimWidthMm: number;
  trimHeightMm: number;
  description: string;
  /**
   * Print rules consumed by preflight (see `preflight.ts`). These are
   * calibration defaults — tune against real printer requirements and the
   * Slice 3b test fixtures. Dimension/page-count/multiple-of-four feed
   * blocking checks; bleed/DPI feed non-blocking warnings.
   */
  rules: FormatPrintRules;
  /**
   * Editor layout defaults consumed by Native Publishing (Slice A+): new
   * documents freeze resolved copies of these into their own meta, so
   * changing a preset later never reflows existing documents.
   *
   * zine_a5 carries the Spike C v2 accepted values (12/5). The A4 and
   * square values are PROVISIONAL — proposed in the Slice A blueprint,
   * awaiting Ben's confirmation at the Slice A review; do not treat them
   * as settled product decisions (see D-031).
   */
  layout: FormatLayoutDefaults;
}

export interface FormatLayoutDefaults {
  /** Default page margin, mm in from trim. Margin guides + future snap targets. */
  marginMm: number;
  /** Default safe area, mm in from trim — keep important content inside. */
  safeMm: number;
}

export interface FormatPrintRules {
  /** Inclusive lower bound on total pages. */
  minPages: number;
  /** Inclusive upper bound on total pages. */
  maxPages: number;
  /** Saddle-stitch and similar binding require a multiple-of-four page count. */
  requiresMultipleOfFour: boolean;
  /** Allowed deviation, in mm, of a page's trim from the preset trim. */
  dimensionToleranceMm: number;
  /** Expected bleed margin in mm (0 = bleed not expected). Warning only. */
  bleedMm: number;
  /** Minimum acceptable image resolution in DPI. Warning only. */
  minImageDpi: number;
}

export const PUBLICATION_FORMAT_PRESETS: readonly PublicationFormatPreset[] = [
  {
    id: 'zine_a5',
    name: 'A5 Zine',
    trimWidthMm: 148,
    trimHeightMm: 210,
    description: 'Folded A4, portrait.',
    rules: {
      minPages: 4,
      maxPages: 64,
      requiresMultipleOfFour: true,
      dimensionToleranceMm: 1,
      bleedMm: 3,
      minImageDpi: 300,
    },
    layout: { marginMm: 12, safeMm: 5 },
  },
  {
    id: 'magazine_a4',
    name: 'A4 Magazine',
    trimWidthMm: 210,
    trimHeightMm: 297,
    description: 'Standard magazine, portrait.',
    rules: {
      minPages: 8,
      maxPages: 96,
      requiresMultipleOfFour: true,
      dimensionToleranceMm: 1,
      bleedMm: 3,
      minImageDpi: 300,
    },
    // PROVISIONAL — confirm at Slice A review (D-031).
    layout: { marginMm: 15, safeMm: 6 },
  },
  {
    id: 'photobook_square_210',
    name: 'Square Photobook',
    trimWidthMm: 210,
    trimHeightMm: 210,
    description: 'Square, 210mm.',
    rules: {
      // Perfect-bound: no multiple-of-four constraint.
      minPages: 20,
      maxPages: 240,
      requiresMultipleOfFour: false,
      dimensionToleranceMm: 1,
      bleedMm: 3,
      minImageDpi: 300,
    },
    // PROVISIONAL — confirm at Slice A review (D-031).
    layout: { marginMm: 14, safeMm: 6 },
  },
] as const;

export type FormatPresetId = (typeof PUBLICATION_FORMAT_PRESETS)[number]['id'];

export function getFormatPreset(id: string): PublicationFormatPreset | undefined {
  return PUBLICATION_FORMAT_PRESETS.find((f) => f.id === id);
}

export function isFormatPreset(id: string): id is FormatPresetId {
  return PUBLICATION_FORMAT_PRESETS.some((f) => f.id === id);
}

export const PUBLICATION_CATEGORIES = [
  'Zine',
  'Photobook',
  'Art Book',
  'Chapbook',
  'Magazine',
  'Monograph',
  'Comic',
  'Essay',
  'Photojournalism',
  'Experimental',
] as const;

export type PublicationCategory = (typeof PUBLICATION_CATEGORIES)[number];

export function isPublicationCategory(s: string): s is PublicationCategory {
  return (PUBLICATION_CATEGORIES as readonly string[]).includes(s);
}
