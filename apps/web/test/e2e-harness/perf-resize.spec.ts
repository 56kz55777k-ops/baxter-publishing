/**
 * Stage 8A — resize performance (plan §8.4, AC-18) on the 30-element reference document.
 *
 * Instrumentation (harness builds only; dead code in a default build — proven separately):
 * - start: `performance.mark('baxter:editor:resize-move')` at the top of the Transformer's
 *   `anchorDragBoundFunc` (the earliest point Konva hands the app a move; earlier than the plan's
 *   `boxBound`, so each sample is a slightly LONGER span);
 * - end: `performance.measure('baxter:editor:resize-frame', <that mark>)` inside the
 *   requestAnimationFrame scheduled by the effect that runs after React commits the preview — i.e. at
 *   the start of the next frame after the commit. It is NOT handler time and NOT a paint timestamp.
 * When several moves arrive before a frame, the frame measures from the latest mark (then clears).
 *
 * Input: REAL Playwright mouse moves, paced to a 2-second sweep of 120 moves (≥ 60 required).
 * Gate: median ≤ 18.2 ms in Chromium and Firefox. WebKit is measured and reported, not gated (the VM's
 * WebKit is software-rendered; a failing result needs a native-Mac remeasurement).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page-script globals (Konva's untyped stage, test counters) and loosely typed document elements */
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import { test, expect } from '@playwright/test';
import { openEditor, expectFenced, fid } from './spec-kit';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const TARGET = fid(0x500); // rect, verso of spread 1, (14, 16) 30 × 24

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};

