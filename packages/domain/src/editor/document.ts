/**
 * Editor document schema — v1.
 *
 * The persisted shape of a Native Publishing document (`editor_documents.doc`).
 * Pure rules: no I/O, no DB, no React. Zod is the single validation gate: the
 * save route re-parses on the server before every write, and the editor parses
 * on load before hydrating — never render a document that can't be re-saved.
 *
 * Versioning: `schemaVersion` travels inside the document (self-describing);
 * the `editor_documents.schema_version` column is derived from it server-side,
 * never accepted separately from a client. Migrations are forward-only,
 * deterministic and side-effect free; v1 migration is the identity; unknown
 * versions are rejected, never guessed (`parseEditorDoc`).
 *
 * Geometry: millimetres, top-left origin relative to each page's trim.
 * Typography: points. Model values live on a 0.01 mm grid at commit time —
 * committing code quantizes; the schema does not.
 *
 * Deliberate shape decisions (see the production implementation handoff,
 * Part 5, and the Slice A blueprint):
 * - Text has no stored height, ever — height is always the rendered text.
 * - `font` is a role token (body | heading), never a family name.
 * - Images reference `assets.id` — never a URL, never client-claimed natural
 *   dimensions (naturals live server-side in `assets.meta`).
 * - `stroke: null` is first-class "None", distinct from a thin stroke.
 * - Colours are the editor's stored sRGB hex; CMYK/ICC is an export concern.
 * - Trim/bleed are NOT duplicated into the document — they derive from the
 *   format preset; only resolved margin/safe values are frozen in `meta`.
 */
import { z } from 'zod';
import { isFormatPreset } from '../formats';

export const CURRENT_EDITOR_SCHEMA_VERSION = 1;

/** #rrggbb — the editor's stored colour space. */
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');

const ElementBase = z.object({
  id: z.string().uuid(),
  /** mm, page-trim-relative; may be negative or exceed the page (contract #2). */
  x: z.number().finite(),
  y: z.number().finite(),
  opacity: z.number().min(0).max(1),
  locked: z.boolean(),
});

export const RectElementSchema = ElementBase.extend({
  type: z.literal('rect'),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  fill: HexColor,
  /** null = stroke None — first-class, not width 0 (contract #18). */
  stroke: HexColor.nullable(),
  strokeWidth: z.number().min(0).finite(),
  cornerRadius: z.number().min(0).finite(),
});

export const EllipseElementSchema = ElementBase.extend({
  type: z.literal('ellipse'),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  fill: HexColor,
  stroke: HexColor.nullable(),
  strokeWidth: z.number().min(0).finite(),
});

export const ImageElementSchema = ElementBase.extend({
  type: z.literal('image'),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  /** `assets.id`; null = an empty frame. Frames remain frames (contract #12). */
  assetId: z.string().uuid().nullable(),
  fit: z.enum(['fill', 'fit']),
  cropZoom: z.number().min(1).max(3),
  focal: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  /** Empty-frame ground and Fit letterbox colour (contract #12). */
  fill: HexColor,
});

export const TextElementSchema = ElementBase.extend({
  type: z.literal('text'),
  /** Width-only geometry — no stored height, ever (contract #15). */
  width: z.number().positive().finite(),
  text: z.string(),
  /** pt; the model floor from the numeric contract (#19). */
  fontSize: z.number().min(4).finite(),
  lineHeight: z.number().min(0.8).finite(),
  fill: HexColor,
  font: z.enum(['body', 'heading']),
  align: z.enum(['left', 'center', 'right']),
});

export const LineElementSchema = ElementBase.extend({
  type: z.literal('line'),
  /** Signed delta to the endpoint — a vector, not a bounding box (contract #16). */
  width: z.number().finite(),
  height: z.number().finite(),
  stroke: HexColor,
  strokeWidth: z.number().min(0.1).finite(),
});

export const EditorElementSchema = z.discriminatedUnion('type', [
  RectElementSchema,
  EllipseElementSchema,
  ImageElementSchema,
  TextElementSchema,
  LineElementSchema,
]);

