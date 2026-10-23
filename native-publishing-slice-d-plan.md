# Native Publishing — Slice D plan

**Status:** proposed plan for Codex's independent review. **Decisions D-1…D-6 were approved by Ben on 2026-10-22** (§1). **Implementation is NOT authorized**; it begins only after Codex's review and Ben's go. Nothing in this document changes application code, dependencies or CI.
**Base:** `main` = `790ddf9875f7ea4d35e594c52fc6eb1fdb218467` (PR #19 merge, Next.js 15.5.28), tree `db54dbef235a7a4d771f6e48a158f20f1e110677`. Branch: `slice-d-resize`.
**Supersedes for planning purposes:** `native-publishing-slice-d-readiness.md` (2026-10-06), which stays as the historical readiness record, unaltered.
**Scope (production handoff Part 11):** Transformer resize + numeric consistency — `boundResize` (edge-diff, ratio, minimums, quantization, stored-box commit), the live pill, the anchor no-op rule, cursor ownership. Acceptance: preview == commit property tests, the R9 matrix including off-grid positions, cursor table tests. Plus the six approved decisions.
**Contracts:** #2 · #4 · #5 · #9 · #10 · #11 · #18 · #19 · #20 · #21 · #24 · #25 · #26 (and #3 for the creation-pill correction).
**Sources read for this plan:**
- `HANDOFF.md`, `native-publishing-production-implementation-handoff.md` Parts 2, 6, 11 and 12, `native-publishing-slice-d-readiness.md`, `native-publishing-slice-a-blueprint.md` (performance budgets), `docs/adr/ADR-003`, `docs/security-operations.md` §5 and §8, `decisions.md` D-031…D-035.
- The R9 record `~/Desktop/baxter-spikes/review9-progress-for-chatgpt.md` (T1–T18) and the spike source `spike-c2/src/Workspace.jsx`.
- The editor code on `790ddf9`.
- **Konva 10.3.0's `lib/shapes/Transformer.js`** (the installed version; every Konva claim below was read from that source, not from memory or docs).

---

## 1 · Approved decisions (Ben, 2026-10-22)

The left column is Ben's decision as approved. The right column is how this plan makes it precise. The right column is reviewable; if Codex or Ben finds it does not match the decision, the decision wins.

| # | Approved | Precise definition used by this plan |
|---|---|---|
| **D-1** Minimum size | 4 mm per axis for shape resizing **and** inspector W/H. Existing smaller shapes are preserved, never enlarged automatically. An already undersized axis must not shrink further or jump unexpectedly. Changing the inspector's 2 mm floor is approved. | **Effective floor of an axis = `min(4 mm, the axis's value when the gesture or edit starts)`.**<br>• A normal axis (≥ 4 mm) can go down to 4.<br>• An undersized axis (e.g. 2.5) can never go below its starting value. It **can** be enlarged, including to values still below 4 (2.5 → 3.2 is allowed), and the new value becomes its floor for the next edit.<br>• Nothing ever moves at gesture start or on selection.<br>**Typed edits:** a value below the floor clamps to the floor. For an undersized axis that clamp equals the current value, so the edit is a **no-op** — no history, no save, the field shows the unchanged value. On a normal axis, typing 3 commits 4.<br>**Arrow steps:** same floor. Down from 2.5 is a no-op; up from 2.5 commits 3.5.<br>**Proportional (ratio) resize:** the single scale factor is floored at `max(floorW/startW, floorH/startH)`. If either axis is undersized that floor is ≥ 1, so the shape can be scaled **up** proportionally but not down.<br>Applies to rect and ellipse in D (images inherit it in E; text has its own 10 mm width rule in G). |
| **D-2** Keep proportions | The toggle affects **corner-drag resizing only**. Typed W/H stay independent. Side handles never preserve ratio. Client-only, remembered for the editor session. Shift also enables proportional corner resizing. | `keepProportions` is client UI state (Part 6 already lists "ratio-lock toggle" as client editor state). It is never persisted, never in history, never autosaved, and resets on reload.<br>Ratio applies iff `(keepProportions ∨ Shift) ∧ the active anchor is a corner`. With the toggle on, Shift changes nothing.<br>The ratio is the **gesture-start** box's ratio (also Konva's own behaviour, §4.1).<br>Wording and placement are proposed in §4.9. |
| **D-3** Cancel a resize | Escape or loss of window focus during a resize restores the original position and size, keeps the selection, and creates no save or history entry. | It extends the Slice C rule (C-5 / decision 2) to resize. **One meaning per press:** Escape during a resize cancels only the resize; the next Escape (no gesture) deselects and returns to Select, as today. Window blur cancels the same way. |
| **D-4** Panning takes priority | While Hand is active or Space is held, handles stay **visible but inactive**, the hand cursor shows, and accidental resizing is impossible. Specify Space pressed **during** an active resize. | Handles render but do not receive pointer events. A press on one pans, exactly as a press anywhere else does. The inner Konva cursor is cleared at the moment handles become inactive, so a stale resize cursor can never show (§4.6).<br>**Space during an active resize:** the resize continues to its mouseup, keeps its resize cursor and pans nothing. If Space is still held after release, handles become inactive and the cursor is `grab`. This is **exactly Slice C's drag behaviour** today (the drag cursor outranks hand in `resolveCursor`, and `enabled` gates only *new* gestures), so no new product decision is needed unless Ben prefers otherwise (Q2). |
| **D-5** Intent threshold | 3 **screen** px of movement before resizing begins, matching object drag. A handle click or sub-threshold movement changes nothing and creates no save or history entry. Define across zoom and at the crossing. | **Distance:** Euclidean, in CSS px, from the anchor-press point to the current pointer — the same measure as `DRAG_THRESHOLD_PX` in `use-stage-gestures.ts`. It is zoom-independent on screen, so in model terms it is `3 / (3.4 · zoom)` mm: 5.88 mm at 15%, 0.88 mm at 100%, 0.11 mm at 800%.<br>**Below it:** the box, guides and pill do not change at all.<br>**At the crossing:** the box jumps to the **full** displacement since the press (no swallowed distance), then is bounded and snapped like any other move. Same as drag.<br>**Latching:** once crossed, the gesture stays live even if the pointer returns within 3 px.<br>Modifiers pressed below the threshold take effect at the crossing. |
| **D-6** Selection and lock indicators | The specified dashed group border for multi-selections and the lock indicator for locked objects. Neither multi-selections nor locked objects get handles. Multi-object resize stays out of scope. | **Multi:** one dashed oxblood border around the **union** box of the selected objects shown on the unit (locked members included), replacing the per-object solid outlines. This follows the spike, where the multi border was the Transformer's border around all nodes with `borderDash [3,2]`. It travels with a drag preview.<br>**Lock indicator:** a small padlock on **every** locked object on the unit (the spike showed it on all locked objects, not only selected ones).<br>Both are listed as implementation choices in §10.2 so Codex or Ben can object. |

**Naming note.** "D-1…D-6" are Slice D's decision labels (from the readiness document). They are unrelated to `decisions.md`'s three-digit log (D-001…D-035). The resize precision rules and D-1's contract amendment land in the log as **D-036** with the implementation (§13).

---

## 2 · Scope, exclusions, acceptance criteria

### 2.1 In scope
- Konva Transformer resize for **one** selected, **unlocked**, **non-line** element (rect, ellipse), using the Select tool, with the phase writable.
- The pure `boundResize` maths (§3), the live `W × H mm` pill, snap guides, and the anchor no-op rule.
- Cursor chain extension (#21) and Hand/Space inertness (D-4).
- Cancel (D-3), the intent threshold (D-5), and the 4 mm floor with grandfathering in both resize and inspector (D-1).
- The Keep-proportions toggle (D-2), multi dashed border and lock indicator (D-6).
- The **creation-pill correction**: creation's preview box and pill show exactly what creation commits (§4.8).
- A keyboard guard during an active resize (§4.5).

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
- Next.js upgrades.

### 2.3 Acceptance criteria

Each criterion is proved by the tests named in §7 and the browser cases in §8.

| AC | Criterion | Contract | R9 / decision |
|---|---|---|---|
| AC-1 | A moving edge snaps to the shared target set (page edges, centre lines, margins, other elements' edges and centres, locked included); the guide shows while engaged; released past the 1.6 mm radius it commits the free position. | #8, #9, #20 | T1, T2, T3, T5, T6, T17 |
| AC-2 | Only edges the gesture moves snap; fixed edges are bit-identical to their start values. | #9 | T2, Part 12 "off-grid X 20.05 → right edge exactly 70.00" |
| AC-3 | Corner drags snap both axes independently (no ratio). | #9 | T4 |
| AC-4 | Ratio (toggle or Shift, corners only): one scale factor; the best single-axis snap drives it; the other axis follows; fixed corner pinned. | #10 | T10, D-2 |
| AC-5 | Alt/centred scaling: an axis whose two edges both move does not snap; centre preserved (tolerance §3.6). | #9 (tiebreaker) | T11 |
| AC-6 | Minimums: ≥ 4 mm per axis during preview, pinned to the fixed edge; the minimum outranks the snap (guide dropped); no flip; drag-through freezes at the last good box; grandfathered axes per D-1. | #11 | T7, D-1 |
| AC-7 | Preview == commit == pill == inspector-after-commit, bit-identical, on the 0.01 mm grid. Commits x, y, w, h (top/left anchors commit position too). | #9, #19 | T1–T18, Part 12 stale-position regression |
| AC-8 | One history entry per changed gesture. Zero for anchor clicks, sub-threshold movement, a gesture that ends where it started, cancel, or a locked target. One autosave per changed gesture; zero for the rest. Undo/redo restores box and selection exactly. | #24, #25 | T8, T9, D-3, D-5 |
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
| AC-19 | Shared First-Load JS grows **0 B**; Konva stays editor-only; the island chunk is measured and reported. | blueprint A7 | — |

**R9 cases not in D:** T12a–c (text, Slice G) and T14 (image frames, Slice E). Its "top/left resize commits x/y" regression is covered here with rect and ellipse. T15 (multi union move) shipped in Slice C.

---

## 3 · The resize calculation (pure domain)

### 3.1 Where it lives
- **`packages/domain/src/editor/resize.ts`:** `boundResize(input) → { box, guideX, guideY }`. It is pure: no React, no Konva.
- **`packages/domain/src/editor/minimums.ts`:** `MIN_SHAPE_MM = 4` and `effectiveMin(startValue, min) = Math.min(min, startValue)`. They move out of `use-stage-gestures.ts` because they are model rules shared by creation, resize and the inspector.
- Both are exported through the domain barrel like `moves.ts` and `snapping.ts`. Tree-shaking has kept prior domain additions out of shared chunks (0 B in B and C), and the budget check would catch a leak (§9).

### 3.2 Inputs
All lengths are unit-space millimetres (the spread's coordinate system; page 2 at `x + trimWidth`) unless marked px.

- `start` — the element's box at gesture start, converted from page-relative by adding its own page's offset. On the 0.01 grid (every committed value is; §3.7).
- `prev` — the last bounded box returned in this gesture (initially `start`). On the 0.01 grid by construction.
- `raw` — Konva's proposed box, converted px → mm with the existing inverse `mm = (px − view.x|y) / view.scale` (`screenToUnitMm`; contract #9's conversion). Konva's `boundBoxFunc` boxes are absolute stage px, and the stage carries no transform (zoom/pan live on the `Group`), so stage px = screen px relative to the wrapper.
- `ratio` — `(keepProportions ∨ shiftKey) ∧ isCorner(activeAnchor)`, sampled per move (§4.3).
- `floorW = effectiveMin(start.width, 4)`, `floorH = effectiveMin(start.height, 4)`.
- `targets` — `buildTargets(page geometry, every other element on the unit)`, built once at gesture start. It excludes only the resized element and includes locked elements (#20). Radius 1.6 mm (`SNAP_RADIUS_MM`).

### 3.3 Algorithm (order matters; it encodes the precedence of §3.5)
1. **Drag-through freeze.** If `raw.width ≤ 0` or `raw.height ≤ 0`, return `prev` with no guides.
   - Konva 10.3 renames the active anchor *before* calling `boundBoxFunc` when an edge crosses the opposite edge.
   - Contract #11 accepts the consequence: if the user keeps dragging, the gesture resumes from the opposite edge, and commit still equals preview.
   - Ben's recorded "hold until mouseup" preference is **not** adopted (#11: do not change it pre-emptively).
2. **Edge-diff against `prev`**, per axis, with ε = 1e-6 mm. The spike used 0.02 mm. 1e-6 is far above the conversion's float noise (~1e-12) and far below the 0.01 grid, so a genuinely moved edge is never missed.
   - **Exactly one edge moved:** that edge is the *moving* edge. The other edge is *fixed* and **taken from `prev`, never from `raw`**.
   - **Both moved:** a centred axis (Alt).
   - **Neither moved:** the axis is unchanged.
3. **Free (non-ratio) axis with one moving edge `e` and fixed edge `f`:**
   1. Snap: `bestSnap([{ value: e, rate: 1 }], targets.axis)`. Only the moving edge is a candidate, never the centre (R9 tiebreaker). If it engages, `e ← e + delta` and remember the guide.
   2. Minimum: if `|e − f| < floor`, then `e ← f ± floor` (pinned at the fixed edge) and **drop the guide**.
   3. Quantize the moving edge only: `e ← quantizeInspector(e)`. `f` is untouched.
   4. Size = `|e − f|`, exact on the grid because both edges are.
4. **Centred axis:**
   - No snap.
   - `w = max(floor, quantizeInspector(raw.w))`.
   - Centre `c = prev.x + prev.w / 2`. This equals the start centre when Alt is held from the beginning; it is also where Konva centres if Alt is pressed mid-gesture. Then `x = quantizeInspector(c − w/2)`.
   - Width exact; centre within 0.005 mm (§3.6).
5. **Ratio** (corner anchor, one moving edge per axis):
   1. `s_raw` = raw size ÷ start size on the axis with the **larger** start size. Konva keeps both proportional to float precision; the larger axis has the smaller relative quantization error.
   2. For each axis, place the moving edge at `f ± start.size · s_raw` and run `bestSnap` on it. Each engaged snap implies a factor `s_axis = |e' − f| / start.size`.
   3. Pick the axis whose snap correction is smaller in mm, and set `s = s_axis` with that axis's guide. If neither engages, `s = s_raw`.
   4. Floor: `s ← max(s, floorW/start.w, floorH/start.h)`. If the floor raised `s`, drop the guide.
   5. **The snapped axis**, if it survived the floor, gets an exact edge: `e = quantizeInspector(target)` and `size = |e − f|`. **The dependent axis** gets `size = quantizeInspector(start.size_other · size / start.size)`.
   6. Without a snap, both axes are `quantizeInspector(start.size · s)`.
   7. Positions come from the fixed corner: `x = f` or `x = f − w`, and likewise for y.
   - **Ratio + Alt** (both axes centred): factor about the centre, floored the same way; sizes quantized; positions per step 4.
