/**
 * Slice D stage 8A — the write gate and the run protocol (plan §8.5), HARNESS-ONLY and LOCAL-MOCK-ONLY.
 *
 * This is the §8.5 protocol exercised end to end against the Node-side `EditorMock`: "forwarding" a
 * write means handing it to the mock, which plays the server (including late commits). It approves
 * nothing for production — not the Q1 allowances, not the Q6 attributes — and no production
 * acceptance, cleanup or recovery script imports it.
 *
 * Per context: one `WriteGate` (one phase, one budget). The route handler classifies each request;
 * for a WRITE it reserves synchronously, then (unless a declared creation is pending, which holds it)
 * runs the unattributed-id guard, fsyncs the write-journal record, and only then forwards.
 */
import type { Browser, BrowserContext, Page, Request, Route } from '@playwright/test';
import type { EditorDoc } from '@baxter/domain';
import { API_PATH, ORIGIN, type EditorMock, type Fence } from '../mock';
import { Editor } from '../harness';
import { classify, WriteBudget, type Phase } from './write-budget';
import { outcomeOf, WriteJournal, type Outcome } from './write-journal';
import { OwnershipRegistry } from './ownership-registry';

export interface TargetUnit {
  label: string;
  /** The document page ids of the run's target unit (the guard checks only these pages). */
  pageIds: string[];
}

export type StopReport =
  | { kind: 'ambiguous'; intent: { seq: number; kind: string }; before: string[]; after: string[]; selection: string[]; reloaded: boolean }
  | { kind: 'unattributed'; seq: number; ids: string[] }
  | { kind: 'no-b0'; seq: number };

export class RunStopped extends Error {
  constructor(readonly report: StopReport) {
    super(`run stopped: ${report.kind}`);
    this.name = 'RunStopped';
  }
}

export class RunBlocked extends Error {
  constructor(readonly journalPath: string) {
    super(`an unfinished journal blocks new runs: ${journalPath}`);
    this.name = 'RunBlocked';
  }
}

interface WriteItem {
  seq: number;
  method: 'PUT' | 'POST';
  route: Route;
  request: Request;
  body: { doc: EditorDoc; baseRevision: number; clientId: string } | null;
}

export interface WriteEvent {
  seq: number | null;
  method: string;
  outcome: Outcome | 'blocked';
  status: number | string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Start a run: refuses while an unfinished journal exists (§8.5 interrupted runs). */
export function startRun(journalPath: string, registryPath: string, runId: string) {
  if (WriteJournal.unfinished(journalPath)) throw new RunBlocked(journalPath);
  return { journal: WriteJournal.create(journalPath, runId), registry: new OwnershipRegistry(registryPath), runId };
}

export class WriteGate implements Fence {
  readonly budget: WriteBudget;
  unexpected: string[] = [];
  allowed: string[] = [];
  prefetchBlocked: string[] = [];
  auth = 0;
  /** `request` events of the write class seen by the context (§8.5 cross-check of `attempted`). */
  writeRequestEvents = 0;
  /** This browser page's load set (§8.5 B0): the unit's ids at load, before the first gesture. */
  b0: Set<string> | null = null;
  stop: StopReport | null = null;
  readonly events: WriteEvent[] = [];
  navigations = 0;

  private creationPending = false;
  private held: WriteItem[] = [];
  private inflight = new Map<number, Promise<void>>();
  private settledUnknown = new Set<number>();
  private waiters: (() => void)[] = [];

  constructor(
    readonly phase: Phase,
    cap: number,
    readonly mock: EditorMock,
    readonly journal: WriteJournal,
    readonly registry: OwnershipRegistry,
    readonly unit: TargetUnit,
    readonly runId: string
  ) {
    this.budget = new WriteBudget(phase, cap);
  }

  async install(context: BrowserContext) {
    context.on('request', (r) => {
      if (classify(r.method(), new URL(r.url()), ORIGIN, API_PATH) === 'write') this.writeRequestEvents += 1;
    });
    context.on('page', (p) => this.watch(p));
    for (const p of context.pages()) this.watch(p);
    await context.route('**/*', (route, request) => this.onRequest(route, request));
  }

