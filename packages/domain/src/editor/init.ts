/**
 * New-document initialization — the shape a publication's editor document is
 * born with, derived entirely from its format preset.
 *
 * Interior count: `minPages - 2`, so the born document's TOTAL page count
 * (cover + interiors + back) equals the preset's minimum and passes the
 * preset's own preflight bounds — including multiple-of-four where required.
 * (The Slice A blueprint's prose said "minPages interiors"; that would make
 * every born zine 6 pages and preflight-invalid. Recorded as a blueprint
 * deviation with this reason.)
 */
import type { PublicationFormatPreset } from '../formats';
import type { EditorDoc, EditorPage } from './document';
import { CURRENT_EDITOR_SCHEMA_VERSION } from './document';

function newPage(kind: EditorPage['kind']): EditorPage {
  return { id: crypto.randomUUID(), kind, elements: [] };
}

export function newEditorDoc(preset: PublicationFormatPreset): EditorDoc {
  const interiorCount = Math.max(1, preset.rules.minPages - 2);
  return {
    schemaVersion: CURRENT_EDITOR_SCHEMA_VERSION,
    meta: {
      formatPresetId: preset.id,
      // Frozen copies: existing documents keep their layout if preset
      // defaults evolve later (handoff Part 5).
      marginMm: preset.layout.marginMm,
      safeMm: preset.layout.safeMm,
    },
    pages: [
      newPage('cover'),
      ...Array.from({ length: interiorCount }, () => newPage('interior')),
      newPage('back'),
    ],
  };
}
