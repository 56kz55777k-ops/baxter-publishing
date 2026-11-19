/**
 * Slice D stage 8A — resize timing recorder, HARNESS BUILDS ONLY (plan §8.4; Codex's 8A P2 #2).
 *
 * Every call site is behind the build-time constant `BAXTER_E2E_HARNESS === '1'`, so a default build
 * contains neither the calls nor this module (verified per build by the exclusion verifier's markers).
 *
 * What it measures, per PREVIEW COMMIT (not per newest input):
 * - `move()` — Konva handed the app a resize move (anchorDragBoundFunc entry). Each move gets a sequence
 *   number and a timestamp and waits in the gesture's pending list.
 * - `commit()` — React committed a new resize preview (a layout effect on the preview object). The commit
 *   CLAIMS every pending move (the coalescing rule: all moves since the previous commit of this gesture
 *   are served by this commit) and schedules its own animation-frame callback, bound to this sample.
 * - the callback stamps that sample only: `callbackT` (performance.now() inside the callback) and
 *   `frameT` (the rAF timestamp). A later move or commit can never change an earlier sample's start.
 * - Latency of a sample = callbackT − (its OLDEST claimed move): the longest any served input waited
 *   for the next animation-frame callback after its preview committed. `newestLatency` (from the newest
 *   claimed move) is kept for comparison only.
 * - Moves that produce no preview stay pending and are claimed by the next commit of the same gesture
 *   (conservative: the user saw nothing new until then); moves still pending when the gesture ends are
 *   counted `unservedAtEnd`, never folded into another gesture.
 * - `end()` closes the gesture (preview cleared: release or cancel). Its scheduled callbacks still
 *   complete into ITS samples; the next move starts a new gesture with a new number.
 * - `teardown()` (the stage unmounts) cancels every pending callback; those samples are marked
 *   `cancelled` and a callback that fires anyway is ignored.
 * An animation-frame callback is NOT proof that a frame was painted; it is reported as what it is.
 */

export interface ResizeTimingSample {
  gesture: number;
  commit: number;
  /** Moves claimed by this commit (≥ 1). */
  moves: number;
  firstMoveSeq: number;
  lastMoveSeq: number;
  firstMoveT: number;
  lastMoveT: number;
  commitT: number;
  /** performance.now() inside the animation-frame callback scheduled by this commit. */
  callbackT: number | null;
  /** The rAF timestamp passed to that callback (the frame's start time as the browser reports it). */
  frameT: number | null;
  status: 'pending' | 'measured' | 'cancelled';
}

export interface ResizeTimingSnapshot {
  gestures: number;
  movesTotal: number;
  commitsTotal: number;
  /** Commits with no new move since the previous commit (not samples). */
  commitsWithoutMoves: number;
  unservedAtEnd: number;
  samples: ResizeTimingSample[];
  moveTimes: number[];
}

export interface TimingEnv {
  now(): number;
  raf(cb: (frameT: number) => void): number;
  caf(id: number): void;
}

export function createResizeTimingRecorder(env: TimingEnv) {
  let gesture = 0;
  let active = false;
  let moveSeq = 0;
  let commitSeq = 0;
  let pending: { seq: number; t: number }[] = [];
  let unservedAtEnd = 0;
  let commitsWithoutMoves = 0;
  const samples: ResizeTimingSample[] = [];
  const moveTimes: number[] = [];
  const scheduled = new Map<number, ResizeTimingSample>();

  return {
    move() {
      if (!active) {
        active = true;
        gesture += 1;
      }
      moveSeq += 1;
      const t = env.now();
      pending.push({ seq: moveSeq, t });
      moveTimes.push(t);
    },
    commit() {
      if (!active) return;
      commitSeq += 1;
      if (pending.length === 0) {
        commitsWithoutMoves += 1;
        return;
      }
      const first = pending[0]!;
      const last = pending[pending.length - 1]!;
      const s: ResizeTimingSample = {
        gesture,
        commit: commitSeq,
        moves: pending.length,
        firstMoveSeq: first.seq,
        lastMoveSeq: last.seq,
        firstMoveT: first.t,
        lastMoveT: last.t,
        commitT: env.now(),
        callbackT: null,
        frameT: null,
        status: 'pending',
      };
      pending = [];
      samples.push(s);
      const id = env.raf((frameT) => {
        if (s.status !== 'pending') return; // cancelled at teardown: a late callback changes nothing
        s.callbackT = env.now();
        s.frameT = frameT;
        s.status = 'measured';
        scheduled.delete(id);
      });
      scheduled.set(id, s);
    },
    end() {
      if (!active) return;
      unservedAtEnd += pending.length;
      pending = [];
      active = false;
    },
    teardown() {
      for (const [id, s] of scheduled) {
        env.caf(id);
        s.status = 'cancelled';
      }
      scheduled.clear();
      unservedAtEnd += pending.length;
      pending = [];
      active = false;
    },
    reset() {
      for (const [id, s] of scheduled) {
        env.caf(id);
        s.status = 'cancelled';
      }
      scheduled.clear();
      gesture = 0;
      active = false;
      moveSeq = 0;
      commitSeq = 0;
      pending = [];
      unservedAtEnd = 0;
      commitsWithoutMoves = 0;
      samples.length = 0;
      moveTimes.length = 0;
    },
    snapshot(): ResizeTimingSnapshot {
      return {
        gestures: gesture,
        movesTotal: moveSeq,
        commitsTotal: commitSeq,
        commitsWithoutMoves,
        unservedAtEnd,
        samples: samples.map((s) => ({ ...s })),
        moveTimes: [...moveTimes],
      };
    },
  };
}

export type ResizeTimingRecorder = ReturnType<typeof createResizeTimingRecorder>;

/** The page's recorder (harness builds only): `window.__baxterResizeTiming`, created on first use. */
export function harnessResizeTiming(): ResizeTimingRecorder {
  const w = window as unknown as { __baxterResizeTiming?: ResizeTimingRecorder };
  if (!w.__baxterResizeTiming) {
    w.__baxterResizeTiming = createResizeTimingRecorder({
      now: () => performance.now(),
      raf: (cb) => requestAnimationFrame(cb),
      caf: (id) => cancelAnimationFrame(id),
    });
  }
  return w.__baxterResizeTiming;
}

/** Latency of a measured sample from its oldest claimed move (ms). */
export function sampleLatency(s: ResizeTimingSample): number | null {
  return s.callbackT === null ? null : s.callbackT - s.firstMoveT;
}
