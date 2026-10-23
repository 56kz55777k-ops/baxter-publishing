# Stage 1 probe — what the earlier runs found, and what was changed

The recorded result is `../summary.md` (all three browsers, final probe code). Two earlier runs reported failures. Their summaries and the traces of the failing cases are kept here unchanged:

- `run1-chromium-summary.md`, `run1-chromium-failing-cases.jsonl.gz` (cases E3, E7, C2)
- `run2-all-browsers-summary.md`, `run2-firefox-W1.jsonl.gz` (case W1 in Firefox)

In both runs the per-move comparison with the reviewed model found **0 differences in every case and every browser**: real Konva matched the model's port move for move. Every failure was a case-level expectation, and each one was traced to the probe or to the browser, not to the model or the proposed algorithm.

## Run 1 (Chromium only): E3, E7 and C2 failed

### E3 and E7 — 2 out/back mismatches each — probe defect (path design)

Minimal reproduction, from `run1-chromium-failing-cases.jsonl.gz`, case E3 (ratio, bottom-right, crossing both axes):

| measured move | pointer (px) | class | box (mm) |
|---|---|---|---|
| 0 | (475, 441) | threshold pending | held 40 × 30 |
| 1 | (474, 441) | threshold pending | held 40 × 30 |
| 2 | (473, 440) | live | 39.15 × 29.36 |
| … | … | … | … |
| 405 | (474, 441) | live | 39.48 × 29.61 |
| 406 | (475, 441) | live | 39.67 × 29.75 |
| 407 | (476, 442) | live | 40 × 30 |

- The press was at the handle, (476, 442) px, which is also E3's first waypoint (140, 130) mm. There was no lead-in, so the 3 px D-5 threshold fell inside the measured path: going out, the first two moves were pending (box held); coming back, the same positions were live.
- The out/back check compares the box at each position going out with the box at the same position coming back. So it flagged 2 mismatches. E7 (ratio + Alt) started at the handle too and failed the same way.
- The evidence model has no threshold, so its measured path is live from waypoint 0. The probe must start its measured path after the threshold latch to test the same property.
- Fix (probe only): when the first waypoint is within 3 px of the press, the lead-in first moves 4 px away from the first segment's direction and comes back. Then the measured path starts live.
- Rerun: E3 0 mismatches (max edge jump 0.33 mm), E7 0, and E9 4 — the evidence script's E9 also has 4 (accepted #11 behaviour; not a check).

### C2 — the control gesture was not seen — probe defect (marker order)

- C2's control half marked the phase `control` and then called `setup()`. `setup()` starts a new phase, so the control press was filed under no phase and the check could not find it.
- Fix: mark after the setup.
- Rerun: Transformer layer on top → the anchor press starts a transform; a listening layer above it → the press goes to `overlay-cover` and no transform starts.

## Run 2 (all three browsers): W1 failed in Firefox only

Minimal reproduction, from `run2-firefox-W1.jsonl.gz`. The left mouse button stays down throughout:

| move | sent (px) | received (CSS px) | box (mm) |
|---|---|---|---|
| 9 | (486, 452) | (486, 452) | 42.94 × 32.94 |
| — | wheel (0, 120); **Control** + wheel (0, −120); wheel (60, 0) | wheel deltas 0,120 · 0,−120 ctrl · **55**,0 | — |
| 10 | (487, 453) | **(446, 415)** | **31.18 × 22.06** |
| 11 | (488, 453) | (447, 415) | 31.47 × 22.06 |

- Nothing in the page prevented the wheel default. Firefox applied its own page zoom to the Control+wheel: `innerWidth` went from 1000 to 917 CSS px, about 109 %. Chromium and WebKit headless did not zoom.
- From then on, pointer input arrived in the new CSS px, and so did the next wheel delta (60 → 55).
- Konva and the model both work from the delivered CSS px, so they still agreed on every move. But the box jumped by 11.8 mm between two adjacent physical pointer positions.
- Cause: browser behaviour. The plan §4.6 already requires `preventDefault()` for ctrl/⌘-wheel during a resize session. This run shows that the requirement matters in Firefox: without it, a trackpad pinch or Control+wheel mid-resize moves the box.
- Probe changes:
  - W1 is now a plain wheel only.
  - New W2 sends Control+wheel with the plan's freeze: a non-passive stage wheel listener calls `preventDefault()` while a session is live.
  - New W3 is the same without `preventDefault()`, kept as a recorded control. Its delivery check accepts only the deviations that the observed zoom predicts (within 1 px).
  - Every case now runs in a fresh browser context, so a page zoom cannot carry into later cases.
- Rerun: W1, W2 and W3 pass in all three browsers. In Firefox, W2 shows no zoom and W3 records the zoom.

## Negative controls (after the recorded run)

`../negative-controls/` holds Chromium runs against a deliberately wrong Node-side model, while the browser keeps the reviewed one. They show the comparison catches a model that differs from Konva:

- `inclusiveSkip` — r3's wrong [−1, 1] interval. Flags exactly +1 px (H-w+1, H-h+1), and not 0 (H-w0), where both intervals agree.
- `noClamp` — no ratio anchor clamp. Flags E1, E3 and E12: target, clamp flag, raw box, and in E12 the anchor rename.
- `noCarry` — the r2 centre re-capture. Flags E7, E13 and MT1: carried-centre references and bounded boxes 0.01 mm apart.
