# Slice A — Production Engineering Review

**Prepared:** 2026-08-03, after Slice A functional completion (branch `slice-a-native-publishing`, PR #1). A verification and architecture pass — behavioural contracts (Spike C v2 + Slice A) treated as fixed; nothing here redesigns behaviour, and nothing here has been implemented. Every finding cites the code.
**Canonical locations:** tri-location, same as the handoff documents.

---

## 1 · Facts observed

**F1 — The autosave hook's commit-observation effect runs on every state transition, not every commit.** `use-autosave.ts:103-107` depends on `[state]`; the reducer returns a new state object for `SAVE_STARTED`/`SAVED`/`SAVE_FAILED` too, so `noteCommit()` also fires on save-machine transitions whenever the doc is dirty (e.g. immediately after `SAVE_STARTED`, since `savedDoc` hasn't moved yet). Harmless today — `AutosaveScheduler.attempt()` guards `inFlight`, and a redundant debounce during flight no-ops — but it is timer churn with misleading intent, and any future scheduler change that weakens the `inFlight` guard turns it into double-saving.

**F2 — The save payload is built in two places.** `use-autosave.ts:50` (scheduler path) and `use-autosave.ts:117` (beforeunload keepalive) each hand-roll `JSON.stringify({ doc, baseRevision, clientId })`. If Slice B ever extends the envelope, the keepalive copy can silently drift. (Verified safe today: a keepalive racing an in-flight save is idempotent-by-revision — the conditional write lets the first land and 409s the second, which nobody reads. Safe by protocol, not by coordination.)

