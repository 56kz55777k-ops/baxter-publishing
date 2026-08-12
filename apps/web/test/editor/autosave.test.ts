import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  AutosaveScheduler,
  type AutosaveOutcome,
} from '@/components/editor/state/autosave-core';

/**
 * Fake driver: `dirty` is the reference-inequality the reducer derives;
 * `outcomes` scripts what each performSave resolves to. `pending` lets a
 * test hold a save in flight and resolve it manually.
 */
function makeDriver() {
  const calls: number[] = [];
  let dirty = false;
  let outcomes: AutosaveOutcome[] = [];
  let hold: ((o: AutosaveOutcome) => void) | null = null;
  let holdNext = false;

  const driver = {
    isDirty: () => dirty,
    performSave: (): Promise<AutosaveOutcome> => {
      calls.push(Date.now());
      if (holdNext) {
        holdNext = false;
        return new Promise<AutosaveOutcome>((resolve) => {
          hold = resolve;
        });
      }
      const o = outcomes.shift() ?? 'saved';
      if (o === 'saved') dirty = false;
      return Promise.resolve(o);
    },
  };

  return {
    driver,
    calls,
    setDirty: (v: boolean) => {
      dirty = v;
    },
    script: (...o: AutosaveOutcome[]) => {
      outcomes = o;
    },
    holdNextSave: () => {
      holdNext = true;
    },
    resolveHeld: (o: AutosaveOutcome) => {
      if (o === 'saved') dirty = false;
      hold?.(o);
      hold = null;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AutosaveScheduler — timing and ordering (blueprint §2.5)', () => {
  it('saves once, 2 s after the last commit (debounce restarts per commit)', async () => {
    const d = makeDriver();
    const s = new AutosaveScheduler(d.driver);

    d.setDirty(true);
    s.noteCommit();
    await vi.advanceTimersByTimeAsync(1_000);
    s.noteCommit(); // restarts the 2 s window
    await vi.advanceTimersByTimeAsync(1_999);
    expect(d.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(d.calls).toHaveLength(1);
    s.dispose();
  });

  it('max-wait: continuous commits still reach the server at 10 s', async () => {
    const d = makeDriver();
    const s = new AutosaveScheduler(d.driver);

    d.setDirty(true);
    // Commit every second forever — the debounce alone would never fire.
    for (let t = 0; t < 10; t++) {
      s.noteCommit();
      await vi.advanceTimersByTimeAsync(1_000);
      if (d.calls.length > 0) break;
    }
    expect(d.calls).toHaveLength(1); // fired by max-wait at ~10 s
    s.dispose();
  });

  it('nothing to save → no request (clean flush is silent)', async () => {
    const d = makeDriver();
    const s = new AutosaveScheduler(d.driver);
    d.setDirty(false);
    s.noteCommit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS + AUTOSAVE_DEBOUNCE_MS);
    expect(d.calls).toHaveLength(0);
    s.dispose();
  });

  it('ONE in-flight save; edits during flight trigger a follow-up after it resolves', async () => {
    const d = makeDriver();
    const s = new AutosaveScheduler(d.driver);

    d.setDirty(true);
    d.holdNextSave();
    s.noteCommit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(d.calls).toHaveLength(1); // in flight, held

    s.noteCommit(); // user keeps editing during the flight
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 100);
    expect(d.calls).toHaveLength(1); // never two in flight

    d.resolveHeld('saved');
    d.setDirty(true); // the mid-flight edit is still unsaved (reducer semantics)
    await vi.advanceTimersByTimeAsync(0);
    s.noteCommit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(d.calls).toHaveLength(2);
    s.dispose();
  });

  it('failure ladder 10 s → 30 s → 60 s → hold 60 s; success resets it', async () => {
    const d = makeDriver();
    const s = new AutosaveScheduler(d.driver);

    d.setDirty(true);
    d.script('failed', 'failed', 'failed', 'failed', 'saved');
    s.noteCommit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(d.calls).toHaveLength(1); // attempt 1 fails

    await vi.advanceTimersByTimeAsync(9_999);
    expect(d.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); // +10 s
    expect(d.calls).toHaveLength(2); // attempt 2 fails

    await vi.advanceTimersByTimeAsync(30_000); // +30 s
    expect(d.calls).toHaveLength(3); // attempt 3 fails

    await vi.advanceTimersByTimeAsync(60_000); // +60 s
    expect(d.calls).toHaveLength(4); // attempt 4 fails (ladder holds at 60)

    await vi.advanceTimersByTimeAsync(60_000); // +60 s
    expect(d.calls).toHaveLength(5); // attempt 5 succeeds → ladder resets

    d.setDirty(true);
    d.script('failed');
    s.noteCommit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(d.calls).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(10_000); // back to the 10 s tier
    expect(d.calls).toHaveLength(7);
    s.dispose();
  });

  it('commits during backoff mark dirty but do NOT shorten the retry wait', async () => {
    const d = makeDriver();
    const s = new AutosaveScheduler(d.driver);

    d.setDirty(true);
    d.script('failed', 'saved');
    s.noteCommit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS); // attempt 1 fails; 10 s backoff armed

    s.noteCommit(); // typing during backoff
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 1_000);
    expect(d.calls).toHaveLength(1); // debounce did NOT preempt the ladder

    await vi.advanceTimersByTimeAsync(7_000); // 10 s total since the failure
    expect(d.calls).toHaveLength(2);
    s.dispose();
  });

  it('conflict is terminal: no further attempts, ever', async () => {
    const d = makeDriver();
    const s = new AutosaveScheduler(d.driver);

    d.setDirty(true);
    d.script('conflict');
    s.noteCommit();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(d.calls).toHaveLength(1);
    expect(s.isTerminal).toBe(true);

    s.noteCommit();
    s.flushNow();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(d.calls).toHaveLength(1);
    s.dispose();
  });

  it('flushNow saves immediately when dirty (beforeunload path)', async () => {
    const d = makeDriver();
    const s = new AutosaveScheduler(d.driver);
    d.setDirty(true);
    s.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.calls).toHaveLength(1);
    s.dispose();
  });

  it('dispose cancels every pending timer and schedules nothing after', async () => {
    const d = makeDriver();
    const s = new AutosaveScheduler(d.driver);
    d.setDirty(true);
    s.noteCommit();
    s.dispose();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS * 2);
    expect(d.calls).toHaveLength(0);
  });
});
