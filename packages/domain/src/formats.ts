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
   * All three presets are ACCEPTED product decisions as of D-034. zine_a5
   * carries the Spike C v2 values (12/5) unchanged; A4 15/6 is accepted as
   * proposed; the square margin was revised 14 → 19 mm. Nothing here is
   * provisional any more.
   *
   * Because these are frozen at document creation (D-031), a change to a
   * value below affects only documents created after it — existing work is
   * never reflowed, and is never silently mutated.
   */
  layout: FormatLayoutDefaults;
}

export interface FormatLayoutDefaults {
  /**
   * Default page margin, mm in from trim. Margin guides + future snap targets.
   *
   * A single scalar, applied symmetrically to all four edges. Retained
   * deliberately through the present editor slices (D-034): no current
   * consumer — not preflight, not the inspector, not an exporter — requires
   * binding-aware geometry, and building it early would be speculative
   * infrastructure.
   *
   * **This deferral is dated, not indefinite.** Binding-relative per-edge
   * margins are a hard prerequisite before M2.4/export ships. The future
   * representation is `{ top, bottom, inner, outer }` — binding-relative,
   * NOT screen-relative `{ top, right, bottom, left }`, because "inner" is
   * the left edge on a recto and the right edge on a verso; storing screen
   * edges would push that flip into every consumer (D-034).
   */
  marginMm: number;
  /**
   * Default editorial safe area, mm in from trim — keep important content
   * inside.
   *
   * **An editorial layout guide, not a printer-safety guarantee (D-034).**
   * These values express where Baxter thinks critical content should sit on
   * the page; they do not assert conformance with any printer's safety
   * requirement, and must not be described as satisfying one. Real output
   * safety — per-edge, gutter-aware, page-count-aware, profile-owned — is
   * the job of future output-profile and preflight logic (D-033), not of
   * this number.
   */
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
  /**
   * Expected bleed PER APPLICABLE EDGE, in mm (0 = bleed not expected).
   * Warning only.
   *
   * Measured outward from trim on ONE edge. A page bleeding on both opposing
   * edges therefore grows by twice this in that dimension: at the generic
   * value, +0.25 in / 6.35 mm of total width and height. **Never encode
   * 0.25 in as the per-edge value** (D-033).
   *
   * 3 mm and 3.175 mm are industry synonyms in prose — Adobe itself writes
   * "0.125 inches (3 mm)" — but they are 0.175 mm apart and must not be
   * silently substituted. A future printer profile must be able to state a
   * true 3.0 mm requirement (D-033).
   *
   * Scalar today because every current preset bleeds symmetrically on all
   * four edges. Publication workflows can require zero bleed on the
   * binding/gutter edge (IngramSpark, Amazon KDP, Gorham all forbid it), so
   * this becomes per-edge when output profiles arrive. That conversion needs
   * no migration: bleed is derived from the preset and never persisted into
   * `editor_documents.doc` (D-033).
   */
  bleedMm: number;
  /** Minimum acceptable image resolution in DPI. Warning only. */
  minImageDpi: number;
}

/* -------------------------------------------------------------------------- */
/* Bleed — the generic publication value (D-033)                              */
/* -------------------------------------------------------------------------- */

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

/**
 * The generic publication bleed, per applicable edge: 1/8 inch.
 *
 * D-033 resolved the reported "quarter-inch bleed" as a quarter inch added to
 * each full page dimension — i.e. an eighth of an inch per applicable edge —
 * not a quarter inch per edge. Derived here rather than written as a decimal
 * so the imperial origin stays visible and the mm/pt values cannot drift.
 */
export const GENERIC_PUBLICATION_BLEED_IN = 0.125;
/** 3.175 mm exactly. */
export const GENERIC_PUBLICATION_BLEED_MM = GENERIC_PUBLICATION_BLEED_IN * MM_PER_INCH;
/** 9 pt exactly. */
export const GENERIC_PUBLICATION_BLEED_PT = GENERIC_PUBLICATION_BLEED_IN * PT_PER_INCH;

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
      bleedMm: GENERIC_PUBLICATION_BLEED_MM,
      minImageDpi: 300,
    },
    // ACCEPTED (D-034): unchanged from the Spike C v2 values.
    // Editorial safe guide, not a printer guarantee.
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
      bleedMm: GENERIC_PUBLICATION_BLEED_MM,
      minImageDpi: 300,
    },
    // ACCEPTED as proposed (D-034). Editorial safe guide, not a printer guarantee.
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
      bleedMm: GENERIC_PUBLICATION_BLEED_MM,
      minImageDpi: 300,
    },
    // ACCEPTED (D-034): margin revised 14 → 19 mm. Perfect-bound to 240 pages;
    // the gutter requirement scales with page count while the outer does not,
    // so the symmetric scalar is set to the stricter (binding) edge. The page
    // range is NOT narrowed to compensate — binding/page-count requirements
    // belong to future output-profile and preflight logic.
    // Editorial safe guide, not a printer guarantee.
    layout: { marginMm: 19, safeMm: 6 },
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