**F3 — `INIT` is a dead reducer branch.** `reducer.ts:50` defines it; nothing dispatches it (grep confirms zero sites outside the type and tests). The provider initializes state directly (`document-context.tsx` passes `initialDocumentState(...)` as `useReducer`'s initial value). The `useMemo` wrapping that initial value is also inert — `useReducer` reads its initial argument once.

**F4 — The save route reads request bodies unbounded.** `route.ts` PUT calls `req.json()` with no content-length check (grep confirms). App Router route handlers impose no default body cap; an authenticated owner could PUT a 100 MB "document" that zod then chews through. Slice A docs are kilobytes.

**F5 — Window-level keyboard handling lives inside `SpreadStage`.** `SpreadStage.tsx:97-135` owns keydown/keyup/blur with the typing guard. The blueprint (§2.1) places the full keyboard map in a shell-level `useEditorKeyboard`; Slice B adds tools, nudge, delete, undo — which cannot reasonably live in the stage component, so B would otherwise grow a *second* window keydown handler with a *second* typing guard.

**F6 — Every dispatch re-renders the entire editor tree.** `DocumentContext` delivers the whole state object; `EditorShell` consumes it and renders `UnitList`, `SpreadStage`, and `StatusBar` inline with fresh callback props each render (`EditorShell.tsx:48-54, 119-140`). No component is memoized. Each save cycle re-renders the canvas subtree twice (SAVE_STARTED, SAVED). Measured cost today: negligible (P2 held 120 fps through 2,312 resize-driven renders). The cost model changes in Slice B when the canvas subtree contains per-element nodes.

**F7 — Transient interaction state correctly bypasses the store.** Pan gestures write only `panOrigin` ref + one `SET_VIEW` per move into the UI context; document context sees nothing until a commit. Verified: `SET_VIEW`/`SET_UNIT`/`SET_TOOL` touch `EditorUiContext` only (`editor-ui.ts`), so autosave and history are structurally isolated from viewport churn — contracts #24/#25 hold by construction, not convention.

**F8 — Cleanup is symmetric and proven.** ResizeObserver: one instance per mount, `disconnect()` in cleanup (`SpreadStage.tsx:55-69`); live evidence from the incident battery — attach/disconnect balanced across 3 entry/exit cycles, 2,312 deliveries without leak. Keyboard/pan listeners share effect lifetimes; window blur clears `spaceHeld` and `panning` (contract #26's modifier rule).

**F9 — The island treats mount-time props as authoritative for the page's life.** `editor-island.tsx` boots once (`eslint-disable react-hooks/exhaustive-deps` with a comment). A `router.refresh()` elsewhere would re-render the RSC tree and hand the gate *fresh* `docRow` props, which the mounted island deliberately ignores — correct (the client is the working-copy authority while editing) but documented only in a code comment.

**F10 — Error handling at boot is terminal-but-calm.** Parse failure or POST failure renders the situation screen with a full-reload "Try again" (`editor-island.tsx`); autosave 400s log loudly and ride the retry ladder (`use-autosave.ts:77-84`) — a documented Slice A limitation (no distinct 'rejected' terminal phase).

**F11 — Contract conformance re-verified.** One history entry per `COMMIT`, reference-equality no-ops, terminal phases frozen against late responses (`reducer.ts`, all under test); save labels are the Constitution-voiced set in one place (`selectors.ts:selectSaveLabel`); fit/zoom math has a single source (`geometry.ts`) invoked from three sites (stage resize effect, shell navigation, fit buttons) — call sites differ, math doesn't. The `Math.min(ui.unitIndex, units.length - 1)` clamp in `EditorShell.tsx:33` already protects against future page deletion.

**F12 — Two demo-observed cosmetic facts.** Single-page units show "Fit page · Fit page" (StatusBar's `spreadFitLabel` degrades correctly but duplicates the neighbouring button's label). The `viewport()` fallback `{w:1200,h:800}` in `EditorShell.tsx:44-46` is now nearly unreachable post-incident-fix (sync measure fills `viewportRef` before any user interaction can call it) — harmless belt-and-braces.

**F13 — Test coverage shape.** 9 suites / 76 tests cover: domain (schema/init/units/conversion), reducer transactions, scheduler timing (fake timers), route status codes + race + two-client conflict (stateful fake), geometry, gate decision logic. **Not covered:** the `use-autosave` hook seam (fetch→dispatch mapping: 200/409/423/400 → actions), the viewport-measurement path (the incident's exact surface — currently testable only by mounting Konva, which jsdom can't), and any browser-level smoke (Playwright deferred to Slice C by the blueprint — a decision the incident argues against).

---

## 2 · Risks

**R1 — Maintainability (biggest):** `EditorShell` is the natural dumping ground for Slice B (keyboard map, selection wiring, commit helpers, marquee state). Unrestructured, it re-grows the spike's monolith with the 200-line standard as the only brake. The decomposition seams (keyboard hook, save-state chip, memo boundaries) are cheap now and expensive after B lands on top.

**R2 — Performance (biggest):** doc-context churn crossing into the canvas subtree once per-element nodes exist (F6). Not measurable today; structurally guaranteed to matter at M2.3 document scale. The mitigation is boundary memoization, not a store migration — dispatch frequency stays commit-level by architecture (F7).

**R3 — Behavioural consistency (biggest):** two copies of the save envelope (F2) and, if B adds its own keydown handler, two typing guards (F5). Both are drift-by-duplication risks — the class of bug that passes review because each copy looks right.

**R4 — Abuse surface:** unbounded PUT bodies (F4). Low likelihood (authenticated owners only), cheap to close, embarrassing to explain later.

**R5 — Regression blindness at the browser layer:** the one real production incident of Slice A (hidden-tab stage failure) was invisible to every unit test and to dev-mode usage; only a real browser in the right state exposed it. Until Playwright exists, that whole failure class is guarded by one hand-run battery.

**R6 — Dead/inert code as false documentation:** `INIT` (F3) reads like a supported rehydration path; a future developer may dispatch it expecting history-preserving reload semantics it was never wired for.

---

## 3 · Recommendations (by category)

### Should change before Slice B
1. **Move keyboard ownership to a shell-level `useEditorKeyboard`** with the single typing guard; SpreadStage keeps only its cursor/pan/wheel concerns (F5, R3). Mechanical move, no behaviour change, blueprint-conformant.
2. **Single `buildSavePayload(state)` helper** used by both the scheduler path and the keepalive (F2, R3).
3. **Bound the PUT body** — reject > 1 MB with 413 before `req.json()` (F4, R4). One guard, one test.
4. **Narrow the autosave observation effect to `[state.doc, state.savePhase]`** — or better, gate on doc-reference change only (F1). Aligns intent with mechanism.
5. **Memo boundaries:** `memo(SpreadStage)`, `memo(UnitList)`, `memo(StatusBar)`; `useCallback` the navigation/fit handlers; extract the save-state chip into its own component so save-phase flips re-render a chip, not a canvas (F6, R2).
6. **Resolve `INIT`:** either delete the branch or wire conflict-reload-in-place through it deliberately (F3, R6). Recommend delete — reload-in-place is a designed feature, not a leftover.
7. **Extract `useViewportMeasure` from SpreadStage and unit-test the incident:** mocked `getBoundingClientRect` + a ResizeObserver stub that never fires → assert size lands synchronously. The regression test for the one production incident this slice had (F13, R5).
8. **Hook-seam tests for `use-autosave`:** mocked fetch × {200, 409, 423, 400, network-throw} → exact dispatched actions, using the real reducer + fake timers (F13).
9. **One Playwright smoke in early Slice B** (editor route loads, stage mounts, a commit saves) rather than waiting for Slice C — the incident is the argument (R5). This amends the blueprint's test-phasing assumption; recorded here as a proposed amendment, not a silent change.

### Should improve (during B, opportunistically)
10. A distinct terminal `rejected` save phase for autosave 400s, with its own quiet copy (F10) — becomes more important the moment B's commits produce documents complex enough to fail validation.
11. Dedupe the single-unit fit buttons ("Fit page · Fit page" → one button on singles) (F12).
12. Boot-error retry without full page reload (re-run `bootUp` instead of `location.reload`) (F10).
13. Promote the island's mount-props-authority assumption (F9) from code comment to the state-ownership ADR (see §5).

### Acceptable as-is (reviewed, no action)
- Reducer structure (transaction log + generic COMMIT), reference-based dirty, history cap arithmetic and structural sharing — all correct under test (F11).
- Two-context split and transient-state discipline (F7) — the architecture is doing exactly what the blueprint bought it for.
- Scheduler design (one in-flight, ladder semantics, terminal states) — proven by fake-timer suite + live P3.
- Konva single non-listening layer; hairline `strokeScaleEnabled` handling; DPR left to Konva.
- `viewport()` fallback (F12) — harmless; keep as belt-and-braces.
- Keepalive/in-flight race — safe by revision protocol (F2 note); document, don't coordinate.
- Route/db helper layering (`authorize()` + `lib/editor/db.ts`), RLS-plus-explicit-checks defence in depth.

---

## 4 · Required work before Slice B

Items 1–9 above, estimated as one focused day including tests, none touching accepted behaviour:

| # | Item | Size | Behaviour change |
|---|---|---|---|
| 1 | `useEditorKeyboard` at shell level | S | none |
| 2 | `buildSavePayload` consolidation | XS | none |
| 3 | PUT body bound (413) + test | XS | none (new guard) |
| 4 | Autosave effect dep narrowing | XS | none |
| 5 | Memo boundaries + SaveStateChip + useCallback | S | none |
| 6 | Delete dead `INIT` branch (+ inert `useMemo`) | XS | none |
| 7 | `useViewportMeasure` extraction + incident regression test | S | none |
| 8 | use-autosave hook-seam tests | S | none |
| 9 | Playwright smoke (or first-week-of-B commitment) | M | none |

Gate for starting B's feature work: 1–8 merged green; 9 either merged or scheduled as B's first task.

## 5 · Documentation actions (recommendations only)

- **ADR-001 — Frame-independence rule** (from the stage incident): *initial component state must never depend on frame-delivered callbacks (ResizeObserver, rAF, IntersectionObserver); measure synchronously, observe for changes.* Becomes a permanent engineering standard alongside the review checklist.
- **ADR-002 — Environment flags:** server-read env for runtime toggles; `NEXT_PUBLIC_` only for values genuinely needed by client code (build-inlined by definition). Include the `.env.local`-overrides-shell footnote for local dev.
- **ADR-003 — Editor state ownership:** the two-context split, transients-outside-the-store rule, reference-based dirty, mount-props authority (F9), and the reducer-as-transaction-log invariant (no per-element actions, ever).
- **D-032 candidate (decisions.md):** ops-identity consolidation — GitHub/Supabase/Vercel all under the ops account; production Supabase free-tier auto-pause caused a silent outage (discovered and resumed 2026-08-03); uptime probe or Pro upgrade recommended.
- **Removable when B replaces them:** the dev-commit handle (`EditorShell.tsx`, NODE_ENV-gated) once real editing exists; the blueprint's pre-incident sizing description (amend via ADR-001 pointer, don't rewrite history).
- **Keep untouched:** all accepted handoff/blueprint/review documents as historical record.

## 6 · Slice B readiness verdict

Ready, with the §4 list as the entry gate. Remaining architectural risks are R1–R3 (all addressed by that list); nothing in the foundation needs redesign. **Must not change during B:** the generic `COMMIT` transaction log; reference-equality dirty; the conditional-revision save protocol and its terminal states; the cursor-ownership boundary (resolver on the wrapper, Konva's inner element untouched — B extends the resolver's priority chain, never forks it); the `(editor)` route group + lazy-island bundle isolation and its CI budget; the tri-layer testing rule with contract-numbered test names.
