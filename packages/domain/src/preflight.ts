/**
 * Preflight evaluation — pure rules, no I/O.
 *
 * The Inngest worker inspects the uploaded PDF and produces a `PreflightFacts`
 * object (page count, per-page sizes, best-effort bleed / font / DPI signals).
 * This module turns those facts plus the chosen format's rules into a verdict:
 * a status (`passed` | `failed`), blocking issues, and non-blocking warnings.
 *
 * Status model (D-012): a file either can proceed (`passed`) or cannot
 * (`failed`). Warnings never change the status — they annotate a passed file.
 *
 * User-facing copy (D-013): the issue `title` / `detail` strings are the exact
 * words the creator reads. No "failed" / "passed" / "error" language; the
 * issues themselves carry the context.
 *
 * A fact that could not be determined is `null`. A null fact NEVER produces a
 * warning — silence is preferred over a guess (Editorial Constitution).
 */

import type { FormatPrintRules } from './formats';

/** A single page's trim size, in millimetres. */
export interface PageSizeMm {
  widthMm: number;
  heightMm: number;
}

/** What the PDF inspector extracts from an uploaded file. */
export interface PreflightFacts {
  pageCount: number;
  /** One entry per page. Empty if the file could not be parsed for sizes. */
  pageSizesMm: PageSizeMm[];
  /** true = bleed detected; false = none detected; null = undetermined. */
  hasBleed: boolean | null;
  /** true = all fonts embedded; false = at least one not embedded; null = undetermined. */
  fontsEmbedded: boolean | null;
  /** Lowest image DPI found; null = undetermined or no raster images. */
  minImageDpi: number | null;
}

export type PreflightStatus = 'pending' | 'passed' | 'failed';

export interface PreflightIssue {
  /** Stable identifier for the check (for logs / future filtering). */
  code: string;
  /** Short section label shown to the creator, e.g. "Page dimensions". */
  title: string;
  /** One composed sentence shown beneath the title. */
  detail: string;
}

export interface PreflightResult {
  status: Extract<PreflightStatus, 'passed' | 'failed'>;
  blockers: PreflightIssue[];
  warnings: PreflightIssue[];
}

/** Rounds to one decimal for tidy copy without implying false precision. */
function mm(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/**
 * Evaluate a file against a format's print rules.
 *
 * @param facts   measurements from the PDF inspector
 * @param trim    the publication's expected trim size (from the format preset)
 * @param rules   the format preset's print rules
 */
export function evaluatePreflight(
  facts: PreflightFacts,
  trim: PageSizeMm,
  rules: FormatPrintRules
): PreflightResult {
  const blockers: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];

  // --- Blocking: page dimensions match the selected format -------------------
  if (facts.pageSizesMm.length > 0) {
    const tol = rules.dimensionToleranceMm;
    const offFormat = facts.pageSizesMm.some((p) => {
      // Accept either orientation: a page may be stored rotated.
      const matchUpright =
        Math.abs(p.widthMm - trim.widthMm) <= tol &&
        Math.abs(p.heightMm - trim.heightMm) <= tol;
      const matchRotated =
        Math.abs(p.widthMm - trim.heightMm) <= tol &&
        Math.abs(p.heightMm - trim.widthMm) <= tol;
      return !(matchUpright || matchRotated);
    });
    if (offFormat) {
      blockers.push({
        code: 'page-dimensions',
        title: 'Page dimensions',
        detail: `Page dimensions do not match the selected format. This format expects ${mm(
          trim.widthMm
        )} × ${mm(trim.heightMm)} mm.`,
      });
    }
  }

  // --- Blocking: page count within the format's bounds -----------------------
  if (facts.pageCount < rules.minPages || facts.pageCount > rules.maxPages) {
    blockers.push({
      code: 'page-count-bounds',
      title: 'Page count',
      detail: `Page count must be between ${rules.minPages} and ${rules.maxPages} for this format.`,
    });
  }

  // --- Blocking: multiple-of-four where the binding requires it --------------
  if (rules.requiresMultipleOfFour && facts.pageCount % 4 !== 0) {
    blockers.push({
      code: 'page-count-multiple',
      title: 'Page count',
      detail: 'Page count must be a multiple of four.',
    });
  }

  // --- Warning: image resolution (only when determinable) --------------------
  if (facts.minImageDpi !== null && facts.minImageDpi < rules.minImageDpi) {
    warnings.push({
      code: 'image-dpi',
      title: 'Image resolution',
      detail: 'Some images appear below the recommended print resolution.',
    });
  }

  // --- Warning: embedded fonts (only when determinable) ----------------------
  if (facts.fontsEmbedded === false) {
    warnings.push({
      code: 'fonts-embedded',
      title: 'Fonts',
      detail: 'One or more fonts may not be embedded in the file.',
    });
  }

  // --- Warning: bleed (only when determinable, and only if expected) ---------
  if (rules.bleedMm > 0 && facts.hasBleed === false) {
    warnings.push({
      code: 'bleed',
      title: 'Bleed',
      detail:
        'No bleed area was detected on pages containing edge-to-edge artwork.',
    });
  }

  return {
    status: blockers.length > 0 ? 'failed' : 'passed',
    blockers,
    warnings,
  };
}
