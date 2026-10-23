# Slice D stage 1 — isolated Konva probe

Plan: `native-publishing-slice-d-plan.md` §6 stage 1. **Not production code.** Nothing here is imported by the app, linted, type-checked, built or run by CI (`docs/` is outside the npm workspaces). It adds no dependency: it uses the repo's own installed `konva` 10.3.0 and `@playwright/test` 1.62.1 from `npm ci`.

## What it is

- `probe.html` + `probe-page.js` — one page with a real `Konva.Transformer` (Konva's ESM `node_modules/konva/lib`, the build the app resolves) on one element inside a zoomed, translated parent `Group`, configured as plan §4.2 (rotate/flip off, padding 0, `shiftBehavior` default, `keepRatio` = the toggle). The plan's three session hooks (§4.3) are wired to the **reviewed model** — `createSession`, `capture`, `bound` and helpers, served verbatim from the shared section of `docs/evidence/slice-d-math-check.js` — plus the D-5 threshold and the §3.5 step 0 ratio clamp, exactly as `gestureMove` in that script. Every Konva callback is logged with the exact numbers Konva passed. One observer wraps `Konva.Util._inRange` (calls the original, returns its result) to record the exact extent Konva tested for its [-1, 1) px early return.
- `run-probe.mjs` — serves the page on 127.0.0.1 only, drives Chromium, Firefox and WebKit with real Playwright mouse and keyboard input, collects the logs, and writes `results/`.
- `cases.mjs` — the matrix: E1–E13 crossing-and-return paths (plus E1 via Shift), H boundary cases (width and height at −1, 0, +1 px and their 2^-20 neighbours), the D-5 threshold at 15/100/800 %, boundBoxFunc coordinate space with a zoomed group, modifier transitions, grandfathered sizes, lifecycle (transformstart/end, anchor click, mouseup coordinates, stopTransform, destroy, Escape, blur), Transformer defaults, `keepRatio || Shift` corner-only, all 8 anchors, an ellipse, cursors and `listening(false)`, layer hit order, wheel during a transform.
- `model.mjs` + `analyse.mjs` — every delivered move is replayed through the model's Konva port (`konvaStep`) and `bound()`, and independently through the evidence script's own `gestureMove()` (the "twin"), and compared with what Konva did: threshold decision, returned anchor target, clamp, segment key and references, Konva's anchor position and current box, its comparePoint against our fixed corner (and its centre against our carried centre), skip/proceed, the proposed box, the anchor name after any rename, the bounded box (exact), freeze, and the node attrs and client rect after `onTransform`. Then case-specific expectations from the plan and the evidence script.
- `report.mjs` — writes `results/summary.md`.

Kinds: **real** = only real pointer/keyboard input; **programmatic** = a supplementary check that calls Konva or dispatches a synthetic event (stated per case); **mixed** = real input with named programmatic steps.

## Run it

```
npm ci
npx playwright install chromium-headless-shell firefox webkit   # the builds for @playwright/test 1.62.1
node docs/evidence/slice-d-konva-probe/run-probe.mjs
```

Options: `--browsers chromium,firefox,webkit`, `--only E1,H-w+1`, `--out <dir>`. Exit code 0 = every case passed in every browser; 1 = a failure; 2 = no failure but something not executed. `PLAYWRIGHT_BROWSERS_PATH` selects a browser cache.

## Outputs (`results/`)

- `summary.md` — environment, matrix, measured agreement, boundary table, crossing paths, per-case notes. Deterministic: rerunning in the same environment reproduces it byte for byte.
- `results.json` — the same data, machine-readable.
- `trace-<browser>.jsonl.gz` — one line per delivered move (browser values, model values, differences) and one per gesture.
- `investigation/` — the runs that found problems before the recorded run, with their failing traces and `INVESTIGATION.md`.

## Limits

- Headless Linux browsers driven by Playwright: Chromium is the headless shell, WebKit is Playwright's WebKit build (not Safari), all at device pixel ratio 1. Pointer coordinates are integers in every browser; exact sub-pixel extents come from node geometry.
- Window blur, mouseup at a position other than the pointer's, `stopTransform()` and `destroy()` cannot be produced by real input here; those cases are programmatic and say so.
- The probe checks Konva and the proposed maths. It does not exercise the editor (React, the reducer, autosave); that is stages 2–8.
