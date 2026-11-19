/**
 * Slice D stage 8A — unit tests for the harness-only §8.5 helpers (budget, write journal, ownership
 * registry). Pure Node; no browser, no network, no production anything.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, WriteBudget, WriteBudgetExhausted } from './write-budget';
import { outcomeOf, WriteJournal } from './write-journal';
import { OwnershipRegistry } from './ownership-registry';

const dir = () => mkdtempSync(path.join(tmpdir(), 'baxter-8a-'));
const ORIGIN = 'http://127.0.0.1:3008';
const API = '/api/editor/e2e-harness';

describe('WriteBudget', () => {
  it('admits at most the cap however many reservations arrive; attempted = admitted + blocked', () => {
    const b = new WriteBudget('action', 3);
    const r = Array.from({ length: 50 }, () => b.reserve());
    expect(r.filter(Boolean)).toHaveLength(3);
    expect(b.snapshot()).toMatchObject({ attempted: 50, admitted: 3, blocked: 47 });
    expect(b.invariantsHold()).toBe(true);
  });

  it('a cap of 0 admits nothing; close() blocks every later reservation', () => {
    expect(new WriteBudget('cleanup', 0).reserve()).toBe(false);
    const b = new WriteBudget('cleanup', 8);
    expect(b.reserve()).toBe(true);
    b.close();
    expect(b.reserve()).toBe(false);
    expect(b.snapshot()).toMatchObject({ attempted: 2, admitted: 1, blocked: 1, closed: true });
  });

  it('exhaustion rejects `exhausted` once, and `step` makes an action throw at its next await', async () => {
    const b = new WriteBudget('action', 1);
    b.reserve();
    const never = new Promise<string>(() => undefined);
    const step = b.step(never);
    b.reserve(); // refused → signal
    await expect(step).rejects.toBeInstanceOf(WriteBudgetExhausted);
    await expect(b.exhausted).rejects.toMatchObject({ reason: 'cap', phase: 'action' });
  });

  it('classifies requests as §8.5 says', () => {
    const u = (p: string, o = ORIGIN) => new URL(p, o);
    expect(classify('PUT', u(API), ORIGIN, API)).toBe('write');
    expect(classify('POST', u(API), ORIGIN, API)).toBe('write');
    expect(classify('GET', u(API), ORIGIN, API)).toBe('read');
    expect(classify('PUT', u('/api/editor/other'), ORIGIN, API)).toBe('other-non-get');
    expect(classify('PUT', u(API, 'http://evil.test'), ORIGIN, API)).toBe('other-non-get');
    expect(classify('POST', u('/sign-in'), ORIGIN, API)).toBe('auth');
  });
});

describe('WriteJournal', () => {
  it('maps statuses to outcomes per the route contract', () => {
    expect(outcomeOf(200)).toBe('committed');
    for (const s of [400, 401, 404, 409, 413, 423]) expect(outcomeOf(s)).toBe('not-committed');
    for (const s of [500, 502, 'aborted', 'network', 'timeout', 'context-closed'] as const) expect(outcomeOf(s)).toBe('unknown');
  });

  it('appends fsynced lines; the first terminal outcome stands; finished only when marked', () => {
    const d = dir();
    const p = path.join(d, 'journal.jsonl');
    const j = WriteJournal.create(p, 'run-1');
    expect(() => WriteJournal.create(p, 'run-2')).toThrow(/already exists/);
    const s = j.nextSeq();
    j.write(s, 'action', 'PUT', 3, { version: 1, pages: [{ id: 'pg', kind: 'interior', elements: [{ id: 'e1' } as never] }] } as never, true);
    expect(j.read().writes[0]).toMatchObject({ seq: s, outcome: 'pending', baseRevision: 3, forwarded: true });
    j.outcome(s, 'unknown', 'pending-at-settle-deadline');
    j.outcome(s, 'committed', 200);
    expect(j.read().writes[0]).toMatchObject({ outcome: 'unknown' });
    expect(WriteJournal.unfinished(p)).toBe(true);
    j.markFinished();
    expect(WriteJournal.unfinished(p)).toBe(false);
    expect(readFileSync(p, 'utf8').trim().split('\n')).toHaveLength(5);
  });

  it('journaling never touches the ownership registry', () => {
    const d = dir();
    const j = WriteJournal.create(path.join(d, 'journal.jsonl'), 'run');
    const reg = new OwnershipRegistry(path.join(d, 'registry.jsonl'));
    const before = reg.size();
    j.write(j.nextSeq(), 'action', 'PUT', 1, { version: 1, pages: [{ id: 'pg', kind: 'interior', elements: [{ id: 'new-id' } as never] }] } as never, true);
    j.intent('create-rect', 'cover');
    expect(reg.size()).toBe(before);
    expect(reg.ids().size).toBe(0);
  });
});

describe('OwnershipRegistry', () => {
  it('records only what register() is given', () => {
    const reg = new OwnershipRegistry(path.join(dir(), 'registry.jsonl'));
    reg.register({ runId: 'r', intentSeq: 1, kind: 'create-rect', unit: { label: 'cover', pageIds: ['pg'] }, id: 'a', pageId: 'pg' });
    expect([...reg.ids()]).toEqual(['a']);
    expect(reg.entries()[0]).toMatchObject({ kind: 'create-rect', unit: { label: 'cover' } });
  });
});
