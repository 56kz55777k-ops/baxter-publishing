# Slice B — Shapes, Selection, Inspector · Implementation Plan

**Date:** 2026-09-19 · **Branch:** `slice-b-shapes-selection` from `086e3e8`
**Governing sources:** the 27 accepted contracts (production implementation handoff Part 2), Part 5 (doc model), Part 6 (state ownership), Part 7 (history/autosave), Part 11 (slice scope), Part 12 (test strategy); Slice A blueprint + Amendments 1–3; ADR-001/002/003; the Slice A engineering review; D-031 … D-034; and the production code as it stands on `main`.

**Standing rule observed:** Spike C v2 is a behavioural specification. Algorithms are ported deliberately; no file is copied.

---

## 0 · The headline finding: no schema change is required

Slice A shipped the **complete v1 element schema**, rect and ellipse included, and the factories with them. `packages/domain/src/editor/document.ts` already defines `RectElementSchema` and `EllipseElementSchema` with every field Slice B needs, and `factories.ts` already provides `newRectElement` / `newEllipseElement` at the accepted creation defaults.

Slice B therefore **consumes** the schema rather than extending it. That is the single most important architectural fact in this plan: **no schema change, no `schemaVersion` bump, no migration, no backfill, no change to `parseEditorDoc` or `migrateEditorDoc`.** Existing documents load and save exactly as they do today, and D-031's freeze contract and D-034's margin values are untouched.

---

## 1 · Element and document model

Field-by-field, what Slice B needs and where it already lives.

