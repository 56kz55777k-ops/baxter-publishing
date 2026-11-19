/**
 * Slice D stage 8A correction — the resize timing recorder (Codex's 8A P2 #2), deterministic.
 * A fake clock and a fake animation-frame scheduler drive the real recorder. `legacy` re-implements the
 * reviewed algorithm (measure from the NEWEST global move mark at callback time, then clear all marks)
 * so each scenario shows what the old measurement reported against the corrected one.
 */
import { describe, expect, it } from 'vitest';
import { createResizeTimingRecorder, sampleLatency } from '@/components/editor/resize-timing';

function harness() {
  let now = 0;
  let nextId = 1;
  const frames = new Map<number, (t: number) => void>();
  const cancelled: number[] = [];
  const rec = createResizeTimingRecorder({
    now: () => now,
    raf: (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    caf: (id) => {
      cancelled.push(id);
      frames.delete(id);
    },
  });
  // The reviewed algorithm, for comparison: one global mark list; each callback measures from the newest.
  let marks: number[] = [];
  const legacy: number[] = [];
  const legacyFrames: (() => void)[] = [];
  return {
    rec,
    at: (t: number) => void (now = t),
    move: () => {
      rec.move();
      marks.push(now);
    },
    commit: () => {
      rec.commit();
      legacyFrames.push(() => {
        if (marks.length === 0) return;
        legacy.push(now - marks[marks.length - 1]!);
        marks = [];
      });
    },
    /** Run every scheduled frame callback (one frame), with the frame timestamp = now. */
    frame: () => {
      const cbs = [...frames.values()];
      frames.clear();
      for (const cb of cbs) cb(now);
      for (const f of legacyFrames.splice(0)) f();
    },
    /** Fire a callback that was cancelled (a browser that runs it anyway). */
    fireCancelled: (cb?: (t: number) => void) => cb?.(now),
    frames,
    cancelled,
    legacy,
  };
}

const lat = (h: ReturnType<typeof harness>) => h.rec.snapshot().samples.map((s) => sampleLatency(s));

describe('resize timing recorder', () => {
  it("Codex's scenario: move+commit at 0 ms, a newer move at 100 ms with no commit, the callback at 101 ms → 101 ms (legacy reported 1 ms)", () => {
    const h = harness();
    h.at(0);
    h.move();
    h.commit();
    h.at(100);
    h.move(); // newer input, no preview commit
    h.at(101);
    h.frame();
    expect(lat(h)).toEqual([101]);
    expect(h.legacy).toEqual([1]);
    const snap = h.rec.snapshot();
    expect(snap.samples[0]).toMatchObject({ moves: 1, firstMoveSeq: 1, lastMoveSeq: 1, status: 'measured' });
    // The 100 ms move is still pending: it belongs to the next commit, not to this sample.
    h.rec.end();
    expect(h.rec.snapshot().unservedAtEnd).toBe(1);
  });

  it('several moves coalesced into one preview: one sample claiming all of them, latency from the oldest', () => {
    const h = harness();
    for (const t of [0, 5, 10]) {
      h.at(t);
      h.move();
    }
    h.at(12);
    h.commit();
    h.at(20);
    h.frame();
    const s = h.rec.snapshot().samples;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ moves: 3, firstMoveT: 0, lastMoveT: 10, commitT: 12, callbackT: 20 });
    expect(lat(h)).toEqual([20]);
    expect(h.legacy).toEqual([10]);
  });

  it('several commits before one frame: each sample keeps its own start; the later commit does not reset the earlier', () => {
    const h = harness();
    h.at(0);
    h.move();
    h.at(1);
    h.commit();
    h.at(5);
    h.move();
    h.at(6);
    h.commit();
    h.at(16);
    h.frame();
    expect(lat(h)).toEqual([16, 11]);
    expect(h.rec.snapshot().samples.map((s) => s.frameT)).toEqual([16, 16]); // one frame, two samples
    expect(h.legacy).toEqual([11]); // the legacy path lost the first sample entirely
  });

  it('moves that produce no new preview: claimed by the next commit of the gesture, or counted unserved at its end', () => {
    const h = harness();
    h.at(0);
    h.move();
    h.at(16);
    h.move(); // e.g. a Konva skip: no preview
    h.at(30);
    h.commit();
    h.at(33);
    h.frame();
    expect(h.rec.snapshot().samples[0]).toMatchObject({ moves: 2, firstMoveT: 0 });
    expect(lat(h)).toEqual([33]);
    h.at(40);
    h.move();
    h.at(50);
    h.move();
    h.rec.end(); // released before any further preview
    const snap = h.rec.snapshot();
    expect(snap.unservedAtEnd).toBe(2);
    expect(snap.samples).toHaveLength(1);
    // A commit with nothing new to serve is counted, not sampled.
    h.at(60);
    h.move();
    h.commit();
    h.commit();
    expect(h.rec.snapshot().commitsWithoutMoves).toBe(1);
  });

  it('cancellation and unmount: pending callbacks are cancelled and ignored if they fire; the next gesture is separate', () => {
    const h = harness();
    h.at(0);
    h.move();
    h.commit();
    const [id, cb] = [...h.frames.entries()][0]!;
    h.rec.end(); // the gesture ends (Escape) before its frame
    h.rec.teardown(); // the stage unmounts
    expect(h.cancelled).toEqual([id]);
    h.at(500);
    h.fireCancelled(cb); // a browser that runs it anyway
    expect(h.rec.snapshot().samples[0]).toMatchObject({ status: 'cancelled', callbackT: null });
    // A subsequent gesture: new number, its own samples, unaffected by the old one.
    h.at(1000);
    h.move();
    h.commit();
    h.at(1010);
    h.frame();
    const snap = h.rec.snapshot();
    expect(snap.gestures).toBe(2);
    expect(snap.samples.map((s) => [s.gesture, s.status])).toEqual([
      [1, 'cancelled'],
      [2, 'measured'],
    ]);
    expect(lat(h).at(-1)).toBe(10);
  });

  it("a late callback from an ended gesture writes only into its own sample, not the next gesture's", () => {
    const h = harness();
    h.at(0);
    h.move();
    h.commit(); // gesture 1's callback still pending
    h.rec.end();
    h.at(5);
    h.move(); // gesture 2 begins
    h.commit();
    h.at(40);
    h.frame(); // both callbacks run in the same frame
    const s = h.rec.snapshot().samples;
    expect(s.map((x) => [x.gesture, sampleLatency(x)])).toEqual([
      [1, 40],
      [2, 35],
    ]);
  });

  it('NEGATIVE CONTROL — deliberately delayed frames: an 80 ms frame delay with inputs every 16 ms is exposed (legacy hid it)', () => {
    const h = harness();
    let t = 0;
    for (let frame = 0; frame < 10; frame++) {
      // Inputs keep arriving and committing every 16 ms, but the frame callback only runs every ~80 ms.
      for (let k = 0; k < 5; k++) {
        h.at(t);
        h.move();
        h.commit();
        t += 16;
      }
      h.at(t - 1); // the delayed frame runs just after the newest input
      h.frame();
    }
    const corrected = lat(h).filter((x): x is number => x !== null);
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    expect(Math.max(...corrected)).toBeGreaterThanOrEqual(79);
    expect(median(corrected)).toBeGreaterThanOrEqual(30);
    expect(Math.max(...h.legacy)).toBeLessThanOrEqual(15); // the reviewed metric reported ≤ 15 ms throughout
  });
});
