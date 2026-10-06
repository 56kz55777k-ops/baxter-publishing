# Native Publishing — Slice D readiness (proposal, not begun)

**Status:** readiness assessment only, written 2026-10-06 during the post–Slice C maintenance checkpoint. **Slice D has not begun.** Nothing here is implemented. It becomes a plan when Ben gives the go and settles the decisions in §7.

**Sources:** `native-publishing-production-implementation-handoff.md` ("spec") Part 2 contracts #2, #4, #9, #10, #11, #19, #20, #21, #24, #26, Part 6, Part 11 (Slice D), Part 12 (fixtures) · `HANDOFF.md` §2 Phase 11, §7, §9 · the post–Slice C code on `main` · the spike tiebreaker `~/Desktop/baxter-spikes/review9-progress-for-chatgpt.md` (the R9 record and its T1–T18 results matrix), `review9-resize-snapping-demo.html`, `spike-c2-review9-snapshot-2026-07-20.zip`.

## 1 · What Slice D is

Part 11: *"Transformer resize + numeric consistency. boundResize ported (edge-diff, ratio, minimums, quantization, stored-box commit), pill, anchor no-op rule, cursor ownership boundary. Acceptance: preview==commit property tests; the R9 matrix incl. off-grid positions; cursor table tests."*

## 2 · Behaviours in scope (contracts)

- **#4.** Transformer handles appear only for **one unlocked, non-line object** with the Select tool. They are hidden while a creation tool is armed, and the selection persists underneath. A multi-selection gets no handles (#5).
- **#9.** Konva boxes are converted from screen px to mm.
  - **Only the edges the gesture moves may snap.** This is detected by diffing newBox against oldBox per edge, not by trusting the anchor name.
  - Fixed edges stay pinned.
  - The bounded preview box is stored, and **the commit writes exactly those numbers** (x, y, w, h).
  - An anchor-click without movement commits nothing.
  - A live `W × H` pill shares the creation readout.
  - Konva's directional anchor cursors are left untouched.
- **#10.** Ratio is engaged by ⇧ or the Ratio toggle, on corner anchors only.
  - Snapping picks the single best correction across both moving axes and applies one scale factor, pinned at the fixed corner.
  - The minimum outranks the snap: the factor is floored and the guide is dropped.
- **#11.** Minimums apply during preview, pinned to the fixed edge: shapes are ≥ 4 mm per axis.
  - Grandfathering: an object already below the minimum never pops up and can't shrink further.
  - Flip is disabled. Dragging through the minimum freezes at the last good box (Konva's anchor-renaming case is accepted; Ben's calmer alternative is recorded).
