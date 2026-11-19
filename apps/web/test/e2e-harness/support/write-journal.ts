/**
 * Slice D stage 8A — the write journal (plan §8.5 "Two records, kept apart", "Journal before
 * forwarding", "Write outcomes"). HARNESS-ONLY.
 *
 * Append-only JSON lines, each record written and fsynced before the call returns. One record per
 * outgoing write (phase, sequence, base revision, every element id with its model, forwarded or not),
 * then outcome records; plus intents, the run's report and the finished marker. It NEVER adds anything
 * to the ownership registry — that file is written only by `OwnershipRegistry.register`.
 *
 * Outcome precedence: the FIRST terminal outcome recorded for a write stands. `unknown` is never treated
 * as proof that the server did not commit.
 */
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import type { EditorDoc } from '@baxter/domain';
import type { Phase } from './write-budget';

export type Outcome = 'pending' | 'committed' | 'not-committed' | 'not-forwarded' | 'unknown';

export type JournalRecord =
  | { t: 'start'; runId: string; at: number }
  | { t: 'intent'; seq: number; kind: string; unit: string; geometry?: unknown; at: number; hr: number }
  | {
      t: 'write';
      seq: number;
      phase: Phase;
      method: 'PUT' | 'POST';
      baseRevision: number | null;
      /** Every element id in the body with its model (whole-document saves carry everything). */
      elements: Record<string, unknown>;
      forwarded: boolean;
      at: number;
      /** In-process high-resolution time (orders records against the registry within a run). */
      hr: number;
    }
  | { t: 'outcome'; seq: number; outcome: Exclude<Outcome, 'pending'>; status: number | string; at: number }
  | { t: 'report'; status: 'clean' | 'recovery-pending'; detail: unknown; at: number }
  | { t: 'finished'; at: number };

export interface WriteState {
  seq: number;
  phase: Phase;
  method: 'PUT' | 'POST';
  baseRevision: number | null;
  elements: Record<string, unknown>;
  forwarded: boolean;
  outcome: Outcome;
  status: number | string | null;
}

/** §8.5 outcome table, from the route's contract. */
export function outcomeOf(status: number | 'aborted' | 'network' | 'timeout' | 'context-closed'): Exclude<Outcome, 'pending' | 'not-forwarded'> {
  if (status === 200) return 'committed';
  if (typeof status === 'number' && [400, 401, 404, 409, 413, 423].includes(status)) return 'not-committed';
  return 'unknown'; // 5xx, network error, aborted/cancelled, timeout, context closed, anything else
}

export function elementsOf(doc: EditorDoc | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of doc?.pages ?? []) for (const e of p.elements) out[e.id] = structuredClone(e);
  return out;
}

export class WriteJournal {
  private seqCounter = 0;

  constructor(readonly path: string) {}

  /** A fresh journal. Refuses to overwrite an existing file. */
  static create(path: string, runId: string): WriteJournal {
    if (existsSync(path)) throw new Error(`journal already exists: ${path}`);
    const j = new WriteJournal(path);
    j.append({ t: 'start', runId, at: Date.now() });
    return j;
  }

  /** True when a journal exists and is not marked finished (a killed run, recovery pending, unknowns). */
  static unfinished(path: string): boolean {
    return existsSync(path) && !new WriteJournal(path).read().finished;
  }

  nextSeq() {
    this.seqCounter += 1;
    return this.seqCounter;
  }

  /** Append one record and fsync it before returning. */
  append(rec: JournalRecord) {
    const fd = openSync(this.path, 'a');
    try {
      writeSync(fd, JSON.stringify(rec) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  intent(kind: string, unit: string, geometry?: unknown) {
    const seq = this.nextSeq();
    this.append({ t: 'intent', seq, kind, unit, geometry, at: Date.now(), hr: performance.now() });
    return seq;
  }

  write(seq: number, phase: Phase, method: 'PUT' | 'POST', baseRevision: number | null, doc: EditorDoc | null, forwarded: boolean) {
    this.append({ t: 'write', seq, phase, method, baseRevision, elements: elementsOf(doc), forwarded, at: Date.now(), hr: performance.now() });
  }

  outcome(seq: number, outcome: Exclude<Outcome, 'pending'>, status: number | string) {
    this.append({ t: 'outcome', seq, outcome, status, at: Date.now() });
  }

  report(status: 'clean' | 'recovery-pending', detail: unknown) {
    this.append({ t: 'report', status, detail, at: Date.now() });
  }

  markFinished() {
    this.append({ t: 'finished', at: Date.now() });
  }

  read() {
    const lines = existsSync(this.path) ? readFileSync(this.path, 'utf8').split('\n').filter(Boolean) : [];
    const records = lines.map((l) => JSON.parse(l) as JournalRecord);
    const writes = new Map<number, WriteState>();
    let finished = false;
    const reports: Extract<JournalRecord, { t: 'report' }>[] = [];
    for (const r of records) {
      if (r.t === 'write') writes.set(r.seq, { seq: r.seq, phase: r.phase, method: r.method, baseRevision: r.baseRevision, elements: r.elements, forwarded: r.forwarded, outcome: 'pending', status: null });
      else if (r.t === 'outcome') {
        const w = writes.get(r.seq);
        if (w && w.outcome === 'pending') {
          w.outcome = r.outcome;
          w.status = r.status;
        }
      } else if (r.t === 'finished') finished = true;
      else if (r.t === 'report') reports.push(r);
    }
    return { records, writes: [...writes.values()], finished, reports };
  }
}
