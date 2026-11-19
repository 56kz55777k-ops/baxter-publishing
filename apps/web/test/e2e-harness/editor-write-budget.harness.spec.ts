/**
 * Slice D stage 8A — the §8.5 budget / journal / ownership protocol against LOCAL MOCKS ONLY, on the real
 * styled editor, in three browsers. Nothing here approves Q1 (allowances) or Q6 (production attributes),
 * and nothing here is wired into a production acceptance, cleanup or recovery script.
 *
 * Labels: INJECTED = requests built by the test in page script (`fetch`), to force concurrency the editor
 * cannot produce (it keeps one save in flight). HUMAN = a change made by the Node mock directly in its
 * document at a new revision ("someone else"). Everything else is REAL Playwright input on the editor.
 * Every held mock write is drained (answered or committed) before a test asserts a final state.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page-script globals (Konva's untyped stage, test counters) and loosely typed document elements */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Browser } from '@playwright/test';
import type { EditorDoc } from '@baxter/domain';
import { EditorMock } from './mock';
import { fixtureDoc, ID, type Editor } from './spec-kit';
import { WriteBudgetExhausted } from './support/write-budget';
import { cleanup, RunBlocked, RunStopped, startRun, WriteGate, type TargetUnit } from './support/write-gate';

test.describe.configure({ timeout: 120_000 });

const P1 = () => structuredClone(fixtureDoc('budget')!.pages[1]!.elements.find((e) => e.id === ID.p1)!);

async function begin(browser: Browser, A: number, name = 'run') {
  const dir = test.info().outputPath(name);
  mkdirSync(dir, { recursive: true });
  const jp = path.join(dir, 'journal.jsonl');
  const rp = path.join(dir, 'registry.jsonl');
  const { journal, registry, runId } = startRun(jp, rp, `run-${test.info().project.name}-${Date.now()}`);
  const seed = fixtureDoc('budget')!;
  const mock = new EditorMock(seed, 1);
  const unit: TargetUnit = { label: 'Front cover', pageIds: [seed.pages[0]!.id] };
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3008', viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const gate = new WriteGate('action', A, mock, journal, registry, unit, runId);
  await gate.install(ctx);
  const page = await ctx.newPage();
  const loaded = await gate.load(page);
  expect(loaded).not.toBeNull();
  const ed = loaded!.ed;
  return { dir, jp, rp, journal, registry, runId, mock, unit, ctx, gate, page, ed, clean: (cap: number, hooks: Partial<Parameters<typeof cleanup>[0]> = {}) => cleanup({ browser, mock, journal, registry, runId, unit, cap, ...hooks }) };
}

/** Declared creation of a default rect by the Rectangle tool (R + a real click) at a unit-mm point. */
async function createRect(gate: WriteGate, ed: Editor, at = { x: 100, y: 60 }) {
  const p = await ed.at(at);
  return gate.declaredCreate(ed, 'create-rect', async () => {
    await ed.page.keyboard.press('r');
    await ed.page.mouse.click(Math.round(p.x), Math.round(p.y));
  });
}

/** Every body the mock received carries p1, the other page's element (whole-document saves). */
function expectP1InEveryPut(mock: EditorMock) {
  for (const w of mock.puts) expect(w.doc!.pages.some((pg) => pg.elements.some((e) => e.id === ID.p1)), `PUT ${w.seq} lacks p1`).toBe(true);
}
const find = (doc: EditorDoc | null, id: string) => doc?.pages.flatMap((p) => p.elements).find((e) => e.id === id);
async function drain(mock: EditorMock) {
  for (const h of mock.held.splice(0)) await h.release();
}
const elementsOn = (mock: EditorMock, i: number) => mock.doc!.pages[i]!.elements.map((e) => e.id);

