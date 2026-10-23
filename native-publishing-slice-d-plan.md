# Native Publishing — Slice D plan

**Status:** **Revision 3 (r3), 2026-10-22/23: proposed plan for Codex's third independent review.**
- r1 (`8042cc8`) drew seven findings; r2 (`b30373c`) answered them (§0.1).
- Codex then reviewed r2. It independently ran the r2 evidence script and **accepted** the centre capture, the controlling-axis ratio calculation, the integer arithmetic and the preview/commit payload approach. It left three findings, answered here (§0.2).
- Correcting the Konva model (finding 1) **exposed two further defects** in the proposed algorithm: re-anchoring after a ratio crossing, and centre creep across anchor renames. Both are revised and re-evidenced here (§0.2 rows N1 and N2).
- **Decisions D-1…D-6 were approved by Ben on 2026-10-22** (§1).
- Open product questions: **Q2** (Space during an active resize) and **Q7** (the ratio-crossing behaviour proposed in N1).
- **Implementation has NOT started and is NOT authorized.** It begins only after Codex's re-review and Ben's go.
- Nothing in this document changes application code, dependencies or CI. No production-write test has been run for D.

**Base:** `main` = `790ddf9875f7ea4d35e594c52fc6eb1fdb218467` (PR #19 merge, Next.js 15.5.28), tree `db54dbef235a7a4d771f6e48a158f20f1e110677`. Branch: `slice-d-resize`. r1 = `8042cc8`, r2 = `b30373c`; r3 is the next commit on the branch.
**Supersedes for planning purposes:** `native-publishing-slice-d-readiness.md` (2026-10-06), which stays as the historical readiness record, unaltered.
**Scope (production handoff Part 11):** Transformer resize + numeric consistency — `boundResize` (edge-diff, ratio, minimums, quantization, stored-box commit), the live pill, the anchor no-op rule, cursor ownership. Acceptance: preview == commit property tests, the R9 matrix including off-grid positions, cursor table tests. Plus the six approved decisions.
**Contracts:** #2 · #4 · #5 · #9 · #10 · #11 · #18 · #19 · #20 · #21 · #24 · #25 · #26 (and #3 for the creation-pill correction).
**Sources read for this plan:**
- `HANDOFF.md`, `native-publishing-production-implementation-handoff.md` Parts 2, 6, 11 and 12, `native-publishing-slice-d-readiness.md`, `native-publishing-slice-a-blueprint.md` (performance budgets), `docs/adr/ADR-003`, `docs/security-operations.md` §5 and §8, `decisions.md` D-031…D-035.
- The R9 record `~/Desktop/baxter-spikes/review9-progress-for-chatgpt.md` (T1–T18) and the spike source `spike-c2/src/Workspace.jsx`.
- The editor code on `790ddf9`: notably `precision.ts`, `snapping.ts`, `num-field.ts`, `SpreadStage.tsx`, `use-viewport-measure.ts`, `use-editor-keyboard.ts`, `use-autosave.ts`, `editor-island.tsx`, `editor-gate.tsx`, `next.config.js`, `middleware.ts`, `editor-smoke.spec.ts`.
- **Konva 10.3.0's `lib/shapes/Transformer.js`** (the installed version). Every Konva claim below was read from that source, not from memory or docs. It was re-read for r2, and for r3 its anchor branches (`_handleMouseMove`) and the start of `_fitNodesInto` were ported line by line into the evidence script.
- **Maths evidence:** `docs/evidence/slice-d-math-check.js` and its output `docs/evidence/slice-d-math-check.out.txt` (renamed from `slice-d-r2-math-check.*` in r3).
  - The script is isolated: not imported, not linted, not run by CI.
  - It reproduces Codex's r1 counterexamples.
  - It checks the rules with deterministic examples (§3.8), crossing-and-return paths, an exhaustive representation check, and 4,000 seeded random gestures (312,818 bounded moves) driven through the Konva port.
  - Run: `node docs/evidence/slice-d-math-check.js` (exit 0; output byte-identical on every run).
  - **It is mathematical-model evidence.** The real Konva in three browsers is verified only by the stage 1 probe (§6), which has not run.

---

## 0 · Review resolution

### 0.1 Codex review of r1 `8042cc8` (2026-10-22) — answered in r2

Numbers in this table come from the r2 run of the evidence script. The current (r3) run is in §3.8; r3 leaves all of them unchanged except where §0.2 says otherwise.

"Correction" means the r1 *implementation approach* was wrong and is replaced. None of the findings reopens an approved decision. Finding 5 separates an unresolved product choice from what was approved.

| # | Finding | Kind | Resolution in r2 | Sections | Evidence |
|---|---|---|---|---|---|
| 1 | Centred resizing accumulates drift: r1 recomputed the centre from the previous rounded box each move. | Correction | A **segment** model: the centre is captured once per uninterrupted centred segment, in doubled hundredths, and never recomputed. Only the active-anchor-side raw edge is read from Konva. Alt pressed or released mid-gesture starts a new segment from the last bounded box. Max centre error 0.005 mm, no accumulation. | §3.3, §3.4, §3.5 step 4, §3.7 G6, §3.8 B1–B2, §7 | Script A1 reproduces r1's 5 → 5.02 mm. B1/B2 show r2 stable. Random: r1 drifts in 115,285 of 148,146 centred moves (max 0.14 mm); r2 max error 0.005 mm. |
| 2 | Unsnapped ratio resizing violates G5 (4.03 × 4 at 1.0087 → 4.07 × 4.03, error 0.0097 mm). | Correction | A **controlling axis** is always chosen: the snapped axis, otherwise the larger start axis, with ties defined. It is quantized first; the dependent size is derived from it in exact integer arithmetic and quantized. Floors are applied to the controlling size after quantization, using exact integer ceilings, so both axes meet their floors. Covers ratio + Alt and grandfathered shapes. | §3.5 step 5, §3.6, §3.7 G5/G7, §3.8 B3–B7, §7 | A2 reproduces r1's error. B3: the same input gives 4.07 × 4.04 (error 0.0003 mm). Random: r1 exceeds 0.005 mm in 5,289 of 40,000 moves; r2 max 0.005 mm. |
| 3 | Floating-point "exactness" claims are incompatible with JavaScript arithmetic (`0.03 - 0.01`). | Correction | All grid maths in **integer hundredths of a millimetre**. Four layers are distinguished: integer model, stored payload, geometric reconstruction, formatted text. Each gets an explicit guarantee or tolerance. Unchanged fields keep their original stored numbers, and no-op gestures write nothing. The r1 idempotence claim (G8) was false at odd parity and at the snap radius, and is replaced. | §3.1, §3.2, §3.6, §3.7 (G1–G8 rewritten), AC-2/5/7/8, §7 | A3 reproduces the float case. Exhaustive ±2000 mm: `toH(fromH(h)) === h`, `quantizeInspector` identity and `formatNum` = integer formatting, 0 mismatches in 400,001 values. Random: 0 non-integer outputs, 0 payload mismatches. |
| 4 | Wheel pan/zoom during a resize is undefined: `SpreadStage.onWheel` has no gesture guard. | Correction (proposed policy) | **Viewport freeze for the whole resize session**, from anchor press (including threshold-pending) to release or cancel. Wheel pan and zoom are suppressed (`preventDefault`, view unchanged). The viewport-size refit is deferred and applied once at session end. Keyboard routes are covered by the key guard, which now also blocks native Space/Enter activation of a focused control mid-gesture. Normal behaviour returns immediately on release, Escape, blur or unmount. | §4.6, §4.5, AC-20, §7, §8.2, §11 C14 | `SpreadStage.tsx` `onWheel` (lines 224–237); `useEffect([size])` refit (lines 108–113); `use-editor-keyboard.ts` control-target rule. |
| 5 | Space during an active resize still needs Ben's explicit decision. | Unresolved product question | The r1 claims that "no new product decision is needed" are removed. **Q2** carries Codex's recommendation ("Finish the current resize; if Space is still held after release, enable panning.") as a recommendation, not an approval. Stage 4 cannot complete, and the Space-mid-resize code and tests are not written, until Ben answers. | §1 D-4, §4.5, §6 stage 4, §10.3 Q2 | — |
| 6 | Grandfathered objects can be browser-tested. | Correction | r1's "not testable in a browser" claim is removed. A **local harness** runs the real editor island (`EditorGate` → `EditorIsland` → `SpreadStage` → Transformer) on fixture documents with mocked persistence: a fresh clone with no `.env` files, Playwright fulfilling every `/api/editor/*` request in the browser, and no production data. It covers enlargement, prohibited shrinkage, ratio, no initial jump and inspector edits. It is separate from the production suite, and its mechanism needs Codex's and Ben's agreement (Q5). | §8.2, §5, §6 stage 8A, §10.2 choices 15–16, §10.3 Q5, §11 C13 | `editor-island.tsx` boots from a `docRow` prop and saves only via `fetch('/api/editor/…')`. The editor components import no Supabase client. |
| 7 | Production-write budget and cleanup. | Correction | Separate **action** and **cleanup** allowances, write counting at request time, a hard stop enforced at the network layer, and cleanup in a fresh browser context with its own allowance. Ownership is checked before every delete, and a per-run journal plus a recovery mode handle interrupted runs. Residual risks and Ben-only approvals are listed. Most interaction coverage moves to the harness, so the production estimate falls from ≈38 to ≈19 PUTs per browser. **Not approved; no production-write test runs.** | §8.3, §8.5, §10.3 Q1/Q6 | `docs/security-operations.md` §8; `editor-smoke.spec.ts` (identity-by-geometry cleanup, `finally` path). |

**Preserved, as Codex accepted:** the staged implementation with review checkpoints (§6); the three-browser Konva probe before integration (stage 1); the generic `COMMIT`, autosave, authorization and editor-isolation invariants (§3.6, §5 "Not changed"); no silent bundle-budget increase (§9.2); D-1…D-6 as approved, except the D-4 interpretation now open as Q2.

### 0.2 Codex review of r2 `b30373c` (2026-10-22) — answered in r3

**Accepted by Codex:** the centre capture, the controlling-axis ratio calculation, the integer arithmetic, and the preview/commit payload approach. Codex also ran the r2 evidence script successfully.

**Kept in r3, with two refinements the corrected model forced (N2), stated so nothing accepted changes silently:**
- The first centre capture is unchanged. Re-capture while Alt stays held is replaced by **carrying** the centre.
- The controlling-axis logic is unchanged. Only the **input** to the ratio scale changes: the anchor position against our integer reference, rather than Konva's projected corner.

| # | Finding | Kind | Resolution in r3 | Sections | Evidence (current run) |
|---|---|---|---|---|---|
| 1 | The evidence script's Konva model kept the dragged corner's original direction in ratio mode. Real Konva 10.3.0 flips each axis when the anchor crosses the comparison point (the opposite corner, or the centre with Alt), producing negative extents and an anchor rename. | Evidence correction | The model is replaced by a line-by-line port of `_handleMouseMove`'s anchor branches (per-axis `reverseX`/`reverseY`, centred mirroring) and the start of `_fitNodesInto` (the ±1 px early return, the rename before `boundBoxFunc`). New crossing-and-return paths E1–E13 cover ratio with and without Alt, crossing x, y and both, checking negative-extent rejection, renaming, segment capture, floors and recovery. The same cases are added to the stage 1 real-Konva probe. | §3.8, §4.1, §6 stage 1, §7 | Script section D shows the per-axis reverse and rename. Sections E and F are summarised in §3.8. |
| N1 | **Defect exposed by the corrected model:** in one-edge ratio mode (corner + Keep proportions/Shift, no Alt), crossing the fixed corner on one axis while the other axis is still large makes Konva rename the anchor. r2's freeze-then-re-capture then re-anchors the box at its **far** corner. | Algorithm correction (behaviour choice for Ben: Q7) | **Ratio anchor clamp:** in `anchorDragBoundFunc`, after the threshold, the dragged anchor is kept at least the minimum box's extent away from the fixed corner on each axis. Konva therefore never sees a crossing in this mode: no negative extent, no rename, no skipped move. Beyond the corner the box follows the remaining axis's distance, or holds at the minimum box when the pointer is past both axes. It is continuous, and returning the pointer restores the earlier box exactly. Free and centred modes keep Konva's rename (unchanged #11 behaviour; continuous). | §3.5 step 0, §3.7 G9, §4.3, §10.2 choice 19, §10.3 Q7, AC-24 | r2: jumps of 9.5–15.8 mm per 0.2 mm pointer step; 150–202 out/back mismatches (E1, E2, E4); random gestures: 594 freezes/renames in this mode. r3: 0 freezes, 0 renames, 0 skips; max jump ≤ 0.09 mm; 0 out/back mismatches; one-move jump past the corner lands on the minimum box (E12). |
| N2 | **Defect exposed by the corrected model:** with Alt held, each anchor rename (centre crossing) re-captured the centre from the rounded box. The centre could then creep by 0.005 mm per crossing, unbounded. | Algorithm correction | While Alt stays held, the centre is **carried** across every segment change (rename, ratio toggle). It is re-captured from `prev` only when Alt is newly pressed. In ratio + Alt, the scale is computed from the anchor position against the carried centre, not from Konva's corner (which Konva projects from its own rounded node centre). | §3.3, §3.4, §3.5 step 5.1, §3.7 G6/G9 | E13: six centre crossings — r2 creep 0.010 mm, r3 0.005 mm. E5–E7: 0 out/back mismatches. Random: max centre error per continuous Alt hold 0.005 mm. |
| 2 | Production write-budget enforcement was imprecise: §8.5 blocked the request after the cap, and that blocked request itself exceeded the stated count. | Process correction | Three counters per phase (`attempted`, `admitted`, `blocked`). Caps A = 24 and C = 8 apply to **admitted** writes, reserved synchronously in the route handler before forwarding, so concurrency cannot exceed them. Admitted writes consume allowance whatever their outcome; retries consume again. Exhaustion terminates the action at its next await, takes the context offline, then closes it. Cleanup always runs in a fresh context under C with the same enforcement. Mocked tests are planned for the boundary, concurrency, retries, failures and cleanup after A exhaustion. | §8.5, §7, AC-22, §10.3 Q1 | Design only; the tests are planned for stage 8A (no production). |
| 3 | Automatic cleanup needs proven ownership: geometry cannot prove it, and a fresh context loads the newest revision, so human edits need not conflict. | Process correction | **Recorded element ids are mandatory** for automatic cleanup, checked against the pre-run baseline id set. **Geometry-only deletion is removed**; geometry remains a consistency check. An interruption before an id is recorded, or any ambiguity in ownership or current state, stops and reports for manual recovery. Nothing restores a baseline document over newer changes. Without the id instrumentation (Q6), the production suite and automatic cleanup stay blocked. | §8.5, §8.3, §10.3 Q6, §11 C17 | Design only. |

---

## 1 · Approved decisions (Ben, 2026-10-22)

The left column is Ben's decision as approved. The right column is how this plan makes it precise; it is reviewable, and if Codex or Ben finds it does not match the decision, the decision wins. **One interpretation is still open:** what Space does when pressed during an active resize (Q2).

| # | Approved | Precise definition used by this plan |
|---|---|---|
| **D-1** Minimum size | 4 mm per axis for shape resizing **and** inspector W/H. Existing smaller shapes are preserved, never enlarged automatically. An already undersized axis must not shrink further or jump unexpectedly. Changing the inspector's 2 mm floor is approved. | **Effective floor of an axis = `min(4 mm, the axis's value when the gesture or edit starts)`**, in integer hundredths (`min(400, start)`).<br>• A normal axis (≥ 4 mm) can go down to 4.<br>• An undersized axis (e.g. 2.5) can never go below its starting value. It **can** be enlarged, including to values still below 4 (2.5 → 3.2 is allowed), and the new value becomes its floor for the next edit.<br>• Nothing moves at gesture start, on selection, or below the D-5 threshold.<br>**Floors are checked after quantization** (§3.5).<br>**Typed edits:** a value below the floor clamps to the floor. For an undersized axis that clamp equals the current value, so the edit is a **no-op**: no history, no save, and the field shows the unchanged value. On a normal axis, typing 3 commits 4.<br>**Arrow steps:** same floor. Down from 2.5 is a no-op; up from 2.5 commits 3.5.<br>**Proportional (ratio) resize:** the controlling size is floored at the exact integer ceiling that keeps **both** axes at or above their floors (§3.5 step 5). If either axis is undersized, both sizes stay ≥ their start values: the shape can scale **up** proportionally but not down.<br>Applies to rect and ellipse in D (images inherit it in E; text has its own 10 mm width rule in G). |
| **D-2** Keep proportions | The toggle affects **corner-drag resizing only**. Typed W/H stay independent. Side handles never preserve ratio. Client-only, remembered for the editor session. Shift also enables proportional corner resizing. | `keepProportions` is client UI state (Part 6 already lists "ratio-lock toggle" as client editor state). It is never persisted, never in history, never autosaved, and resets on reload.<br>Ratio applies iff `(keepProportions ∨ Shift) ∧ the active anchor is a corner`. This is exactly Konva's own `keepRatio() ∨ shiftKey`, applied only in its corner branches. With the toggle on, Shift changes nothing.<br>The ratio is the **gesture-start** box's ratio: Konva computes its `sin`/`cos` at mousedown (§4.1).<br>What happens when the dragged corner passes the fixed corner in ratio mode is not covered by D-2 or #11; r3 proposes holding the fixed corner (§3.5 step 0) and asks Ben to confirm (Q7).<br>Wording and placement are proposed in §4.10. |
| **D-3** Cancel a resize | Escape or loss of window focus during a resize restores the original position and size, keeps the selection, and creates no save or history entry. | It extends the Slice C rule (C-5 / decision 2) to resize. **One meaning per press:** Escape during a resize cancels only the resize; the next Escape (no gesture) deselects and returns to Select, as today. Window blur cancels the same way. The viewport freeze (§4.6) ends at the cancel. |
| **D-4** Panning takes priority | While Hand is active or Space is held, handles stay **visible but inactive**, the hand cursor shows, and accidental resizing is impossible. Specify Space pressed **during** an active resize. | Handles render but do not receive pointer events. A press on one pans, exactly as a press anywhere else does. The inner Konva cursor is cleared at the moment handles become inactive, so a stale resize cursor can never show (§4.7).<br>**Space pressed during an active resize: OPEN — Q2 (Ben).** Today's drag behaviour does not settle it. Codex recommends: *"Finish the current resize; if Space is still held after release, enable panning."* That is a recommendation, not an approval. The code that depends on it (the session's Space policy, its tests and its acceptance case) waits for Ben's answer (§6 stage 4). |
| **D-5** Intent threshold | 3 **screen** px of movement before resizing begins, matching object drag. A handle click or sub-threshold movement changes nothing and creates no save or history entry. Define across zoom and at the crossing. | **Distance:** Euclidean, in CSS px, from the anchor-press point to the current pointer — the same measure as `DRAG_THRESHOLD_PX` in `use-stage-gestures.ts`. It is zoom-independent on screen, so in model terms it is `3 / (3.4 · zoom)` mm: 5.88 mm at 15%, 0.88 mm at 100%, 0.11 mm at 800%.<br>**Below it:** the box, guides and pill do not change at all.<br>**At the crossing:** the box jumps to the **full** displacement since the press (no swallowed distance), then is bounded and snapped like any other move. Same as drag.<br>**Latching:** once crossed, the gesture stays live even if the pointer returns within 3 px.<br>Modifiers pressed below the threshold take effect at the crossing. The viewport freeze (§4.6) applies from the press, including below the threshold. |
| **D-6** Selection and lock indicators | The specified dashed group border for multi-selections and the lock indicator for locked objects. Neither multi-selections nor locked objects get handles. Multi-object resize stays out of scope. | **Multi:** one dashed oxblood border around the **union** box of the selected objects shown on the unit (locked members included), replacing the per-object solid outlines. This follows the spike, where the multi border was the Transformer's border around all nodes with `borderDash [3,2]`. It travels with a drag preview.<br>**Lock indicator:** a small padlock on **every** locked object on the unit (the spike showed it on all locked objects, not only selected ones).<br>Both are implementation choices in §10.2 so Codex or Ben can object. |

**Naming note.** "D-1…D-6" are Slice D's decision labels (from the readiness document). They are unrelated to `decisions.md`'s three-digit log (D-001…D-035). The resize precision rules (§3) and D-1's contract amendment land in the log as **D-036** with the implementation (§13).

---

## 2 · Scope, exclusions, acceptance criteria

### 2.1 In scope
- Konva Transformer resize for **one** selected, **unlocked**, **non-line** element (rect, ellipse), using the Select tool, with the phase writable.
- The pure `boundResize` maths in integer hundredths (§3), the live `W × H mm` pill, snap guides, and the anchor no-op rule.
- Cursor chain extension (#21) and Hand/Space inertness (D-4); Space during an active resize once Q2 is answered.
- Cancel (D-3), the intent threshold (D-5), and the 4 mm floor with grandfathering in both resize and inspector (D-1).
- The Keep-proportions toggle (D-2), multi dashed border and lock indicator (D-6).
- The **creation-pill correction**: creation's preview box and pill show exactly what creation commits (§4.9).
- A keyboard guard (§4.5) and a viewport freeze (§4.6) during an active resize session.
- A **local browser harness** with mocked persistence for interaction, grandfathering and performance coverage (§8.2), subject to Q5.

### 2.2 Excluded
- Images, R2 and frame re-crop (E).
- Crop (F).
- Text resize — width-only, 10 mm (G; the domain function is written so G can reuse it).
- Fonts (G).
- Lines and endpoint handles (H).
- Rotation.
- **Multi-object resize** and multi position/size fields (#5).
- Page management and viewing modes (I).
- Export.
- Any change to D-035's 0.1 mm creation/drag/nudge grid.
- Moving E2E off production.
- Next.js upgrades and any dependency change. The open Dependabot alerts #86/#87 are tracked separately (§12).

### 2.3 Acceptance criteria

Each criterion is proved by the tests named in §7 and the browser cases in §8. "H" means integer hundredths of a millimetre (§3.1).

| AC | Criterion | Contract | R9 / decision |
|---|---|---|---|
| AC-1 | A moving edge snaps to the shared target set (page edges, centre lines, margins, other elements' edges and centres, locked included); the guide shows while engaged; released past the 1.6 mm radius it commits the free position. | #8, #9, #20 | T1, T2, T3, T5, T6, T17 |
| AC-2 | Only moving edges snap. Within a segment, fixed edges are **equal in H** to their captured values. An unchanged stored field keeps its **original stored number** (`Object.is`). A fixed edge reconstructed in floating point from stored values is within 1e-9 mm of its H value. | #9 | T2, Part 12 "off-grid X 20.05 → right edge exactly 70.00" (exact in H and in the stored `w`) |
| AC-3 | Corner drags without ratio snap both axes independently. | #9 | T4 |
| AC-4 | Ratio (toggle or Shift, corners only): one controlling axis — the snapped one, else the larger start axis, ties per §3.6. The controlling size is exact on the grid; the dependent size is derived from it within 0.005 mm. The fixed corner is pinned. | #10 | T10, D-2 |
| AC-5 | Alt/centred scaling: a centred axis does not snap. Its centre is captured when Alt is pressed and **carried while Alt stays held**, including across anchor renames and ratio toggles. Every bounded box during that hold has its centre within 0.005 mm of it, with **no accumulation** over any number of moves or crossings. Releasing and re-pressing Alt captures a new centre from the last bounded box. | #9 (tiebreaker) | T11 |
| AC-6 | Minimums, checked after quantization: ≥ 4 mm per axis, pinned to the fixed edge or centre. The minimum outranks the snap (guide dropped) and the ratio (factor floored exactly). No flip. Drag-through in free and centred modes freezes at the last good box for one move, then resumes per #11; in one-edge ratio mode the crossing never reaches Konva (AC-24). Grandfathered axes per D-1. | #11 | T7, D-1 |
| AC-7 | **Payload equality:** the committed patch is the stored bounded-preview payload, the same numbers (`Object.is`), not recomputed at release. **Canonical values:** every changed stored value is `h / 100` for an integer h. **Text:** pill text = `formatNum` of the payload = inspector text after commit. Top/left anchors commit position too. | #9, #19 | T1–T18, Part 12 stale-position regression |
| AC-8 | One history entry per changed gesture. Zero for anchor clicks, sub-threshold movement, a gesture whose release box equals the start box in H, cancel, or a locked target; in all these the document reference is unchanged, so stored values are untouched. One autosave per changed gesture; zero for the rest. Undo/redo restores box and selection exactly. | #24, #25 | T8, T9, D-3, D-5 |
| AC-9 | Resize never re-parents; a cross-gutter stretch keeps the owning page and may produce negative page-relative X. | #2 | T18 |
| AC-10 | Handles only for one unlocked non-line object with the Select tool. Hidden under creation tools (selection persists). Visible-but-inactive under Hand or Space. None for multi or locked (the border remains). | #4, #5, #20 | T16, D-4, D-6 |
| AC-11 | Cursor: Konva's directional anchor cursors on the inner element; the wrapper resolver extended, never forked. The resize cursor is held through the gesture; `grab` when handles are inactive; no stale cursors after cancel, blur or tool change. | #21 | D-4 |
| AC-12 | Escape or blur mid-resize restores the original box, keeps the selection, and writes nothing. | — | D-3 |
| AC-13 | 3 px intent threshold at every zoom, with the crossing behaviour of D-5. | — | D-5 |
| AC-14 | Inspector W/H floor of 4 mm with grandfathering; typed W/H independent of the toggle. | #19 (amended by D-1) | D-1, D-2 |
| AC-15 | Multi dashed union border; lock indicator on locked objects. | #5, #20 | D-6 |
| AC-16 | Creation preview and pill equal the committed element. | #3, #19 | readiness §4 |
| AC-17 | Reload fidelity: committed boxes survive autosave and a full reload exactly. | #25 | — |
| AC-18 | Resize frame time on the 30-element reference document meets ≥ 55 fps (§8.4). | blueprint budget table | — |
| AC-19 | Shared First-Load JS grows **0 B**; Konva stays editor-only; the island chunk is measured and reported; the production build contains no harness route. | blueprint A7 | — |
| AC-20 | **Viewport freeze:** from anchor press (threshold-pending included) to release or cancel, wheel pan/zoom changes nothing and the viewport-size refit is deferred to session end. Normal wheel behaviour and any deferred refit apply immediately after release, Escape, blur or unmount. | — | Codex finding 4 |
| AC-21 | **Grandfathering in a real browser** (local harness): an undersized axis enlarges, cannot shrink, does not jump at press or crossing; ratio on an undersized shape scales up only; inspector edits per D-1. | #11, #19 | D-1, Codex finding 6 |
| AC-22 | **Production writes** (only when Q1 and Q6 are approved): attempted / admitted / blocked counted per phase; **admitted** writes never exceed A = 24 (actions) or C = 8 (cleanup) per browser, including under concurrency; exhaustion stops the action phase and takes its context offline; cleanup runs in a fresh context; automatic deletion only of **recorded, baseline-checked element ids**; zero residue or an explicit manual-recovery report. | security-operations §8 | r1 finding 7; r2 findings 2–3 |
| AC-23 | **Space during an active resize** behaves as Ben decides in Q2. The criterion is written when Q2 is answered. | #26 | D-4 (open part) |
| AC-24 | **Ratio crossing** (one-edge ratio: corner + Keep proportions/Shift, no Alt), subject to Q7. The dragged anchor never crosses the fixed corner's minimum-box extent: no freeze, no anchor rename, the fixed corner never moves. The box is continuous across the crossing; beyond both axes it is the minimum box. Returning the pointer to an earlier position restores the earlier box exactly. Centred crossings (Alt) stay continuous and recover exactly with the centre carried. | #10, #11 | r2 finding 1; N1, N2 |

**R9 cases not in D:** T12a–c (text, Slice G) and T14 (image frames, Slice E). Its "top/left resize commits x/y" regression is covered here with rect and ellipse. T15 (multi union move) shipped in Slice C.

---

## 3 · The resize calculation (pure domain)

### 3.1 Representation: integer hundredths
All grid maths runs on **integers counting hundredths of a millimetre ("H")**. Floating point appears in exactly three places, each with a stated rule:
- **Raw pointer input** (Konva's proposed box, px → mm) is a float. It enters the integer model once, through `toH`.
- **Stored values** are the doubles `h / 100`.
- **Geometric reconstruction**, such as `x + w` computed by other code, is float arithmetic on stored values.

Helpers (new `packages/domain/src/editor/hundredths.ts`; pure):
- `toH(mm) = Math.round(mm * 100)`, with `-0` normalised to `0`. For every canonical stored value it is exact: `toH(h / 100) === h` for all integers h in ±200,000 (±2 m), checked exhaustively.
- `fromH(h) = h / 100`, with `-0` normalised. This is the **canonical stored value** for h. It equals `quantizeInspector(fromH(h))`, so it is the same double the inspector path would store. `formatNum(fromH(h))` equals the decimal digits of h (checked exhaustively).
- Integer `floorDiv(a, b)`, `ceilDiv(a, b)` and `roundHalfUpDiv(a, b) = floorDiv(2a + b, 2b)`. The float quotient is corrected by the exact integer remainder. All intermediates stay below 2^53 for documents up to 1 m (asserted in tests).
- Snap and centre targets are held in **doubled hundredths ("H2")**, because an element centre can fall on a half-hundredth. `halfUp(t2) = floorDiv(t2 + 1, 2)` converts H2 to H, rounding ties toward +∞.

**Box in unit space:** `{ x, y, w, h }` in H. Page offsets (148/210 mm trims → 14,800/21,000 H) are integers for every current format preset (148×210, 210×297, 210×210; margins 12/15/19 mm).

### 3.2 Inputs and start box
- **`start`** — the element's box at gesture start, unit space, in H. Edges are converted edge-wise:
  - `L = toH(x) + offH`
  - `R = toH(x + w) + offH`
  - `T = toH(y)`
  - `B = toH(y + h)`
  - `w = R − L`, `h = B − T`.

  For canonical stored values this equals `toH(x) + toH(w)` exactly (200,000 random pairs, 0 mismatches). For a legacy non-canonical value — the schema permits one, no current code path writes one — each edge is within 0.005 mm of its stored geometry.
- **`floors`** — `fl.w = min(400, start.w)`, `fl.h = min(400, start.h)`.
- **`targets`** — H2 values from `buildTargets` geometry: page edges, centre lines and margins, plus every other element on the unit (locked included, #20), excluding only the resized element. Element edges are `2·toH(edge)`; centres are `2·toH(x) + toH(w)` (exact half-hundredths). They are built once at gesture start. The snap radius stays 1.6 mm (`SNAP_RADIUS_MM`), applied in mm through the existing `bestSnap`. Its tie rule — smaller correction, then the lower target value — is unchanged and deterministic.
- **`raw`** — Konva's proposed box (absolute stage px), converted to unit-space mm with the existing inverse `mm = (px − view.x|y) / view.scale` (contract #9). **Only the raw edges on the active anchor's side are read** (§3.4). Konva's own fixed edges and centre are never used.
- **Modifiers and anchor** — `ratio = (keepProportions ∨ shiftKey) ∧ isCorner(anchor)` and `alt = altKey`, sampled from the same DOM event Konva uses. `anchor = tr.getActiveAnchor()`, which reflects Konva's rename on drag-through.

### 3.3 Segments
A **segment** is a maximal run of moves with the same key `(active anchor, ratio, alt)`. A segment starts at the first bounded move after the threshold crossing, and whenever the key changes: Alt pressed or released, Shift or the toggle changing ratio on a corner, or Konva renaming the anchor after a drag-through. At a segment start, the per-axis references are **captured from `prev`**, the last bounded box (integers, exact):
- **One-edge axis:** the fixed edge `F` is `prev`'s edge opposite the active side. `dir = +1` when the moving edge is right/bottom, −1 when left/top.
- **Centred axis (Alt):** the doubled centre `C2`. When Alt is newly pressed (or the gesture starts with it), `C2 = 2·prev.pos + prev.size`. **While Alt stays held, `C2` is carried unchanged into the new segment** (anchor rename, ratio toggle) and is never re-derived from a rounded box. *(r3, N2: re-capturing from `prev` at each rename crept 0.005 mm per crossing.)*
- **Axis not touched by the anchor** (side handles): it keeps `prev`'s values.

Inside a segment these references **never change**. That is the fix for r1's finding 1: no reference is ever re-derived from a rounded box mid-segment. A fixed edge captured from `prev` is exact, because `prev`'s fixed edge equals it. A centre is carried rather than re-captured while Alt is held, because `prev`'s centre may sit 0.005 mm off.

### 3.4 What Konva contributes per move
Konva moves the dragged anchor to the pointer (`anchorDragBoundFunc` may adjust it first). Then:
- **Free and centred modes:** the raw edge on the active side **is** the anchor's coordinate. Konva's other edges come from the node box we set on the previous move; with Alt, it mirrors them about **its current node centre**, which is the rounded `prev` — the value r1 fed back and drifted on.
- **Ratio mode:** Konva places the dragged corner at `comparePoint + hyp·(cos, sin)`, with a per-axis sign. `comparePoint` is the opposite corner of the current node box, or its centre with Alt; `hyp` is the full Euclidean distance from `comparePoint` to the anchor (not a projection); `cos`/`sin` come from the gesture-start box. Each axis flips independently when the anchor is strictly past `comparePoint` on that axis (§4.1).

The bounded-move maths therefore reads only:
- **free and centred axes:** `e = raw edge on the active side` (right → `raw.x + raw.width`; left → `raw.x`; same for y);
- **ratio:** the **anchor position** `a` (after the threshold and the ratio clamp, §3.5 step 0), measured against the segment's own integer reference. This is Konva's own hypotenuse rule without Konva's rounded node box (r3, N2);
- **all modes:** the raw extent sign, for the drag-through freeze.

### 3.5 Algorithm (one bounded move; order encodes the precedence of §3.6)
0. **Ratio anchor clamp** (in `anchorDragBoundFunc`, after the D-5 threshold; one-edge ratio only, i.e. corner + ratio, no Alt; r3, N1; behaviour subject to Q7).
   - Compute the minimum box: `kMin` on the larger start axis and its derived partner, as in step 5.5.
   - On each axis, if the proposed anchor is closer to the segment's fixed corner `F` than that axis's minimum extent (measured toward the natural side), move it to exactly that extent: `a_axis = F_axis + dir·minExtent_axis` (stage px).
   - Konva then never computes a negative extent and never renames the anchor.
   - It also never skips a move for being under 1 px, because a 4 mm floor is ≥ 2 px even at 15% zoom (4 mm × 0.51 px/mm). The exception is a grandfathered axis under ~2 mm at ≤ 15% zoom, where Konva's own skip can hold `prev` (G9).
   - Step 0 runs in `anchorBound`; steps 1–6 run in `boxBound`.
   - Beyond the corner on one axis, the box is driven by the other axis's distance; beyond both, it is exactly the minimum box. One fast move past the corner lands on the minimum box too (§3.8 E12).
1. **Drag-through freeze** (free and centred modes; it cannot occur in one-edge ratio after step 0). If `raw.width ≤ 0` or `raw.height ≤ 0`, return `prev` with no guides.
   - Konva has already renamed the anchor before calling `boundBoxFunc` (§4.1), so the next move starts a new segment.
   - **Free axis:** the new fixed edge comes from `prev`, so the gesture resumes from the opposite edge. Contract #11 accepts this; the box is continuous because it was pinned at the floor. Ben's recorded "hold until mouseup" preference is **not** adopted for free axes (#11: do not change it pre-emptively).
   - **Centred axis:** the centre is carried (§3.3), so the symmetric box continues unchanged.
2. **Segment key.** If the key differs from the current segment's, capture a new segment from `prev`, carrying the centre while Alt stays held (§3.3). In the session this happens in `anchorBound`, before Konva runs, so the clamp in step 0 always uses the current segment's fixed corner.
3. **Free one-edge axis** (no ratio, no Alt), fixed edge `F`, direction `dir`, floor `fl`:
   1. Snap: `bestSnap([{ value: e, rate: 1 }], targets)` in mm. If it engages, `E = halfUp(t2)` and the guide is `t2`. Otherwise `E = toH(e)`.
   2. Floor, **after quantization**: if `dir·(E − F) < fl`, then `E = F + dir·fl` and the guide is dropped.
   3. `size = dir·(E − F)`; `pos = F` when `dir = +1`, else `E`. Both are integers.
4. **Centred axis** (Alt, no ratio), centre `C2`, floor `fl`:
   1. No snap.
   2. `W = max(fl, toH(2·dir·(e − C2/200)))`. The width comes from the dragged edge against the **segment** centre.
   3. `pos = floorDiv(C2 − W, 2)`. The centre is exact when `C2 − W` is even; otherwise it sits half a hundredth (0.005 mm) low, deterministically, and **the error never accumulates** because `C2` is fixed for the whole Alt hold.
5. **Ratio** (corner; both axes one-edge, or both centred with Alt). `S0w`, `S0h` are the **gesture-start** sizes in H (Konva's ratio basis):
   1. **Raw scale** from the anchor position `a` (mm × 100, a float in H) and the start diagonal `hyp0 = hypot(S0w, S0h)`. One-edge: `s = hypot(a − F) / hyp0`. Centred: `s = 2·hypot(a − C2/2) / hyp0`. This is exactly Konva's corner rule (`hyp·cos`, `hyp·sin`) applied to our integer references. (r2 read Konva's raw corner instead. That is identical for one-edge ratio, but with Alt it inherits Konva's rounded node centre — N2.) The larger start axis `big` (x when `S0w ≥ S0h`) still decides the default controlling axis.
   2. **Snap candidates** (one-edge only; centred axes never snap): for each axis, the candidate moving edge `F + dir·S0·s` (mm) is checked with `bestSnap`.
   3. **Controlling axis `k`, deterministic:** the axis whose snap engaged; if both engaged, the one with the smaller correction (mm); if the corrections are equal, `big`; if the start sizes are also equal, x. With no snap, `k = big`.
   4. **Controlling size:** snapped → `E = halfUp(t2)` and `size_k = dir·(E − F)`; otherwise `size_k = Math.round(S0k·s)`.
   5. **Floor, exact:** `size_k ≥ kMin = max(fl_k, ceilDiv(fl_o·S0k, S0o))`. If raised, the guide is dropped. This guarantees `size_k·S0o/S0k ≥ fl_o`, so the dependent size also meets its floor. With an undersized axis, `kMin ≥ S0k`, so both sizes stay ≥ their start values (D-1).
   6. **Dependent size:** `size_o = roundHalfUpDiv(size_k·S0o, S0k)`, exact integer arithmetic.
   7. **Positions:** one-edge from the fixed corner (`pos = F` or `F − size`); centred `pos = floorDiv(C2 − size, 2)` per axis.
6. Return `{ box, guideX, guideY }` (guides in H2). A guide is reported only for a snap that survived its floor. In ratio mode only the controlling axis can report one.

### 3.6 Precedence and ties (highest first)
1. **Segment references:** fixed edges, the fixed corner, and centres. Never moved within a segment.
2. **Floors (D-1)**, checked after quantization. They outrank ratio (the controlling size is floored exactly) and snap (the guide is dropped).
3. **Ratio:** one controlling axis exact on the grid; the dependent size derived from it.
4. **Snap:** moving one-edge axes only; nearest target within 1.6 mm; `bestSnap`'s tie rule (smaller correction, then lower value). In ratio mode the axis tie rule is §3.5 step 5.3.
5. **Raw pointer**, via the active-side edge only.
6. **Quantization to H:** `Math.round` for raw values; round-half-up (`halfUp`) for half-hundredth targets.

### 3.7 Guarantees and tolerances
Four layers are kept apart: **(M)** the integer model in H; **(P)** the stored payload; **(G)** geometric reconstruction in floating point; **(T)** formatted text.

| Id | Guarantee | Layer and tolerance |
|---|---|---|
| G1 | Fixed edges stay fixed within a segment. | **M:** exact integer equality.<br>**P:** an unchanged field emits its original stored number (`Object.is`), so a no-op gesture changes nothing and a moved left edge never rewrites the stored right-side values it does not own.<br>**G:** float `x + w` from stored canonical values is within 1e-9 mm of the H edge (measured max 1.1e-13 mm).<br>**Legacy non-canonical values:** the fixed edge is within 0.005 mm. |
| G2 | Every changed stored value is canonical. | **P:** exact. `v === fromH(h)` for an integer h; equivalently `quantizeInspector(v) === v`. |
| G3 | Commit == last preview == pill text == inspector after commit. | **P:** exact. The commit sends the stored payload object built from the last bounded box; nothing is recomputed at release.<br>**T:** exact. The pill and the inspector both apply `formatNum` to the same numbers. |
| G4 | A snapped moving edge sits on its guide. | **M:** exact when the target is on the 0.01 grid (even H2): page geometry, margins, element edges. **≤ 0.005 mm** for an element centre of odd size in H, the model grid's resolution (the same bound D-035 records for drag). |
| G5 | Ratio preserved. | **M:** the dependent size is within **0.005 mm** of `size_k · S0o / S0k`, as an integer inequality: `abs(2·(size_o·S0k − size_k·S0o)) ≤ S0k`. Relative error ≤ `0.005 / size_o`: about 0.007% at 70 mm, **up to 0.125% at the 4 mm floor** (§11 C7). Holds with and without snap, with Alt, and for grandfathered shapes. |
| G6 | Centred scaling keeps its centre. | **M:** width exact; centre within **0.005 mm** of the centre captured when Alt was pressed, for **every** move while Alt stays held — across anchor renames and ratio toggles. No accumulation. A new Alt press captures a new centre from `prev` by design (§3.3). |
| G7 | Floors. | **M:** exact integer comparisons, after quantization. Size ≥ the effective floor per axis. An undersized axis is never below its start value. With ratio and any undersized axis, both sizes are ≥ their start values. Nothing changes at press or below the threshold. |
| G8 | No-op preservation and determinism. | **M/P:** if the release box equals `start` in H, no `COMMIT` is dispatched and the document reference is unchanged. The same session state and input always give the same output. *(Replaces r1's G8 idempotence claim, which does not hold: a centred odd-parity box fed back as raw moves by 0.01 mm, and an edge just outside the radius snaps when fed back.)* |
| G9 | Crossing and recovery (r3). | **M:** within a segment the bounded box is a pure function of the anchor position, so returning the pointer to an earlier position with the same modifiers restores the earlier box exactly.<br>**One-edge ratio:** Konva never renames (step 0), so this holds across fixed-corner crossings; the fixed corner never moves.<br>**Centred modes:** renames carry the centre, so it holds across centre crossings.<br>**Free axes:** a crossing re-anchors per #11, with the box continuous at the floor.<br>**Not covered:** moves Konva itself skips under 1 px. They keep `prev`, and arise only where a box axis is under ~2 px on screen (a grandfathered axis below ~2 mm at ≤ 15% zoom). |

**Explicitly not guaranteed:**
- A snapped edge, an exact ratio and an exact centre **simultaneously**. They cannot all hold on a 0.01 grid.
- That the pointer and the moving edge coincide after a floor clamp, a freeze or a ratio projection. The edge stays where the rules put it.
- Bit-identity of floating-point reconstructions such as `x + w`. Those carry the stated tolerance.

### 3.8 Worked examples (from `docs/evidence/slice-d-math-check.out.txt`)

| # | Case | r1 result | r2 result |
|---|---|---|---|
| B1 | Centred (Alt), x 0, w 10 (centre 5), right handle at 10.005 / 10.010 / 10.015 / 10.020 mm (widths 10.01–10.04). | Centre drifts to **5.02**. | Widths 10.01 / 10.02 / 10.03 / 10.04; x −0.01 / −0.01 / −0.02 / −0.02; centre 4.995 / 5 / 4.995 / 5. Within 0.005 mm, no drift. |
| B2 | Right handle on 20 × 30 → free to 55.37 → Alt at 57.00 → Alt at 57.50 → Alt released at 60.00. | — | x 20 w 35.37 → centre 37.685 captured: x 18.37 w 38.63 → x 17.87 w 39.63 (centre still 37.685) → fixed left = 17.87, w 42.13. |
| B3 | Ratio, 4.03 × 4, scale 1.0087, no snap. | 4.07 × 4.03 (error **0.0097 mm**). | Controlling x: **4.07 × 4.04**; exact 4.039702; error 0.0003 mm. |
| B4 | R9 T10: ratio 4:3 (40 × 30 at 10, 10), target x = 60. | — | 50 × 37.5 exactly; guide x 60; fixed corner (10, 10). |
| B5 | Ratio 40 × 30, targets x 60 (correction 0.08) and y 47.60 (correction 0.04). | — | Controlling **y**: h 37.60 exact, w 50.13 (exact 50.133…); guide y 47.60. |
| B5b | Square 40 × 40, both edges 0.50 mm from a target. | — | Tie → larger start axis → equal → **x**: 50.5 × 50.5. |
| B6 | Floors: normal axis raw 3.994 → 4.00. Grandfathered 2.5 × 20: shrink to 2.4 → 2.5; enlarge to 3.2 → 3.2. Ratio on 2.5 × 20: scale 0.9 → 2.5 × 20; 1.1 → 2.75 × 22. | — | As listed. |
| B7 | Ratio + Alt on 30.01 × 20, corner pointer (33.30, 22.10). | — | 36.5 × 24.33 about the start centre; centre error 0.005 mm; ratio error 0.0048 mm. (Unchanged in r3: the scale now comes from the anchor position.) |
| B8 | Snap ties: two targets 0.50 mm either side (20.00 / 21.00) → lower wins: 20.00. Half-hundredth target 25.005 (centre of a 10.01-wide element) → edge 25.01. | — | Edge within 0.005 mm of its guide. |
| B9 | Target at 3.00 inside the 4 mm floor. | — | w 4.00, guide dropped. |

**Konva port check (script section D;** node 40 × 30 at (100, 100) mm, bottom-right anchor, ratio**):**
- Natural quadrant: raw 53.67 × 40.25.
- Pointer past the fixed corner in **x only**: raw width −48.66 → anchor renamed `bottom-left`.
- In **y only**: raw height −18.97 → `top-right`.
- **Both**: −11.31 × −8.49 → `top-left`.
- With Alt, crossing the centre flips the same way.

**Crossing-and-return paths (script section E;** start 40 × 30 at (100, 100), 100% zoom, 0.2 mm pointer steps, out and back along the same path**):**

| Path | r2 (freeze + Konva rename) | r3 |
|---|---|---|
| E1 ratio, crosses x only | 1 freeze, 1 rename; jump **13.67 mm** in one step; 202 out/back mismatches; back at the start point 48.42 × 36.32 instead of 57.69 × 43.27 | 0 freezes, 0 renames; max step 0.09 mm; 0 mismatches; exact return |
| E2 ratio, crosses y only | jump **9.47 mm**; 152 mismatches | 0 / 0; max 0.07 mm; exact return |
| E3 ratio, crosses both (through the corner) | 2 renames; 6 mismatches | 0 / 0; holds the 5.34 × 4.01 minimum box; exact return |
| E4 ratio, top-left anchor, crosses x | jump **15.82 mm**; 201 mismatches | 0 / 0; max 0.08 mm; exact return |
| E5–E7 ratio + Alt, crosses the centre in x / y / both | continuous, 0 mismatches (the paths cross only twice) | same; centre carried |
| E8–E9 free corner / free side cross the fixed edge (#11) | 2 freezes, 2 renames; max step 0.60 mm (continuous at the floor); returns to the start box | unchanged (accepted #11 behaviour) |
| E10 ratio near the fixed corner | — | smallest box 5.34 × 4.01: `kMin = ceil(4 × 40/30)` = 5.34 on the controlling axis, dependent 4.005 → 4.01 |
| E11 ratio on grandfathered 2.5 × 20 | — | never below 2.5 × 20; 0 freezes; exact return |
| E12 one fast move from (150, 140) past the corner to (60, 50) | frozen, then re-anchored at the far corner: 100.5 × 75.38 at (50.72, 63.04) | lands on the minimum box 5.34 × 4.01 at the fixed corner (100, 100) |
| E13 Alt held, 6 centre crossings, start centre 105.005 | centre creeps **0.010 mm** | 0.005 mm (carried) |

**Random evidence (script section F;** 4,000 seeded gestures through the Konva port: random views at 0.51–27.2 px/mm, all 8 anchors, mid-gesture ratio/Alt toggles, renames, 25% undersized starts**):**
- r3: 312,818 bounded moves; 47,126 segments; 530 Konva 1 px skips; 6,652 freezes and renames (free and centred modes only); 6,322 clamped moves.
- r3 one-edge ratio: **0 freezes, 0 renames, 0 skips**.
- r3 properties: 0 non-integer outputs, 0 floor violations, 0 undersized shrinks, 0 fixed-edge changes within a segment.
- r3 tolerances: max centre error 0.005 mm, both per segment and per continuous Alt hold; max ratio error 0.005 mm; max snapped-edge-to-guide 0.005 mm.
- r3: 0 payload or format mismatches, 0 px round-trip failures, 0 non-deterministic reruns.
- r2 on the same gestures: **594 freezes and 594 renames in one-edge ratio mode** (each one a potential N1 re-anchoring); otherwise the same property results.
- r1 (section G): centred drift > 0.005 mm in 115,285 of 148,146 moves (max 0.14 mm); unsnapped ratio error > 0.005 mm in 5,289 of 40,000 (max 0.0098 mm).

**What this evidence is and is not:**
- It verifies the proposed maths against a **port** of Konva 10.3.0's anchor logic.
- It does **not** verify real Konva in real browsers: event timing, the anchor drag offset, float agreement between our fixed-corner px and Konva's `comparePoint`, layering, or cursors. The stage 1 probe (§6) checks those in Chromium, Firefox and WebKit before any integration, including every crossing path above.

### 3.9 Commit mapping
- The session stores the bounded box in H and, beside it, the **payload**: `{ x, y, width, height }` as stored numbers. For each field, if its H value equals `start`'s, the payload holds the element's **original stored number**; otherwise it holds `fromH(h − offH)` (page-relative). The pill renders from this payload; release commits this payload object.
- The owning page never changes (#2). Negative page-relative x is allowed (T18).
- The patch goes through the existing `updateElement`. It skips locked elements structurally and returns the **same document** when every field is `Object.is`-equal to the stored value, so a no-op is dropped by the generic `COMMIT` (#24/#25). The reducer, autosave, the revision-guarded PUT, authorization and the desktop gate are unchanged.

---

## 4 · Gesture lifecycle in the editor

### 4.1 Konva 10.3.0 facts this design relies on (read from the installed source)
- **`transformstart` fires on anchor mousedown**, before any movement. `_handleMouseDown` also records `sin`/`cos` of the **current** node rect, which is the ratio basis for the whole gesture.
- **`transformend` fires on mouseup** through a capture-phase window listener (`_handleMouseUp` → `_removeEvents(e)`). It is passed the mouseup event and **does not process its coordinates**: the node holds the last move's geometry.
- **`stopTransform()` and `destroy()` also fire `transformend`, with no event** (`_removeEvents()`).
- **`anchorDragBoundFunc(oldAbs, newPos, evt)`** runs on every move before the anchor moves and receives the DOM event. If it returns `oldAbs`, Konva sees `oldAbs === newAbs` and returns early: no transform, no `boundBoxFunc`, no `transform` event.
- **Ratio:** `keepProportion = keepRatio() || evt.shiftKey` (with `shiftBehavior 'default'`), applied **only** in the four corner branches.
  - The dragged corner is placed at `comparePoint ± hyp·(cos, sin)`, where `comparePoint` is the opposite corner of the current box, or its centre with Alt, and `hyp` is the Euclidean distance from `comparePoint` to the anchor.
  - The sign is chosen **per axis**: `reverseX = -1` when the anchor is strictly past `comparePoint` on x (top-left: `tl.x > c.x`; top-right: `tr.x < c.x`; bottom-left: `c.x < bl.x`; bottom-right: `br.x < c.x`), and likewise for y.
  - So crossing one axis flips only that axis: a negative extent, then a rename in `_fitNodesInto`. r2's model missed this (r2 review, finding 1).
- **Centring:** `centeredScaling = centeredScaling() || evt.altKey`. With it, Konva moves the opposite anchors by the dragged anchor's offset **relative to the transformer's current box**, so it mirrors about the current node centre on every move. This is why r2 never reads Konva's centre (§3.4).
- **Anchor renaming:** in `_fitNodesInto`, a negative proposed width or height renames the active anchor (left ↔ right, top ↔ bottom) **before** `boundBoxFunc` is called, which receives the negative extent. A proposed width or height in [−1, 1] px (inclusive, padding 0) returns early: `update()`, no `boundBoxFunc`, no rename.
- **Defaults to override explicitly:** `keepRatio` defaults to **true**, `flipEnabled` to **true**, `rotateEnabled` to **true**.
- **Cursors:** anchors write `stage.content.style.cursor` on `mouseenter` and clear it to `''` on `mouseout`. `destroy()` clears it if one was set.
- **Bundle:** Transformer code is **already in the editor's Konva chunk** (`8593.*.js`, 193,907 B; contains `_handleMouseDown` and `anchorDragBoundFunc`), so using it adds no Konva bytes.

### 4.2 Configuration
- `rotateEnabled={false}`, `flipEnabled={false}`, `keepRatio={keepProportions}` (D-2), `shiftBehavior="default"`, `centeredScaling={false}` (Alt enables it per event), `ignoreStroke`, `padding={0}`.
- `borderEnabled={false}`: the existing solid selection outline stays the single border, so there is no double border.
- All 8 anchors for rect/ellipse. Anchor style from the spike: 7 px, oxblood stroke, white fill, radius 2, constant on screen.
- The Transformer sits in **its own listening `Layer` above the overlay layer**, not inside the zoomed `Group`. Konva's Transformer ignores ancestor transforms anyway; a separate top layer keeps anchors above guides and outlines.
- It attaches by node id (`id={element.id}` on `ElementNode`) only when all of these hold:
  - exactly one id is selected;
  - it is on the shown unit, unlocked and not a line;
  - the tool is Select or Hand;
  - the phase is writable.
- Under Hand or Space it is present but `listening={false}` (D-4).

### 4.3 Transient gesture state (ADR-003 invariant 4)
A plain-TypeScript **resize session** controller (`resize-session.ts`) owns all gesture state in refs. It needs no Konva, which is why it is unit-testable in jsdom (no canvas exists in the test environment). A session exists **from anchor press (`transformstart`) to release or cancel**, including while the threshold is pending. It holds:
- `pressPoint` (stage px), `crossed` (the D-5 latch);
- `start`, `floors`, `targets` (H / H2);
- `segment` — key, fixed edges or centres (§3.3);
- `prev` (H), `payload` (stored numbers, §3.9);
- `activeAnchorAtStart` (for the held cursor), `cancelled`, `pendingRefit` (§4.6).

It exposes three hooks, wired to Konva by the thin `SelectionTransformer.tsx`:
- **`anchorBound(oldAbs, newPos, evt)`** — runs first on every move. It:
  - samples Shift/Alt and the pointer from `evt` (the same event Konva reads);
  - enforces the 3 px threshold by returning `oldAbs` until crossed (§1 D-5);
  - determines the segment key from `tr.getActiveAnchor()` and the modifiers, capturing a new segment from `prev` (or carrying the centre) when the key changes (§3.3);
  - in one-edge ratio mode, applies the anchor clamp (§3.5 step 0);
  - records the final anchor position for `boxBound`.
- **`boxBound(oldBox, newBox)`** — reads `tr.getActiveAnchor()`, converts the active-side raw edges (and, in ratio mode, the recorded anchor position) px → mm, and calls `boundResize`. It writes the result and its payload **synchronously** into `prev`/`payload`, and returns the box converted back to px.
- **`onTransform(node)`** — re-applies the bounded box to the node as unscaled render attrs: `x, y, width, height` for a rect; `x/y` centre plus `radiusX/radiusY` for an ellipse; `scaleX = scaleY = 1`. One shared function `nodeAttrsFor(element, box)` is used here and by `ElementsLayer`, so the preview renders exactly as the committed element will (stroke and corner radius are never scaled). Konva's own `update()` positions the anchors from it.

The pill, the guides and an `ElementsLayer` **`resizePreview` override** (like Slice C's `dragPreview`) are React state mirrored from `payload`. **The document is untouched until one COMMIT**, so no preview frame can reach history or autosave (#24/#25).

### 4.4 Release, commit, cancel, cleanup
- **Release** (`transformend` carrying a real `mouseup`, not cancelled):
  - If `crossed` and `prev` differs from `start` in H: call `onResize(id, payload)`. The shell runs `updateElement`, then **one** `COMMIT { label: 'Resize', selection: unchanged }`.
  - Otherwise nothing.
  - Either way: the preview override, pill and guides clear; the viewport freeze ends and any deferred refit is applied (§4.6). React's next render applies the committed (or unchanged) model attrs.
- **Release point.**
  - The commit reads `payload`, written synchronously in `boxBound` during the last processed move. It does not depend on any React render having happened — the Slice C Firefox lesson (`570934b`).
  - Konva itself ignores the mouseup's coordinates, so the committed box is exactly the last drawn box (G3).
  - The harness asserts this in Firefox, which delivers mouseup before rendering, by comparing the PUT body with the last pill (§8.2).
- **Cancel** — any of:
  - Escape: a capture-phase window `keydown` registered at `transformstart`, calling `stopImmediatePropagation` so the shell's resting-state Escape does not deselect (D-3).
  - Window `blur`.
  - `readOnly` becoming true (a save conflict or the window closing).
  - The Transformer unmounting.
  - Any `transformend` **without** a mouseup event (Konva's `stopTransform`/`destroy` path).

  On cancel: `cancelled ← true`, `tr.stopTransform()`, the preview override is cleared (React restores the model attrs), pill and guides clear, and the viewport freeze ends (deferred refit applied). **No COMMIT, no save, selection unchanged.**
- **Cleanup:** every listener the session adds (capture `keydown`, `blur`) is removed on release, cancel and unmount; the session ref is cleared, which lifts the wheel suppression (§4.6). Konva removes its own window listeners in `_removeEvents`.

### 4.5 Keyboard during an active resize session
`use-editor-keyboard.ts` has **no gesture guard today**: ⌘Z, Delete, the arrows, ⌘D/C/X/V/A and the tool letters act even mid-drag (§11 C4). For resize this would break AC-8 — for example, an undo mid-gesture followed by a commit onto the undone document.

D adds a guard fed by a shared `gestureActiveRef`, which the stage sets for the whole resize session (press to release or cancel). While it is set:
- Every document-mutating, tool-switching and unit-navigating key is ignored.
- **Escape** is handled by the session's capture listener (cancel).
- **Native activation is blocked:** today `isControlTarget` lets Space and Enter activate a focused button or checkbox natively (C-6). During a session, the session's capture listener calls `preventDefault` for Space and Enter on such targets, on both keydown and keyup (browsers differ on which one activates), so a focused toolbar control (fit, zoom, unit navigation) cannot fire mid-gesture.
- **Space:** keydown/keyup always keep `spaceHeld` accurate (so it never sticks). **What Space does to an active resize is not decided — Q2.** Until Ben answers, no Space-mid-resize behaviour is implemented (§6 stage 4).

Whether the same guard (and the viewport freeze of §4.6) should also cover Slice C's drag, creation and marquee is **Q3** (§10.3). The default in this plan is resize only.

### 4.6 Viewport freeze during a resize session (proposed policy — Codex finding 4)
The screen-to-model mapping (`view.x`, `view.y`, `view.scale`) must not change while a resize session exists; otherwise the pointer and the bounded box disagree mid-gesture. Every route that can change it is listed:

| Route (code today) | During a session | After release, Escape, blur, unmount |
|---|---|---|
| Wheel pan / ctrl-or-⌘-wheel zoom, including trackpad pinch delivered as ctrl+wheel (`SpreadStage.onWheel`, unguarded) | `preventDefault()` and return: no `SET_VIEW`, no page scroll or browser zoom. Applies from press, threshold-pending included. | Next wheel event behaves normally (the guard reads the live session ref; nothing to restore). |
| Viewport size change → refit (`useEffect([size])` dispatches `fitUnitView`; `useViewportMeasure`'s ResizeObserver). Window resizing, a panel opening, browser zoom. | The Stage canvas resizes (pointer coordinates stay stage-relative, so the mapping holds), but the **refit is deferred**: `pendingRefit ← true`, no `SET_VIEW`. | If `pendingRefit`, exactly one `fitUnitView` for the current size, after the commit or cancel. |
| Keyboard: tool letters, unit navigation, ⌘ chords (`use-editor-keyboard.ts`) | Ignored by the key guard (§4.5). | Normal. |
| Focused toolbar control activated by Space/Enter (fit page/unit, 100%, unit navigation in `EditorShell`) | Native activation blocked (§4.5). | Normal. |
| Toolbar or pointer clicks elsewhere | Impossible without releasing the button, which ends the session first. | — |
| Hand / Space drag-pan | Not startable: `enabled` gates new gestures, and the anchor press owns the pointer. Space-mid-resize semantics are Q2. | Per D-4. |
| `readOnly` (conflict, window closed) | Cancels the resize (§4.4). | — |
| Device-pixel-ratio change (window moved between displays) | No mapping change (CSS px). Konva redraws. | — |
| Safari trackpad pinch (WebKit `GestureEvent`; the editor does not handle it today) | Visual-viewport zoom only: layout, the stage rect and client coordinates stay consistent, so the mapping holds. Not intercepted. Cannot be driven in the VM's Playwright WebKit; recorded, not tested. | — |

Tests: §7 (`slice-d-viewport-freeze.test.tsx`) and §8.2.

### 4.7 Cursor (contract #21 — extend, never fork)
- **`resolveCursor` gains `resizing: { cursor } | null`, at the top of the chain beside `dragging`.** While a resize is live, the wrapper holds the active anchor's directional cursor, taken from the anchor at gesture start (`nwse-resize`, `nesw-resize`, `ns-resize`, `ew-resize`). If the pointer leaves the anchor — for example while held at the minimum — Konva's `mouseout` clears the inner element and the wrapper shows the same cursor, so the cursor never flickers. This replaces the readiness plan's resolver input `resizing: boolean`, because the wrapper must name the specific cursor.
- **Inactive handles (D-4).** When Hand or Space makes handles inactive and no resize is live, `SelectionTransformer` clears `stage.content.style.cursor` if an anchor had set it. This mirrors Konva's own `mouseout`/`destroy` behaviour, so the inner element never shows a resize cursor that a press could not honour; the wrapper shows `grab`. It is the only write to the inner element outside Konva itself, and it only ever clears.
- **Stage mousedown guard.** `onStageMouseDown` ignores presses whose target is a Transformer child, so an anchor press never also starts a marquee. When handles are inactive the anchors don't hit, so the press reaches the stage and pans.
- **Priority:**
  1. `resizing` (held) / `dragging` (held, `move`)
  2. active pan (`grabbing`)
  3. hand available (`grab`)
  4. creation tool (`crosshair`)
  5. marquee / other gesture (`default`)
  6. object hover
  7. `default`

  Konva's anchor cursor on the inner element wins by containment while set (unchanged architecture).

### 4.8 Visibility rules
- **Selection outline and handles visible:** Select or Hand tool.
- **Hidden:** under creation tools (#4: selection persists).
- **Change to existing behaviour:** `SpreadStage` currently hides outlines whenever the tool is not `select`, so they also vanish under **Hand**. That contradicts #4 (hidden only for creation tools) and D-4. D shows them under Hand (§11 C3).
- **Multi:** dashed union border, no handles.
- **Locked single:** solid outline and lock indicator, no handles.

### 4.9 Creation-pill consistency correction (approved)
Today the creation pill and preview show the **unquantized** box, while `onUp` commits `quantizeCreate` values (x, y, w, h to 0.1 mm, minimum 4). During a drag still under the 3 mm click threshold, they show a 4 mm box although release creates the default-size element. D makes both exact:
- **Past the click threshold:** the preview box and pill show the element that will commit, converted back to unit space for drawing. Positions are quantized page-relative, then the page offset is added; sizes are `quantizeCreate(max(4, size))`. The pill formats the same numbers the commit sends (G3's rule applied to creation).
- **Under the click threshold:** only the anchor dot shows — no box, no pill. Release there is a click (#3: "tiny drag = click = default-size element"), so showing a box would misstate the outcome. This is an implementation choice (§10.2).

Creation's guide can still sit up to 0.05 mm from the committed edge, because creation commits on the accepted 0.1 grid (#19 / D-035). The pill no longer pretends otherwise.

### 4.10 Inspector (D-1 floor, D-2 toggle)
- **Floor:** `SIZE_BOUNDS` (`{ min: 2 }`) becomes `sizeBounds(current) = { min: effectiveMin(current, 4), step: 1, shiftStep: 5 }`. NumField's existing clamp-at-bounds and no-op rules then deliver D-1's typed and stepped behaviour unchanged. NumField already quantizes to 0.01 through `quantizeInspector` and displays through `formatNum`, both consistent with §3.1 (exhaustively checked).
- **Typed W/H stay independent:** typing W pins the left edge, as today.
- **Keep proportions** (proposed wording and placement; Ben may adjust the words without reopening D-2):
  - **Placement:** single-object inspector → *Position & Size*, a full-width row directly under the X/Y/W/H grid.
  - **Control:** a native checkbox. C-6 already keeps shortcuts live after clicking a checkbox.
  - **Label:** **Keep proportions**.
  - **Caption** (caption style, ink-soft, linked by `aria-describedby`): **"Corner handles only. Shift does the same. W and H are typed separately."**
  - Shown for sized objects (rect, ellipse; images in E). Disabled with the fieldset when the object is locked. The state persists across selections for the session.
  - **Alternative caption** if Ben prefers shorter: "For corner dragging. W and H stay independent."

---

## 5 · Files

**New (implementation, after authorization)**
- `packages/domain/src/editor/hundredths.ts` — `toH`, `fromH`, `floorDiv`, `ceilDiv`, `roundHalfUpDiv`, `halfUp` (§3.1).
- `packages/domain/src/editor/minimums.ts` — `MIN_SHAPE_MM`, `effectiveMin`.
- `packages/domain/src/editor/resize.ts` — `boundResize` (segment-aware, §3.3–3.5), `startBoxH`, `resizePayload`, `isCornerAnchor`, `anchorCursor`.
- `apps/web/components/editor/resize-session.ts` — the Konva-free session controller (§4.3–4.6).
- `apps/web/components/editor/SelectionTransformer.tsx` — the thin Konva adapter.
- Unit tests (Vitest):
  - `apps/web/test/editor/slice-d-resize-math.test.ts`
  - `slice-d-resize-session.test.tsx`
  - `slice-d-viewport-freeze.test.tsx`
  - `slice-d-cursor.test.ts`
  - `slice-d-inspector.test.tsx`
  - `slice-d-creation-readout.test.tsx`
  - `slice-d-overlays.test.tsx`
  - `slice-d-shell-resize.test.tsx`
- **Local harness (subject to Q5):**
  - `apps/web/app/(editor)/e2e-harness/[fixture]/page.harness.tsx` — renders the real `EditorGate` with a fixture `docRow`. It is compiled only in a harness build (§8.2).
  - `apps/web/test/e2e/fixtures/*.json` — fixture documents: grandfathered shapes, the 30-element reference document, a spread with snap targets.
  - `apps/web/playwright.harness.config.ts` — its own port (:3008), no credentials.
  - `apps/web/test/e2e/editor-resize-harness.spec.ts`.
- **Production suite:** `apps/web/test/e2e/editor-resize-acceptance.spec.ts` — committed, but **skipped unless `E2E_ACCEPTANCE=1`** and credentials are present; never in CI (§8.3, §8.5).
- Shared helpers:
  - `apps/web/test/e2e/support/write-budget.ts` — synchronous reservation; attempted/admitted/blocked counters; exhaustion signal.
  - `apps/web/test/e2e/support/ownership-journal.ts` — baseline id set, intent/result journal, ownership decision.
- Their tests:
  - `apps/web/test/e2e-support/write-budget.test.ts` and `ownership-journal.test.ts` (Vitest, pure, no browser);
  - `apps/web/test/e2e/editor-write-budget.harness.spec.ts` (harness, mocked persistence).

**Modified (implementation, after authorization)**
- `packages/domain/src/index.ts` — exports.
- `packages/domain/src/editor/precision.ts` — doc comment only: the fixed-edge identity rests on integer hundredths (§11 C16).
- `apps/web/components/editor/`:
  - `SpreadStage.tsx` — Transformer layer; stage-mousedown guard; resolver input; outlines under Hand; pill/guides from the session; wheel suppression and deferred refit (§4.6).
  - `ElementsLayer.tsx` — node `id`s, `resizePreview` override, `nodeAttrsFor`.
  - `StageOverlays.tsx` — multi dashed union border, lock indicator.
  - `cursor.ts` — `resizing`.
  - `use-stage-gestures.ts` — imports minimums from the domain; quantized creation preview/pill; no box under the click threshold.
  - `state/editor-ui.ts` — `keepProportions` + `SET_KEEP_PROPORTIONS`.
  - `EditorShell.tsx` — `onResize` → one COMMIT; `gestureActiveRef`.
  - `use-editor-keyboard.ts` — the guard, including blocked native activation during a session.
  - `inspector/Inspector.tsx` — toggle; per-element size bounds.
  - `inspector/NumField.tsx` — `sizeBounds`.
  - If Q6 is approved: `data-unit-element-ids` and `data-selected-ids` on the stage wrapper (test instrumentation, like `data-view`).
- `apps/web/next.config.js` — **subject to Q5:** `pageExtensions` includes `harness.tsx` only when `BAXTER_E2E_HARNESS=1`. The default production build is unchanged and verified so (§9.2).
- `apps/web/test/e2e/editor-smoke.spec.ts` — one corner resize, with persistence and reload, under the write budget (§8.3, §8.5).
- Docs at the end (§13).

**Evidence (documentation only):** `docs/evidence/slice-d-math-check.js` and `.out.txt` (added in r2 as `slice-d-r2-math-check.*`; renamed and extended in r3). They are isolated: outside the npm workspaces, so not linted, type-checked, tested or built.

**Not changed:** the reducer (`COMMIT` is generic), autosave, the API route, the schema, migrations, authorization, middleware, the desktop gate, `budget.json` and the budget allowance, CI, dependencies.

---

## 6 · Implementation stages and review checkpoints

Each stage is one or two commits on `slice-d-resize`. Every commit runs the full battery (§9.1) on its exact tree.

| Stage | Content | Checkpoint / dependency |
|---|---|---|
| **0** | The plan (docs only). r1 `8042cc8` reviewed by Codex; **r2 (this)**. | **Codex re-reviews r2 → Ben authorizes implementation.** |
| **1** | **Konva probe** — no production code. A throwaway page in the Mac VM, run under Playwright with the installed Konva 10.3.0 in Chromium/Firefox/WebKit. It records:<br>• boundBox coordinate space with a zoomed parent `Group`;<br>• the threshold via `anchorDragBoundFunc`;<br>• drag-through rename and the negative extent passed to `boundBoxFunc`;<br>• Alt mirroring about the current node box;<br>• the `keepRatio` default;<br>• `listening(false)` and inner-cursor clearing;<br>• layer hit order;<br>• scale normalisation in `transform`;<br>• wheel events delivered during a transform.<br>**Added in r3:** every crossing path of §3.8 E1–E13 replayed with real pointer events — ratio with and without Alt; crossing x, y and both; out and back; one fast move past the corner. For each move it records the anchor name, the raw box passed to `boundBoxFunc` (or a skip), and the bounded box, and compares them with the evidence script's port (a mismatch stops the plan). It also measures the ratio clamp (no rename, no skip, exact return) and the px agreement between our fixed corner and Konva's `comparePoint` (expected ≤ 1e-6 px; the clamp needs well under the minimum extent). | Findings reported to Codex. If any contradicts §4.1 or the port, **stop and amend the plan** before stage 2. |
| **2** | Domain: `hundredths.ts`, `minimums.ts`, `resize.ts`, and the maths tests (R9 matrix, §3.8 examples, sequence and property tests). The production code must reproduce the evidence script's B1–B9 outputs and its E1–E13 results exactly when driven by the same Konva port (now a test fixture). | **Codex reviews the maths before any UI exists.** |
| **3** | Visible small changes: D-1 inspector floor + tests; creation-pill correction + tests. | — |
| **4** | Resize session controller + tests: segments (centre carry), threshold, ratio anchor clamp, cancel, release point, one commit, key guard, viewport freeze. | **The Space-mid-resize policy and its tests are written only after Ben answers Q2, and the ratio clamp is activated only after Ben answers Q7. Stage 4 cannot be marked complete before both.** |
| **5** | Konva wiring: `SelectionTransformer`, `SpreadStage`, `ElementsLayer`, shell `onResize`, cursor chain, Hand/Space inertness, outlines under Hand, wheel suppression and deferred refit. | — |
| **6** | D-2 toggle (UI state + inspector). | — |
| **7** | D-6 chrome: multi dashed union border, lock indicator. | — |
| **8A** | **Local harness:** harness build flag, harness page, fixtures, harness spec in three browsers; grandfathering; the viewport freeze in a browser; performance on the reference document. **Zero production access.** | **Requires agreement on the harness mechanism (Q5).** |
| **8B** | **Production suite:** smoke extension + small env-gated acceptance; three browsers; admitted writes under the caps; zero residue or an explicit manual-recovery report. | **Blocked until Ben approves both Q1 (write allowances) and Q6 (id instrumentation).** Without Q6 there is no automatic cleanup and therefore no production run. Every recovery run needs its own approval. Not run before then. |
| **9** | Docs (§13); PR opened, **not merged**. | **Codex reviews the PR → Ben's acceptance → merge.** |

---

## 7 · Tests (Vitest, jsdom where needed; no new dependencies)

Property tests use a small seeded PRNG written inside the test (no `fast-check`). Every failure prints its seed. All geometry assertions are stated per layer (§3.7): integer equality in H, `Object.is` on payload fields, string equality on text, and an explicit tolerance for float reconstruction.

**`slice-d-resize-math.test.ts` (pure)**

*Representation:*
- `toH(fromH(h)) === h`, `quantizeInspector(fromH(h)) === fromH(h)`, and `formatNum(fromH(h))` equals the integer's decimal digits, exhaustively for ±200,000.
- Integer division helpers against BigInt references at the 2^53 bounds used.
- `0.03 − 0.01` style cases: edges built from H never subtract floats.

*R9 matrix,* in unit space with explicit targets (expected values in H):
- **T1:** right edge raw 69 → 70; w 50; guide.
- **T2:** left edge to margin; right edge equal in H, stored `x`/`w` per G1.
- **T3:** bottom to page centre.
- **T4:** corner, both axes snap independently.
- **T5:** release outside range → free 0.01 value; no guide.
- **T6:** engage/hold, then release past.
- **T7:** minimum pinned at the fixed edge; drag-through freezes and the next move starts a new segment from `prev`.
- **T10:** ratio 4:3, snap on x → w 50, h 37.5; fixed corner pinned (B4).
- **T11:** centred → no snap; width exact; centre within 0.005.
- **T13:** ellipse — same box maths.
- **T17:** right-page margin target 160 = 148 + 12 → commits page-relative x 12.
- **T18:** cross-gutter → owning page unchanged; negative page-relative x.

*Part 12 fixture:* off-grid X 20.05 → right edge exactly 70.00 in H; stored `w` = 49.95 canonical; stored `x` is the original number.

*Worked examples:* §3.8 B1–B9 reproduced exactly (the same numbers as the evidence script).

*Crossing and return (r3)* — the evidence script's Konva port becomes a test fixture (`konva-port.ts`, test-only):
- E1–E4 and E10–E12 (one-edge ratio): 0 freezes, 0 renames, 0 skips; continuity; exact out/back recovery; the minimum box beyond both axes and after a fast jump.
- E5–E7 and E13 (centred, with and without ratio): continuity; the centre carried across renames (≤ 0.005 mm per continuous hold); exact recovery.
- E8–E9 (free axes, #11): freeze and rename, then resume from the opposite edge; continuity at the floor.
- Grandfathered shapes under every crossing: never below their start sizes.

*Sequence tests (finding 1):*
- **Repeated centred moves:** 200 consecutive moves in one Alt segment from even and odd start widths; every box's centre within 0.005 mm of the captured centre; max over the sequence asserted.
- **Width-parity changes:** alternating odd/even widths (B1 pattern) with no accumulation.
- **Modifier transitions:** free → Alt → free → Alt; ratio on → off → on (Shift press/release); ratio + Alt → Alt only. Each transition starts a segment whose references equal `prev`'s and stay constant until the next.
- **Drag-through:** the rename sequence (negative extent → freeze → new segment).

*Ratio (finding 2):*
- Codex's 4.03 × 4 case (B3).
- Controlling-axis selection: one snap, both snaps (smaller correction wins), equal corrections (larger start axis, then x).
- Floors after quantization, including exact `kMin` at fractional ratios.
- Ratio + Alt (B7).
- Grandfathered shapes, ratio up only (B6).

*D-1:* undersized start (2.5 × 20): no change at press or crossing; cannot shrink; can enlarge to 3.2. The minimum outranks the snap and the guide is dropped (B9).

*Snap ties and half targets:* B8 cases; `bestSnap` tie rule unchanged.

*Legacy values:* a document with a non-canonical stored `x`: the unchanged field keeps its number; the fixed edge is within 0.005 mm.

*Properties* — driven through the Konva port, with random on-grid start boxes (25% with undersized axes); all 8 anchors; random mid-gesture ratio/Alt toggles; random views at 0.51–27.2 px/mm with offsets; random targets including half-hundredths. Checked on every move:
- integers;
- floors and undersized rules (G7);
- fixed references constant within a segment (G1);
- centre ≤ 0.005 (G6), ratio ≤ 0.005 (G5), guide ≤ 0.005 (G4);
- payload canonical and `formatNum` consistent (G2/G3);
- px round trip;
- determinism (G8);
- one-edge ratio never freezes, renames or is skipped; the centre is stable per continuous Alt hold (G9).

**`slice-d-resize-session.test.tsx`** (session controller driven with synthetic boxes and real window events)
- **D-5 threshold** at zoom 0.15 / 1 / 8: under 3 px → `anchorBound` returns `oldAbs` and `boxBound` is never called; the crossing applies the full displacement; the latch holds after returning within 3 px; an anchor click gives zero `onResize` calls.
- **Release point:** a mouseup immediately after a move, before any React render, commits that move's **payload object** (`Object.is` per field).
- A gesture whose release box equals the start in H → zero commits.
- **D-3:** Escape (capture phase; shell Escape not reached; selection kept) and blur → zero commits, preview cleared.
- `transformend` without an event → cancel. `readOnly` flip → cancel. Unmount → cancel.
- Shift sampled per move; corner vs side; toggle on + Shift.
- **Ratio anchor clamp** in `anchorBound`: proposed anchors past the minimum extent on x, y or both are clamped to it, and nothing else changes. The clamp follows segment changes (Shift press/release, Alt press/release). It is inactive below the threshold and in free/centred modes.
- **Key guard:** ⌘Z, Delete, arrows, V/H/R, unit navigation ignored mid-session; Space/Enter on a focused button do not activate it mid-session; Escape cancels.
- **Space mid-resize:** written after Q2.

**`slice-d-viewport-freeze.test.tsx`** (finding 4)
- Wheel (plain and ctrl/⌘) during a **threshold-pending** session → no `SET_VIEW`, `preventDefault` called.
- Same during **active resizing**.
- After **release**, **Escape**, **blur** and **unmount** → the next wheel event changes the view normally.
- A viewport-size change during a session → no `SET_VIEW`; exactly one refit after release, and after cancel.
- No size change during the session → no refit at the end.
- The session ref is cleared in every exit path (no leaked suppression).

**`write-budget.test.ts`** and **`ownership-journal.test.ts`** (pure; r3; §8.5)
- Budget, with fake routes:
  - exact boundary: cap N → writes 1…N admitted, N + 1 blocked; `attempted = admitted + blocked`;
  - 50 concurrent requests with cap 24 → exactly 24 admitted, 26 blocked;
  - an admitted write that then fails (5xx), errors on the network, or never completes still counts, with no refund;
  - a retry consumes a new reservation;
  - after exhaustion every later write is blocked and the exhaustion signal fires once;
  - auth requests do not consume A or C; any other non-GET request is blocked and fails the run;
  - a cleanup phase starts with its own C counters after A is exhausted.
- Ownership:
  - deletes only ids in the journal's created set, absent from the baseline, present now, with model values equal to the last or previous journaled state;
  - an intent without a recorded id → manual recovery, never deletion;
  - zero or several new ids after a creation → stop;
  - a changed model on an owned object → stop;
  - unknown ids are never touched.

**`slice-d-shell-resize.test.tsx`** (reducer + commit observer)
- One COMMIT `'Resize'`; selection unchanged; one autosave.
- Zero entries and zero saves for every no-op path; document reference unchanged.
- Undo/redo restores the box and the selection.
- A locked target → same document.

**`slice-d-cursor.test.ts`** (resolver table)
- `resizing` outranks pan, hand, creation and hover, and holds through.
- Hand/Space with no resize → `grab`.
- After cancel and after blur → no stale state.
- All existing rows unchanged.

**`slice-d-inspector.test.tsx`**
- Floor matrix: normal 10 → type 3 → 4; step down from 4.3 → 4; undersized 2.5 → type 2 = no-op; type 3 → 3; ↑ → 3.5; ↓ = no-op.
- Keep proportions: session state; not in history; not autosaved; disabled when locked; caption present; W/H independent.

**`slice-d-creation-readout.test.tsx`**
- Pill and preview equal the committed element at random pointer paths.
- Under 3 mm → anchor dot only, no pill.
- Existing creation tests updated where they asserted the unquantized preview.

**`slice-d-overlays.test.tsx`**
- Multi → one dashed union box, no per-object outlines, no handles.
- Locked → indicator present.
- Outlines visible under Hand, hidden under creation tools.

**Battery:** all existing suites stay green (main has 36 files / 431 tests).

---

## 8 · Browser acceptance, performance, production fixture

Two suites with different purposes and blast radii. **Interaction behaviour is proved locally with zero production access (8.2). Production runs prove only what needs the real save path (8.3).**

### 8.1 Where and how
- **Where:** Ben's Mac Linux VM; Chromium, WebKit and Firefox. Never in GitHub Actions.
- **Browser gates (C-7):** each browser is recorded PASS / FAIL / NOT EXECUTED (reason). None is waived. If a browser cannot run in the VM, it runs natively on Ben's Mac from his Terminal against the same committed build and suite.
- **Pointer aiming:** pointers are aimed with the stage's `data-view` / `data-page-offsets` instrumentation (approved as internal test instrumentation, 2026-10-06). Anchor screen positions are computed from the model box and the view.

### 8.2 Local harness suite (`editor-resize-harness.spec.ts`; finding 6; mechanism subject to Q5)
**Mechanism:**
- A **fresh `git clone --no-local`** of the exact commit, containing **no `.env` files**, so no production credential exists in the process (security-operations §5).
- Built and started with `BAXTER_E2E_HARNESS=1` and placeholder public Supabase variables (as the verification battery already uses), on `next start` port 3008.
- The flag makes `page.harness.tsx` a route. It renders the **same `EditorGate`** (→ `next/dynamic` → `EditorIsland` → `EditorShell` → `SpreadStage` → Transformer) with `publicationId: 'e2e-harness'` and a fixture `docRow`. The island boots through its normal `parseEditorDoc` path.
- **Persistence is mocked in the browser:** Playwright `page.route('**/api/editor/**')` fulfils every request — PUT → `200 { revision: n + 1 }`, or `409`/`423` where a test asks for them — and records each request body. Requests to any other origin fail the test.
- Nothing reaches Supabase. Middleware's `getUser()` without a session cookie makes no request, and the placeholder URL would fail anyway.

**Cases (all three browsers):**
- **Grandfathering (AC-21):** fixtures with 2.5 × 20 and 3.2 × 3.2 rects and a 2.5 × 20 ellipse.
  - Press and cross the threshold without net change → no movement, 0 PUTs.
  - Shrink the undersized axis → stays; 0 PUTs.
  - Enlarge to 3.2 → PUT body `width: 3.2`.
  - Ratio corner (toggle and Shift) down → unchanged; up → both ≥ start.
  - Inspector: type 2 → no-op; type 3 → 3; ↑ → +1; ↓ at floor → no-op.
- **Anchor families:** all 8 anchors, side and corner; the moving edge checked against the PUT body; the fixed edge's stored number unchanged.
- **R9:** T1–T7 and drag-through; T10/T11; T13 ellipse; T17 right-page margin; T18 cross-gutter (spread fixture).
- **Ratio** via the toggle and via Shift; side handles not ratio-locked.
- **Alt:** centred hold for ≥ 100 moves, and Alt pressed/released mid-gesture (finding 1, in a browser).
- **No-op paths (0 PUTs):** anchor click; sub-threshold wiggle at three zooms; Escape mid-resize (selection kept; a second Escape deselects); window blur mid-resize; Space held over an anchor (no resize, pans, `grab` cursor, inner cursor cleared); Hand tool over an anchor.
- **Viewport freeze (AC-20):** wheel and ctrl-wheel during threshold-pending and active resize → `data-view` unchanged; resizing the browser viewport mid-gesture → no refit until release, then one; after release/Escape/blur the wheel works.
- **Locked single:** outline + indicator, no anchors. **Multi:** dashed union border, no anchors.
- **Undo/redo:** box and selection restored; PUT bodies match.
- **Release point (all browsers, Firefox the motivating case):** the last PUT body's numbers equal the pill text at release; `formatNum` strings equal.
- **Conflict mid-resize:** the next PUT answered with 409 → `readOnly` → an active resize cancels.
- **Cursor readings** over each anchor family: inner element vs wrapper.
- **Space during an active resize:** written after Q2.

**`editor-write-budget.harness.spec.ts` (r3; mocked persistence, no production):** the budget helper and ownership journal run against the real editor in three browsers.
- With A set small (e.g. 3): exhaustion stops the action within one await; the context goes offline and then closes; the mock receives zero requests after going offline, including the `pagehide` keepalive flush of unsaved changes.
- Concurrent writes, injected with `Promise.all` in the page, never exceed the cap.
- Retries after mocked 500s consume allowance.
- A fresh cleanup context deletes only the journaled ids, under its own C, and a cleanup exhausting C stops and reports.
- A fixture document with a pre-existing element (baseline) and a "human" edit injected between runs verifies that only owned, unchanged ids are deleted.

### 8.3 Production suite (minimal; needs Q1 and Q6)
Purpose: prove what only production can — the real autosave PUT, the revision guard, persistence and reload — for resize.
- **Smoke extension** (`editor-smoke.spec.ts`, first spread, its own rectangle): one corner resize; inspector W/H == the pill at release; exactly one PUT for it; undo then redo; reload with exact values. In D the smoke's cleanup moves to the same **id-based ownership** as the acceptance suite (§8.5); its existing geometry identity becomes a consistency check only (§11 C17).
- **Acceptance** (`editor-resize-acceptance.spec.ts`, `E2E_ACCEPTANCE=1`, back cover — must be empty at the start, deleted at the end, asserted empty after a reload):
  - Create one rect and one ellipse.
  - One each: left-side resize (commits x and w); top-left free corner (commits x, y, w, h); Shift ratio corner; Alt centred; inspector W.
  - Undo + redo.
  - No-op checks with 0 PUTs: anchor click; Escape mid-resize; blur mid-resize; wheel during a resize.
  - Reload fidelity of every committed box.
  - Cleanup.

### 8.4 Performance (AC-18)
- **Target:** resize frame time ≤ 18.2 ms (≥ 55 fps; blueprint budget "Drag / resize frame rate ≥ 55 fps on reference doc", C/D) on the 30-element reference document.
- **Where:** the **harness** with the reference-document fixture (30 elements, reference-doc C composition). This needs no production writes. r1 built the document on production with ≈ 6 writes.
- **Measurement:** `performance.mark('baxter:editor:resize-move')` in `boxBound` → `measure` at the next frame after React commits, mirroring Slice C's drag measure. A scripted 2-second sweep (≥ 60 moves) reports median, p95 and max.
- **Gate:** median ≤ 18.2 ms in Chromium and Firefox in the VM.
- **WebKit:** measured and reported. The VM's WebKit is software-rendered and not representative (HANDOFF §7). If its median exceeds the target, it is re-measured natively on the Mac before any conclusion.
- Exceeding the budget makes optimisation part of D (blueprint rule).

### 8.5 Production writes: allowances, enforcement, ownership, recovery — needs Ben's approval (Q1 and Q6)
**No production-write test for D has run or will run before Ben approves Q1 and Q6.** Each recovery run needs its own approval.

**Estimate per browser** (unchanged from r2):
- Smoke: today's 5 PUTs + resize, undo, redo = **8** (7 action + 1 cleanup).
- Acceptance: 2 creations + 5 resizes/edits + undo + redo = **9 action** + **1 cleanup**.
- Together **≈ 19 per browser (16 action + 3 cleanup), ≈ 57 for three browsers**, all to one `editor_documents` row.

**Request classes** (decided per request in a `page.route('**/*')` handler; service workers blocked for the context so every request passes through it):

| Class | Definition | Treatment |
|---|---|---|
| **Write** | Any request to the app origin with a method other than GET/HEAD/OPTIONS whose path is `/api/editor/<fixture publication id>`: autosave PUT, create-if-absent POST, the `pagehide` keepalive PUT. These are the only requests that can change the fixture document. | Budgeted (below). |
| **Auth** | The sign-in form's server-action POST to `/sign-in` (Supabase is called server-side). | Allowed, counted separately; at most 3 per context, beyond which the run fails. |
| **Other non-GET** | Anything else: other paths, other publication ids, other origins. | Blocked and the run fails at once. Unexpected by construction, so it is never silently allowed. |

**Phases and caps.** Each phase has its own browser context and its own counters:
- **Action:** cap A = **24** admitted writes per browser.
- **Cleanup:** cap C = **8** per browser (3 planned + 5 reserve).
- **Recovery:** cap 8, separate approval each time.

**Counters** (per phase): `attempted` (every write request reaching the handler), `admitted` (forwarded with `route.continue()`), `blocked` (aborted with `route.abort()`). Invariants: `attempted = admitted + blocked` and `admitted ≤ cap`. `page.on('request')` cross-checks `attempted`.

**Synchronous reservation.** The write branch of the handler runs, before any `await`:
1. If the phase is closed or `admitted ≥ cap`: `blocked += 1`; signal exhaustion; `route.abort()`.
2. Otherwise: `admitted += 1` (the reservation), then `route.continue()`.

Playwright invokes route handlers on Node's single event loop, and the check-and-increment has no `await` between them, so concurrent requests cannot both pass: at most `cap` writes are ever admitted.

**Accounting:**
- An admitted write consumes allowance **whatever happens next** — 200, 409, 5xx, network error, or no answer before the context closes. There are no refunds.
- A retry (the autosave retry ladder, or a re-sent keepalive) is a new request and needs a new reservation.

**Termination on exhaustion:**
- The first blocked write closes the phase, so every later write is blocked too, and rejects the phase's `exhausted` promise.
- Every test action is awaited as `Promise.race([action, exhausted])`, so the test throws `WriteBudgetExhausted` at its next await.
- Fixture teardown then calls `context.setOffline(true)` first. No request of any kind leaves after that, including the editor's `pagehide` keepalive flush of unsaved changes. Then `context.close()`.
- Unsaved editor state in that page is discarded with it, by design.

**Cleanup:**
- Cleanup always runs afterwards — after success, assertion failure, timeout, exhaustion or a `readOnly`/conflict state.
- It runs in a **fresh context**: a new sign-in, the latest server revision, its own C counters, and the same enforcement. Reaching A therefore never prevents cleanup.
- If C is exhausted, cleanup stops and the run reports the remaining owned ids for manual recovery.

**Ownership — recorded element ids are mandatory (Q6):**
- **Instrumentation:** `data-unit-element-ids` (every element id on the shown unit) and `data-selected-ids` (the current selection) on the stage wrapper — internal test instrumentation, like the approved `data-view`. **Without Q6 approval there is no automatic cleanup, and therefore no production run.** There is no geometry-only fallback.
- **Baseline:** before the first write, the run records the unit's id set `B0` (the acceptance suite also asserts it is empty), fsynced to the run journal.
- **Creation:**
  1. The journal records the *intent* (unit, kind, intended geometry) before the action.
  2. After the action's write is admitted and answered, the run reads the unit's id set. Exactly one id must be new relative to `B0` and every previously created id.
  3. That id and the object's model values are journaled as the *result*.
  4. Zero or several new ids, or a failed read, stops the run. That creation is reported, never auto-deleted.
- **Later actions** on an owned object journal intent and result (model values), keyed by id.
- **Automatic deletion** happens only if **all** of these hold:
  - the id is in the journal's created set;
  - the id is not in `B0`;
  - the id is present now;
  - selecting the object yields exactly `data-selected-ids == [id]`;
  - its current model equals the last journaled state, or the one before it (allowing for a final write that was blocked or unanswered). Geometry is a **consistency check**, never proof of ownership.
- Deletion uses the editor's normal Delete and the revision-guarded autosave; a newer revision → 409 → stop.
- **Never deleted automatically:** ids in `B0`; ids not in the journal; an owned object whose model no longer matches (someone else changed it); anything created by an action whose id was not recorded. These are reported for Ben's manual recovery.
- **No baseline restore.** Nothing ever restores or re-saves a whole earlier document over newer changes.
- A fresh cleanup context loads the newest revision, so a concurrent human edit elsewhere on the unit causes no conflict. Ownership by id makes such edits irrelevant: only owned ids are touched. An edit to an owned object is caught by the consistency check.

**Interrupted runs:**
- An unfinished journal blocks new runs.
- `E2E_RECOVER=<journal>` — **only on Ben's go, each time** — opens a fresh context with the recovery cap and applies exactly the deletion rules above to the journal's recorded ids.
- Intents without a recorded id are reported, not acted on.
- If the journal is lost (VM reset), Ben inspects the fixture manually. Nothing is deleted by guesswork.

**Residual risk (accepted only by Ben):**
- Between a kill and a recovery, test objects remain on the fixture's back cover or first spread (one test-only document; no other publication touched).
- A creation interrupted before its id was recorded can leave one object that only Ben can remove.
- Admitted writes that failed still count, so a flaky network can exhaust A early. The run then stops; it does not continue.
- The fixture password exposure noted in security-operations §8 is unchanged by D.

**Requires Ben's approval:**
- running D's production suite at all (Q1);
- the A, C and recovery caps (Q1);
- the id instrumentation (Q6);
- each recovery run;
- any manual removal of unowned or ambiguous objects — Ben does that himself;
- any change to these rules.

---

## 9 · Verification gates

### 9.1 Every commit
- A fresh linux-x64 `git clone --no-local` of the exact commit, then `npm ci`.
- **The tested tree hash equals the committed tree hash.**
- Typecheck, test-tree typecheck, lint, all suites (guard suite included), forced build, `npm run budget`, preflight 6/6, `npm audit --omit=dev` unchanged (41: 33 moderate / 8 high / 0 critical on `790ddf9`).
- Run on Node 24 (CI and Vercel) and Node 22.
- From stage 2: `node docs/evidence/slice-d-math-check.js` still passes, and the domain tests reproduce its §3.8 numbers.

### 9.2 Bundle and build (AC-19; baseline measured on `790ddf9`)

| Measure | Value | D target |
|---|---|---|
| Shared First-Load JS | 343.1 kB (baseline 342.1 kB, +986 B of +1024 B; **38 B headroom**) | **+0 B**. Any growth stops work and is reported. The budget is not raised. |
| Konva chunk (`8593.*.js`) | 193,907 B (58,602 B gzip); Transformer already inside | Unchanged |
| Editor island chunk (`3934.*.js`) | 43,953 B (13,436 B gzip) | Measured and reported; expected growth a few kB, all island-only |
| Editor route page chunk | 4,738 B | Unchanged |
| Production route list (default build, no `BAXTER_E2E_HARNESS`) | — | **Contains no `/e2e-harness` route** (checked from the build's app-path manifest); otherwise identical to the pre-change route list |

### 9.3 Per stage
Codex checkpoints at stage 0 (r1 done, r2 now), stage 2 and stage 9; the stage 1 probe report goes to Codex. Ben's answers gate stage 4 (Q2, Q7), 8A (Q5) and 8B (Q1 and Q6).

### 9.4 Final (stage 9)
- Harness suite in three browsers, recorded per browser, with performance numbers.
- Production smoke + acceptance per §8.3, with attempted/admitted/blocked counts per phase and zero residue (or a manual-recovery report) — only if Q1 and Q6 were approved.
- Hosted CI + CodeQL + Vercel preview editor check on the PR head.
- PR opened, **not merged**.

---

## 10 · Decisions, implementation choices, open questions

### 10.1 Approved (not reopened)
- D-1…D-6 as in §1, except the D-4 interpretation that is open as Q2.
- Contract #11's accepted drag-through behaviour, kept as is. Ben's recorded "hold at minimum" alternative is not adopted, per #11.

### 10.2 Implementation choices made by this plan (Codex/Ben may object; each has a reason)
1. **Integer hundredths for all grid maths** (§3.1). This is what makes "exact" provable rather than hoped for.
2. **Segments** (§3.3): fixed edges and centres are captured from `prev` when the anchor/ratio/Alt key changes, and never recomputed inside a segment.
3. **Only the active-side raw edge (free and centred axes) or the anchor position (ratio) is read from Konva** (§3.4). Konva's other edges, its centre and its ratio-projected corner derive from our rounded box.
4. **Ratio controlling axis:** snapped axis; else the larger start axis (finer pointer tracking: it moves in 0.01 steps, and the smaller axis follows within 0.005); ties per §3.5 step 5.3. The dependent size is derived and quantized.
5. **Centred scaling: exact width, centre within 0.005 mm per segment**, with `floorDiv` rounding at odd parity (G6). The alternative — an exact centre with the width forced to a parity — would change sizes the user didn't ask for.
6. **Unchanged fields emit their original stored numbers** (§3.9), so no-ops and untouched axes never rewrite stored values.
7. **The threshold is implemented in `anchorDragBoundFunc`**, using Konva's own early return. There are no extra window listeners.
8. **Preview renders unscaled node attrs** (`nodeAttrsFor`), not Konva's scale. Strokes and corner radii are content in mm and must not scale during preview.
9. **The resolver holds the gesture-start anchor's cursor** for the whole gesture, including after an accepted rename. Calm over clever.
10. **Multi selection:** a dashed union border **replaces** per-object outlines, as in the spike. The alternative is to keep per-object outlines inside the dashed border.
11. **The lock indicator is a vector padlock at constant screen size (~11 px), inset at the object's top-left, on every locked object on the unit.** The spike used an emoji at 4 mm (zoom-dependent). Emoji fonts are absent in the Linux test browsers, and a mm-sized glyph vanishes at 15% and dominates at 800%.
12. **Creation preview and pill hidden under the 3 mm click threshold** (§4.9).
13. **Clearing the inner cursor when handles become inactive** (§4.7). It is the only touch of Konva's inner element outside Konva, and it only ever sets `''`, exactly as Konva's own `mouseout`/`destroy` do. Without it, Space pressed while hovering an anchor would leave a resize cursor showing over a press that pans.
14. **Viewport freeze policy** (§4.6) — Codex's recommendation, recorded as the proposed policy: wheel suppressed from press to release or cancel; the size refit deferred to session end; native control activation blocked.
15. **Local harness mechanism** (§8.2): a build-flagged `page.harness.tsx` route, fresh clone without `.env`, persistence mocked in the browser. Subject to Q5.
16. **Interaction coverage lives in the harness; production proves persistence only** (§8.2–8.3). This cuts production writes by about half and removes production writes from performance measurement.
17. **The acceptance and harness specs are committed** (production acceptance env-gated), unlike Slice C's one-off script, so Codex can review the exact evidence.
18. **Write-budget enforcement at the network layer** with synchronous reservation against admitted writes, termination via offline-then-close, and cleanup in a fresh context (§8.5).
19. **Ratio anchor clamp at the minimum box's corner** (§3.5 step 0; r3, N1). This keeps Konva from ever renaming the anchor in one-edge ratio mode. Clamping at the minimum extent rather than at the corner itself also means Konva never skips the move (a box under 1 px), so a fast move past the corner still lands exactly on the minimum box. The visible behaviour is Q7.
20. **The centre is carried while Alt stays held, and the ratio scale is taken from the anchor position** (§3.3–3.5; r3, N2).
21. **Ownership only by recorded element ids**, with geometry as a consistency check (§8.5; r2 review finding 3).

### 10.3 Genuinely open
- **Q1 — Ben; blocks stage 8B.** Approve D's production-write allowances?
  - **A = 24 admitted test-action writes and C = 8 admitted cleanup writes per browser** (96 total ceiling for three browsers), enforced by synchronous reservation, with the counting, termination, ownership and recovery rules of §8.5.
  - A recovery run has a cap of 8 and needs your separate go each time.
  - Not approved yet; no production-write test runs before Q1 **and** Q6 are approved.
- **Q2 — Ben; unresolved product question; blocks completion of stage 4 (the Space policy, its tests and AC-23).** What happens when Space is pressed **during** an active resize?
  - **Codex recommends:** *"Finish the current resize; if Space is still held after release, enable panning."*
  - Alternatives: cancel the resize when Space is pressed; or switch to panning mid-gesture (which would also need a commit-or-discard rule).
  - Slice C's drag currently behaves like the recommendation, but that is existing behaviour, not a decision for resize.
- **Q3 — Ben; non-blocking; default resize only.** Extend the in-gesture keyboard guard (§4.5) **and the viewport freeze (§4.6)** to Slice C's drag, creation and marquee? Today ⌘Z, Delete, the arrows and the wheel act mid-drag (§11 C4, C14). Recommendation: yes, as one small separate commit in D, with regression tests.
- **Q4 — Ben; non-blocking.** The caption wording for Keep proportions (§4.10).
- **Q5 — Codex review + Ben's OK; blocks stage 8A.** The harness mechanism:
  - a `next.config.js` `pageExtensions` entry for `harness.tsx` active only under `BAXTER_E2E_HARNESS=1`;
  - the harness page under `app/(editor)/e2e-harness/`;
  - a separate Playwright config on port 3008;
  - a fresh clone with no `.env` files;
  - the production build verified to contain no harness route (§9.2).
  
  Without a harness, AC-21 cannot be proved in a browser without writing undersized shapes into production data, and the production estimate returns to ≈ 38 per browser.
- **Q6 — Ben; blocks the whole production suite (stage 8B) and any automatic cleanup.** Add `data-unit-element-ids` (every element id on the shown unit) and `data-selected-ids` (the current selection) to the stage wrapper as internal test instrumentation, like the approved `data-view`?
  - Recorded ids are now the only accepted proof of ownership (§8.5).
  - **If Q6 is not approved, automatic cleanup and the production suite stay blocked**; the geometry fallback has been removed.
- **Q7 — Ben; product behaviour; blocks activating the ratio clamp (completion of stage 4).** When the dragged corner passes the fixed corner **with Keep proportions or Shift on (no Alt)**, should the box:
  - **(a) hold the fixed corner** — proposed (N1). The box keeps following the pointer's distance on the other axis, becomes the minimum box when the pointer is past both axes, never re-anchors, and returns exactly when the pointer comes back; or
  - **(b) re-anchor at its far corner** as r2 would have — evidenced as defective: jumps of 9.5–15.8 mm in one 0.2 mm step, the original corner lost, no exact return (§3.8 E1–E4, E12)?
  - Free (non-ratio) handles keep the accepted #11 behaviour either way, and centred (Alt) crossings are continuous either way.

---

## 11 · Conflicts and corrections found while planning
- **C1 — spec vs code.** Part 11 says Slice D "introduces the resolver + Konva inner-element convention". Both already exist on `main` (`cursor.ts`, `SpreadStage.tsx`). D **extends** them; the code is right and the spec text is historical.
- **C2 — contracts #11 and #19** state the inspector W/H floor as 2 mm. D-1 changes it to 4 mm with grandfathering (approved). This is recorded as **D-036** when D lands; the contract text gets an amendment note rather than a silent edit.
- **C3 — outlines under Hand.** `SpreadStage` hides selection outlines whenever the tool is not `select`, so they vanish under Hand. This contradicts #4 (hidden only under creation tools) and D-4. Fixed in stage 5.
- **C4 — no keyboard guard during gestures.** `use-editor-keyboard.ts` acts on ⌘Z, Delete, the arrows, the clipboard chords and the tool letters mid-drag. This is pre-existing and not caught by Slice C acceptance. D guards resize; Q3 covers the rest.
- **C5 — creation pill/preview.** They show the unquantized box, and a 4 mm box under the click threshold, while the commit is 0.1-quantized or default-size. Corrected (§4.9).
- **C6 — spike vs production pill precision.** The R9 spike pill displayed 0.1 mm. Production displays the exact committed values (`formatNum`, ≤ 2 dp), as AC-7 / G3 require.
- **C7 — contract #10's "≈ 0.007% worst case"** holds for ~70 mm sizes only. At the 4 mm floor, dependent-axis rounding can reach 0.125%. This plan states the true bound (G5) and promises nothing stronger.
- **C8 — Konva defaults.** `keepRatio`, `flipEnabled` and `rotateEnabled` default to `true` in 10.3.0 and are set explicitly. The readiness document's "~0 chunk delta" is confirmed: the Transformer is already in the editor's Konva chunk.
- **C9 — documents.** The handoff was stale (`main` = `351274b`; D-1…D-6 pending). It was brought to the r1 checkpoint and now to r2.
- **C10 — budget headroom.** 38 B remains after Next 15.5.28. D adds 0 B to shared JS. A future framework patch could exceed the allowance on its own, which would be Ben's budget decision, separate from D.
- **C11 — the readiness document's `resizing: boolean`** resolver input becomes `resizing: { cursor }`. The wrapper must name the directional cursor once the pointer leaves the anchor (§4.7).
- **C12 — tiny objects at low zoom.** The 7 px anchors can cover a 4 mm object entirely (4 mm × 0.51 px/mm ≈ 2 px at 15%), so a drag there needs zoom-in. This is spike-identical; it is recorded as a known limitation, not fixed.
- **C13 — (r1 claim withdrawn).** r1 said grandfathering could not be exercised in a browser. That was wrong: the local harness loads fixture documents with undersized shapes into the real editor without touching production (§8.2, AC-21).
- **C14 — wheel and viewport during gestures.** `SpreadStage.onWheel` changes the view with no gesture guard, and a viewport-size change refits the view at any time. This is pre-existing for drag, creation and marquee. D freezes the viewport for resize (§4.6); Q3 covers the rest.
- **C15 — r1 maths.** r1's centred rule drifted (finding 1), its unsnapped ratio rule exceeded its own G5 (finding 2), and its exactness claims assumed exact float arithmetic (finding 3). All are replaced in §3, with the counterexamples reproduced in the evidence script.
- **C17 — the existing Slice C smoke's cleanup** identifies its objects by geometry (C-8). That is no longer accepted as proof of ownership for D's production runs (r2 review, finding 3). D moves the smoke's cleanup to recorded ids (§8.3, §8.5). Whether pre-D smoke runs should also be held to this rule is Ben's call; this plan does not run them.
- **C18 — r2's evidence model was simplified** (it kept the ratio corner's direction). The r3 port corrected it, and two algorithm defects followed (N1, N2). Model evidence still needs real-Konva confirmation in the stage 1 probe.
- **C19 — `kMin` is conservative by design.** It uses the exact ceiling of the proportional floor, so the minimum ratio box may sit 0.01 mm above a box rounding alone would allow: 5.34 × 4.01 rather than 5.33 × 4.00 for 4:3, §3.8 E10. That keeps both the exact and the stored dependent at or above the floor.
- **C16 — `precision.ts` comment.** It says the commit-boundary grids make "the fixed-edge identity in contract #9's resize maths exact". That holds in integer hundredths (§3.1), not for float subtraction; the comment is corrected in stage 2 (comment only).

---

## 12 · Not in D
- Images (E), crop (F), text and fonts (G), lines (H), rotation, viewing modes (I).
- Multi-object resize; multi W/H.
- Page management, export.
- Moving E2E off production; running the harness in CI (a separate decision).
- `/[handle]/[slug]` outage handling.
- D-032's platform half, EasyPost keys, the security-operations §9 follow-ups.
- Dependabot #17, and the open Dependabot alerts **#86/#87** on `next` (status reported separately; no dependency change in this plan).
- Any Next.js upgrade.

---

## 13 · Document maintenance
- **Now (stage 0, r3):**
  - This plan is revised in place on `slice-d-resize`; r1 (`8042cc8`) and r2 (`b30373c`) remain in history.
  - The evidence script and its output are renamed to `docs/evidence/slice-d-math-check.*`, extended, and committed with byte-identical, reproducible output.
  - `HANDOFF.md` is brought to the r3 checkpoint and propagated byte-identical to the canonical and Vault copies, with checksums.
  - `native-publishing-slice-d-readiness.md` is left unaltered as the historical record.
- **At stage 8B:** `docs/security-operations.md` §8 gains D's measured per-browser attempted/admitted/blocked counts per phase, the write-budget rules and the id-ownership rules of §8.5, once approved.
- **At stage 9:**
  - `decisions.md` **D-036** — the integer-hundredths representation, segments and the centre carry, the ratio anchor clamp (per Ben's Q7 answer), precedence and tolerances (§3), and D-1's amendment of #11/#19.
  - `HANDOFF.md` Phase entry with the measured results, propagated again.
  - This plan's status line updated to "implemented on `slice-d-resize`", with Ben's acceptance decisions appended (Slice C's precedent).