- **#2.** Resize never re-parents. A cross-gutter stretch keeps the object's page, and its X may go negative.
- **#19.** Resize commits at 0.01 mm.
- **#20.** A locked object shows no handles (the border remains), and locked objects remain snap targets.
- **#21.** One resolver owns the outer wrapper. Konva's Transformer owns the inner content element's anchor cursors, and inner wins while it is set. This extends the existing pure `resolveCursor` chain (`cursor.ts`); it does not fork it.
- **#24.** One history entry per resize gesture, and zero for anchor-clicks or unchanged boxes.
- **Spike R9 tiebreaker** (resolves cases the contracts imply but don't spell out):
  - **Alt/centred scaling stays available.** An axis where both edges move does not snap (R9 point 5, T11).
  - **Resize never offers the centre as a snap candidate**; only the moving edge is a candidate (R9 §"snap step").

## 3 · Architecture

- **Domain (new `packages/domain/src/editor/resize.ts`).** A pure `boundResize(oldBox, rawBox, {ratio, minMm, targets, radius})` returns `{box, guides}`. It does the edge-diff, per-axis or ratio snap, minimum pinning, drag-through freeze and 0.01 quantization.
  - It is type-parameterised so Slice G (text: x and width only, 10 mm) can reuse it later. Slice D does not implement text.
  - The minimum constants move from `use-stage-gestures.ts` (`MIN_SHAPE_MM`) into the domain beside `precision.ts`, because they are model rules.
- **Transient gesture state.** Konva owns the live node during the gesture.
  - Every `boundBoxFunc` call runs `boundResize` and writes the bounded box to a **ref**, mirrored into local state for the pill and guides.
  - Nothing enters the document, history or autosave until release. The ref (not React state) avoids the Slice C Firefox release-point class of defect (`570934b`).
- **Commit.** On `transformend`:
  1. Convert the stored box px → unit mm → page-relative, using the object's **own** page offset (no re-parent).
  2. Reset the node's scale.
  3. Dispatch **one generic `COMMIT` labelled "Resize"**, with the selection unchanged.
  - `updateElement` already returns the same document for identical values and for locked targets, so the no-op rules hold structurally. **No reducer change.**
- **Selection and lock.** The Transformer attaches only when the selection is exactly one id, on the shown unit, unlocked, non-line, the tool is Select and the phase is writable. Lock is read live (toggling Lock detaches immediately).
- **Snapping.** Same radius (1.6 mm) and target builder as drag, excluding only the resized object. Locked objects remain targets, and guides reuse `SnapGuides`.
- **Cursor.** Konva writes the inner content cursor on anchor enter and leave, and the resolver gains a `resizing` input. This keeps the anchor-family cursor stable when the pointer leaves the anchor mid-gesture, e.g. while held at the minimum. Hand and Space handling: see decision D-4.
- **Inspector.** W/H keep committing at 0.01, and typing W pins the left edge (unchanged). During a gesture the inspector shows document values and the pill is the live readout, matching drag. The Ratio toggle needs a home (decision D-2). The 2 mm vs 4 mm floors are decision D-1.
- **Persistence.** Unchanged: one document change produces one debounced conditional-revision save, and preview churn never reaches autosave.
- **Bundle.** `react-konva` already pulls the full Konva build, Transformer included, so the chunk delta is about zero. Everything stays in the lazy editor island, and the budget's Konva-containment check and the 238 B shared-JS headroom are unaffected.
- **Konva 10.3.0 configuration.** The spike ran Konva 9, so re-verify each setting:
  - `keepRatio` is bound to the toggle (the default is true);
  - `rotateEnabled=false`, `flipEnabled=false`, `ignoreStroke=true`, `padding=0`;
  - side anchors don't keep ratio;
  - the anchor mousedown must not also start a marquee or pan in `SpreadStage`'s stage handler.

**Likely files**
- New: `resize.ts` (domain), `use-resize.ts`, `SelectionTransformer.tsx`.
- Modified: `SpreadStage.tsx` (a listening Transformer layer, a stage-mousedown guard, resolver input), `ElementsLayer.tsx` (node ids, a `resizePreview` override), `cursor.ts`, `state/editor-ui.ts` (ratio flag), `EditorShell.tsx` (`onResize`), `Inspector.tsx`, `NumField.tsx` (if D-1 changes the floor), `StageOverlays.tsx` (no double border).

## 4 · Numeric consistency found during readiness (proposed in scope)

- The **creation pill shows the unquantized box** while the commit is `quantizeCreate` (`use-stage-gestures.ts` readout vs commit). #9 says the resize pill "shares the creation readout", and the slice is titled numeric consistency. Proposal: both pills show exactly what will commit.

## 5 · Test strategy

- **Pure (Vitest).** Preview == commit as a property test over random boxes, all 8 anchors, ratio on and off, and random view transforms. Fixed edges must be bit-identical and every value on the 0.01 grid.
- **The R9 matrix (T1–T18 from the spike record)**, including:
  - off-grid X 20.05 → right edge exactly 70.00;
  - a top/left resize commits both x/y and w/h (the stale-position regression);
  - ratio single-axis snap with the exact ratio;
  - minimum outranks snap;
  - grandfathered objects don't pop;
  - drag-through freeze;
  - Alt/centred: no snap;
  - cross-gutter with negative X;
  - locked objects as targets.
- **Shell and reducer.** One entry per gesture; zero for anchor-clicks and locked objects. Undo/redo restores the box and selection. One autosave per gesture.
- **Cursor table.** New rows: `resizing`, and hand vs anchors per D-4.
- **Hook.** The same harness as `slice-c-drag.test.tsx`. A release without a final move commits the last bounded box; Escape and blur behave per D-3.

## 6 · Browser acceptance plan (C-7: Chromium, WebKit and Firefox all gate; C-8 self-cleaning; production fixture back cover)

- Corner and side resize from each anchor family.
- Snap engage, hold and release on a moving edge.
- ⇧ and the toggle for ratio.
- Shrink to the minimum and hold; drag through it (and verify Konva 10's behaviour against #11's accepted case).
- Anchor-click produces 0 PUTs.
- Locked objects and multi-selections show no handles.
- Cross-gutter stretch.
- Undo and redo.
- Reload fidelity.
- Inner vs wrapper cursor readings over each anchor.
- Resize ≥ 55 fps via `performance.mark` (Slice A blueprint budget table: "Drag / resize frame rate ≥ 55 fps on reference doc", C / D).

## 7 · Decisions for Ben before implementation

- **D-1 · Minimum floors.** The inspector W/H floor is 2 mm (`NumField.tsx` `SIZE_BOUNDS`) and the resize minimum is 4 mm. #11 and #19 ask for this to be "carried knowingly or reconciled as a conscious production decision". Options:
  - (a) carry it, since grandfathering absorbs typed 2–4 mm objects;
  - (b) raise the inspector floor to 4;
  - (c) lower the resize minimum to 2.
- **D-2 · Ratio toggle.** #10 names "the Ratio toggle", but #18's inspector anatomy doesn't place it, and nothing says whether it constrains **typed** W/H. Options:
  - (a) a toggle in Position & Size that also links typed W/H;
  - (b) a gesture-only toggle.
  - Either way it is client-only (Part 6). Decide whether it is per session or per object.
- **D-3 · Escape or blur mid-resize.** C-5 covers drag only. Proposal: extend C-5, so the gesture restores with zero trace, Escape cancels only the resize, and the selection is kept.
- **D-4 · Hand/Space over a selected object's anchors.** #21 ranks hand above hover, but Konva's inner cursor wins by containment, and #4 hides handles only for creation tools. Options:
  - (a) make the Transformer inert while Hand is armed or Space is held (proposed);
  - (b) hide it.
- **D-5 · Resize jitter threshold.** Drag has a 3 px threshold (a Slice C choice). Spike-literal resize has none, so 1 px of jitter at the base zoom commits about 0.29 mm. Options:
  - (a) none (spike-literal);
  - (b) reuse 3 px.
- **D-6 · Multi-selection and lock chrome.** Canvas multi-selection currently draws solid per-object outlines, not #5's dashed group border, and there is no canvas 🔒 badge (#20). Slice D makes single and multi chrome visibly different. Fix it in D or carry it?

The following are **not open**, because the spike tiebreaker settles them: Alt/centred scaling stays (no snap on a two-edge axis), and resize snaps edges only, never the centre.

## 8 · Explicit exclusions

- Images, R2 and frame re-crop.
- Crop.
- Text resize (width-only, 10 mm; the domain function is ready for it).
- Fonts and Slice G.
- Lines (#17 endpoint handles, Slice H).
- Rotation.
- Multi-object resize and multi W/H (#5).
- Page and viewing modes.
- Export.
- Any change to D-035's 0.1 mm creation/drag grid.

## 9 · Invariants preserved

- The reducer stays a pure transaction log, and mutations go through the generic COMMIT.
- Gesture state lives in refs and local state outside the document and history.
- One entry per intention.
- No UI or viewport churn in autosave.
- The conditional-revision save is untouched.
- Selection and history restoration are unchanged (the selection is carried on the COMMIT).
- One resolver chain (extended with `resizing`).
- Konva stays in the editor only.
- The contracts remain the behavioural source of truth.
