/**
 * Stage 8A — resize performance on the 30-element reference document (plan §8.4, AC-18), measured with the
 * per-commit recorder (components/editor/resize-timing.ts; harness builds only; Codex's 8A P2 #2).
 *
 * Definitions (every number in the report is one of these):
 * - DELIVERED MOVES: moves Konva handed the app (anchorDragBoundFunc entries) during the measured sweep.
 * - COMMIT: React committed a new resize preview. A commit CLAIMS every move since the previous commit of
 *   the gesture (coalescing rule); moves with no later commit are `unservedAtEnd`.
 * - LATENCY (the gated metric): for each commit, (performance.now() in the animation-frame callback that
 *   commit scheduled) − (its OLDEST claimed move). A later input cannot change an earlier sample.
 *   `newestMoveLatency` (from the newest claimed move) is reported for comparison only.
 * - UPDATE CADENCE: commits per second over the sweep window (first to last delivered move).
 * - FRAME-CALLBACK CADENCE: distinct rAF timestamps that carried at least one resize commit, per second,
 *   and the intervals between them. An animation-frame callback is NOT proof of a painted frame.
 * - LEGACY-STYLE (reference only): for each distinct callback, callback − newest move at or before it —
 *   what the reviewed instrumentation effectively reported. Never gated.
 *
 * Input: REAL Playwright mouse moves, 120 paced over 2 s (≥ 60 delivered required).
 * Gates: the plan's §8.4 gate (median LATENCY ≤ 18.2 ms) is asserted in Chromium and Firefox. AC-18's
 * "≥ 55 fps" is REPORTED (update and frame-callback cadence vs 55) and not asserted: how AC-18 is measured
 * is an open decision for Ben (plan §10.3 Q8); the two are not equivalent. WebKit is reported, not gated
 * (the VM's WebKit is software-rendered; native-Mac remeasurement per §8.4).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page-script globals (the harness recorder, test counters) */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { test, expect, type Page } from '@playwright/test';
import { openEditor, expectFenced, fid, RUN_DIR, type Editor } from './spec-kit';

// Not serial: a failed gate in one test must not skip the negative control or the baseline.
test.describe.configure({ timeout: 180_000 });

const TARGET = fid(0x500); // rect, verso of spread 1, (14, 16) 30 × 24
const N = 120;
const SWEEP_MS = 2000;

