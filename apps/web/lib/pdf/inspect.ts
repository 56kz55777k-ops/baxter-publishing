import { PDFDocument, PDFDict, PDFName, PDFArray, PDFNumber } from 'pdf-lib';
import type { PreflightFacts, PageSizeMm } from '@baxter/domain';

/**
 * Inspect an uploaded PDF and extract the facts preflight reasons about.
 *
 * Confidence tiers (Slice 3b):
 *  - Page count + per-page trim size: reliable (drive the blocking checks).
 *  - Bleed: best-effort from the page's BleedBox/TrimBox vs MediaBox. When the
 *    boxes are absent we cannot tell, so we return null (no warning) rather
 *    than guess.
 *  - Embedded fonts: best-effort by walking font dictionaries. Standard-14
 *    fonts are treated as embedded-equivalent.
 *  - Image DPI: NOT yet implemented — it requires content-stream parsing to
 *    get each image's placed size. Returns null (no warning) until calibrated
 *    against real fixtures with a deeper parser. See Slice 3b notes.
 *
 * Throws if the file cannot be parsed at all (corrupt / password-protected).
 * The worker catches that and records a single composed blocking issue.
 */

const PT_PER_MM = 72 / 25.4;
function ptToMm(pt: number): number {
  return pt / PT_PER_MM;
}

const STD_14 = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
  'Symbol',
  'ZapfDingbats',
]);

export async function inspectPdf(bytes: Uint8Array): Promise<PreflightFacts> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = pdf.getPages();

  const pageSizesMm: PageSizeMm[] = pages.map((page) => {
    // Prefer the TrimBox (the finished page size) so bleed does not look like
    // a dimension mismatch. pdf-lib's getTrimBox falls back to crop/media when
    // no explicit TrimBox is present, which is exactly what we want.
    const { width, height } = page.getTrimBox();
    return { widthMm: ptToMm(width), heightMm: ptToMm(height) };
  });

  return {
    pageCount: pdf.getPageCount(),
    pageSizesMm,
    hasBleed: detectBleed(pages),
    fontsEmbedded: detectFontsEmbedded(pdf),
    minImageDpi: null, // deferred — see header note.
  };
}

/**
 * Bleed is present when a page declares a BleedBox/MediaBox larger than its
 * TrimBox. We only inspect boxes explicitly set on the page; if a page sets
 * none we cannot decide, and a single undetermined page leaves the whole
 * result undetermined (null).
 */
function detectBleed(pages: ReturnType<PDFDocument['getPages']>): boolean | null {
  let anyDetermined = false;
  let anyWithoutBleed = false;

  for (const page of pages) {
    const node = page.node;
    const trim = readBoxSize(node, 'TrimBox');
    const bleed = readBoxSize(node, 'BleedBox');
    const media = readBoxSize(node, 'MediaBox');

    // Need a trim reference and an outer box to compare against.
    const outer = bleed ?? media;
    if (!trim || !outer) continue; // undetermined for this page

    anyDetermined = true;
    const grewW = outer.widthMm - trim.widthMm;
    const grewH = outer.heightMm - trim.heightMm;
    // ~2mm total growth (1mm per edge) is a low bar for "some bleed exists".
    if (grewW < 2 && grewH < 2) anyWithoutBleed = true;
  }

  if (!anyDetermined) return null;
  return !anyWithoutBleed;
}

function readBoxSize(
  node: PDFDict,
  name: string
): { widthMm: number; heightMm: number } | null {
  try {
    const raw = node.get(PDFName.of(name));
    if (!(raw instanceof PDFArray) || raw.size() !== 4) return null;
    const nums = [0, 1, 2, 3].map((i) => {
      const v = raw.get(i);
      return v instanceof PDFNumber ? v.asNumber() : NaN;
    });
    if (nums.some((n) => Number.isNaN(n))) return null;
    const [llx, lly, urx, ury] = nums;
    return { widthMm: ptToMm(urx - llx), heightMm: ptToMm(ury - lly) };
  } catch {
    return null;
  }
}

/**
 * Best-effort embedded-font detection by walking indirect objects.
 * Returns false if any non-embedded, non-standard font is found; true if at
 * least one font was seen and all are embedded (or standard-14); null if no
 * font information could be read.
 */
function detectFontsEmbedded(pdf: PDFDocument): boolean | null {
  try {
    const Type = PDFName.of('Type');
    const Subtype = PDFName.of('Subtype');
    const FontDescriptor = PDFName.of('FontDescriptor');
    const Font = PDFName.of('Font');
    const Type1 = PDFName.of('Type1');
    const TrueType = PDFName.of('TrueType');
    const BaseFont = PDFName.of('BaseFont');
    const fileKeys = [
      PDFName.of('FontFile'),
      PDFName.of('FontFile2'),
      PDFName.of('FontFile3'),
    ];

    let sawFont = false;
    let unembedded = false;

    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const type = obj.get(Type);

      if (type === FontDescriptor) {
        sawFont = true;
        const hasFile = fileKeys.some((k) => obj.get(k) !== undefined);
        if (!hasFile) unembedded = true;
      } else if (type === Font) {
        const subtype = obj.get(Subtype);
        if (subtype === Type1 || subtype === TrueType) {
          sawFont = true;
          // If the simple font carries no descriptor, it is only acceptable
          // when it is one of the standard-14 fonts.
          if (obj.get(FontDescriptor) === undefined) {
            const base = obj.get(BaseFont);
            const name = base instanceof PDFName ? stripSubset(base.toString()) : '';
            if (!STD_14.has(name)) unembedded = true;
          }
        }
      }
    }

    if (!sawFont) return null;
    return !unembedded;
  } catch {
    return null;
  }
}

/** "/ABCDEF+Helvetica" → "Helvetica"; "/Helvetica" → "Helvetica". */
function stripSubset(name: string): string {
  const bare = name.replace(/^\//, '');
  const plus = bare.indexOf('+');
  return plus === 6 ? bare.slice(plus + 1) : bare;
}