6. Return `{ box, guideX, guideY }`. Guides are reported only for snaps that survived step 3.2 / 5.4.

### 3.4 Commit mapping
- The session stores the returned unit-space box. At commit it becomes page-relative: `x_page = quantizeInspector(x_unit − pageOffset(ownPage))`.
- Page offsets are multiples of the trim width (148 / 210 / 210 mm — all on the grid), so this is an identity on the grid. The quantize call guards against float representation.
- The owning page never changes (#2).
- The patch is `{ x, y, width, height }` through the existing `updateElement`, which skips locked elements structurally and returns the **same document** for identical values (so a no-op is dropped by `COMMIT`).

### 3.5 Precedence (highest first)
1. **Fixed edges / fixed corner** — never moved, never re-quantized (an identity).
2. **Minimum** (D-1 floors) — outranks ratio and snap. Under ratio it floors the *factor*, so the ratio survives.
3. **Ratio** — one factor for both axes. When a snap fixes one axis exactly, the other axis carries the rounding.
4. **Snap** — moving edges only; nearest target within 1.6 mm. Dropped whenever (2) overrides it. Never applied to a centred axis.
5. **Raw pointer.**
6. **Quantization to 0.01 mm**, applied last and only to moving values.

### 3.6 Guarantees and numerical tolerances (stated so none is mathematically incompatible)

| Id | Guarantee | Tolerance |
|---|---|---|
| G1 | Fixed edges equal their gesture-start values (or, after the accepted drag-through rename, their frozen values). | **Exact** (bit-identical) |
| G2 | Every committed x, y, w, h is on the 0.01 mm grid. | Exact (`quantizeInspector` output) |
| G3 | Commit == last preview == pill text == inspector after commit. | **Exact.** The commit writes the stored preview box; nothing is recomputed at release. The pill and inspector both use `formatNum` (≤ 2 dp), which is lossless on the 0.01 grid. |
| G4 | A snapped moving edge equals its guide. | **Exact** when the target is on the 0.01 grid (page geometry, margins, element edges). **≤ 0.005 mm** when the target is an element *centre* of an odd-hundredth size. This is the model grid's own resolution, the same bound D-035 records for drag. |
| G5 | Ratio preserved. | The dependent axis is within **0.005 mm** of the exact proportional value. Relative ratio error ≤ `0.005 / (dependent size)`: about 0.007% at 70 mm, **up to 0.125% at the 4 mm floor**. Contract #10's "≈0.007% worst case" holds only for typical sizes; this plan states the true bound (§11, C7). |
| G6 | Centred scaling keeps the centre. | Width/height exact on the grid; centre within **0.005 mm** (a centre of an odd-hundredth width cannot be represented exactly with an on-grid width and on-grid x). |
| G7 | Committed size ≥ the effective floor on each axis; undersized axes never go below their start value; nothing changes at gesture start. | Exact |
| G8 | Idempotence: feeding `prev` back as `raw` returns `prev`. | Exact |

**Explicitly not guaranteed:**
- A snapped edge, an exact ratio and an exact centre **simultaneously**. They cannot all hold on a 0.01 grid.
- That the pointer and the moving edge coincide after a minimum clamp or a freeze. The edge stays where the rules put it.

### 3.7 Why fixed edges are provably pinned
- Every committing path quantizes: inspector and resize to 0.01, creation, drag and nudge to 0.1 (`precision.ts`).
- So every model value is on the 0.01 grid, and the fixed edge is read from `prev`, which is on-grid by induction from `start`.
- The algorithm never re-quantizes a fixed edge. Even if it did, quantizing an on-grid value is an identity.

---

## 4 · Gesture lifecycle in the editor

### 4.1 Konva 10.3.0 facts this design relies on (read from the installed source)
- **`transformstart` fires on anchor mousedown**, before any movement.
- **`transformend` fires on mouseup** through a capture-phase window listener. It is passed the mouseup event and **does not process that event's coordinates**: the node holds the last move's geometry.
- **`stopTransform()` and `destroy()` also fire `transformend`, with no event.**
- **`anchorDragBoundFunc(oldAbs, newPos, evt)`** runs on every move before the anchor moves and receives the DOM event. If it returns `oldAbs`, Konva sees `oldAbs === newAbs` and returns early: no transform, no `boundBoxFunc`, no `transform` event.
- **Ratio:** `keepProportion = keepRatio() || evt.shiftKey` (with `shiftBehavior 'default'`). It is applied **only** in the four corner-anchor branches. Konva computes the proportion from the node rect *at mousedown*, so the ratio is the gesture-start ratio.
- **Centring:** `centeredScaling = centeredScaling() || evt.altKey`.
- **Anchor renaming:** in `_fitNodesInto`, when the proposed width or height is negative, the active anchor is renamed (left ↔ right, top ↔ bottom) **before** `boundBoxFunc` is called. A proposed |width| or |height| under 1 px returns early without calling `boundBoxFunc`.
- **Defaults to override explicitly:** `keepRatio` defaults to **true**, `flipEnabled` to **true**, `rotateEnabled` to **true**.
- **Cursors:** anchors write `stage.content.style.cursor` on `mouseenter` and clear it to `''` on `mouseout`. `destroy()` clears it if one was set.
- **Bundle:** Transformer code is **already in the editor's Konva chunk** (`8593.*.js`, 193,907 B, contains `_handleMouseDown` and `anchorDragBoundFunc`), so using it adds no Konva bytes.

### 4.2 Configuration
- `rotateEnabled={false}`, `flipEnabled={false}`, `keepRatio={keepProportions}` (D-2), `shiftBehavior="default"`, `centeredScaling={false}` (Alt enables per event), `ignoreStroke`, `padding={0}`.
- `borderEnabled={false}`: the existing solid selection outline stays the single border, so there is no double border.
- All 8 anchors for rect/ellipse. Anchor style from the spike: 7 px, oxblood stroke, white fill, radius 2 — constant on screen.
- The Transformer sits in **its own listening `Layer` above the overlay layer**, not inside the zoomed `Group`. Konva's Transformer ignores ancestor transforms anyway; a separate top layer keeps anchors above guides and outlines.
- It attaches by node id (`id={element.id}` on `ElementNode`) only when: exactly one id is selected; it is on the shown unit, unlocked and not a line; the tool is Select or Hand; and the phase is writable.
- Under Hand or Space it is present but `listening={false}` (D-4).

### 4.3 Transient gesture state (ADR-003 invariant 4)
A plain-TypeScript **resize session** controller (`resize-session.ts`) owns all gesture state in refs. It needs no Konva, which is why it is unit-testable in jsdom (no canvas exists in the test environment). It holds:
- `pressPoint` (stage px)
- `crossed` (D-5 latch)
- `start`, `prev`
- `targets`
- `ratio` and `alt` modifiers
- `activeAnchorAtStart` (for the held cursor)
- `cancelled`

It exposes three hooks, wired to Konva by the thin `SelectionTransformer.tsx`:
- **`anchorBound(oldAbs, newPos, evt)`** — samples Shift/Alt and the pointer from `evt`, and enforces the 3 px threshold by returning `oldAbs` until crossed (§1 D-5).
- **`boxBound(oldBox, newBox)`** — converts px → mm, calls `boundResize`, writes the result **synchronously** into `prev`, and returns it converted back to px.
- **`onTransform(node)`** — re-applies the bounded box to the node as unscaled render attrs: `x, y, width, height` for a rect; `x/y` centre plus `radiusX/radiusY` for an ellipse; `scaleX = scaleY = 1`. One shared function `nodeAttrsFor(element, box)` is used here and by `ElementsLayer`, so the preview renders exactly as the committed element will (stroke and corner radius are never scaled), and Konva's own `update()` positions the anchors from it.

The pill, the guides and an `ElementsLayer` **`resizePreview` override** (like Slice C's `dragPreview`) are React state mirrored from `prev`. **The document is untouched until one COMMIT**, so no preview frame can reach history or autosave (#24/#25).

### 4.4 Release, commit, cancel, cleanup
- **Release** (`transformend` carrying a real `mouseup`, not cancelled):
  - If `crossed` and `prev` differs from `start`: call `onResize(id, prev)`. The shell runs `updateElement`, then **one** `COMMIT { label: 'Resize', selection: unchanged }`.
  - Otherwise nothing.
  - Either way the preview override, pill and guides clear. React's next render applies the committed (or unchanged) model attrs.
- **Release point.**
  - The commit reads `prev`, written synchronously in `boxBound` during the last processed move. It does not depend on any React render having happened — the Slice C Firefox lesson (`570934b`).
  - Konva itself ignores the mouseup's coordinates, so the committed box is exactly the last drawn box (G3).
  - The browser layer asserts this in Firefox, which delivers mouseup before rendering (§8).
- **Cancel** — any of:
  - Escape: a capture-phase window `keydown` registered at `transformstart` that calls `stopImmediatePropagation` so the shell's resting-state Escape does not deselect (D-3).
  - Window `blur`.
  - `readOnly` becoming true (a save conflict or the window closing).
  - The Transformer unmounting.
  - Any `transformend` **without** a mouseup event (Konva's `stopTransform`/`destroy` path).

  On cancel: `cancelled ← true`, `tr.stopTransform()`, the preview override is cleared (React restores the model attrs), and pill and guides clear. **No COMMIT, no save, selection unchanged.**
- **Cleanup:** every listener the session adds (capture `keydown`, `blur`) is removed on release, cancel and unmount. Konva removes its own window listeners in `_removeEvents`.

### 4.5 Keyboard during an active resize
`use-editor-keyboard.ts` has **no gesture guard today**: ⌘Z, Delete, the arrows, ⌘D/C/X/V/A and the tool letters act even mid-drag (§11 C4). For resize this would break AC-8 — for example, undo mid-gesture followed by a commit onto the undone document.

D adds a guard fed by a shared `gestureActiveRef`, which the stage sets for the duration of a resize. While it is set:
- Every document-mutating and tool-switching key is ignored.
- **Escape** is handled by the session's capture listener (cancel).
- **Space** keydown/keyup still update `spaceHeld` (so it never sticks) but have no effect until release (D-4).

Whether the same guard should also cover Slice C's drag, creation and marquee is **Q3** (§10.3). The default in this plan is resize only.

### 4.6 Cursor (contract #21 — extend, never fork)
- **`resolveCursor` gains `resizing: { cursor } | null`, at the top of the chain beside `dragging`.** While a resize is live, the wrapper holds the active anchor's directional cursor (from the anchor at gesture start: `nwse-resize`, `nesw-resize`, `ns-resize`, `ew-resize`). If the pointer leaves the anchor — for example while held at the minimum — Konva's `mouseout` clears the inner element and the wrapper shows the same cursor. The cursor never flickers. This replaces the readiness plan's resolver input `resizing: boolean` with the specific cursor, because the wrapper must name it.
- **Inactive handles (D-4).** When Hand or Space makes handles inactive and no resize is live, `SelectionTransformer` clears `stage.content.style.cursor` if an anchor had set it. This mirrors Konva's own `mouseout`/`destroy` behaviour, so the inner element never shows a resize cursor that a press could not honour; the wrapper shows `grab`. That is the only write to the inner element outside Konva itself, and it only ever clears.
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

### 4.7 Visibility rules
- **Selection outline and handles visible:** Select or Hand tool.
- **Hidden:** under creation tools (#4: selection persists).
- **Change to existing behaviour:** `SpreadStage` currently hides outlines whenever the tool is not `select`, so they also vanish under **Hand**. That contradicts #4 (hidden only for creation tools) and D-4. D shows them under Hand (§11 C3).
- **Multi:** dashed union border, no handles.
- **Locked single:** solid outline and lock indicator, no handles.

### 4.8 Creation-pill consistency correction (approved)
Today the creation pill and preview show the **unquantized** box, while `onUp` commits `quantizeCreate` values (x, y, w, h to 0.1 mm, minimum 4). During a drag still under the 3 mm click threshold, they show a 4 mm box although release creates the default-size element. D makes both exact:
- **Past the click threshold:** the preview box and pill show the element that will commit, converted back to unit space for drawing. Positions are quantized page-relative, then the page offset is added; sizes are `quantizeCreate(max(4, size))`.
- **Under the click threshold:** only the anchor dot shows — no box, no pill. Release there is a click (#3: "tiny drag = click = default-size element"). Showing a box would misstate the outcome. This is an implementation choice (§10.2).

Creation's guide can still sit up to 0.05 mm from the committed edge, because creation commits on the accepted 0.1 grid (#19 / D-035). The pill no longer pretends otherwise.

### 4.9 Inspector (D-1 floor, D-2 toggle)
- **Floor:** `SIZE_BOUNDS` (`{ min: 2 }`) becomes `sizeBounds(current) = { min: effectiveMin(current, 4), step: 1, shiftStep: 5 }`. NumField's existing clamp-at-bounds and no-op rules then deliver D-1's typed and stepped behaviour unchanged.
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

**New**
- `packages/domain/src/editor/minimums.ts` — `MIN_SHAPE_MM`, `effectiveMin`.
- `packages/domain/src/editor/resize.ts` — `boundResize`, `isCornerAnchor`, `anchorCursor`.
- `apps/web/components/editor/resize-session.ts` — the Konva-free session controller (§4.3–4.5).
- `apps/web/components/editor/SelectionTransformer.tsx` — the thin Konva adapter.
- Tests:
  - `apps/web/test/editor/slice-d-resize-math.test.ts`
  - `slice-d-resize-session.test.tsx`
  - `slice-d-cursor.test.ts`
  - `slice-d-inspector.test.tsx`
  - `slice-d-creation-readout.test.tsx`
  - `slice-d-overlays.test.tsx`
  - `slice-d-shell-resize.test.tsx`
- `apps/web/test/e2e/editor-resize-acceptance.spec.ts` — committed, but **skipped unless `E2E_ACCEPTANCE=1`** and credentials are present; never in CI (§8).

**Modified**
- `packages/domain/src/index.ts` — exports.
- `apps/web/components/editor/`:
  - `SpreadStage.tsx` — Transformer layer, stage-mousedown guard, resolver input, outlines under Hand, pill/guides from the session.
  - `ElementsLayer.tsx` — node `id`s, `resizePreview` override, `nodeAttrsFor`.
  - `StageOverlays.tsx` — multi dashed union border, lock indicator.
  - `cursor.ts` — `resizing`.
  - `use-stage-gestures.ts` — imports minimums from the domain; quantized creation preview/pill; no box under the click threshold.
  - `state/editor-ui.ts` — `keepProportions` + `SET_KEEP_PROPORTIONS`.
  - `EditorShell.tsx` — `onResize` → one COMMIT; `gestureActiveRef`.
  - `use-editor-keyboard.ts` — the guard.
  - `inspector/Inspector.tsx` — toggle; per-element size bounds.
  - `inspector/NumField.tsx` — `sizeBounds`.
- `apps/web/test/e2e/editor-smoke.spec.ts` — one corner resize, with persistence and reload, self-cleaning.
- Docs at the end (§13).

**Not changed:** the reducer (`COMMIT` is generic), autosave, the API route, the schema, migrations, authorization, the desktop gate, `budget.json` and the budget allowance, CI, dependencies.

---

## 6 · Implementation stages and review checkpoints

Each stage is one or two commits on `slice-d-resize`. Every commit runs the full battery (§9.1) on its exact tree.

| Stage | Content | Checkpoint |
|---|---|---|
| **0** | This plan (docs only). | **Codex reviews the plan → Ben authorizes implementation.** |
| **1** | **Konva probe** — no production code. A throwaway page in the Mac VM, run under Playwright with the installed Konva 10.3.0 in Chromium/Firefox/WebKit, records: boundBox coordinate space with a zoomed parent `Group`; threshold via `anchorDragBoundFunc`; drag-through rename; `keepRatio` default; `listening(false)` and inner-cursor clearing; layer hit order; scale normalisation in `transform`. | Findings reported. If any contradicts §4, **stop and amend the plan** before stage 2. |
| **2** | Domain: `minimums.ts`, `resize.ts`, and the math tests (R9 matrix + property tests). | **Codex reviews the maths before any UI exists.** |
| **3** | Visible small changes: D-1 inspector floor + tests; creation-pill correction + tests. | — |
| **4** | Resize session controller + hook tests (threshold, cancel, release point, one commit, key guard, Space). | — |
| **5** | Konva wiring: `SelectionTransformer`, `SpreadStage`, `ElementsLayer`, shell `onResize`, cursor chain, Hand/Space inertness, outlines under Hand. | — |
| **6** | D-2 toggle (UI state + inspector). | — |
| **7** | D-6 chrome: multi dashed union border, lock indicator. | — |
| **8** | Browser layer: smoke extension + acceptance spec; three-browser run; performance; PUT counts; zero residue. | **Requires Ben's approval of the production-write budget (Q1).** |
| **9** | Docs (§13); PR opened, **not merged**. | **Codex reviews the PR → Ben's acceptance → merge.** |

---

## 7 · Tests (Vitest, jsdom where needed; no new dependencies)

Property tests use a small seeded PRNG written inside the test (no `fast-check`). Every failure prints its seed.

**`slice-d-resize-math.test.ts` (pure)**

*R9 matrix* in unit space with explicit targets:
- **T1:** right edge raw 69 → 70; w 50; guide.
- **T2:** left edge to margin; right edge bit-identical.
- **T3:** bottom to page centre.
- **T4:** corner, both axes snap independently.
- **T5:** release outside range → free 0.01 value; no guide.
- **T6:** engage/hold, then release past.
- **T7:** minimum pinned at the fixed edge; drag-through freezes.
- **T10:** ratio 4:3, snap on x → w 50, h 37.5 exactly; fixed corner pinned.
- **T11:** centred → no snap; width exact; centre within 0.005.
- **T13:** ellipse — same box maths.
- **T17:** right-page margin target 160 = 148 + 12 → commits page-relative x 12.
- **T18:** cross-gutter → owning page unchanged; negative page-relative x.

*Part 12 fixture:* off-grid X 20.05 → right edge exactly 70.00.

*D-1:*
- Undersized start (2.5 × 20): no change at start; cannot shrink; can enlarge to 3.2.
- Ratio with an undersized axis: the factor is floored at 1.
- The minimum outranks the snap; the guide is dropped.

*Snap-target tolerance:* a half-grid target (centre of a 10.01-wide element) → within 0.005 mm.

*Edge-diff robustness:* ±1e-9 px float noise on unmoved edges is still treated as fixed.

*Properties* (random on-grid start boxes; all 8 anchors; ratio on/off; centred on/off; random views at scale 0.51–27.2 with random offsets; random targets):
- Outputs on the grid (G2).
- Fixed edges bit-identical (G1).
- Sizes ≥ floors (G7).
- Ratio tolerance (G5).
- Snapped edge within tolerance of its guide (G4).
- Idempotence (G8).
- px → mm → px round trip stable.

**`slice-d-resize-session.test.tsx`** (session controller driven with synthetic boxes and real window events)
- **D-5 threshold** at zoom 0.15 / 1 / 8: under 3 px → `anchorBound` returns `oldAbs` and `boxBound` is never called; crossing → full displacement; latch after returning within 3 px; anchor click → zero `onResize` calls.
- **Release point:** a mouseup immediately after a move, before any React render, commits that move's box.
- A gesture that returns to its start → zero commits.
- **D-3:** Escape (capture phase; shell Escape not reached; selection kept) and blur → zero commits, preview cleared.
- `transformend` without an event → cancel.
- `readOnly` flip → cancel.
- Unmount → cancel.
- Shift sampled per move; corner vs side; toggle on + Shift.
- **Key guard:** ⌘Z, Delete, arrows, V/H/R ignored mid-resize; Space tracked but deferred; Escape cancels.

**`slice-d-shell-resize.test.tsx`** (reducer + commit observer)
- One COMMIT `'Resize'`; selection unchanged; one autosave.
- Zero entries and zero saves for all no-op paths.
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

### 8.1 Where and how
- **Where:** Ben's Mac Linux VM, a production build (`next start` on :3007), Chromium, WebKit and Firefox, with credentials loaded in place (`set -a; . <path>; set +a`; never copied or printed; security-operations §5/§8). Never in GitHub Actions.
- **Browser gates (C-7):** each browser is recorded PASS / FAIL / NOT EXECUTED (reason). None is waived. If a browser cannot run in the VM, it runs natively on Ben's Mac from his Terminal against the same committed build and suite.
- **Pointer aiming:** pointers are aimed with the stage's `data-view` / `data-page-offsets` instrumentation (approved as internal test instrumentation, 2026-10-06). Anchor screen positions are computed from the model box and the view.

### 8.2 Committed smoke extension (`editor-smoke.spec.ts`, first spread, by identity)
One corner resize of the smoke's own rectangle:
- Assert inspector W/H == the pill read at release.
- Assert one PUT.
- Undo then redo.
- Reload, and assert the exact values.
- The existing cleanup removes the rectangle.

### 8.3 Acceptance (`editor-resize-acceptance.spec.ts`, back cover — must be empty at the start, deleted at the end, asserted empty after a reload)
- Each anchor family: side and corner, from every one of the 8 anchors, with the moving edge checked against the model and the fixed edge unchanged.
- T1/T2/T3/T4/T5/T6/T7 and drag-through.
- Ratio via the toggle and via Shift; side handles not ratio-locked.
- Alt centred.
- Ellipse.
- Right-page margin target (T17); cross-gutter (T18).
- **No-op paths assert 0 PUTs:** anchor click; sub-threshold wiggle at three zooms; Escape mid-resize (selection kept; a second Escape deselects); window blur mid-resize; Space held over an anchor (no resize, pans, `grab` cursor, inner cursor cleared); Hand tool over an anchor; Space pressed during a live resize (resize completes, nothing pans).
- Locked single: outline + indicator, no anchors. Multi: dashed union border, no anchors.
- Undo/redo; reload fidelity.
- Cursor readings over each anchor family: inner element vs wrapper.
- **Firefox release point:** the committed box equals the last pill.
- **Not testable in a browser:** grandfathering. After D-1 the shipped UI can no longer create shapes under 4 mm; it is covered at domain, session and inspector level (§11 C13).

### 8.4 Performance (AC-18)
- **Target:** resize frame time ≤ 18.2 ms (≥ 55 fps, blueprint budget "Drag / resize frame rate ≥ 55 fps on reference doc", C/D) on the 30-element reference document.
- **Reference document:** built on the back cover by duplicating (≈ 5 commits), then deleted.
- **Measurement:** `performance.mark('baxter:editor:resize-move')` in `boxBound` → `measure` at the next frame after React commits, mirroring Slice C's drag measure. Over a scripted 2-second sweep (≥ 60 moves) report the median, p95 and max.
- **Gate:** median ≤ 18.2 ms in Chromium and Firefox in the VM.
- **WebKit:** measured and reported. The VM's WebKit is software-rendered and not representative (HANDOFF §7). If its median exceeds the target, it is re-measured natively on the Mac before any conclusion.
- Exceeding the budget makes optimisation part of D (blueprint rule).

### 8.5 Production-fixture blast radius (needs Ben's approval — Q1)
Estimated per browser:
- **Smoke:** 6 PUTs.
- **Acceptance:** ≈ 32 PUTs — about 3 creations, about 18 committed resizes and inspector edits, undo + redo, lock/unlock, about 6 for the performance set, 1 cleanup.

That is **≈ 38 per browser, ≈ 114 for the three-browser gate**, all to one `editor_documents` row, **zero residue**. Autosave debouncing may coalesce some. The measured numbers replace these in security-operations §8. Approval is requested for **up to 40 per browser / 120 total**. Anything above that stops and comes back to Ben.

---

## 9 · Verification gates

### 9.1 Every commit
- A fresh linux-x64 `git clone --no-local` of the exact commit, then `npm ci`.
- **The tested tree hash equals the committed tree hash.**
- Typecheck, test-tree typecheck, lint, all suites (guard suite included), forced build, `npm run budget`, preflight 6/6, `npm audit --omit=dev` unchanged (41: 33 moderate / 8 high / 0 critical on `790ddf9`).
- Run on Node 24 (CI and Vercel) and Node 22.

### 9.2 Bundle (AC-19; baseline measured on `790ddf9`)

| Measure | Value | D target |
|---|---|---|
| Shared First-Load JS | 343.1 kB (baseline 342.1 kB, +986 B of +1024 B; **38 B headroom**) | **+0 B**. Any growth stops work and is reported. The budget is not raised. |
| Konva chunk (`8593.*.js`) | 193,907 B (58,602 B gzip); Transformer already inside | Unchanged |
| Editor island chunk (`3934.*.js`) | 43,953 B (13,436 B gzip) | Measured and reported; expected growth a few kB, all island-only |
| Editor route page chunk | 4,738 B | Unchanged |

### 9.3 Per stage
Codex checkpoints at stages 0, 2 and 9; the stage 1 probe report goes to Codex.

### 9.4 Final (stage 9)
- Three-browser smoke + acceptance per §8, recorded per browser.
- Performance numbers.
- Measured PUTs and zero residue.
- Hosted CI + CodeQL + Vercel preview editor check on the PR head.
- PR opened, **not merged**.

---

## 10 · Decisions, implementation choices, open questions

### 10.1 Approved (not reopened)
- D-1…D-6 as in §1.
- Contract #11's accepted drag-through behaviour, kept as is. Ben's recorded "hold at minimum" alternative is not adopted, per #11.

### 10.2 Implementation choices made by this plan (Codex/Ben may object; each has a reason)
1. **Fixed edges come from `prev`, not from Konva's raw box** (§3.3). This gives exact pinning and handles the accepted anchor rename.
2. **The ratio factor comes from the larger start axis; the snapped axis wins exactness; the dependent axis carries rounding** (§3.3–3.6).
3. **Centred scaling: exact width, centre within 0.005 mm** (G6). The alternative — an exact centre with the width forced to a parity — would change sizes the user didn't ask for.
4. **The threshold is implemented in `anchorDragBoundFunc`**, using Konva's own early return. There are no extra window listeners.
5. **Preview renders unscaled node attrs** (`nodeAttrsFor`), not Konva's scale. Strokes and corner radii are content in mm and must not scale during preview.
6. **The resolver holds the gesture-start anchor's cursor** for the whole gesture, including after an accepted rename. Calm over clever.
7. **Multi selection:** a dashed union border **replaces** per-object outlines, as in the spike. The alternative is to keep per-object outlines inside the dashed border.
8. **The lock indicator is a vector padlock at constant screen size (~11 px), inset at the object's top-left, on every locked object on the unit.** The spike used an emoji at 4 mm (zoom-dependent). Emoji fonts are absent in the Linux test browsers, and a mm-sized glyph vanishes at 15% and dominates at 800%.
9. **Creation preview and pill hidden under the 3 mm click threshold** (§4.8).
10. **The acceptance spec is committed but env-gated**, unlike Slice C's one-off script, so Codex can review the exact evidence.
11. **Clearing the inner cursor when handles become inactive** (§4.6). This is the only touch of Konva's inner element outside Konva. It only ever sets `''`, exactly what Konva's own `mouseout`/`destroy` do. Without it, Space pressed while hovering an anchor would leave a resize cursor showing over a press that pans.

### 10.3 Genuinely open (Ben)
- **Q1 — blocking for stage 8 only.** Production writes for the three-browser gate: approve up to 40 PUTs per browser / 120 total, self-cleaning, zero residue (§8.5)?
- **Q2 — non-blocking; the default applies.** Space pressed during a live resize: the plan keeps parity with drag (ignored until release). Confirm, or choose cancel-on-Space or switch-to-pan.
- **Q3 — non-blocking; the default is resize only.** Extend the in-gesture keyboard guard (§4.5) to Slice C's drag, creation and marquee? Today ⌘Z, Delete and the arrows act mid-drag (§11 C4). Recommendation: yes, as one small separate commit in D, with a regression test.
- **Q4 — non-blocking.** The caption wording for Keep proportions (§4.9).

---

## 11 · Conflicts and corrections found while planning
- **C1 — spec vs code.** Part 11 says Slice D "introduces the resolver + Konva inner-element convention". Both already exist on `main` (`cursor.ts`, `SpreadStage.tsx`). D **extends** them; the code is right and the spec text is historical.
- **C2 — contracts #11 and #19** state the inspector W/H floor as 2 mm. D-1 changes it to 4 mm with grandfathering (approved). This is recorded as **D-036** when D lands; the contract text gets an amendment note rather than a silent edit.
- **C3 — outlines under Hand.** `SpreadStage` hides selection outlines whenever the tool is not `select`, so they vanish under Hand. This contradicts #4 (hidden only under creation tools) and D-4. Fixed in stage 5.
- **C4 — no keyboard guard during gestures.** `use-editor-keyboard.ts` acts on ⌘Z, Delete, the arrows, the clipboard chords and the tool letters mid-drag. This is pre-existing and not caught by Slice C acceptance. D guards resize; Q3 covers the rest.
- **C5 — creation pill/preview.** They show the unquantized box, and a 4 mm box under the click threshold, while the commit is 0.1-quantized or default-size. Corrected (§4.8).
- **C6 — spike vs production pill precision.** The R9 spike pill displayed 0.1 mm. Production displays the exact committed values (`formatNum`, ≤ 2 dp), as AC-7 / G3 require.
- **C7 — contract #10's "≈ 0.007% worst case"** holds for ~70 mm sizes only. At the 4 mm floor, dependent-axis rounding can reach 0.125%. This plan states the true bound (G5) and promises nothing stronger.
- **C8 — Konva defaults.** `keepRatio`, `flipEnabled` and `rotateEnabled` default to `true` in 10.3.0 and are set explicitly. The readiness document's "~0 chunk delta" is confirmed: the Transformer is already in the editor's Konva chunk.
- **C9 — documents.** The handoff was stale (`main` = `351274b`; D-1…D-6 pending). It is brought to this checkpoint and re-propagated with this plan.
- **C10 — budget headroom.** 38 B remains after Next 15.5.28. D adds 0 B to shared JS. A future framework patch could exceed the allowance on its own, which would be Ben's budget decision, separate from D.
- **C11 — the readiness document's `resizing: boolean`** resolver input becomes `resizing: { cursor }`. The wrapper must name the directional cursor once the pointer leaves the anchor (§4.6).
- **C12 — tiny objects at low zoom.** The 7 px anchors can cover a 4 mm object entirely (4 mm × 0.51 px/mm ≈ 2 px at 15%), so a drag there needs zoom-in. This is spike-identical; it is recorded as a known limitation, not fixed.
- **C13 — grandfathering cannot be exercised in a browser** after D-1, because the UI no longer creates undersized shapes. Domain, session and inspector tests cover it with fixture documents.

---

## 12 · Not in D
- Images (E), crop (F), text and fonts (G), lines (H), rotation, viewing modes (I).
- Multi-object resize; multi W/H.
- Page management, export.
- Moving E2E off production.
- `/[handle]/[slug]` outage handling.
- D-032's platform half, EasyPost keys, the security-operations §9 follow-ups.
- Dependabot #17.
- Any Next.js upgrade.

---

## 13 · Document maintenance
- **Now (stage 0):** this plan is committed on `slice-d-resize`. `HANDOFF.md` is brought to the 2026-10-22 checkpoint and propagated byte-identical to the canonical copy and the Vault copy, with checksums. `native-publishing-slice-d-readiness.md` is left unaltered as the historical record.
- **At stage 9:**
  - `decisions.md` **D-036** — resize precision and precedence (§3.5–3.6), and D-1's amendment of #11/#19.
  - `HANDOFF.md` Phase entry with the measured results, propagated again.
  - `docs/security-operations.md` §8 with the measured per-browser PUTs.
  - This plan's status line updated to "implemented on `slice-d-resize`", with Ben's acceptance decisions appended (Slice C's precedent).