test.describe('budget: caps, counters, retries, exhaustion, offline', () => {
  test('INJECTED: 10 concurrent writes with A = 3 (the load took one) → exactly 2 more admitted; attempted = admitted + blocked = request events', async ({ browser }) => {
    const r = await begin(browser, 3);
    const doc = r.mock.doc;
    await r.page.evaluate(async (doc) => {
      await Promise.all(
        Array.from({ length: 10 }, () =>
          fetch('/api/editor/e2e-harness', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc, baseRevision: 1, clientId: 'injected' }) }).catch(() => null)
        )
      );
    }, doc);
    await expect.poll(() => r.gate.events.length).toBeGreaterThanOrEqual(11);
    expect(r.gate.budget.snapshot()).toMatchObject({ attempted: 11, admitted: 3, blocked: 8 });
    expect(r.gate.budget.invariantsHold()).toBe(true);
    expect(r.gate.writeRequestEvents).toBe(r.gate.budget.attempted);
    expect(r.mock.puts.map((w) => w.status).sort()).toEqual([200, 409]);
    expect(r.gate.unexpected).toEqual([]);
    await r.ctx.close();
  });

  test('exhaustion stops the action at its next await; then offline → close: the mock receives nothing more, including the beforeunload keepalive of an unsaved edit', async ({ browser }) => {
    const r = await begin(browser, 3); // load + 2 saves
    await r.ed.click(ID.u0);
    let steps = 0;
    const action = async () => {
      for (let i = 0; i < 10; i++) {
        const from = r.gate.events.length;
        await r.page.keyboard.press('ArrowRight');
        await r.gate.budget.step(r.gate.nextEvent('PUT', from, 15_000));
        steps += 1;
      }
    };
    await expect(r.gate.budget.step(action())).rejects.toBeInstanceOf(WriteBudgetExhausted);
    expect(steps).toBe(2);
    const stepsAtThrow = steps;
    await r.page.keyboard.press('ArrowRight'); // an unsaved edit, so beforeunload has something to flush
    const end = await r.gate.endPhase(r.ctx, 2_000, async () => {
      await r.page.close({ runBeforeUnload: true });
      await new Promise((res) => setTimeout(res, 800));
    });
    expect(r.mock.writes.length).toBe(end.mockWritesAtOffline);
    expect(steps).toBe(stepsAtThrow);
    expect(r.gate.budget.invariantsHold()).toBe(true);
    expect(r.gate.budget.admitted).toBe(3);
    test.info().annotations.push({ type: 'offline', description: JSON.stringify({ ...end, attemptedAfter: r.gate.budget.attempted, budget: r.gate.budget.snapshot() }) });
  });

  /** One try: dirty the editor inside the debounce, then close the page with beforeunload. */
  async function keepaliveTry(browser: Browser, name: string, how: { offline?: boolean; closePhase?: boolean }) {
    const r = await begin(browser, 10, name);
    await r.ed.click(ID.u0);
    await r.page.keyboard.press('ArrowRight'); // dirty, inside the 2 s debounce
    const before = r.mock.writes.length;
    if (how.closePhase) r.gate.budget.close();
    if (how.offline) await r.ctx.setOffline(true);
    await r.page.close({ runBeforeUnload: true });
    await new Promise((res) => setTimeout(res, 1500));
    const got = r.mock.writes.length - before;
    const out = { got, blocked: r.gate.budget.blocked, admitted: r.gate.budget.admitted };
    await r.ctx.close();
    return out;
  }

  test('keepalive positive control (online, phase open): the beforeunload keepalive PUT reaches the mock in at least one of 3 tries (best effort by design)', async ({ browser }) => {
    const tries = [];
    for (let i = 0; i < 3; i++) tries.push(await keepaliveTry(browser, `online-${i}`, {}));
    test.info().annotations.push({ type: 'keepalive-online', description: JSON.stringify(tries) });
    expect(tries.some((t) => t.got === 1)).toBe(true);
    for (const t of tries) if (t.got === 1) expect(t.admitted).toBe(2); // the load + the keepalive, charged
  });

  test('OBSERVED, not asserted: setOffline alone (phase open) is not a barrier for route-handled writes in every browser', async ({ browser }) => {
    const tries = [];
    for (let i = 0; i < 3; i++) tries.push(await keepaliveTry(browser, `offline-${i}`, { offline: true }));
    test.info().annotations.push({ type: 'keepalive-offline-only', description: JSON.stringify(tries) });
  });

  test('the barrier that holds: with the phase CLOSED (§8.5 step 1), online or offline, the mock receives nothing on close; any keepalive is blocked and counted', async ({ browser }) => {
    for (const offline of [false, true]) {
      for (let i = 0; i < 3; i++) {
        const t = await keepaliveTry(browser, `closed-${offline}-${i}`, { closePhase: true, offline });
        expect(t.got).toBe(0);
        expect(t.admitted).toBe(1);
      }
    }
  });

  test('retries after a mocked 500 consume allowance: 500 (unknown) then the ladder’s retry (committed) — two charges', async ({ browser }) => {
    const r = await begin(browser, 3);
    r.mock.next({ kind: 'status', status: 500 });
    await r.ed.click(ID.u0);
    await r.page.keyboard.press('ArrowDown');
    await expect.poll(() => r.mock.puts.length, { timeout: 20_000 }).toBe(2); // 2 s debounce + 10 s retry
    expect(r.mock.puts.map((w) => w.status)).toEqual([500, 200]);
    const w = r.journal.read().writes.filter((x) => x.method === 'PUT');
    expect(w.map((x) => x.outcome)).toEqual(['unknown', 'committed']);
    expect(r.gate.budget.admitted).toBe(3);
    await r.page.keyboard.press('ArrowDown');
    await expect.poll(() => r.gate.budget.blocked, { timeout: 10_000 }).toBe(1);
    await r.ctx.close();
  });
});

