# Slice D stage 5 — real-Konva probe of the resize wiring

Plan: `native-publishing-slice-d-plan.md` §6.9 (R1–R14), §6.10 (R15–R18, the stage 5 correction) and §6.11 (R19–R28, stage 6 Keep proportions). **Not production code.** Nothing here is imported by the app, linted, type-checked, built or run by CI (`docs/` is outside the npm workspaces). It adds no dependency: it uses what `npm ci` installs (esbuild through vitest, `konva` 10.3.0, `react-konva`, `@playwright/test` 1.62.1).

## What it is

- `page.tsx` — mounts the **real editor tree** — `EditorShell`, `SpreadStage`, `ElementsLayer`, `SelectionTransformer`, `useResizeHost`, `ResizeSession`, the document reducer and the real autosave hook — with real Konva and react-konva, on a local fixture document (one 40 × 30 mm rect at (20, 20), one 24 × 18 mm ellipse at (30, 60), A5 zine page 1). Only `fetch` is stood in: every PUT is answered 200 and counted. No Next.js, no server code, no Supabase, no credentials, **no production data**.
- `probe.html` — the page shell, with the few layout utilities the tree needs (Tailwind is not part of this bundle) and a plain `<button>` for the native-activation checks.
- `stub-next-link.tsx` — `next/link` as a plain anchor.
- `run-probe.mjs` — bundles the page with esbuild, serves it on 127.0.0.1 only, drives Chromium with real Playwright mouse and keyboard input, writes `results/`.

## Run it

```
npm ci
node docs/evidence/slice-d-stage5-probe/run-probe.mjs [--chromium <path to a chrome binary>] [--out <dir>]
```

Without `--chromium` (or `PROBE_CHROMIUM`) Playwright's own Chromium for 1.62.1 is used. Exit code 0 = every case passed.

## Cases (R1–R28)

Changed release (pill = commit, one `Resize`, one PUT, resize cursor) · anchor click · out and back to the press point · Escape mid-drag · Space held through release, then a new press pans and, after keyup, resizes · Space held through Escape · Space through window blur (blur/focus programmatic) · Q7 with Shift: a fast drag past the fixed corner commits the ratio minimum box · wheel and Ctrl+wheel during the resize · ellipse top-left · native activation of a focused button by Space and by Enter during a resize (focus placed on the button programmatically mid-drag, because a canvas press moves focus to the body; each has a control that the button activates without a resize) · shortcuts mid-resize · Hand tool.

R15–R18 (stage 5 correction, Codex finding 1) read the **live** Konva node and Transformer through `window.__konva` (exposed by `page.tsx` for the probe only): position, size or radii, scale, and whether the Transformer's box matches the node's. R15 rect / R16 ellipse: a real anchor press, then one synthetic `mousemove` and `Escape` keydown dispatched in a single browser task, so React cannot render the preview in between (Codex's reproduction) — then a later real resize must commit once and be drawn as committed. R17 rect / R18 ellipse: Escape by real input after a rendered preview.

R19–R28 (stage 6, D-2 Keep proportions) click the real inspector checkbox and drive real drags: rect and ellipse proportional corner resizes (the ellipse after the preference was set with the rect selected), ON + Shift, side handles with ON (and Shift), ON + Alt (centre compared in doubled hundredths), ON Q7, an ON before-render cancel (mixed, as R15) and an ON after-render cancel (real), the checkbox operated by the real keyboard with editor shortcuts after it, and a locked object's disabled checkbox.

## Limits

- Chromium only here (headless, device pixel ratio 1). Firefox and WebKit: NOT EXECUTED in this environment.
- Window blur cannot be produced by real input; R7 dispatches it.
- R15–R16 and R25 force the before-render ordering with synthetic events in one task; human-paced input was not attempted.
- R28 locks the rect with a programmatic document COMMIT (`window.__probe.docDispatch`); the Lock button itself is covered in jsdom.
- Element ids are random per page load, so `results/` differs between runs in those ids only.
- `results/` holds the latest run (28 / 28, stage 6). `results/before-correction-3fcad11/` holds the same 18 cases run with the three corrected source files reverted to `3fcad11` (16 / 18: R15 and R16 fail).
- It proves the wiring in a real browser with real Konva; it is not the Q5 harness (no Next build, no `EditorGate`, no mocked API route).
