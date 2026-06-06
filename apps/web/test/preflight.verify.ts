/**
 * Preflight verification harness (Slice 3b, Decision 4).
 *
 * Generates synthetic PDFs in memory and runs the REAL inspector + evaluator
 * against them, asserting the expected verdict. Run from the repo root with:
 *
 *     node apps/web/test/preflight.verify.ts
 *
 * (Node 22+ strips the type annotations natively; no build step.)
 *
 * Scope: the synthetic generator reliably covers the BLOCKING checks
 * (dimensions, page-count bounds, multiple-of-four) plus bleed and the corrupt
 * path. It does NOT cover low-DPI images or non-embedded fonts — those need
 * real exports (see README.md), and DPI detection itself is deferred. As real
 * fixtures land, point this harness at the files in ./fixtures and extend the
 * cases rather than relying only on synthetic generation.
 */
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import { inspectPdf } from '../lib/pdf/inspect.ts';
import { evaluatePreflight } from '../../../packages/domain/src/preflight.ts';
import { getFormatPreset } from '../../../packages/domain/src/formats.ts';

const MM = 72 / 25.4;
const A5 = getFormatPreset('zine_a5')!;
const trim = { widthMm: A5.trimWidthMm, heightMm: A5.trimHeightMm };

async function makePdf(opts: {
  pages: number;
  trimWmm: number;
  trimHmm: number;
  bleedMm: number;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const b = opts.bleedMm * MM;
  const tw = opts.trimWmm * MM;
  const th = opts.trimHmm * MM;
  for (let i = 0; i < opts.pages; i++) {
    const page = doc.addPage([tw + 2 * b, th + 2 * b]);
    page.drawText(`Page ${i + 1}`, {
      x: b + 10,
      y: b + 10,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    // Real exports always declare a TrimBox; inset by bleed, or equal to the
    // MediaBox when there is no bleed.
    page.node.set(PDFName.of('TrimBox'), doc.context.obj([b, b, b + tw, b + th]));
  }
  return doc.save();
}

type Case = {
  name: string;
  bytes: Uint8Array;
  expect: 'passed' | 'failed';
  expectWarn?: string;
};

async function run() {
  const cases: Case[] = [
    {
      name: 'clean A5 (8pp, bleed)',
      expect: 'passed',
      bytes: await makePdf({ pages: 8, trimWmm: 148, trimHmm: 210, bleedMm: 3 }),
    },
    {
      name: 'wrong dimensions (A4 in A5)',
      expect: 'failed',
      bytes: await makePdf({ pages: 8, trimWmm: 210, trimHmm: 297, bleedMm: 3 }),
    },
    {
      name: 'not multiple of four (7pp)',
      expect: 'failed',
      bytes: await makePdf({ pages: 7, trimWmm: 148, trimHmm: 210, bleedMm: 3 }),
    },
    {
      name: 'below min pages (2pp)',
      expect: 'failed',
      bytes: await makePdf({ pages: 2, trimWmm: 148, trimHmm: 210, bleedMm: 3 }),
    },
    {
      name: 'no bleed (8pp)',
      expect: 'passed',
      expectWarn: 'bleed',
      bytes: await makePdf({ pages: 8, trimWmm: 148, trimHmm: 210, bleedMm: 0 }),
    },
  ];

  let pass = 0;
  const total = cases.length + 1; // + corrupt case

  for (const c of cases) {
    const facts = await inspectPdf(c.bytes);
    const result = evaluatePreflight(facts, trim, A5.rules);
    const warnCodes = result.warnings.map((w) => w.code);
    const ok =
      result.status === c.expect &&
      (!c.expectWarn || warnCodes.includes(c.expectWarn));
    if (ok) pass++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.name} — status=${result.status} ` +
        `pages=${facts.pageCount} bleed=${facts.hasBleed} ` +
        `blockers=[${result.blockers.map((b) => b.code).join(', ')}] ` +
        `warnings=[${warnCodes.join(', ')}]`
    );
  }

  try {
    await inspectPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]));
    console.log('FAIL  corrupt file (expected a throw)');
  } catch {
    pass++;
    console.log('PASS  corrupt file (threw as expected)');
  }

  console.log(`\n${pass}/${total} checks passed`);
  if (pass !== total) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
