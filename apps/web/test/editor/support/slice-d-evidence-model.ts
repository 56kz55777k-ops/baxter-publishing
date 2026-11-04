/**
 * TEST-ONLY — loads the reviewed model from the Slice D evidence script so the
 * production maths can be compared with it move by move (plan §6 stage 2:
 * "reproduce the evidence script's B1–B9 outputs and its E1–E13 results
 * exactly when driven by the same Konva port").
 *
 * Exactly like the stage 1 probe (`docs/evidence/slice-d-konva-probe/model.mjs`),
 * it takes the script's shared section — everything before its "r1" section:
 * helpers, `bound`, the Konva port `konvaStep`, `newGesture`, `gestureMove` —
 * verbatim, and runs it in an isolated `vm` context. The script itself is
 * never edited or executed in full here.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const EVIDENCE_PATH = fileURLToPath(new URL('../../../../../docs/evidence/slice-d-math-check.js', import.meta.url));
const MODEL_END_MARKER = '// ---------- r1 (the first reviewed plan), only the parts Codex questioned ----------';

export interface EvidenceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EvidenceGesture {
  s: { prev: EvidenceBox; seg: { key: string } | null; fl: { w: number; h: number } };
  anchor: string;
}

export interface EvidenceMove {
  skipped?: boolean;
  frozen?: boolean;
  renamed?: boolean;
  clamped?: boolean;
  box: EvidenceBox;
  k?: 'x' | 'y' | null;
  gx?: number | null;
  gy?: number | null;
}

export interface EvidenceModel {
  newGesture(start: EvidenceBox, targets2: { x: number[]; y: number[] }, anchor: string, view: { scale: number; vx: number; vy: number }): EvidenceGesture;
  gestureMove(G: EvidenceGesture, pointerMm: { x: number; y: number }, ratioFlag: boolean, alt: boolean, clampOn: boolean): EvidenceMove;
  createSession(start: EvidenceBox, targets2: { x: number[]; y: number[] }): unknown;
  /** The script's segment capture (anchorBound's first step), for replaying Konva's anchor-unchanged return. */
  capture(prev: EvidenceBox, anchor: string, ratio: boolean, alt: boolean, prevSeg: unknown): { key: string };
  segKey(anchor: string, ratio: boolean, alt: boolean): string;
  axesOf(anchor: string): { xs: number; ys: number };
  bound(
    s: unknown,
    raw: { l: number; t: number; r: number; b: number },
    anchor: string,
    ratioFlag: boolean,
    alt: boolean,
    anchorMm?: { x: number; y: number }
  ): EvidenceMove;
}

export function loadEvidenceModel(): { model: EvidenceModel; sha256Shared: string } {
  const full = readFileSync(EVIDENCE_PATH, 'utf8');
  const i = full.indexOf(MODEL_END_MARKER);
  if (i < 0 || full.indexOf(MODEL_END_MARKER, i + 1) >= 0) throw new Error('evidence model marker not found exactly once');
  const shared = full.slice(0, i);
  const ctx = vm.createContext({});
  vm.runInContext(shared + '\n;globalThis.__model = { newGesture, gestureMove, createSession, bound, capture, segKey, axesOf };', ctx, {
    filename: 'slice-d-math-check.js (shared model section)',
  });
  return {
    model: (ctx as unknown as { __model: EvidenceModel }).__model,
    sha256Shared: createHash('sha256').update(shared).digest('hex'),
  };
}
