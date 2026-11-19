/**
 * Slice D stage 8A — the local harness's fixture documents (plan §8.2).
 *
 * Imported ONLY by `app/(editor)/e2e-harness/[fixture]/page.harness.tsx`,
 * which exists as a route only in a build made with BAXTER_E2E_HARNESS=1.
 * A default build never sees that page, so nothing here is compiled into it.
 *
 * The allowlist is this object's keys: the page looks a fixture up by name and
 * answers 404 for anything else. Nothing is read from the filesystem at
 * request time. Every document is built from the domain's own factories with
 * fixed ids (so tests can address elements), then passed through JSON, as a
 * stored jsonb column would arrive, and the island boots it through its normal
 * `parseEditorDoc` path.
 *
 * A5 zine: page 0 is the front cover (a single), pages 1–2 the first spread
 * (verso | recto; offsets 0 and 148 mm), the last page the back cover.
 */
import {
  getFormatPreset,
  newEditorDoc,
  newEllipseElement,
  newRectElement,
  type EditorDoc,
  type EditorElement,
} from '@baxter/domain';

/** Deterministic UUIDs (version 4 layout) so a test can name an element. */
export const fid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** Element ids used by the specs. */
export const ID = {
  rect: fid(0x101),
  ellipse: fid(0x102),
  lockedEllipse: fid(0x103),
  gfRectW: fid(0x201), // 2.5 × 20 rect (grandfathered width)
  gfRectSq: fid(0x202), // 3.2 × 3.2 rect (both axes grandfathered)
  gfEllipse: fid(0x203), // 2.5 × 20 ellipse
  gfSnapW: fid(0x204), // left edge at 33.2: the rect's right edge snaps there → width exactly 3.2
  gfSnapE: fid(0x205), // left edge at 93.2: the same for the ellipse
  zeroH: fid(0x206), // x 0, width 0.004 mm (0 H), height 20 — the zero-H rule
  s21: fid(0x301), // 3.00 × 3.04 rect at (50, 40) on the spread's verso
  s21Target: fid(0x302), // its snap target, top edge at 44.11 mm
  verso: fid(0x401),
  recto: fid(0x402),
  rectoMargin: fid(0x403),
  gutter: fid(0x404),
  wide: fid(0x405),
  u0: fid(0x601), // budget fixture: on the target unit (the front cover)
  p1: fid(0x602), // budget fixture: on another page (spread 1, verso)
} as const;

type Geo = { x: number; y: number; width: number; height: number };

function rect(id: string, g: Geo, extra: Partial<EditorElement> = {}): EditorElement {
  return { ...newRectElement({ x: g.x, y: g.y }), id, width: g.width, height: g.height, ...extra } as EditorElement;
}
function ellipse(id: string, g: Geo, extra: Partial<EditorElement> = {}): EditorElement {
  return { ...newEllipseElement({ x: g.x, y: g.y }), id, width: g.width, height: g.height, ...extra } as EditorElement;
}

/** A fresh A5 zine with deterministic page ids; `place` puts elements on pages by index. */
function zine(place: (pages: EditorElement[][]) => void): EditorDoc {
  const doc = newEditorDoc(getFormatPreset('zine_a5')!);
  doc.pages.forEach((p, i) => {
    p.id = fid(0xf000 + i);
  });
  const lists: EditorElement[][] = doc.pages.map(() => []);
  place(lists);
  doc.pages.forEach((p, i) => {
    p.elements = lists[i]!;
  });
  return doc;
}

/** The thirty-element reference document (blueprint: "C: 30 elements"), on the first spread. */
function reference30(): EditorDoc {
  return zine((pages) => {
    for (let i = 0; i < 30; i++) {
      const page = i < 15 ? 1 : 2;
      const k = i % 15;
      const g = { x: 14 + (k % 3) * 40, y: 16 + Math.floor(k / 3) * 38, width: 30 + (i % 4) * 2, height: 24 + (i % 5) * 2 };
      const id = fid(0x500 + i);
      pages[page]!.push(i % 3 === 2 ? ellipse(id, g, { locked: i % 10 === 8 }) : rect(id, g, { locked: i % 10 === 9 }));
    }
  });
}