test.describe('cleanup: separate allowance, only registered ids, the fence, recovery pending', () => {
  test('action exhausts A; a fresh cleanup context with its own C deletes exactly the registered id; clean; p1/u0 untouched', async ({ browser }) => {
    const r = await begin(browser, 2); // load + the creation's save
    const id = await createRect(r.gate, r.ed);
    await expect.poll(() => r.mock.puts.length, { timeout: 10_000 }).toBe(1);
    await r.ed.click(ID.u0);
    await r.page.keyboard.press('ArrowRight');
    await expect.poll(() => r.gate.budget.blocked, { timeout: 10_000 }).toBe(1);
    await r.gate.endPhase(r.ctx, 2_000);
    const c = await r.clean(8);
    expect(c.status).toBe('clean');
    expect(c.needFence).toBe(false);
    expect(c.deleted).toEqual([id]);
    expect(c.budget).toMatchObject({ phase: 'cleanup', cap: 8, admitted: 3, blocked: 0 }); // load, delete, verification load
    expect(find(r.mock.doc, id)).toBeUndefined();
    expect(find(r.mock.doc, ID.p1)).toEqual(P1());
    expect(find(r.mock.doc, ID.u0)).toEqual(fixtureDoc('budget')!.pages[0]!.elements[0]);
    expect([...r.registry.ids()]).toEqual([id]);
    expect(r.registry.ids().has(ID.p1)).toBe(false);
    expectP1InEveryPut(r.mock);
    expect(r.journal.read().finished).toBe(true);
    expect(c.gate.unexpected).toEqual([]);
  });

  test('a cleanup that exhausts C stops and reports recovery pending; the unfinished journal blocks the next run', async ({ browser }) => {
    const r = await begin(browser, 5);
    const id = await createRect(r.gate, r.ed);
    await expect.poll(() => r.mock.puts.length, { timeout: 10_000 }).toBe(1);
    await r.gate.endPhase(r.ctx, 2_000);
    const c = await r.clean(2); // load + delete; the verification load is refused
    expect(c.status).toBe('recovery-pending');
    expect(c.deleted).toEqual([id]);
    expect(c.budget).toMatchObject({ admitted: 2, blocked: 1 });
    expect(r.journal.read().finished).toBe(false);
    expect(() => startRun(r.jp, r.rp, 'next')).toThrow(RunBlocked);
  });

  for (const when of ['before the cleanup load', 'between the load and the fence', 'after the fence (rejected 409)'] as const) {
    test(`late creation: the held save commits ${when}; owned ids cleaned; clean only after draining`, async ({ browser }) => {
      const r = await begin(browser, 5);
      r.mock.next({ kind: 'hold', commit: false });
      const id = await createRect(r.gate, r.ed);
      await expect.poll(() => r.mock.held.length, { timeout: 10_000 }).toBe(1);
      await r.gate.endPhase(r.ctx, 1_500); // still pending at the deadline → unknown
      expect(r.journal.read().writes.find((w) => w.method === 'PUT')!.outcome).toBe('unknown');
      const held = r.mock.held[0]!;
      let lateApplied: boolean | null = null;
      if (when === 'before the cleanup load') lateApplied = held.commitLate();
      const c = await r.clean(8, {
        onAfterLoad: (n) => {
          if (when === 'between the load and the fence' && n === 0) lateApplied = held.commitLate();
        },
        onAfterFence: () => {
          if (when === 'after the fence (rejected 409)') lateApplied = held.commitLate();
        },
      });
      await drain(r.mock);
      const why = JSON.stringify({ reason: c.reason, pending: c.pending, deleted: c.deleted, loads: c.loads, budget: c.budget, events: c.gate.events });
      expect(c.needFence, why).toBe(true);
      expect(c.fenced, why).toBe(true);
      if (when === 'between the load and the fence') {
        // The late commit makes the first fence attempt answer 409; cleanup reloads, re-plans, deletes the
        // owned rect (the committed fence) and verifies. §8.5's literal "clean" rule — EVERY cleanup write
        // committed — then still reports recovery pending, because the 409 is a cleanup write. Implemented as
        // written and reported as a plan question (it conflicts with §8.5's own re-plan-after-409 path).
        expect(c.gate.events.some((e) => e.method === 'PUT' && e.status === 409), why).toBe(true);
        expect(c.status, why).toBe('recovery-pending');
        expect(c.reason).toBe('a cleanup write is not committed');
        expect(r.journal.read().finished).toBe(false);
      } else {
        expect(c.status, why).toBe('clean');
        expect(r.journal.read().finished).toBe(true);
      }
      expect(lateApplied).toBe(when !== 'after the fence (rejected 409)');
      for (const own of r.registry.ids()) expect(find(r.mock.doc, own), `owned ${own} left`).toBeUndefined();
      if (when !== 'after the fence (rejected 409)') expect(c.deleted).toContain(id);
      expect(find(r.mock.doc, ID.p1)).toEqual(P1());
      expectP1InEveryPut(r.mock);
      test.info().annotations.push({ type: 'cleanup', description: JSON.stringify({ deleted: c.deleted, loads: c.loads, budget: c.budget }) });
    });
  }

  test('late update: a held resize of an owned rect commits before the load; its model matches the unknown body → deleted; clean', async ({ browser }) => {
    const r = await begin(browser, 6);
    const id = await createRect(r.gate, r.ed);
    await expect.poll(() => r.mock.puts.length, { timeout: 10_000 }).toBe(1);
    r.mock.next({ kind: 'hold', commit: false });
    await r.ed.drag(await r.ed.anchorPoint(id, 'bottom-right'), [{ x: 130, y: 85 }], { mm: true });
    await expect.poll(() => r.mock.held.length, { timeout: 10_000 }).toBe(1);
    await r.gate.endPhase(r.ctx, 1_500);
    expect(r.mock.held[0]!.commitLate()).toBe(true);
    const lateModel = structuredClone(find(r.mock.doc, id));
    const c = await r.clean(8);
    await drain(r.mock);
    expect(c.status).toBe('clean');
    expect(c.deleted).toEqual([id]);
    expect(lateModel).toBeTruthy();
    expect(find(r.mock.doc, id)).toBeUndefined();
  });

  for (const how of ['the fence answers 500', 'C is too small for the fence'] as const) {
    test(`forced fence failure (${how}) → recovery pending, unknown write listed, journal unfinished, next run blocked`, async ({ browser }) => {
      const r = await begin(browser, 5);
      r.mock.next({ kind: 'hold', commit: false });
      await createRect(r.gate, r.ed);
      await expect.poll(() => r.mock.held.length, { timeout: 10_000 }).toBe(1);
      await r.gate.endPhase(r.ctx, 1_500);
      if (how === 'the fence answers 500') r.mock.next({ kind: 'status', status: 500 });
      const c = await r.clean(how === 'C is too small for the fence' ? 1 : 8);
      await drain(r.mock);
      expect(c.status).toBe('recovery-pending');
      expect(c.fenced).toBe(false);
      expect(c.unknownWrites.length).toBeGreaterThanOrEqual(1);
      expect(r.journal.read().finished).toBe(false);
      expect(() => startRun(r.jp, r.rp, 'next')).toThrow(RunBlocked);
    });
  }
});

