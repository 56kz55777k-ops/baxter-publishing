import * as mupdf from 'mupdf';

/**
 * Rasterize a PDF's cover + first preview pages.
 *
 * mupdf only (WASM, no native binaries). Each page is cropped to its TrimBox
 * so the finished page is shown, not the bleed; if a page declares no TrimBox
 * we fall back to its full bounds. One high-resolution JPEG master is produced
 * per page — Cloudflare Images derives the responsive variants from it.
 *
 * Pure (bytes in, buffers out): no storage, no network — unit-testable, and
 * proven against real PDFs in the Slice 4 spike.
 */

export interface RenderedPage {
  /** 1-based page number. */
  page: number;
  jpeg: Uint8Array;
  width: number;
  height: number;
}

export interface RenderOptions {
  /** How many leading pages to render (cover = page 1). Default 6. */
  maxPages?: number;
  /** Master width in px; height follows the page aspect. Default 1600. */
  targetWidth?: number;
  /** JPEG quality 1–100. Default 80. */
  quality?: number;
}

export function renderPreviewPages(
  pdfBytes: Uint8Array,
  opts: RenderOptions = {}
): RenderedPage[] {
  const { maxPages = 6, targetWidth = 1600, quality = 80 } = opts;
  const doc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
  try {
    const n = Math.min(maxPages, doc.countPages());
    const out: RenderedPage[] = [];
    for (let i = 0; i < n; i++) {
      out.push(renderOne(doc, i, targetWidth, quality));
    }
    return out;
  } finally {
    doc.destroy();
  }
}

function renderOne(
  doc: mupdf.Document,
  index: number,
  targetWidth: number,
  quality: number
): RenderedPage {
  let page = doc.loadPage(index);

  // Crop to the TrimBox (finished page) when the PDF declares one.
  const obj = (page as mupdf.PDFPage).getObject?.();
  const trim = obj?.get('TrimBox');
  if (trim && trim.isArray() && trim.length === 4) {
    obj!.put('CropBox', trim);
    page.destroy();
    page = doc.loadPage(index); // reload so getBounds() reflects the crop
  }

  const [x0, , x1] = page.getBounds();
  const scale = targetWidth / (x1 - x0);
  const pix = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB,
    false
  );
  const jpeg = pix.asJPEG(quality, false);
  const result: RenderedPage = {
    page: index + 1,
    jpeg,
    width: pix.getWidth(),
    height: pix.getHeight(),
  };
  pix.destroy();
  page.destroy();
  return result;
}
