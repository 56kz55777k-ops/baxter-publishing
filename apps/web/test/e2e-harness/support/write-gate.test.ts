/**
 * Slice D stage 8A correction — WriteGate shutdown × declared-creation attribution (Codex's 8A P2 #1).
 * Helper level: the real WriteGate, EditorMock, journal and registry, with stubbed browser transport
 * (route/request objects) and a scripted editor (`stage()` reads). No browser, no network.
 * A real-harness race test lives in editor-write-budget.harness.spec.ts.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EditorDoc } from '@baxter/domain';
import { EditorMock } from '../mock';
import { RunStopped, startRun, WriteGate } from './write-gate';

type Ed = Parameters<WriteGate['declaredCreate']>[0];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const doc0 = { version: 1, pages: [{ id: 'pg', kind: 'cover', elements: [{ id: 'existing' }] }] } as unknown as EditorDoc;
const docWithNew = { version: 1, pages: [{ id: 'pg', kind: 'cover', elements: [{ id: 'existing' }, { id: 'new' }] }] } as unknown as EditorDoc;

function setup(cap = 5) {
  const dir = mkdtempSync(path.join(tmpdir(), 'baxter-gate-'));
  const { journal, registry, runId } = startRun(path.join(dir, 'j'), path.join(dir, 'r'), 'gate-test');
  const mock = new EditorMock(doc0, 1);
  const gate = new WriteGate('action', cap, mock, journal, registry, { label: 'unit', pageIds: ['pg'] }, runId);
  gate.b0 = new Set(['existing']);
  const routes: { aborted: number; fulfilled: number }[] = [];
  /** A PUT arriving at the gate (Playwright's route handler, stubbed). */
  const put = (doc: EditorDoc) => {
    const r = { aborted: 0, fulfilled: 0 };
    routes.push(r);
    const route = { fulfill: async () => void (r.fulfilled += 1), abort: async () => void (r.aborted += 1) };
    const request = { method: () => 'PUT', postData: () => JSON.stringify({ doc, baseRevision: 1, clientId: 'c' }) };
    return (gate as unknown as { onWrite(a: unknown, b: unknown): Promise<void> | void }).onWrite(route, request);
  };
  const ctx = { setOffline: async () => undefined, close: async () => undefined };
  return { journal, registry, mock, gate, put, routes, ctx };
}