const FIXTURES = {
  /** Cover: a 40 × 30 rect and a 24 × 18 ellipse (the probe's fixture), plus a locked ellipse. */
  basic: () =>
    zine((p) => {
      p[0]!.push(rect(ID.rect, { x: 20, y: 20, width: 40, height: 30 }));
      p[0]!.push(ellipse(ID.ellipse, { x: 30, y: 60, width: 24, height: 18 }));
      p[0]!.push(ellipse(ID.lockedEllipse, { x: 80, y: 120, width: 30, height: 20 }, { locked: true }));
    }),
  /** Cover: grandfathered (undersized) shapes, AC-21. */
  grandfathered: () =>
    zine((p) => {
      p[0]!.push(rect(ID.gfRectW, { x: 30, y: 30, width: 2.5, height: 20 }));
      p[0]!.push(rect(ID.gfRectSq, { x: 60, y: 30, width: 3.2, height: 3.2 }));
      p[0]!.push(ellipse(ID.gfEllipse, { x: 90, y: 30, width: 2.5, height: 20 }));
      p[0]!.push(rect(ID.gfSnapW, { x: 33.2, y: 80, width: 10, height: 10 }));
      p[0]!.push(rect(ID.gfSnapE, { x: 93.2, y: 80, width: 10, height: 10 }));
      p[0]!.push(rect(ID.zeroH, { x: 0, y: 120, width: 0.004, height: 20 }));
    }),
  /** Spread: the S2-1 sequence (plan §8.2) — 3.00 × 3.04 at (50, 40) on the verso, a target whose top is 44.11. */
  s21: () =>
    zine((p) => {
      p[1]!.push(rect(ID.s21, { x: 50, y: 40, width: 3, height: 3.04 }));
      p[1]!.push(rect(ID.s21Target, { x: 100, y: 44.11, width: 20, height: 15.89 }));
    }),
  /** Spread: elements on both pages, one near the recto margin, one crossing the gutter, and a wide one. */
  spread: () =>
    zine((p) => {
      p[1]!.push(rect(ID.verso, { x: 30, y: 40, width: 40, height: 30 }));
      p[2]!.push(rect(ID.recto, { x: 40, y: 50, width: 30, height: 40 }));
      p[2]!.push(rect(ID.rectoMargin, { x: 100, y: 120, width: 30, height: 30 }));
      p[1]!.push(rect(ID.gutter, { x: 120, y: 150, width: 20, height: 20 }));
      p[1]!.push(ellipse(ID.wide, { x: 20, y: 100, width: 60, height: 20 }));
    }),
  reference30: () => reference30(),
  /** §8.5 r5 ownership fixture: `u0` on the target unit (cover), `p1` on another page. Loaded through create-if-absent. */
  budget: () =>
    zine((p) => {
      p[0]!.push(rect(ID.u0, { x: 20, y: 20, width: 30, height: 20 }));
      p[1]!.push(rect(ID.p1, { x: 30, y: 30, width: 20, height: 20 }));
    }),
  /** No stored document: the island initialises through POST (create-if-absent), answered by the mock. */
  'create-if-absent': () => null,
} satisfies Record<string, () => EditorDoc | null>;

export type HarnessFixtureName = keyof typeof FIXTURES;
export const HARNESS_FIXTURE_NAMES = Object.keys(FIXTURES) as HarnessFixtureName[];

/** The docRow the server page passes to EditorGate: JSON-round-tripped, revision 1. */
export function harnessDocRow(name: string): { doc: unknown; revision: number } | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(FIXTURES, name)) return undefined; // not allowlisted
  const doc = FIXTURES[name as HarnessFixtureName]();
  return doc === null ? null : { doc: JSON.parse(JSON.stringify(doc)), revision: 1 };
}

/** The same documents for the Node-side mock (tests), by name. */
export function fixtureDoc(name: HarnessFixtureName): EditorDoc | null {
  const d = FIXTURES[name]();
  return d === null ? null : (JSON.parse(JSON.stringify(d)) as EditorDoc);
}