const q = (xs: number[], p: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const dist = (xs: number[]) => ({ n: xs.length, median: r2(q(xs, 0.5)), p95: r2(q(xs, 0.95)), max: r2(xs.length ? Math.max(...xs) : NaN) });

interface Snapshot {
  gestures: number;
  movesTotal: number;
  commitsTotal: number;
  commitsWithoutMoves: number;
  unservedAtEnd: number;
  samples: { gesture: number; moves: number; firstMoveT: number; lastMoveT: number; commitT: number; callbackT: number | null; frameT: number | null; status: string }[];
  moveTimes: number[];
}

/** One paced resize sweep on the target's bottom-right anchor; returns the recorder snapshot. */
async function sweep(page: Page, ed: Editor) {
  await page.evaluate(() => (window as any).__baxterResizeTiming?.reset());
  const a = await ed.anchorPoint(TARGET, 'bottom-right');
  await page.mouse.move(Math.round(a.x), Math.round(a.y));
  await page.mouse.down();
  const t0 = Date.now();
  for (let i = 1; i <= N; i++) {
    // A Lissajous-like path: both axes, growing and shrinking, never crossing the fixed corner.
    const dx = 60 + 50 * Math.sin((i / N) * Math.PI * 4);
    const dy = 40 + 30 * Math.sin((i / N) * Math.PI * 6);
    await page.mouse.move(Math.round(a.x + dx), Math.round(a.y + dy));
    const wait = t0 + (i * SWEEP_MS) / N - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
  }
  const elapsed = Date.now() - t0;
  await page.waitForTimeout(300); // let scheduled callbacks run before the release ends the gesture
  const snap = (await page.evaluate(() => (window as any).__baxterResizeTiming.snapshot())) as Snapshot;
  await page.mouse.up();
  return { snap, elapsed };
}

function analyse(snap: Snapshot, elapsed: number) {
  const measured = snap.samples.filter((s) => s.status === 'measured' && s.callbackT !== null);
  const latency = measured.map((s) => s.callbackT! - s.firstMoveT);
  const newest = measured.map((s) => s.callbackT! - s.lastMoveT);
  const moveToCommit = measured.map((s) => s.commitT - s.firstMoveT);
  const commitToCallback = measured.map((s) => s.callbackT! - s.commitT);
  const coalesced = snap.samples.map((s) => s.moves);
  const moveWindow = snap.moveTimes.length > 1 ? snap.moveTimes[snap.moveTimes.length - 1]! - snap.moveTimes[0]! : NaN;
  const frames = [...new Set(measured.map((s) => s.frameT!))].sort((a, b) => a - b);
  const intervals = frames.slice(1).map((t, i) => t - frames[i]!);
  const callbacks = [...new Set(measured.map((s) => s.callbackT!))].sort((a, b) => a - b);
  const legacy = callbacks
    .map((c) => {
      const newestMove = snap.moveTimes.filter((t) => t <= c).pop();
      return newestMove === undefined ? NaN : c - newestMove;
    })
    .filter((x) => !Number.isNaN(x));
  const statuses: Record<string, number> = {};
  for (const s of snap.samples) statuses[s.status] = (statuses[s.status] ?? 0) + 1;
  return {
    sweep: { movesSent: N, movesDelivered: snap.movesTotal, elapsedMs: elapsed, moveWindowMs: r2(moveWindow) },
    commits: { total: snap.commitsTotal, sampled: snap.samples.length, withoutNewMoves: snap.commitsWithoutMoves, measured: measured.length, statuses },
    coalescing: { movesPerCommit: dist(coalesced), commitsClaimingMoreThanOneMove: coalesced.filter((m) => m > 1).length, unservedAtEnd: snap.unservedAtEnd },
    latencyMs: dist(latency),
    newestMoveLatencyMs: dist(newest),
    /** Diagnostic split of LATENCY: oldest claimed move → its commit, and commit → its frame callback. */
    latencySplitMs: { moveToCommit: dist(moveToCommit), commitToCallback: dist(commitToCallback) },
    updateCadencePerSec: r2((snap.samples.length * 1000) / moveWindow),
    frameCallbackCadencePerSec: r2(((frames.length - 1) * 1000) / (frames[frames.length - 1]! - frames[0]!)),
    frameCallbackIntervalMs: dist(intervals),
    legacyStyleNewestMoveToCallbackMs: dist(legacy),
  };
}

async function environment(page: Page, browserVersion: string) {
  const env = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') ?? c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      dpr: window.devicePixelRatio,
      webglRenderer: gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL reported',
    };
  });
  return {
    browser: test.info().project.name,
    version: browserVersion,
    headless: true,
    hardware: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()} ${os.arch()}` },
    rendering: env,
  };
}

function write(name: string, data: unknown) {
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(`${RUN_DIR}/${name}-${test.info().project.name}.json`, JSON.stringify(data, null, 2));
}

test('resize latency and cadence on the reference document (2 s paced sweep, per-commit recorder)', async ({ page, context, browser }) => {
  const ed = await openEditor(page, context, 'reference30');
  await ed.goToUnit(1);
  expect((await ed.stage()).unitIds).toHaveLength(30);
  await ed.click(TARGET);

  await sweep(page, ed); // warm-up (JIT, caches); not reported
  await ed.waitForPuts(1);
  const { snap, elapsed } = await sweep(page, ed);
  await ed.waitForPuts(2);

  const a = analyse(snap, elapsed);
  const verdicts = {
    planGate_medianLatencyLe18_2ms: a.latencyMs.median <= 18.2 ? 'pass' : 'fail',
    ac18_updateCadenceGe55: a.updateCadencePerSec >= 55 ? 'meets' : 'below',
    ac18_frameCallbackCadenceGe55: a.frameCallbackCadencePerSec >= 55 ? 'meets' : 'below',
    note: 'AC-18 (≥ 55 fps) is reported, not asserted: its measurement is an open decision (plan §10.3 Q8).',
  };
  const result = {
    ...(await environment(page, browser.version())),
    instrumentation: 'per-commit recorder: moves at anchorDragBoundFunc entry, claimed by the next preview commit (layout effect), each commit stamped by its own rAF callback',
    ...a,
    verdicts,
    raw: snap,
  };
  write('perf', result);
  test.info().annotations.push({ type: 'perf', description: JSON.stringify({ ...result, raw: undefined }) });
  console.log(`PERF ${JSON.stringify({ ...result, raw: undefined })}`);

  // Validity of the measurement itself.
  expect(a.sweep.movesDelivered).toBeGreaterThanOrEqual(60);
  expect(elapsed).toBeGreaterThanOrEqual(1900);
  expect(a.commits.statuses['cancelled'] ?? 0).toBe(0);
  if (result.browser !== 'webkit') {
    expect(a.commits.measured).toBeGreaterThanOrEqual(30);
    expect(a.latencyMs.median).toBeLessThanOrEqual(18.2); // plan §8.4 gate, on the corrected metric
  }
  expectFenced(ed);
});

test('NEGATIVE CONTROL — deliberately delayed frames (a 70 ms busy wait in every animation frame) are exposed by the corrected latency', async ({ page, context }) => {
  const ed = await openEditor(page, context, 'reference30');
  await ed.goToUnit(1);
  await ed.click(TARGET);
  await page.evaluate(() => {
    (window as any).__burn = true;
    const burn = () => {
      const t = performance.now();
      while (performance.now() - t < 70) {
        /* a long task inside every frame */
      }
      if ((window as any).__burn) requestAnimationFrame(burn);
    };
    requestAnimationFrame(burn);
  });
  const { snap, elapsed } = await sweep(page, ed);
  await page.evaluate(() => ((window as any).__burn = false));
  const a = analyse(snap, elapsed);
  write('perf-negative-delayed-frames', { browser: test.info().project.name, ...a, raw: snap });
  console.log(`PERFNEG ${JSON.stringify({ browser: test.info().project.name, latency: a.latencyMs, legacy: a.legacyStyleNewestMoveToCallbackMs, cadence: a.updateCadencePerSec, frameCadence: a.frameCallbackCadencePerSec, coalescing: a.coalescing })}`);
  expect(a.commits.measured).toBeGreaterThanOrEqual(5);
  expect(a.latencyMs.median).toBeGreaterThan(40); // the delay is visible …
  expect(a.latencyMs.median).toBeGreaterThan(18.2); // … and fails the gate, as it must
  expect(a.frameCallbackCadencePerSec).toBeLessThan(20);
  expectFenced(ed);
});

/**
 * Context only (not gated): the same 2 s paced input over the same document, counting animation-frame
 * callbacks (an rAF loop; not proof of paint) during an idle second, a hover (no redraw), the existing
 * Slice C object drag and a resize.
 */
test('baseline comparison (recorded, not gated): rAF callbacks per second while idle, hovering, dragging an object and resizing', async ({ page, context }, ti) => {
  const ed = await openEditor(page, context, 'reference30');
  await ed.goToUnit(1);
  const idle = await page.evaluate(() => new Promise<number>((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
  const id = fid(0x503);
  await ed.click(id);
  const r = (await ed.live(id)).rect; const st = await ed.stage();
  const cx = Math.round(st.left + r.x + r.width / 2), cy = Math.round(st.top + r.y + r.height / 2);
  const count = async (gesture: () => Promise<void>) => {
    await page.evaluate(() => { (window as any).__f = 0; (window as any).__run = true; const f = () => { (window as any).__f++; if ((window as any).__run) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const t0 = Date.now(); await gesture(); const el = Date.now() - t0;
    const f = await page.evaluate(() => { (window as any).__run = false; return (window as any).__f; });
    return +(f * 1000 / el).toFixed(1);
  };
  const paced = async (x0: number, y0: number) => { await page.mouse.move(x0, y0); await page.mouse.down(); const t0 = Date.now(); for (let i = 1; i <= 120; i++) { await page.mouse.move(Math.round(x0 + 40 * Math.sin(i / 10)), Math.round(y0 + 30 * Math.sin(i / 7))); const w = t0 + i * 2000 / 120 - Date.now(); if (w > 0) await page.waitForTimeout(w); } await page.mouse.up(); };
  const dragRafPerSec = await count(() => paced(cx, cy));
  await ed.click(id);
  const a = await ed.anchorPoint(id, 'bottom-right');
  const resizeRafPerSec = await count(() => paced(Math.round(a.x), Math.round(a.y)));
  const hoverRafPerSec = await count(async () => { const t0 = Date.now(); for (let i = 1; i <= 120; i++) { await page.mouse.move(300 + (i % 50), 300); const w = t0 + i * 2000 / 120 - Date.now(); if (w > 0) await page.waitForTimeout(w); } });
  const out = { browser: ti.project.name, unit: 'animation-frame callbacks per second (not painted frames)', idle, hoverRafPerSec, objectDragRafPerSec: dragRafPerSec, resizeRafPerSec };
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(`${RUN_DIR}/perf-baseline-${ti.project.name}.json`, JSON.stringify(out, null, 2));
  ti.annotations.push({ type: 'perf-baseline', description: JSON.stringify(out) });
  console.log(`BASE ${JSON.stringify(out)}`);
  expectFenced(ed);
});