/** A scripted editor: ids before/after the gesture, and optional pauses on given `stage()` calls. */
function scriptedEd(o: { pauseOnCall?: number; pause?: Promise<void> } = {}) {
  const st = { after: false, calls: 0 };
  const ed = {
    stage: async () => {
      st.calls += 1;
      if (o.pauseOnCall === st.calls && o.pause) await o.pause;
      return { unitIds: st.after ? ['existing', 'new'] : ['existing'], selected: st.after ? ['new'] : [] };
    },
  } as unknown as Ed;
  return { ed, st };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Every journaled write has exactly one terminal outcome record. */
function expectExactlyOnce(journal: ReturnType<typeof setup>['journal']) {
  const { records } = journal.read();
  const writes = records.filter((r) => r.t === 'write').map((r) => (r as { seq: number }).seq);
  for (const seq of writes) {
    expect(records.filter((r) => r.t === 'write' && r.seq === seq), `write ${seq} journaled once`).toHaveLength(1);
    expect(records.filter((r) => r.t === 'outcome' && r.seq === seq), `write ${seq} one outcome`).toHaveLength(1);
  }
}

describe('endPhase while a declared creation is pending', () => {
  for (const held of ['existing ids only', 'the newly created id'] as const) {
    it(`gesture paused at shutdown, held save with ${held}: nothing forwarded, nothing registered, bounded; the resumed gesture changes nothing`, async () => {
      const t = setup();
      const pause = deferred();
      const { ed, st } = scriptedEd();
      const creation = t.gate.declaredCreate(ed, 'create-rect', async () => {
        await pause.promise;
        st.after = true;
      });
      creation.catch(() => undefined);
      await sleep(0);
      await t.put(held === 'existing ids only' ? doc0 : docWithNew);
      expect(t.gate.heldCount).toBe(1);
      expect(t.mock.writes).toHaveLength(0);

      const t0 = Date.now();
      const end = await t.gate.endPhase(t.ctx, 0, undefined, { attributionMs: 60 });
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(end.creation).toBe('cancelled');
      expect(t.mock.writes).toHaveLength(0); // no premature forwarding
      expect(t.routes[0]).toEqual({ aborted: 1, fulfilled: 0 });
      const w = t.journal.read().writes;
      expect(w.map((x) => [x.forwarded, x.outcome, x.status])).toEqual([[false, 'not-forwarded', 'aborted-by-harness:cancelled-at-shutdown']]);
      await expect(creation).rejects.toBeInstanceOf(RunStopped);
      await expect(creation).rejects.toMatchObject({ report: { kind: 'creation-failed', reason: 'cancelled-at-shutdown', heldAborted: [2] } });

      pause.resolve(); // the stale continuation resumes after teardown
      await sleep(30);
      expect(t.registry.entries()).toEqual([]); // no late registry mutation
      expect(t.mock.writes).toHaveLength(0);
      expect(t.gate.budget.snapshot()).toMatchObject({ admitted: 1, blocked: 0, closed: true });
      expectExactlyOnce(t.journal);
    });
  }

  for (const [label, call] of [['the BEFORE observation', 1], ['an AFTER observation', 3]] as const) {
    it(`shutdown during ${label}: cancelled, held save aborted, nothing registered`, async () => {
      const t = setup();
      const pause = deferred();
      const { ed, st } = scriptedEd({ pauseOnCall: call, pause: pause.promise });
      const creation = t.gate.declaredCreate(ed, 'create-rect', async () => void (st.after = true));
      creation.catch(() => undefined);
      await sleep(5);
      await t.put(docWithNew);
      const end = await t.gate.endPhase(t.ctx, 0, undefined, { attributionMs: 60 });
      expect(end.creation).toBe('cancelled');
      await expect(creation).rejects.toMatchObject({ report: { reason: 'cancelled-at-shutdown' } });
      pause.resolve();
      await sleep(30);
      expect(t.registry.entries()).toEqual([]);
      expect(t.mock.writes).toHaveLength(0);
      expectExactlyOnce(t.journal);
    });
  }

  it('successful attribution completing inside the shutdown window: registered BEFORE forwarding, forwarded once, endPhase settles it', async () => {
    const t = setup();
    const { ed, st } = scriptedEd();
    const creation = t.gate.declaredCreate(ed, 'create-rect', async () => {
      await sleep(40);
      st.after = true;
    });
    await sleep(0);
    await t.put(docWithNew);
    const end = await t.gate.endPhase(t.ctx, 2_000, undefined, { attributionMs: 1_000 });
    expect(end.creation).toBe('resolved-in-window');
    await expect(creation).resolves.toBe('new');
    expect(t.mock.puts.map((w) => w.status)).toEqual([200]);
    const reg = t.registry.entries();
    expect(reg.map((e) => e.id)).toEqual(['new']);
    const recs = t.journal.read().records;
    const intent = recs.find((r) => r.t === 'intent') as { hr: number };
    const write = recs.find((r) => r.t === 'write') as { hr: number; forwarded: boolean };
    expect(write.forwarded).toBe(true);
    expect(intent.hr).toBeLessThan(reg[0]!.hr!); // intent → registration
    expect(reg[0]!.hr!).toBeLessThan(write.hr); // registration → forwarding
    expectExactlyOnce(t.journal);
  });

  it('after teardown no creation may start (phase closed), and no intent is recorded', async () => {
    const t = setup();
    await t.gate.endPhase(t.ctx, 0);
    const { ed } = scriptedEd();
    await expect(t.gate.declaredCreate(ed, 'create-rect', async () => undefined)).rejects.toMatchObject({ report: { kind: 'creation-failed', reason: 'phase-closed' } });
    expect(t.journal.read().records.filter((r) => r.t === 'intent')).toHaveLength(0);
  });
});

describe('declared creation failures abort held saves unforwarded', () => {
  it('a thrown gesture → gesture-failed; held save aborted and recorded once; nothing registered', async () => {
    const t = setup();
    const { ed } = scriptedEd();
    const creation = t.gate.declaredCreate(ed, 'create-rect', async () => {
      await sleep(20);
      throw new Error('click failed');
    });
    creation.catch(() => undefined);
    await sleep(0);
    await t.put(docWithNew);
    await expect(creation).rejects.toMatchObject({ report: { kind: 'creation-failed', reason: 'gesture-failed', detail: 'click failed', heldAborted: [2] } });
    expect(t.mock.writes).toHaveLength(0);
    expect(t.registry.entries()).toEqual([]);
    expect(t.gate.stop).toMatchObject({ reason: 'gesture-failed' });
    await t.put(doc0); // a later save from the same context is aborted unforwarded too
    expect(t.mock.writes).toHaveLength(0);
    expectExactlyOnce(t.journal);
  });

  it('attribution timeout (the overall deadline) → timeout; held save aborted', async () => {
    const t = setup();
    const { ed } = scriptedEd();
    const never = new Promise<void>(() => undefined);
    const creation = t.gate.declaredCreate(ed, 'create-rect', () => never, { deadlineMs: 80 });
    creation.catch(() => undefined);
    await sleep(0);
    await t.put(docWithNew);
    const t0 = Date.now();
    await expect(creation).rejects.toMatchObject({ report: { reason: 'timeout' } });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(t.mock.writes).toHaveLength(0);
    expect(t.registry.entries()).toEqual([]);
    expectExactlyOnce(t.journal);
  });

  it('no new id within the observation window → ambiguous; held save aborted', async () => {
    const t = setup();
    const { ed } = scriptedEd(); // gesture never flips `after`
    const creation = t.gate.declaredCreate(ed, 'create-rect', async () => undefined, { observeMs: 120 });
    creation.catch(() => undefined);
    await sleep(0);
    await t.put(doc0);
    await expect(creation).rejects.toMatchObject({ report: { kind: 'ambiguous' } });
    expect(t.mock.writes).toHaveLength(0);
    expectExactlyOnce(t.journal);
  });

  it('cap exhaustion during a pending creation: the over-cap save is blocked (never held); the admitted one waits for attribution and is then forwarded', async () => {
    const t = setup(1);
    const pause = deferred();
    const { ed, st } = scriptedEd();
    const creation = t.gate.declaredCreate(ed, 'create-rect', async () => {
      await pause.promise;
      st.after = true;
    });
    await sleep(0);
    await t.put(docWithNew); // admitted (1 of 1), held
    await t.put(docWithNew); // blocked at reservation
    expect(t.gate.budget.snapshot()).toMatchObject({ attempted: 2, admitted: 1, blocked: 1 });
    expect(t.gate.heldCount).toBe(1);
    expect(t.routes[1]).toEqual({ aborted: 1, fulfilled: 0 });
    await expect(t.gate.budget.exhausted).rejects.toMatchObject({ reason: 'cap' });
    expect(t.mock.writes).toHaveLength(0); // still held: exhaustion does not release it
    pause.resolve();
    await expect(creation).resolves.toBe('new');
    await sleep(10);
    expect(t.mock.puts.map((w) => w.status)).toEqual([200]);
    expect(t.gate.budget.invariantsHold()).toBe(true);
    expectExactlyOnce(t.journal);
  });

  it('the id guard still applies to a held save released by attribution (an extra id → stopped unforwarded)', async () => {
    const t = setup();
    const { ed, st } = scriptedEd();
    const creation = t.gate.declaredCreate(ed, 'create-rect', async () => void (st.after = true));
    await sleep(0);
    const extra = { version: 1, pages: [{ id: 'pg', kind: 'cover', elements: [{ id: 'existing' }, { id: 'new' }, { id: 'stray' }] }] } as unknown as EditorDoc;
    await t.put(extra);
    await expect(creation).resolves.toBe('new');
    await sleep(10);
    expect(t.mock.writes).toHaveLength(0);
    expect(t.gate.stop).toMatchObject({ kind: 'unattributed', ids: ['stray'] });
    expectExactlyOnce(t.journal);
  });
});