  private watch(p: Page) {
    p.on('framenavigated', (f) => {
      if (f === p.mainFrame()) this.navigations += 1;
    });
  }

  private async onRequest(route: Route, request: Request) {
    const url = new URL(request.url());
    const m = request.method();
    const cls = classify(m, url, ORIGIN, API_PATH);
    if (cls === 'write') return this.onWrite(route, request);
    if (cls === 'auth') {
      this.auth += 1;
      if (this.auth > 3) this.unexpected.push(`auth over 3: ${m} ${url.pathname}`);
      return route.abort('blockedbyclient'); // the harness has no sign-in; counted, never forwarded
    }
    if (cls === 'other-non-get') {
      this.unexpected.push(`${m} ${request.url()}`);
      return route.abort('blockedbyclient');
    }
    if (url.origin === ORIGIN && (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/e2e-harness/') || url.pathname === '/favicon.ico')) {
      this.allowed.push(`${m} ${url.pathname}`);
      return route.continue();
    }
    const h = await request.allHeaders();
    if (url.origin === ORIGIN && m === 'GET' && h['next-router-prefetch'] === '1' && h['rsc'] === '1') {
      this.prefetchBlocked.push(url.pathname);
      return route.abort('blockedbyclient');
    }
    this.unexpected.push(`${m} ${request.url()}`);
    return route.abort('blockedbyclient');
  }

  /** §8.5 synchronous reservation: no await between the check and the increment. */
  private onWrite(route: Route, request: Request) {
    if (!this.budget.reserve()) {
      this.emit({ seq: null, method: request.method(), outcome: 'blocked', status: null });
      return route.abort('blockedbyclient').catch(() => undefined);
    }
    const seq = this.journal.nextSeq();
    const method = request.method() as 'PUT' | 'POST';
    const body = method === 'PUT' ? (JSON.parse(request.postData() ?? 'null') as WriteItem['body']) : null;
    const item: WriteItem = { seq, method, route, request, body };
    if (this.creationPending) {
      this.held.push(item); // reserved and charged; forwarded only once attribution succeeds
      return;
    }
    return this.track(item);
  }

  private track(item: WriteItem) {
    const p = this.decide(item);
    this.inflight.set(item.seq, p);
    return p.finally(() => this.inflight.delete(item.seq));
  }

  /** Guard → journal (fsync) → forward to the mock → record the outcome. */
  private async decide(item: WriteItem) {
    const doc = item.body?.doc ?? null;
    const base = item.body?.baseRevision ?? null;
    const reason = this.stop ?? (item.method === 'PUT' ? this.guard(item.seq, doc) : null);
    if (reason) {
      if (!this.stop) this.stop = reason;
      this.journal.write(item.seq, this.phase, item.method, base, doc, false);
      this.journal.outcome(item.seq, 'not-forwarded', 'aborted-by-harness');
      this.emit({ seq: item.seq, method: item.method, outcome: 'not-forwarded', status: 'aborted-by-harness' });
      await item.route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    this.journal.write(item.seq, this.phase, item.method, base, doc, true);
    const idx = this.mock.writes.length; // `handle` pushes its record synchronously, before any await
    let status: number | string;
    try {
      await this.mock.handle(item.route, item.request);
      const w = this.mock.writes[idx];
      status = w ? w.status : 'network';
    } catch {
      status = 'network';
    }
    if (this.settledUnknown.has(item.seq)) return; // already recorded unknown at the settle deadline
    const outcome = outcomeOf(status === 'aborted' ? 'aborted' : typeof status === 'number' ? status : 'network');
    this.journal.outcome(item.seq, outcome, status);
    this.emit({ seq: item.seq, method: item.method, outcome, status });
  }

  /** §8.5 unattributed-id guard: an id on a target-unit page that is in neither B0 nor the registry. */
  private guard(seq: number, doc: EditorDoc | null): StopReport | null {
    if (!doc) return null;
    if (!this.b0) return { kind: 'no-b0', seq };
    const reg = this.registry.ids();
    const bad: string[] = [];
    for (const p of doc.pages) {
      if (!this.unit.pageIds.includes(p.id)) continue;
      for (const e of p.elements) if (!this.b0.has(e.id) && !reg.has(e.id)) bad.push(e.id);
    }
    return bad.length ? { kind: 'unattributed', seq, ids: bad } : null;
  }

  private emit(e: WriteEvent) {
    this.events.push(e);
    for (const w of this.waiters.splice(0)) w();
  }

  /** Wait for the next write event (from index `from`) matching `method`. */
  async nextEvent(method: 'PUT' | 'POST', from: number, timeoutMs = 15_000): Promise<WriteEvent | null> {
    const t0 = Date.now();
    for (;;) {
      const e = this.events.slice(from).find((x) => x.method === method);
      if (e) return e;
      if (Date.now() - t0 > timeoutMs) return null;
      await Promise.race([new Promise<void>((r) => this.waiters.push(r)), sleep(100)]);
    }
  }

  /** Open the editor through create-if-absent: the load is a budgeted write (POST). Null when blocked. */
  async load(page: Page): Promise<{ ed: Editor; doc: EditorDoc; revision: number } | null> {
    const from = this.events.length;
    const resp = page
      .waitForResponse((r) => new URL(r.url()).pathname === API_PATH && r.request().method() === 'POST', { timeout: 20_000 })
      .catch(() => null);
    await page.goto('/e2e-harness/create-if-absent');
    const ev = await this.nextEvent('POST', from, 20_000);
    if (!ev || ev.outcome !== 'committed') return null;
    const r = await resp;
    if (!r) return null;
    const json = (await r.json()) as { doc: EditorDoc; revision: number };
    const ed = new Editor(page, this.mock, this, 'create-if-absent');
    await ed.ready();
    this.b0 = new Set((await ed.stage()).unitIds);
    return { ed, doc: json.doc, revision: json.revision };
  }

  /**
   * §8.5 declared creation: intent (fsync) → hold saves → read before → gesture → read after (≤ 5 s) →
   * attribute (exactly one fresh id, selection exactly [it], no reload) → register (fsync) → release the
   * held saves in arrival order. Otherwise ambiguous: nothing registered, held and later saves aborted
   * unforwarded, and the run stops.
   */
  async declaredCreate(ed: Editor, kind: string, gesture: () => Promise<void>, timeoutMs = 5_000): Promise<string> {
    if (this.stop) throw new RunStopped(this.stop);
    const intentSeq = this.journal.intent(kind, this.unit.label);
    this.creationPending = true;
    const nav0 = this.navigations;
    const before = (await ed.stage()).unitIds;
    await gesture();
    let after = before;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      after = (await ed.stage()).unitIds;
      if (!sameSet(after, before)) break;
      await sleep(50);
    }
    const selection = (await ed.stage()).selected;
    const fresh = after.filter((id) => !before.includes(id));
    const reloaded = this.navigations !== nav0;
    if (fresh.length === 1 && selection.length === 1 && selection[0] === fresh[0] && !reloaded) {
      const id = fresh[0]!;
      this.registry.register({ runId: this.runId, intentSeq, kind, unit: this.unit, id, pageId: this.unit.pageIds.length === 1 ? this.unit.pageIds[0]! : this.pageInHeld(id) });
      this.release();
      return id;
    }
    this.stop = { kind: 'ambiguous', intent: { seq: intentSeq, kind }, before, after, selection, reloaded };
    this.release();
    throw new RunStopped(this.stop);
  }

  private pageInHeld(id: string): string | null {
    for (const h of this.held) for (const p of h.body?.doc.pages ?? []) if (p.elements.some((e) => e.id === id)) return p.id;
    return null;
  }

  private release() {
    this.creationPending = false;
    for (const item of this.held.splice(0)) void this.track(item);
  }

  /** §8.5 end of the action phase: close → settle (pending writes may answer) → offline → close. */
  async endPhase(context: BrowserContext, settleMs = 30_000, beforeClose?: () => Promise<void>) {
    this.budget.close();
    if (this.creationPending) this.release(); // an attribution still pending is resolved by its own call
    const t0 = Date.now();
    while (this.inflight.size && Date.now() - t0 < settleMs) await sleep(50);
    for (const seq of this.inflight.keys()) {
      this.settledUnknown.add(seq);
      this.journal.outcome(seq, 'unknown', 'pending-at-settle-deadline');
      this.emit({ seq, method: 'PUT', outcome: 'unknown', status: 'pending-at-settle-deadline' });
    }
    await context.setOffline(true);
    const mockWritesAtOffline = this.mock.writes.length;
    const attemptedAtOffline = this.budget.attempted;
    if (beforeClose) await beforeClose();
    await context.close();
    return { mockWritesAtOffline, attemptedAtOffline };
  }
}

/* --------------------------------------------------------------------------------------------------
 * Cleanup (§8.5): a fresh context with its own cap; fence when any action-phase outcome is unknown;
 * delete only registered ids that pass the location, selection and model-consistency checks; "clean"
 * only when every condition holds — otherwise recovery pending, journal left unfinished.
 * ------------------------------------------------------------------------------------------------ */

export interface CleanupReport {
  status: 'clean' | 'recovery-pending';
  reason: string | null;
  fenced: boolean;
  needFence: boolean;
  deleted: string[];
  pending: { id: string; reason: string }[];
  unknownWrites: { seq: number; baseRevision: number | null; ids: string[] }[];
  remainingRegistered: string[];
  budget: ReturnType<WriteBudget['snapshot']>;
  loads: number;
  gate: WriteGate;
}

function locate(doc: EditorDoc, id: string) {
  for (const p of doc.pages) for (const e of p.elements) if (e.id === id) return { pageId: p.id, element: e };
  return null;
}

const deepEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function cleanup(o: {
  browser: Browser;
  mock: EditorMock;
  journal: WriteJournal;
  registry: OwnershipRegistry;
  runId: string;
  unit: TargetUnit;
  cap: number;
  /** Called after each committed load (n = 0, 1, …) — lets a test commit a late write "between load and fence". */
  onAfterLoad?: (n: number) => Promise<void> | void;
  /** Called once, right after the fence commits — "after the fence". */
  onAfterFence?: () => Promise<void> | void;
}): Promise<CleanupReport> {
  const ctx = await o.browser.newContext({ baseURL: ORIGIN, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const gate = new WriteGate('cleanup', o.cap, o.mock, o.journal, o.registry, o.unit, o.runId);
  await gate.install(ctx);
  const actionUnknown = o.journal.read().writes.filter((w) => w.phase === 'action' && (w.outcome === 'unknown' || w.outcome === 'pending'));
  const needFence = actionUnknown.length > 0;
  let fenced = false;
  let loads = 0;
  const deleted: string[] = [];
  let pending: { id: string; reason: string }[] = [];
  let lastDoc: EditorDoc | null = null;

  const finish = async (status: 'clean' | 'recovery-pending', reason: string | null): Promise<CleanupReport> => {
    const j = o.journal.read();
    const reg = [...o.registry.ids()];
    const report: CleanupReport = {
      status,
      reason,
      fenced,
      needFence,
      deleted,
      pending,
      unknownWrites: j.writes.filter((w) => w.outcome === 'unknown' || w.outcome === 'pending').map((w) => ({ seq: w.seq, baseRevision: w.baseRevision, ids: Object.keys(w.elements) })),
      remainingRegistered: lastDoc ? reg.filter((id) => locate(lastDoc!, id)) : reg,
      budget: gate.budget.snapshot(),
      loads,
      gate,
    };
    const detail: Partial<CleanupReport> = { ...report };
    delete detail.gate;
    o.journal.report(status, detail);
    if (status === 'clean') o.journal.markFinished();
    await ctx.close().catch(() => undefined);
    return report;
  };

  for (let attempt = 0; attempt < 12; attempt++) {
    const page = await ctx.newPage();
    const loaded = await gate.load(page);
    if (!loaded) return finish('recovery-pending', 'cleanup load blocked or failed (C exhausted?)');
    lastDoc = loaded.doc;
    await o.onAfterLoad?.(loads++);
    const { ed } = loaded;

    // Plan: only registered ids, on their recorded unit, whose model matches one of our bodies.
    pending = [];
    const toDelete: string[] = [];
    const bodies = o.journal.read().writes.filter((w) => w.forwarded && (w.outcome === 'committed' || w.outcome === 'unknown'));
    for (const own of o.registry.entries()) {
      const at = locate(loaded.doc, own.id);
      if (!at) continue;
      if (!own.unit.pageIds.includes(at.pageId)) {
        pending.push({ id: own.id, reason: 'found off its recorded unit' });
        continue;
      }
      if (!bodies.some((b) => own.id in b.elements && deepEqual(b.elements[own.id], at.element))) {
        pending.push({ id: own.id, reason: 'model matches none of our bodies (changed by someone else)' });
        continue;
      }
      toDelete.push(own.id);
    }

    if (toDelete.length === 0) {
      if (needFence && !fenced) {
        if (pending.length) return finish('recovery-pending', 'nothing deletable and the fence is unconfirmed');
        // Fence marker through the declared-creation protocol: create (the fence), then delete next pass.
        const from = gate.events.length;
        const empty = await ed.at({ x: 120, y: 190 });
        try {
          await gate.declaredCreate(ed, 'fence-marker', async () => {
            await ed.page.keyboard.press('r');
            await ed.page.mouse.click(Math.round(empty.x), Math.round(empty.y));
          });
        } catch {
          return finish('recovery-pending', `fence marker not attributed: ${JSON.stringify(gate.stop)}`);
        }
        const ev = await gate.nextEvent('PUT', from, 15_000);
        if (ev?.outcome === 'committed') {
          fenced = true;
          await o.onAfterFence?.();
        } else if (ev?.outcome === 'not-committed' && ev.status === 409) {
          await page.close();
          continue; // 409 before the fence: reload and re-plan
        } else {
          return finish('recovery-pending', `fence write ${ev ? ev.outcome : 'never sent'}`);
        }
        await page.close();
        continue; // after a committed fence: reload — that document is final
      }
      // Verification load: nothing of ours left to delete.
      if (pending.length) return finish('recovery-pending', 'registered ids remain that cleanup may not delete');
      const cleanupWrites = o.journal.read().writes.filter((w) => w.phase === 'cleanup');
      if (!cleanupWrites.every((w) => w.outcome === 'committed')) return finish('recovery-pending', 'a cleanup write is not committed');
      if ([...o.registry.ids()].some((id) => locate(loaded.doc, id))) return finish('recovery-pending', 'a registered id is still present');
      return finish('clean', null);
    }

    // Delete one registered id by the editor's own Delete (a whole-document save of this revision).
    const id = toDelete[0]!;
    await ed.click(id);
    const sel = (await ed.stage()).selected;
    if (!(sel.length === 1 && sel[0] === id)) {
      pending.push({ id, reason: `selection was ${JSON.stringify(sel)}` });
      return finish('recovery-pending', 'selection check failed');
    }
    const from = gate.events.length;
    await ed.page.keyboard.press('Delete');
    const ev = await gate.nextEvent('PUT', from, 15_000);
    if (ev?.outcome === 'committed') {
      deleted.push(id);
      if (!fenced) {
        fenced = true;
        await o.onAfterFence?.();
      }
    } else if (ev?.outcome === 'not-committed' && ev.status === 409 && !fenced) {
      await page.close();
      continue;
    } else {
      return finish('recovery-pending', `delete write ${ev ? `${ev.outcome} (${ev.status})` : 'never sent'}`);
    }
    await page.close(); // reload before the next deletion or the verification
  }
  return finish('recovery-pending', 'too many cleanup attempts');
}
