/**
 * Editorial reason codes — INTERNAL ONLY (D-020).
 *
 * Pure data: no I/O, no DB, no React. This vocabulary helps Baxter organise its
 * own editorial operation — analytics, reporting, operational consistency,
 * search/filtering, and insight into editorial trends over time.
 *
 * These codes are NEVER shown to creators, NEVER transformed into creator-facing
 * copy, and NEVER a substitute for a written editorial note. The editor writes;
 * the software records. When a publication is returned or an edition is declined,
 * the creator reads the editor's own words — not a code and not a template.
 *
 * The labels here are for the editor's eyes only. They are deliberately framed as
 * editorial observations, not rule-enforcement categories: Baxter is an editorial
 * office, not a moderation platform (see the Editorial Constitution). There is no
 * "violation" vocabulary here by design.
 */

export type ReasonCodeGroup =
  | 'production'
  | 'content'
  | 'editorial_fit';

export interface EditorialReasonCode {
  /** Stable id recorded in publication_events.payload. Never rendered to creators. */
  id: string;
  /** Editor-facing label. Internal only. */
  label: string;
  group: ReasonCodeGroup;
}

/** Human-readable group headings for the internal admin surface. */
export const REASON_CODE_GROUPS: Record<ReasonCodeGroup, string> = {
  production: 'Production',
  content: 'Content and metadata',
  editorial_fit: 'Editorial fit',
};

/**
 * The controlled vocabulary. Kept intentionally short — a set of codes is only
 * useful if an editor can scan it at a glance. Extend deliberately, not eagerly.
 */
export const EDITORIAL_REASON_CODES: readonly EditorialReasonCode[] = [
  // Production — how the file is made.
  { id: 'trim_or_bleed', label: 'Trim or bleed inconsistent with the format', group: 'production' },
  { id: 'image_resolution', label: 'Image resolution light for print', group: 'production' },
  { id: 'cover_reads_unclear', label: 'Cover does not yet read as a cover', group: 'production' },
  { id: 'page_sequence', label: 'Page sequence or pacing unresolved', group: 'production' },

  // Content and metadata — what the work says about itself.
  { id: 'description_mismatch', label: 'Description does not match the work', group: 'content' },
  { id: 'category_fit', label: 'Category does not fit the work', group: 'content' },
  { id: 'credits_incomplete', label: 'Title or credits incomplete', group: 'content' },

  // Editorial fit — whether this belongs in the programme.
  { id: 'outside_programme', label: 'Outside the current editorial programme', group: 'editorial_fit' },
  { id: 'needs_further_reading', label: 'Needs further editorial reading', group: 'editorial_fit' },
] as const;

const BY_ID = new Map(EDITORIAL_REASON_CODES.map((c) => [c.id, c] as const));

/** Look up a code by id. Returns undefined for unknown ids. */
export function getReasonCode(id: string): EditorialReasonCode | undefined {
  return BY_ID.get(id);
}

/** Filter a list of ids to those that are valid, preserving vocabulary order. */
export function validReasonCodeIds(ids: readonly string[]): string[] {
  const set = new Set(ids);
  return EDITORIAL_REASON_CODES.filter((c) => set.has(c.id)).map((c) => c.id);
}
