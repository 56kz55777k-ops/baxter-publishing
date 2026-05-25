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
}

export const PUBLICATION_FORMAT_PRESETS: readonly PublicationFormatPreset[] = [
  {
    id: 'zine_a5',
    name: 'A5 Zine',
    trimWidthMm: 148,
    trimHeightMm: 210,
    description: 'Folded A4, portrait.',
  },
  {
    id: 'magazine_a4',
    name: 'A4 Magazine',
    trimWidthMm: 210,
    trimHeightMm: 297,
    description: 'Standard magazine, portrait.',
  },
  {
    id: 'photobook_square_210',
    name: 'Square Photobook',
    trimWidthMm: 210,
    trimHeightMm: 210,
    description: 'Square, 210mm.',
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