test.describe('ownership versus whole-document saves (r5)', () => {
  test('HUMAN h1 added on the target unit before the cleanup load: the deletion save carries it unchanged; it is neither registered nor deleted', async ({ browser }) => {
    const r = await begin(browser, 4);
    const id = await createRect(r.gate, r.ed);
    await expect.poll(() => r.mock.puts.length, { timeout: 10_000 }).toBe(1);
    await r.gate.endPhase(r.ctx, 2_000);
    const h1 = { ...structuredClone(fixtureDoc('budget')!.pages[0]!.elements[0]!), id: '00000000-0000-4000-8000-0000000000a1' };
    r.mock.humanEdit((d) => d.pages[0]!.elements.push(h1 as never));
    const c = await r.clean(8);
    expect(c.status).toBe('clean');
    expect(c.deleted).toEqual([id]);
    const del = r.mock.puts.at(-1)!;
    expect(find(del.doc, h1.id)).toEqual(h1);
    expect(find(r.mock.doc, h1.id)).toEqual(h1);
    expect(r.registry.ids().has(h1.id)).toBe(false);
    expectP1InEveryPut(r.mock);
  });

  test('HUMAN h1 through the marker save: nothing owned at load + one unknown (never committed) → marker created and deleted (two writes from C); h1 survives both', async ({ browser }) => {
    const r = await begin(browser, 4);
    r.mock.next({ kind: 'hold', commit: false });
    const id = await createRect(r.gate, r.ed);
    await expect.poll(() => r.mock.held.length, { timeout: 10_000 }).toBe(1);
    await r.gate.endPhase(r.ctx, 1_500);
    const h1 = { ...structuredClone(fixtureDoc('budget')!.pages[0]!.elements[0]!), id: '00000000-0000-4000-8000-0000000000b1', x: 60 };
    r.mock.humanEdit((d) => d.pages[0]!.elements.push(h1 as never));
    const putsBefore = r.mock.puts.length;
    const c = await r.clean(8);
    await drain(r.mock); // the held write is answered (409) and never applied
    expect(c.status).toBe('clean');
    expect(c.fenced).toBe(true);
    const cleanupPuts = r.mock.puts.slice(putsBefore).filter((w) => w.status === 200);
    expect(cleanupPuts).toHaveLength(2); // marker create (the fence) + marker delete
    for (const w of cleanupPuts) expect(find(w.doc, h1.id)).toEqual(h1);
    expect(find(r.mock.doc, h1.id)).toEqual(h1);
    expect(find(r.mock.doc, id)).toBeUndefined();
    expect(r.registry.entries().map((e) => e.kind)).toEqual(['create-rect', 'fence-marker']);
  });

  test('late writes alongside unrelated changes: a late creation + HUMAN edit to p1 + HUMAN h2 on another page, committed before the load → owned cleaned; p1 keeps the edit; h2 survives', async ({ browser }) => {
    const r = await begin(browser, 4);
    r.mock.next({ kind: 'hold', commit: false });
    const id = await createRect(r.gate, r.ed);
    await expect.poll(() => r.mock.held.length, { timeout: 10_000 }).toBe(1);
    await r.gate.endPhase(r.ctx, 1_500);
    const held = r.mock.held[0]!;
    expect(held.commitLate()).toBe(true);
    const h2 = { ...P1(), id: '00000000-0000-4000-8000-0000000000c2', x: 80 };
    r.mock.humanEdit((d) => {
      (d.pages[1]!.elements.find((e) => e.id === ID.p1) as any).x = 44;
      d.pages[2]!.elements.push(h2 as never);
    });
    const c = await r.clean(8);
    await drain(r.mock);
    expect(c.status).toBe('clean');
    expect(find(r.mock.doc, id)).toBeUndefined();
    expect((find(r.mock.doc, ID.p1) as any).x).toBe(44);
    expect(find(r.mock.doc, h2.id)).toEqual(h2);
  });

  test('ambiguous attribution — a duplicate declared with TWO selected (two new ids): stops; nothing registered; the new ids never reach the mock', async ({ browser }) => {
    const r = await begin(browser, 8);
    const a = await createRect(r.gate, r.ed);
    await expect.poll(() => r.mock.puts.length, { timeout: 10_000 }).toBe(1);
    await r.ed.click(ID.u0);
    await r.ed.click(a, true);
    const regBefore = r.registry.size();
    const err = await r.gate.declaredCreate(r.ed, 'duplicate', () => r.page.keyboard.press('Control+d')).catch((e) => e);
    expect(err).toBeInstanceOf(RunStopped);
    const rep = (err as RunStopped).report as Extract<RunStopped['report'], { kind: 'ambiguous' }>;
    expect(rep.kind).toBe('ambiguous');
    const fresh = rep.after.filter((x) => !rep.before.includes(x));
    expect(fresh).toHaveLength(2);
    expect(rep.selection.sort()).toEqual([...fresh].sort());
    await new Promise((res) => setTimeout(res, 3500)); // the debounced save arrives and is aborted unforwarded
    for (const w of r.mock.puts) for (const f of fresh) expect(find(w.doc, f)).toBeUndefined();
    expect(r.registry.size()).toBe(regBefore);
    expect(r.journal.read().writes.some((w) => !w.forwarded)).toBe(true);
    await r.ctx.close();
  });

  test('ambiguous attribution — a create gesture declared with the SELECT tool still active (no new id): stops after the 5 s wait; nothing registered', async ({ browser }) => {
    const r = await begin(browser, 8);
    const p = await r.ed.at({ x: 100, y: 120 });
    const err = await r.gate.declaredCreate(r.ed, 'create-rect', () => r.page.mouse.click(Math.round(p.x), Math.round(p.y))).catch((e) => e);
    expect(err).toBeInstanceOf(RunStopped);
    expect((err as RunStopped).report).toMatchObject({ kind: 'ambiguous', intent: { kind: 'create-rect' } });
    expect(r.registry.ids().size).toBe(0);
    await r.ctx.close();
  });

  test('undeclared element — Ctrl+D without a declared creation: the guard aborts the save unforwarded; the run stops naming the id; never registered', async ({ browser }) => {
    const r = await begin(browser, 8);
    await r.ed.click(ID.u0);
    await r.page.keyboard.press('Control+d');
    await expect.poll(() => r.gate.stop, { timeout: 10_000 }).not.toBeNull();
    const stop = r.gate.stop as Extract<RunStopped['report'], { kind: 'unattributed' }>;
    expect(stop.kind).toBe('unattributed');
    expect(stop.ids).toHaveLength(1);
    expect(r.mock.puts).toHaveLength(0);
    expect(r.registry.ids().size).toBe(0);
    expect(r.journal.read().writes.filter((w) => w.method === 'PUT').map((w) => [w.forwarded, w.outcome])).toEqual([[false, 'not-forwarded']]);
    await r.ctx.close();
  });

  test('owned element changed by someone else (HUMAN): not deleted; recovery pending', async ({ browser }) => {
    const r = await begin(browser, 4);
    const id = await createRect(r.gate, r.ed);
    await expect.poll(() => r.mock.puts.length, { timeout: 10_000 }).toBe(1);
    await r.gate.endPhase(r.ctx, 2_000);
    r.mock.humanEdit((d) => {
      (d.pages[0]!.elements.find((e) => e.id === id) as any).x = 7;
    });
    const c = await r.clean(8);
    expect(c.status).toBe('recovery-pending');
    expect(c.pending).toEqual([{ id, reason: 'model matches none of our bodies (changed by someone else)' }]);
    expect((find(r.mock.doc, id) as any).x).toBe(7);
    expect(r.journal.read().finished).toBe(false);
    expect(elementsOn(r.mock, 0)).toContain(id);
  });
});