test('resize frame time on the reference document (2 s sweep)', async ({ page, context, browser }) => {
  const ed = await openEditor(page, context, 'reference30');
  await ed.goToUnit(1);
  expect((await ed.stage()).unitIds).toHaveLength(30);
  await ed.click(TARGET);

  const sweep = async (record: boolean) => {
    await page.evaluate((record) => {
      performance.clearMeasures('baxter:editor:resize-frame');
      performance.clearMarks('baxter:editor:resize-move');
      (window as any).__moves = 0;
      (window as any).__markT = [];
      (window as any).__frameT = [];
      if (record && !(window as any).__obs) {
        (window as any).__obs = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            if (e.name === 'baxter:editor:resize-move') {
              (window as any).__moves += 1;
              (window as any).__markT.push(e.startTime);
            } else if (e.name === 'baxter:editor:resize-frame') (window as any).__frameT.push(e.startTime + e.duration);
          }
        });
        (window as any).__obs.observe({ entryTypes: ['mark', 'measure'] });
      }
    }, record);
    const a = await ed.anchorPoint(TARGET, 'bottom-right');
    await page.mouse.move(Math.round(a.x), Math.round(a.y));
    await page.mouse.down();
    const N = 120;
    const t0 = Date.now();
    for (let i = 1; i <= N; i++) {
      // A Lissajous-like path: both axes, growing and shrinking, never crossing the fixed corner.
      const dx = 60 + 50 * Math.sin((i / N) * Math.PI * 4);
      const dy = 40 + 30 * Math.sin((i / N) * Math.PI * 6);
      await page.mouse.move(Math.round(a.x + dx), Math.round(a.y + dy));
      const due = t0 + (i * 2000) / N;
      const wait = due - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
    }
    const elapsed = Date.now() - t0;
    await page.waitForTimeout(100);
    await page.mouse.up();
    const r = await page.evaluate(() => ({
      samples: performance.getEntriesByName('baxter:editor:resize-frame').map((e) => e.duration),
      moves: (window as any).__moves as number,
      markT: (window as any).__markT as number[],
      frameT: (window as any).__frameT as number[],
    }));
    return { ...r, elapsed, sent: N };
  };

  await sweep(false); // warm-up (JIT, caches); not reported
  await ed.waitForPuts(1);
  const m = await sweep(true);
  await ed.waitForPuts(2);

  const env = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') ?? c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      dpr: window.devicePixelRatio,
      webglRenderer: gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL',
    };
  });
  const s = m.samples;
  // Supplementary (test-side, same entries): per measured frame, the OLDEST move not yet served by an
  // earlier frame → that frame; and the frame intervals. The plan's metric (latest move → frame) can look
  // small when frames are rare; these two expose that.
  const oldest: number[] = [];
  let prevEnd = -Infinity;
  for (const end of m.frameT) {
    const first = m.markT.find((t) => t > prevEnd && t <= end);
    if (first !== undefined) oldest.push(end - first);
    prevEnd = end;
  }
  const intervals = m.frameT.slice(1).map((t, i) => t - m.frameT[i]!);
  const result = {
    browser: test.info().project.name,
    version: browser.version(),
    headless: true,
    hardware: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()}`, vm: true },
    rendering: env,
    instrumentation: 'mark at anchorDragBoundFunc entry → measure in the rAF after the React commit of the preview (harness build only)',
    sweep: { movesSent: m.sent, movesDelivered: m.moves, elapsedMs: m.elapsed },
    samples: s.length,
    medianMs: +q(s, 0.5).toFixed(2),
    p95Ms: +q(s, 0.95).toFixed(2),
    maxMs: +Math.max(...s).toFixed(2),
    supplementary: {
      framesMeasured: m.frameT.length,
      framesPerSecond: +((m.frameT.length * 1000) / m.elapsed).toFixed(1),
      oldestMoveToFrame: { medianMs: +q(oldest, 0.5).toFixed(2), p95Ms: +q(oldest, 0.95).toFixed(2), maxMs: +Math.max(...oldest).toFixed(2) },
      frameInterval: { medianMs: +q(intervals, 0.5).toFixed(2), p95Ms: +q(intervals, 0.95).toFixed(2), maxMs: +Math.max(...intervals).toFixed(2) },
    },
    all: s.map((x) => +x.toFixed(2)),
  };
  mkdirSync('../../harness-artifacts', { recursive: true });
  writeFileSync(`../../harness-artifacts/perf-${result.browser}.json`, JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'perf', description: JSON.stringify({ ...result, all: undefined }) });
  console.log(`PERF ${JSON.stringify({ ...result, all: undefined })}`);

  expect(m.moves).toBeGreaterThanOrEqual(60);
  expect(m.elapsed).toBeGreaterThanOrEqual(1900);
  if (result.browser !== 'webkit') {
    // The §8.4 gate (Chromium and Firefox), on the plan's metric.
    expect(s.length).toBeGreaterThanOrEqual(30);
    expect(result.medianMs).toBeLessThanOrEqual(18.2);
  }
  expectFenced(ed);
});

/**
 * Context for the WebKit number: the same 2 s paced input over the same document, counting rendered frames
 * (an rAF loop) during an idle second, a hover (no redraw), the existing Slice C object drag and a resize.
 */
test('baseline comparison (recorded, not gated): idle rAF, hover, the existing object drag and resize — same pacing, same document', async ({ page, context }, ti) => {
  const ed = await openEditor(page, context, 'reference30');
  await ed.goToUnit(1);
  const idle = await page.evaluate(() => new Promise<number>((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
  // object drag (Slice C path) with the same pacing; count frames with rAF loop during it
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
  const dragFps = await count(() => paced(cx, cy));
  await ed.click(id);
  const a = await ed.anchorPoint(id, 'bottom-right');
  const resizeFps = await count(() => paced(Math.round(a.x), Math.round(a.y)));
  const hoverFps = await count(async () => { const t0 = Date.now(); for (let i = 1; i <= 120; i++) { await page.mouse.move(300 + (i % 50), 300); const w = t0 + i * 2000 / 120 - Date.now(); if (w > 0) await page.waitForTimeout(w); } });
  const out = { browser: ti.project.name, idleRafPerSec: idle, hoverFps, objectDragFps: dragFps, resizeFps };
  writeFileSync(`../../harness-artifacts/perf-baseline-${ti.project.name}.json`, JSON.stringify(out, null, 2));
  ti.annotations.push({ type: 'perf-baseline', description: JSON.stringify(out) });
  console.log(`BASE ${JSON.stringify(out)}`);
  expectFenced(ed);
});