export const EditorPageSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['cover', 'interior', 'back']),
  /** Array order is the z-order contract; arrange = reorder. */
  elements: z.array(EditorElementSchema),
});

export const EditorDocV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    meta: z.object({
      formatPresetId: z.string().refine(isFormatPreset, 'unknown format preset'),
      /** Resolved at creation from the preset's layout defaults, then frozen
       *  so existing documents survive preset evolution. */
      marginMm: z.number().min(0).finite(),
      safeMm: z.number().min(0).finite(),
    }),
    /** Document order; spreads are derived (computeUnits), never stored. */
    pages: z.array(EditorPageSchema).min(3),
  })
  .superRefine((doc, ctx) => {
    const kinds = doc.pages.map((p) => p.kind);
    if (kinds[0] !== 'cover') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pages', 0, 'kind'],
        message: 'the first page must be the cover',
      });
    }
    if (kinds[kinds.length - 1] !== 'back') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pages', kinds.length - 1, 'kind'],
        message: 'the last page must be the back cover',
      });
    }
    kinds.slice(1, -1).forEach((k, i) => {
      if (k !== 'interior') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pages', i + 1, 'kind'],
          message: 'pages between the covers must be interior pages',
        });
      }
    });
    const seen = new Set<string>();
    for (const page of doc.pages) {
      if (seen.has(page.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pages'],
          message: `duplicate page id: ${page.id}`,
        });
      }
      seen.add(page.id);
      for (const el of page.elements) {
        if (seen.has(el.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['pages'],
            message: `duplicate element id: ${el.id}`,
          });
        }
        seen.add(el.id);
      }
    }
  });

export type EditorDoc = z.infer<typeof EditorDocV1Schema>;
export type EditorPage = z.infer<typeof EditorPageSchema>;
export type EditorElement = z.infer<typeof EditorElementSchema>;
export type RectElement = z.infer<typeof RectElementSchema>;
export type EllipseElement = z.infer<typeof EllipseElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type TextElement = z.infer<typeof TextElementSchema>;
export type LineElement = z.infer<typeof LineElementSchema>;

// ---------------------------------------------------------------------------
// Parsing + forward-only migration
// ---------------------------------------------------------------------------

export class UnsupportedEditorSchemaVersionError extends Error {
  constructor(readonly version: unknown) {
    super(`unsupported editor document schemaVersion: ${String(version)}`);
    this.name = 'UnsupportedEditorSchemaVersionError';
  }
}

export class EditorDocParseError extends Error {
  constructor(readonly issues: z.ZodIssue[]) {
    super('editor document failed validation');
    this.name = 'EditorDocParseError';
  }
}

const VersionProbe = z.object({ schemaVersion: z.number().int() });

/**
 * Migrate a raw stored document to the current schema version.
 * Deterministic, explicit, side-effect free. Identity for current documents;
 * unknown (future or unrecognised) versions are rejected, never guessed.
 * When v2 exists, this becomes a fall-through chain: 1 → 2 → … → current.
 */
export function migrateEditorDoc(input: unknown, fromVersion: number): unknown {
  switch (fromVersion) {
    case CURRENT_EDITOR_SCHEMA_VERSION:
      return input;
    default:
      throw new UnsupportedEditorSchemaVersionError(fromVersion);
  }
}

/**
 * The one entry point from raw JSON (DB row, request body) to a typed doc.
 * Throws `EditorDocParseError` on shape violations and
 * `UnsupportedEditorSchemaVersionError` on unknown versions.
 */
export function parseEditorDoc(input: unknown): EditorDoc {
  const probe = VersionProbe.safeParse(input);
  if (!probe.success) throw new EditorDocParseError(probe.error.issues);
  const migrated = migrateEditorDoc(input, probe.data.schemaVersion);
  const parsed = EditorDocV1Schema.safeParse(migrated);
  if (!parsed.success) throw new EditorDocParseError(parsed.error.issues);
  return parsed.data;
}