| Requirement | Existing field | Notes |
|---|---|---|
| Element id | `ElementBase.id: z.string().uuid()` | `crypto.randomUUID()` via `elementBase()`. The prototype's `ob_<ts>_<n>` ids are not ported (Part 4 do-not-port list). |
| Geometry | `x`, `y` (`ElementBase`, mm, page-trim-relative, finite, **may be negative or exceed page width** per contract #2) + `width`, `height` (positive, finite) | Cross-gutter spanning is legal by construction. |
| Fill | `fill: HexColor` | sRGB hex, the Part 5 decision. |
| Stroke | `stroke: HexColor.nullable()`, `strokeWidth: z.number().min(0)` | `null` is first-class **None**, distinct from width 0 — contract #18. |
| Corner radius | `cornerRadius` (rect only) | Ellipse has none, correctly. |
| Appearance | `opacity: z.number().min(0).max(1)` (`ElementBase`) | The shared editable property; multi-apply is Slice C. |
| Lock | `locked: z.boolean()` (`ElementBase`) | Slice B needs it: contract #20 governs single-object behaviour and the inspector's Lock section. |
| Ordering / arrange | `EditorPageSchema.elements` **array order is the z-order contract** | Arrange = reorder within the page's array. No `z` field exists and none is added. |
| Validation / defaults | Zod schemas + `factories.ts` defaults | The save route already re-parses server-side; the editor parses on load. |
| Page ownership | element lives in exactly one `page.elements[]` | Contract #2. |

**Nothing is added.** No `name`/`label` (Part 5: defer), no guides, no `z` index, no per-edge geometry, no Slice C/D/E fields.

**Creation page-ownership rule.** Contract #2 specifies re-parenting on *drag-drop* by centre, and contract #3 does not state which page a newly created element belongs to when a drag starts on the verso and ends on the recto. Slice B assigns ownership to **the page containing the creation anchor**, which yields exactly the legal cross-gutter case #2 describes (an element whose `x` exceeds its page width). Drag re-parenting by centre arrives with Slice C and is not pre-built. This is recorded as an implementation decision, not a product change.

---

## 2 · Pure element semantics

New pure module: `packages/domain/src/editor/elements.ts`. Signature shape throughout:

```
(doc: EditorDoc, …args) => EditorDoc      // structurally shared, never mutated
```

| Helper | Purpose |
|---|---|
| `addElement(doc, pageId, element)` | Append to that page's `elements` (top of z-order). |
| `updateElement(doc, id, patch)` | Replace one element; **skips locked elements structurally** except via `setLocked` (contract #20). |
| `setLocked(doc, id, locked)` | The single permitted mutation of a locked element (contract #20). |
| `reorderElement(doc, id, op)` | `'front' \| 'forward' \| 'backward' \| 'back'` — array reorder, the z-contract. |
| `findElement(doc, id)` / `pageOfElement(doc, id)` | Pure lookups used by the inspector and selection filtering. |

Every helper returns the **same reference** when the operation is a no-op — this is what makes `COMMIT`'s reference-equality no-op guard (`reducer.ts:82`) and the commit observer's dirty check exact.

**`current document + semantic operation → next document → generic COMMIT`.** No reducer action is added for any element operation. ADR-003 §1 is preserved literally.

Quantization lives here too, in `packages/domain/src/editor/precision.ts`:

- `quantizeCreate(mm)` → **0.1 mm** (creation, drag, nudge)
- `quantizeInspector(mm)` → **0.01 mm** (inspector, resize)

Contract #19's deliberate cross-system difference, implemented as two named functions so it can never be "tidied" by accident.

---

## 3 · Creation gesture state machine

Tools: `EditorTool` extends `'select' | 'hand'` → `'select' | 'hand' | 'rect' | 'ellipse'`.

| Phase | What happens | Where the state lives |
|---|---|---|
| Tool armed | Toolbar click, or `R` for rect (contract #26's letter). **Ellipse has no accepted shortcut** — toolbar only; #26's map is V/H/T/I/R/L and does not assign one. | `EditorUiState.tool` |
| Before pointer-down | Cursor is **crosshair**, resolved by the existing outer-wrapper resolver | derived, written pre-paint |
| Pointer-down | Anchor recorded in unit-mm; anchor dot renders | `useRef` beside the stage |
| Drag | Live preview rect/ellipse; `W × H mm` readout pill; snapping evaluated each move | `useState` local to the stage (preview box), `useRef` for the anchor |
| Snapping | `bestSnap` against page edges, page centre-lines, margins, and other elements' edges/centres; radius 1.6 mm; oxblood guides render while engaged | pure module + local state |
| Pointer-up | Tiny drag **< 3 mm** in either axis ⇒ default-size element from the factory at the anchor; otherwise the previewed box, quantized to **0.1 mm** | — |
| Commit | `addElement(doc, pageId, el)` → **one** `COMMIT { nextDoc, selection: [el.id], label: 'Create rectangle' }` | document reducer |
| After | Element selected; inspector arms; tool returns to `select`; guides, pill, anchor and preview cleared | UI context + local cleanup |

**Why transient state cannot reach autosave or history.** The preview box, anchor, snap guides and readout pill are refs and component-local `useState` *beside* the stage. They never enter `EditorDoc`, so `state.doc` keeps its reference; `createCommitObserver` returns early on `state.doc === lastDoc` (`commit-observer.ts:19`) and never schedules a debounce. History is only ever appended by `COMMIT`. This is structural, not disciplinary — ADR-003 §4.

Window blur and `Escape` cancel an in-flight creation with no commit and no history entry, matching the pan gesture's existing blur cancellation in `SpreadStage`.

---

## 4 · Selection

`EditorUiState` gains `selection: readonly string[]` — **ID-based**, never object references (contract #4). New UI actions: `SET_SELECTION`, `TOGGLE_SELECTION` (Shift, used by marquee-add in B and Shift-click in C), `CLEAR_SELECTION`.

| Behaviour | Implementation |
|---|---|
| Click element → select | Konva `onMouseDown` on the element node dispatches `SET_SELECTION [id]` |
| Click empty page/pasteboard → deselect | Stage-level handler when the hit target is not an element and the drag stayed under the marquee threshold |
| Single selection drives the inspector | `selection.length === 1` → resolve the element via `findElement` |
| Survives tool/view changes | Selection lives in the UI context and is untouched by `SET_TOOL` / `SET_VIEW` |
| Affordances hidden while a creation tool is armed | The selection outline layer renders only when `tool === 'select'`; **selection itself persists underneath** (contract #4) |
| Undo/redo restoration | §8 below |
| Stale-id filtering | `selection.filter(id => elementExists(restoredDoc, id))` — **stale ids are never recreated** (contract #4) |

**Selection is not persisted document state.** `HistoryEntry.selection` already exists in `reducer.ts:30` and is carried *as data* by the transaction log; it is never written into `EditorDoc` and never reaches `editor_documents.doc`. Slice A designed this seam; Slice B is its first consumer.

---

## 5 · Marquee

| Aspect | Implementation |
|---|---|
| Pointer ownership | Stage-level `onMouseDown` when `tool === 'select'`, the hit target is not an element, and neither Space nor Hand is active (pan outranks marquee, per the existing gate at `SpreadStage.tsx:109`) |
| Transient rectangle | Quiet dashed rect in its own non-persisted Konva layer; geometry in component-local state |
| Intersection | **Bounds intersection**, not full enclosure — contract #6 says "whose bounds intersect". Pure `rectsIntersect` in the geometry module. |
| Shift | Adds to the existing set rather than replacing |
| Threshold | Movement **< 2 mm** is a click ⇒ deselect (distinct from creation's 3 mm — both thresholds are explicit in the contracts and are implemented as separately named constants) |
| Cursor | Stays `default` throughout, stable while crossing objects (contract #6, cursor rule R10) |
| Cleanup | Rect cleared on mouse-up and on window blur |
| Document impact | **None.** No `COMMIT`, no history entry, no autosave — marquee never produces a `nextDoc`. |

---

## 6 · Inspector

New `apps/web/components/editor/inspector/` on `@baxter/ui-tokens`, with the R12 token values (14 px inset, 26 px field height, one radius/border/background, one restrained oxblood focus ring, `fieldset { min-width: 0 }` for the min-content quirk).

Contextual, per contract #18: **page** (nothing selected) / **single object**. Multi-object inspector semantics (`N objects · M locked`, em-dash mixed values) belong to Slice C's multi-selection and are **not** built here.

| Section | Functional in Slice B |
|---|---|
| **Position & Size** | X, Y, W, H as buffered numeric fields. X/Y unbounded (negative page-relative values are first-class); W/H floor 2 mm. |
| **Fill & Stroke** | Fill colour swatch; stroke colour swatch; stroke width numeric. Full **None model**: setting a width activates the stroke with a default colour; picking a colour assigns a default width; width 0 returns to `stroke: null`. |
| **Appearance** | Opacity. Corner radius for rect (`cornerRadius ≥ 0`); absent for ellipse rather than disabled. |
| **Arrange** | Bring to front / forward / backward / send to back → `reorderElement`. |
| **Lock** | Lock toggle + the Locked banner and Unlock affordance; while locked every other section is fieldset-disabled (disabled = fieldset-driven, default cursor, never `not-allowed` as decoration). |

Every control listed is genuinely wired. **No dead controls are shipped to fill the panel.** Type-specific sections for image/text/line are absent, not stubbed.

---

## 7 · Buffered numeric fields — contract #19

One reusable production primitive from day one: `apps/web/components/editor/inspector/NumField.tsx`, with its parsing/commit logic extracted pure into `packages/domain/src/editor/num-field.ts` so the contract is unit-testable without React.

| Contract clause | Implementation |
|---|---|
| Buffered draft | `inputMode="decimal"`; while focused the draft string is component state and is **never parsed, committed or clamped** — `""`, `"-"`, `"12."` are all legal drafts |
| Commit boundary | **blur**, **Enter** (commits and *keeps focus*), and **each arrow press** |
| Invalid draft | Restores the last valid value |
| Clamping | Only at real declared bounds: X/Y unbounded; W/H ≥ 2; stroke ≥ 0; radius ≥ 0; opacity 0–1 |
| Arrows | ±step; fine fields ±0.1; Shift ×5 (fine ±1); **every typed-reachable bound is step-reachable** |
| Escape | Restores the value and exits the field **without touching canvas selection** |
| No-ops | Field visits with no change, and commits identical to the model, create **nothing** — no `COMMIT`, no history, no autosave |
| External changes | When the model changes underneath an unfocused field, the display follows; a focused field keeps its draft |
| Display | `= model exactly, ≤ 2 dp, trailing zeros stripped, −0 normalised` |
| Units | Implied-mm everywhere; units written nowhere (contract #18's "consistent by absence") |
| Spinners | **None** — no native spinners, no permanent +/− controls (barred without a new decision) |
| Precision | Inspector commits quantize at **0.01 mm** |

**A field never commits per keystroke.** One completed edit = one `COMMIT` = one history entry. Each arrow press is its own deliberate entry, which is the contract, not an exception to it.

The R12 fixtures are pinned as tests: typed / transitional / invalid / min / arrows / no-op, plus the `stroke 0.5 → 0` case that nulls the stroke.

---

## 8 · History

The reducer's `history` / `future` stacks exist but **nothing pops them yet** — Slice A left undo/redo as a placeholder. Slice B adds exactly two actions:

```ts
| { type: 'UNDO'; currentSelection: readonly string[] }
| { type: 'REDO'; currentSelection: readonly string[] }
```

These are transaction-log operations, not per-element actions; ADR-003 §1 is preserved. `HistoryEntry.doc` is the document **before** the commit, so:

- **UNDO** pops `history`, pushes `{ doc: state.doc, selection: action.currentSelection, label }` onto `future`, and sets `doc` to the popped entry's `doc`.
- **REDO** is the mirror.
- Both are ignored in the terminal `conflict` / `window-closed` phases, like every other mutating action.

**Selection restoration without putting selection in the document reducer.** The shell's undo handler reads the entry it is about to restore, dispatches `UNDO` to the document reducer, and dispatches `SET_SELECTION` to the UI context with `entry.selection` filtered against `entry.doc`. Two contexts, one direction — the document reducer carries selection as opaque data, and the UI context remains its only owner.

One intention = one entry, for: element creation; each inspector commit (typed value or single arrow press); lock toggle; arrange; delete. Zero entries for: selection changes, tool changes, hover, marquee, creation previews, no-op commits, invalid input, Escape.

---

## 9 · Autosave

The path is already built and Slice B changes none of it:

```
pure helper → nextDoc → COMMIT → state.doc reference changes
  → createCommitObserver sees doc !== lastDoc
  → dirty && !readOnly → debounce → POST /api/editor/[id]/save { doc, baseRevision, clientId }
  → conditional write WHERE revision = baseRevision → { revision } | 409
```

Why the transient surfaces cannot generate save traffic, structurally rather than by convention:

| Surface | Why it cannot |
|---|---|
| Creation preview frames | Local state beside the stage; `doc` reference unchanged |
| Selection | `EditorUiState` — a different context, a different state object; the observer never sees it |
| Marquee | Local state; produces no `nextDoc` |
| Snap guides, readout pill, anchor dot | Local state; render-only |
| Cursor | Derived and written to a DOM element; never stored |
| Incomplete numeric editing | The draft string is component state; no `COMMIT` until the commit boundary |
| Save-machine transitions | `SAVE_STARTED` / `SAVED` / `SAVE_FAILED` / `SAVE_CONFLICT` / `WINDOW_CLOSED` all produce new state objects with the **same** `doc` reference (`commit-observer.ts` comment) |

Conditional-revision first-write-wins, the 409 → read-only terminal phase, and the window-closed phase are inherited untouched.

---

## 10 · Cursor ownership

The resolver already exists as a single `useLayoutEffect` writing to the **outer wrapper** in `SpreadStage.tsx:74–78`. Slice B extends that one chain; it does not add a second writer anywhere.

Priority for Slice B (a strict subset of contract #21's order):

```
panning              → grabbing
Space / Hand tool    → grab
creation tool armed  → crosshair   (stable through the whole gesture)
marquee active       → default     (stable while crossing objects)
object hover         → move (unlocked) / default (locked)
otherwise            → default
```

Hover state stores **only the element id**; lock state is looked up live, so toggling Lock updates the cursor without pointer movement (contract #21). Konva's inner content element stays untouched — the Transformer's angle-aware anchor cursors arrive in Slice D and will own it by CSS containment. **Slice D's resize cursor system is not pre-built.**

---

## 11 · Konva and rendering boundaries

| Component | Change |
|---|---|
| `SpreadStage.tsx` | Gains an interactive elements layer and gesture handlers. The existing guides `Layer` keeps `listening={false}`. |
| `ElementsLayer.tsx` *(new)* | Listening layer; maps `page.elements` → nodes, per page, at that page's `pageOffsetsMm` offset |
| `ElementNode.tsx` *(new)* | `rect` → Konva `Rect` (with `cornerRadius`), `ellipse` → Konva `Ellipse`. Presentation only — no document semantics. |
| `StageOverlays.tsx` *(new)* | `SelectionOutlines`, `CreationPreview`, `MarqueeRect`, `SnapGuides` in one module — they share the single property that defines them: drawn from transient state, never listening, never able to reach the document |
| `use-stage-gestures.ts` *(new)* | The creation/selection/marquee state machine, plus `elementBoxes` and `rectsIntersect` |
| `SizeReadout.tsx` *(new)* | `W × H mm` pill — **DOM, not Konva**: it is chrome, not publication content |
| `inspector/Inspector.tsx`, `inspector/NumField.tsx` *(new)* | Panel, sections, the buffered numeric primitive, colour swatch |
| `packages/domain/src/editor/` | `elements.ts`, `snapping.ts`, `precision.ts`, `num-field.ts` — all pure, all tested without React or Konva |

Bundle containment is unchanged: everything new lands inside the lazily-loaded editor island. Konva is imported only by components already inside it, and the CI budget check (≤ +1 kB shared First-Load) guards the boundary.

---

## 12 · Test plan by level

| Level | Coverage |
|---|---|
| **Pure (domain)** | `addElement` / `updateElement` / `removeElements` / `setLocked` / `reorderElement` incl. no-op reference identity and locked-skip; `quantizeCreate` 0.1 vs `quantizeInspector` 0.01; `buildTargets` / `bestSnap` engage-hold-release at 1.6 mm; `rectsIntersect`; `NumField` parse/commit/clamp/format including the R12 fixtures and `stroke 0.5 → 0` |
| **Reducer / history** | One entry per intention; zero entries for no-ops and invalid input; UNDO/REDO stack mechanics; terminal phases ignore UNDO/REDO; `HISTORY_CAP` drop-oldest |
| **React / component** | `NumField` contract end-to-end (typed, transitional, invalid, Enter-keeps-focus, Escape-restores-and-leaves-selection-alone, arrows, Shift-arrows, no-op visit); inspector stroke None model; Lock disables the other sections; Arrange reorders |
| **Autosave seam** | Completed creation schedules exactly one save; preview frames, selection changes, marquee and incomplete numeric editing schedule none; existing 409 / window-closed behaviour still holds |
| **Selection / stale ids** | Undo restores the associated selection filtered to live ids; a deleted element's id is never recreated |
| **Regression guards** | D-034 frozen-value behaviour and D-033 bleed remain pinned (`margins.test.ts`, `bleed.test.ts` untouched); ADR-001 viewport measurement test untouched |
| **Browser (Playwright)** | Deliberately few high-value truths, not a duplicate unit suite: **(1)** open editor → draw a rectangle → it is selected and the inspector is armed → save → reload → the rectangle survives with its geometry; **(2)** draw an ellipse, undo, redo — element and selection both restore; **(3)** marquee across two shapes selects both; **(4)** a numeric field edit commits once on Enter and survives reload. Nothing that a jsdom test already proves is repeated in the browser. |

**Honesty rule carried forward:** browser coverage is claimed only for what Playwright actually runs. Anything verified by hand is reported as manual evidence, not automated coverage.

---

## 13 · Slice boundaries — deliberately not implemented

Belonging to later slices and **excluded**: multi-element drag and the rigid union move (C); union-box snapping for movement (C); Shift-click multi-selection and ⌘A (C); nudge, duplicate, copy/paste (C); cross-gutter re-parenting by centre (C); the multi-object inspector with `N objects · M locked` and em-dash mixed values (C); Transformer resize, `boundResize`, ratio lock, minimum-size pinning, the anchor no-op rule and the full resize cursor chain (D); images, R2 assets, frames (E); crop (F); text, fonts, overflow measurement (G); lines and endpoint editing (H); Clean View and Review Book (I); export, output profiles, per-edge margins or per-edge bleed (M2.4 / deferred by D-033 and D-034).

**Primitives B introduces that later slices will reuse**, each the smallest correct version:

- `snapping.ts` — built with the complete contract #8 target set (page edges, centre-lines, margins, **and** other elements' edges/centres) because #8 defines it that way and the module is pure. Slice C adds *union-box* evaluation for moving sets; it does not rewrite the targets.
- `precision.ts` — both quantizers, because contract #19's two-grid rule must be explicit from the first commit that writes geometry.
- `NumField` — complete from day one, as Part 11 requires.
- `UNDO` / `REDO` — required by contract #24 the moment a document mutation exists.

**Deliberately absent:** there is no `removeElements` helper and no Delete key binding. Part 11 places delete, duplicate, nudge and copy/paste in Slice C, and the single-object inspector's accepted sections (#18) contain no delete. Shipping the helper unused would be exactly the speculative infrastructure this slice is meant to avoid; undo removes an unwanted shape in the meantime.

**One correction found by its own test.** Escape in a numeric field blurs the field to leave it, and blur is itself a commit boundary — so the first implementation committed the draft Escape had just cancelled. `NumField` now latches the cancel in a ref that the blur handler consumes, and the contract test that caught it stays as the regression.

---

## 14 · Verification and checkpoint protocol

Implementation happens in `~/Desktop/baxter-app`; the executable battery runs in a clean Linux clone. At the push checkpoint the two are proven identical by comparing the **committed git tree hash** of `~/Desktop/baxter-app` against the tree hash of the same commit reconstructed in the verification clone. `node_modules` and Ben's four pre-existing untracked items (`Resend Documentation/`, `Vercel Documentation/`, `brand/`, `baxter-slice6-smoke-test.md`) are outside the committed tree and are explicitly excluded from the comparison; the authoritative object is the committed project content.

Battery: typecheck · test-tree typecheck · lint · full unit suite · production build · bundle budget against current `main`'s measured baseline · preflight harness · Playwright smoke.
