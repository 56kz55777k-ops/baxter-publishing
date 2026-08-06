# Native Publishing — Slice A Implementation Blueprint & Engineering Standards

**Prepared:** 2026-08-03. The final planning pass before production implementation. Companion to `native-publishing-production-implementation-handoff.md` (the canonical specification); where this blueprint amends that document, the amendment is listed in Phase 1 and this file wins.
**Constraints honoured:** no production code written, no migrations run, no repository modifications, no dependencies installed, no interaction contracts altered, no Spike C design questions reopened.
**Canonical locations:** tri-location, same as the handoff (baxter-spikes canonical · baxter-app copy · Vault dated copy).

---

# Phase 1 — Production readiness validation (adversarial re-read)

Every major decision re-challenged against: *necessary? simplest? aligned with the repo? debt in six months?* Results — seven amendments, the rest survive with reasons stated.

### Amendments to the implementation handoff

**A1 · History entries are immutable references, not JSON strings.** The handoff carried the prototype's `JSON.stringify` snapshots as "acceptable initially." Challenged: with a proper reducer every update is already immutable, so a history entry is just `{ doc, selection, label }` holding *references* — unchanged subtrees are shared structurally, memory cost is only the changed path, and no-op detection becomes reference equality. Simpler than string snapshots, faster, and it removes Risk 9's early pressure. `JSON.stringify` happens exactly once per autosave, at the network boundary. *(Necessary: yes — strings were prototype residue. Simpler: yes. Debt: none; a patch-based model remains possible later without schema impact.)*

**A2 · Document load travels as server-component props; there is no GET route.** The handoff implied a save route and left load ambiguous. The repo's pattern is direct RLS reads in server components — the editor page does the same (`publications` status/ownership + `editor_documents` row in one pass) and hands the doc to the island as a prop. One fewer endpoint, one fewer waterfall, perfectly aligned. Save remains a route handler (background, high-frequency, structured 409 — exactly the class the repo already uses route handlers for; server actions would drag `revalidatePath` semantics into autosave).

**A3 · Test infrastructure and CI land in Slice A, not "J at the latest."** Without a runner and CI, every budget and acceptance criterion in this blueprint is theatre. Slice A introduces Vitest + a minimal GitHub Actions workflow (typecheck · lint · unit · bundle assertion). Playwright follows in Slice C when there are real gestures to drive. *(Aligned: the repo has nothing to conflict with. Debt: none — this is the debt-prevention step.)*

**A4 · Slice A gains document initialization and read-only unit navigation; page management gets an explicit home.** Challenged gap: the handoff's slices never housed page add/remove/reorder or the navigator. Resolution: Slice A initializes the document on first open (preset-derived: cover + preset `minPages` interiors + back — the prototype's shape, preset-driven) and ships a *read-only* unit list (click to navigate spreads; no thumbnails yet — text rows; thumbnails arrive with content in Slice B as trivial SVG). Page add/duplicate/delete/reorder becomes part of **Slice I, renamed "Pages & viewing modes"** (document-structure UX belongs together; both are history-participating operations over `pages[]`).

**A5 · Final-save-on-close is best-effort and bounded; the `beforeunload` prompt is the guarantee.** Challenged: `fetch(…, { keepalive })` bodies are capped (~64 KB in-flight per spec); a mature document exceeds that. Contract: while dirty, `beforeunload` prompts (that is the guarantee of no silent loss); a keepalive final save is *attempted* only when the serialized doc is < 60 KB, and its success is never assumed. No sendBeacon games pretending otherwise.

**A6 · The editor route lives in its own route group.** `app/(editor)/studio/editor/[id]/` — URL stays `/studio/editor/[id]` (groups don't affect paths, middleware's `/studio` gate still applies) but the editor gets a bare full-viewport layout instead of inheriting `(app)` chrome. Also carries the M2.5 "open on desktop" message from day one.

**A7 · Bundle assertion is a zero-dependency script.** No `@next/bundle-analyzer`. A ~40-line node script reads `.next/app-build-manifest.json` + chunk sizes after `next build`, computes shared First-Load JS, and fails if it exceeds the recorded baseline + 1 KB. Runs in CI from Slice A.

**Also decided now (not an amendment, a clarification):** font *procurement* (Fraunces/DM Sans licensed files suitable for self-hosting and later PDF embedding; the D-006 DIN question) starts immediately as a parallel non-engineering track owned by Ben — it has lead time and gates Slice G, but no code depends on it before then.

### Decisions that survived the challenge (with the four questions answered)

- **`editor_documents` table** — necessary (publications row is contended, RLS-narrowed, hand-stamped `updated_at`, no concurrency column); simplest that is actually safe (a JSONB column is fewer parts but couples autosave to marketplace writers); aligned (house migration convention, additive); debt-free (cascade delete, versioned, own RLS). Kept.
- **jsonb scene graph, zod-validated, `schemaVersion` + forward-only migrate-on-load** — kept; zod is already an approved (unused) dependency; the column mirror of `schemaVersion` is written server-side from the doc, the client never sends it separately.
- **Optimistic concurrency via integer `revision` conditional write** — necessary (two tabs are trivial to open today); simplest correct mechanism; no CRDT/collaboration. Kept.
- **`useReducer` + two React contexts, zero state libraries** — kept. Gesture-frequency state never touches the reducer (transients live beside Konva, per the accepted architecture), so dispatch traffic is per-*commit*, not per-frame. Two contexts (`DocumentContext`: doc/history/save-state; `EditorUiContext`: selection/tool/viewport/modes) bound re-render blast radius. A store library is not justified by any measured need; revisit only with profiler evidence.
- **Konva present in Slice A despite an empty canvas** — kept: the lazy-island loading, bundle isolation, stage/viewport math, wrapper-vs-content cursor split, and resize/DPR handling *are* Slice A's risk; proving them with an empty document is the point.
- **Debounce 2 s / max-wait 10 s; middleware round-trip accepted** — kept for A; at ≤ 1 save per 2 s the handle-check cost is noise. Re-measure after A; a matcher carve-out is a recorded possibility, not a change.
- **Margins/safe added to domain presets; shared mm↔pt module in `@baxter/domain`** — kept (this is Slice A work inside production packages, done under the slice, not now).
- **Frames-remain-frames, asset-id-only references, per-part boundaries (fonts/images/export)** — untouched; nothing new learned.

---

# Phase 2 — Slice A implementation blueprint

## 2.1 Repository map

**Created (all paths relative to `~/Desktop/baxter-app`):**

| Path | Purpose |
|---|---|
| `packages/db/migrations/0007_editor_documents.sql` | Hand-written, idempotent, header cites this blueprint + handoff; table + RLS exactly as handoff Part 5. Applied manually via Supabase SQL editor (house convention; journal untouched) |
| `packages/domain/src/units.ts` | `MM_PER_PT`, `PT_PER_MM`, `ptToMm`, `mmToPt` — the single conversion source (three local constants exist today; new code imports this; refactoring the old three is **out of scope**) |
| `packages/domain/src/editor/document.ts` | zod schemas: `EditorDocV1` (meta, pages, elements — full v1 shape from handoff Part 5), `parseEditorDoc(json): EditorDoc` with `migrateToCurrent(schemaVersion)` (v1 = identity), element factories with contract defaults |
| `packages/domain/src/editor/units-of-view.ts` | `computeUnits(pages)` ported from the spike (cover single / interior spreads / back single) — pure, tested |
| `packages/domain/src/editor/init.ts` | `newEditorDoc(preset): EditorDocV1` — cover + `preset.rules.minPages` interiors + back, resolved `marginMm`/`safeMm` |
| `apps/web/app/(editor)/layout.tsx` | Bare full-viewport layout (no site chrome); html/body classes only |
| `apps/web/app/(editor)/studio/editor/[id]/page.tsx` | Server component: auth (RLS client) → load publication (ownership + status) → load/create-on-demand is **not** done here (see 2.2 — creation is an explicit POST to avoid GET side effects) → renders `<EditorGate>` with props `{ publication, docRow \| null }` |
| `apps/web/app/(editor)/studio/editor/[id]/editor-gate.tsx` | **Client**, tiny: desktop check (pointer/viewport) → "open on desktop" message; status not editable → the situation screen; else `next/dynamic(() => import('./editor-island'), { ssr: false, loading: calm placeholder })` |
| `apps/web/app/(editor)/studio/editor/[id]/editor-island.tsx` | **Client.** Mounts contexts + `EditorShell`. The only file that imports Konva-bearing modules |
| `apps/web/components/editor/EditorShell.tsx` | Toolbar strip (title, save dot), unit list (read-only navigator), `SpreadStage`, status bar (fit buttons, zoom) |
| `apps/web/components/editor/SpreadStage.tsx` | Konva Stage: paper/bleed/margin/safe guides per unit at preset trim; wheel pan, ctrl-wheel zoom-about-pointer (0.15–8× of 3.4 px/mm), Space-hand; wrapper-owned cursor per contract #21 (resolver is trivial in A: pan states only) |
| `apps/web/components/editor/state/document-context.tsx` `editor-ui-context.tsx` | The two providers |
| `apps/web/components/editor/state/reducer.ts` `actions.ts` `selectors.ts` | §2.3 |
| `apps/web/components/editor/state/autosave.ts` | The autosave machine (§2.5), a hook consuming DocumentContext |
| `apps/web/app/api/editor/[id]/route.ts` | `POST` = create-if-absent (initialize doc v1, revision 0); `PUT` = save `{ doc, baseRevision, clientId }` → 200 `{ revision }` \| 409 `{ serverRevision }` \| 423 (status window closed) \| 400 (zod reject). Server re-parses with zod before writing; derives `schema_version` column from the doc |
| `apps/web/lib/editor/db.ts` | Typed row helpers over Supabase-JS for `editor_documents` (the repo's loosely-typed-rows pattern; Drizzle stays documentation) |
| `apps/web/test/editor/*.test.ts` | Vitest suites (§2.6 of Phase 6) |
| `apps/web/scripts/bundle-budget.mjs` | A7 script + `budget.json` (records the current 102 kB baseline at first run) |
| `.github/workflows/ci.yml` | typecheck · lint · unit · build + bundle budget |
| `vitest.config.ts` (apps/web) | Node + jsdom projects; includes `test/**` (tsconfig `exclude: ["test"]` gets a companion `tsconfig.test.json` — the app build stays untouched) |

**Modified (each minimal and reviewable in isolation):**

| Path | Change | Why |
|---|---|---|
| `packages/domain/src/formats.ts` | Add `marginMm: 12, safeMm: 5` (zine_a5) and per-preset values for the other two (proposed 15/6 A4, 14/6 square — **Ben confirms numbers at slice review**) to `FormatPrintRules` or a sibling `layout` block | Margins/safe don't exist in the domain; editor guides and future snap targets need them; presets are their single home |
| `packages/domain/src/index.ts` | Export the new editor modules | — |
| `apps/web/app/(app)/studio/publications/[id]/page.tsx` | One conditional "Open in editor" link when `editable && FLAG` | The entry point; flag = `NEXT_PUBLIC_NATIVE_PUBLISHING === '1'` so production stays dark until flipped |
| `apps/web/package.json` / root | devDependencies only: `vitest`, `@vitest/coverage-v8`, `jsdom`; scripts `test`, `budget` | A3 (Playwright arrives Slice C) |
| `turbo.json` | `test` task; `NEXT_PUBLIC_NATIVE_PUBLISHING` in build env allowlist | Build correctness |

**Intentionally untouched (and why):** `middleware.ts` (accepted cost; carve-outs only with post-A measurements); all existing routes/actions/components outside the one link; `publications` schema (concurrency solved by the new table); the preflight/Inngest/R2/Stripe pipelines (untouched until Slice E); `lib/supabase/browser.ts` (the island needs no client-side Supabase in A — saves go through the API route with cookie auth); `@baxter/db/src/schema.ts` gains the `editor_documents` definition **as documentation** in the same commit as 0007 (keeping the schema-as-documentation convention honest) but no drizzle generate is ever run; `zod` version pin (use as-is); eslint/tsconfig/prettier configs.

## 2.2 Data flow — the lifecycle, every transition explicit

```
Creator clicks "Open in editor" (workspace page, draft/revisions only, flag on)
  ↓ GET /studio/editor/[id]                     (middleware: session + handle check)
Server component: RLS load publication          → not owner/not found → notFound()
  status ∉ {draft, revisions}                   → <NotEditable situation screen> (no island)
  RLS load editor_documents row                 → may be null (first visit)
  ↓ props { publication, preset, docRow|null }
EditorGate (client, ~2 kB): coarse-pointer/small-viewport → "open on desktop" (stop)
  ↓ next/dynamic import of the island           (editor chunk loads; nothing shared moves)
docRow == null → POST /api/editor/[id]          (server: zod-validate newEditorDoc(preset),
                                                 INSERT revision 0; race-safe: ON CONFLICT DO NOTHING
                                                 + re-select — two tabs first-open converge)
  ↓ { doc, revision }
parseEditorDoc: zod parse → schemaVersion switch → migrateToCurrent (v1: identity)
  parse failure → calm error state, no island crash, report code path      [never render a doc we can't re-save]
  ↓
Hydrate: dispatch INIT { doc, revision }        → reducer state { doc, savedDoc: doc, revision,
                                                   history: [], future: [], saveState: 'clean' }
  ↓
Render: computeUnits(doc.pages) → unit list; SpreadStage draws unit 0 guides at preset trim;
  fit-spread view computed; fonts: n/a in A (no text elements exist)
  ↓
User edits (A: none possible — navigation/pan/zoom only, which are UI-context, not document)
  [From Slice B:] gesture previews live beside Konva → commit dispatches one action
  ↓ reducer: next doc (immutable), history.push({ prevDoc, selection }), future = [],
             dirty = (doc !== savedDoc)
  ↓
Autosave machine observes dirty via context     → debounce 2 s from last commit, max-wait 10 s
  ↓ status 'saving' (save dot: "Saving…")
PUT /api/editor/[id] { doc, baseRevision: revision, clientId }
  ↓ server: auth → ownership → publication status window → zod parse
  UPDATE … SET doc, revision = revision+1, updated_at = now(), updated_by, schema_version
    WHERE publication_id = $1 AND revision = $baseRevision
  ↓ 200 { revision: r+1 } → dispatch SAVED { revision, savedDoc: sentDoc }
      dirty recomputed: (current doc !== sentDoc) → maybe immediately dirty again → debounce continues
  ↓ 409 { serverRevision }  → dispatch CONFLICT → read-only banner (§2.6), no further saves
  ↓ 423                      → dispatch WINDOW_CLOSED → read-only banner (status changed elsewhere)
  ↓ network/5xx              → status 'retrying', backoff 10 s → 30 s → 60 s, keep editing, dirty stays
  ↓
Clean: saveState 'clean', dot returns to "All changes saved"
Navigation away / close: dirty → beforeunload prompt; attempt keepalive PUT iff payload < 60 KB
Unmount: cancel timers; a save already in flight is not aborted (idempotent by revision)
```

## 2.3 Reducer architecture

**Shape (DocumentContext):**
```ts
interface DocumentState {
  doc: EditorDoc;               // immutable; the only editable truth
  savedDoc: EditorDoc;          // reference of the last acknowledged save payload
  revision: number;             // server revision mirrored; never invented client-side
  history: HistoryEntry[];      // { doc, selection, label } — references, capped at 100, drop-oldest
  future: HistoryEntry[];
  saveState: 'clean'|'dirty'|'saving'|'retrying'|'conflict'|'window-closed';
  clientId: string;             // crypto.randomUUID() per mount; diagnostics
}
// dirty is DERIVED: state.doc !== state.savedDoc (reference inequality — A1)
```
**UI state (EditorUiContext, separate reducer):** `{ unitIndex, view: {x,y,zoom}, tool: 'select'|'hand', selection: [], primary: null, mode: 'edit'|'clean'|'review' }` — in Slice A only `unitIndex`, `view`, `tool(select|hand)` are live; the rest exist as typed placeholders so later slices extend rather than reshape.

**Actions — Slice A set:**
| Action | Payload | Effect |
|---|---|---|
| `INIT` | `{ doc, revision }` | Hydrate; history cleared |
| `SAVE_STARTED` | — | `saveState: 'saving'` |
| `SAVED` | `{ revision, sentDoc }` | `revision`, `savedDoc = sentDoc`, saveState clean-or-dirty by derivation |
| `SAVE_FAILED` | `{ kind: 'retry' }` | `'retrying'` |
| `SAVE_CONFLICT` | `{ serverRevision }` | `'conflict'` — terminal until reload |
| `WINDOW_CLOSED` | — | terminal read-only |
| UI: `SET_UNIT`, `SET_VIEW`, `SET_TOOL` | … | UI context only; never history, never dirty |

**Deliberately waiting for their slices (typed now, unimplemented):** `COMMIT` (the single generic document-mutation action — payload `{ nextDoc, selection, label }` — arrives Slice B and *every* element operation flows through it: create/move/resize/patch/delete/duplicate/lock/reorder/page-ops), `UNDO`, `REDO` (Slice B, with the selection-restore filtering contract), text-session commit (G, via COMMIT), crop focal commits (F, via COMMIT). The reducer never grows per-element-type actions — element semantics live in pure helpers that produce `nextDoc`; the reducer stays a transaction log. **Split rule:** if `reducer.ts` approaches 300 lines something is in it that belongs in a helper.

**Selectors (`selectors.ts`, pure):** `selectUnits(doc)` (memoized `computeUnits`), `selectDirty(state)`, `selectSaveLabel(state)` (the calm strings), `selectCurrentUnit(docState, uiState)`, later `selectSelectionBounds` etc.

## 2.4 State ownership diagram

```
PERSISTED (server, editor_documents)     doc (jsonb) · revision · schema_version · updated_* 
        │  load: server-component props · save: PUT with baseRevision
        ▼
REDUCER (DocumentContext)                doc · savedDoc · history/future · revision · saveState
        │  render props (read-only)                        ▲ COMMIT / SAVED …
        ▼                                                   │
REACT STATE (EditorUiContext + locals)   unitIndex · view · tool · (later: selection, mode,
        │                                 editing/crop flags, hover ids)
        ▼
DOM                                      the workspace wrapper (cursor, from Slice B the text
        │                                 overlay + inspector fields with their OWN drafts)
        ▼
KONVA (inner content element)            stage transform = view · guide shapes · anchor cursors
        │                                 (Konva-owned, contract #21)
        ▼
TRANSIENT GESTURE STATE (refs beside     drag origins · marquee box · resize boundRef · draft
 the stage; NEVER in any store)           shapes · endpoint previews — exist only mousedown→mouseup,
                                          feed exactly one COMMIT, then are nothing
```
One owner per datum; anything appearing twice (e.g. `view` in reducer *and* Konva) has a single writer (React) and a single mirror direction (props → Konva attrs).

## 2.5 Autosave specification (Slice A scope marked)

| Concern | Specification | In A? |
|---|---|---|
| Debounce | 2 000 ms after the last commit; **max-wait 10 000 ms** from the first unsaved commit | ✔ |
| Payload | `{ doc, baseRevision, clientId }`; serialized once here (A1) | ✔ |
| Retry | 10 s → 30 s → 60 s, then hold at 60 s; any new commit resets the debounce but not the backoff tier; status shows the quiet escalation copy | ✔ |
| Conflict detection | Server conditional write on `revision`; 409 carries `serverRevision` | ✔ |
| Conflict handling | Terminal read-only banner (§2.6); no auto-merge, no silent LWW | ✔ |
| Save cancellation | In-flight saves are never aborted (idempotent; a stale success just updates `savedDoc` reference equality correctly). New edits during flight → dirty again after `SAVED` | ✔ |
| Navigation away | `beforeunload` prompt while dirty or saving | ✔ |
| Browser close | Same prompt; best-effort keepalive PUT iff payload < 60 KB (A5) | ✔ |
| Offline | Not distinguished from failure in A: retry loop + "can't reach the shelf" copy; editing continues | ✔ (as failure) |
| Failure recovery | Dirty state persists in-memory; recovery = the retry loop. **No IndexedDB mirror in A** (Slice J decision, on evidence) | ✔ (decision recorded) |
| Multi-tab prevention | None (detection only via 409). A soft same-tab advisory (BroadcastChannel) is Future, not A | ✔ (recorded) |

## 2.6 Optimistic concurrency walkthrough — Tab A / Tab B

```
T0  Tab A opens pub P     → { doc r5 }         Tab B opens pub P → { doc r5 }
T1  A edits (commit)      → dirty
T2  A autosaves           → PUT base=5 → server: 5==5 → doc', revision 6 → A: SAVED r6, clean
T3  B edits (commit)      → dirty (B still believes r5)
T4  B autosaves           → PUT base=5 → server: 5≠6 → 409 { serverRevision: 6 }
T5  B: SAVE_CONFLICT      → UI: persistent calm banner over a DISABLED (read-only) canvas:
                            "This publication was edited somewhere else — likely another tab.
                             Reload to pick up the latest version."  [Reload]
                            · B's unsaved edits: preserved on screen (visible, frozen) until reload
                              — nothing is silently kept OR silently thrown away; the banner says so
                            · B's writes: blocked permanently (every path checks saveState)
                            · B's undo/history: frozen with the canvas
T6  B reloads             → { doc r6 } — Tab A's work; B's post-r5 edits are gone BY EXPLICIT CHOICE
T7  A continues normally; if A later 409s (B saved first instead), roles reverse — the contract is
    symmetric: FIRST WRITE WINS, the loser is told immediately, loudly-calmly, and loses only what
    it made after the fork, only after showing it.
```
What is preserved: the winner's save entirely; the loser's screen state until the human chooses. What is blocked: every loser write from the moment of conflict. What is shown: exactly the banner above — no toast that disappears, no merge UI.

---

# Phase 3 — Engineering standards (binding for every slice)

**File-size targets.** Component files ≤ 200 lines (hard review flag at 250); reducer module ≤ 300 (transaction log only — element semantics live in pure helpers); pure-logic modules ≤ 250; functions ≤ 40 lines (flag at 60); one component per file. **Split triggers:** a second responsibility appears; JSX + nontrivial logic cohabit; a test needs private access; the file needs a scroll to review. The spike's three monoliths are the cautionary example — Risk 15 (losing feel in decomposition) is mitigated by *contract tests*, not by tolerating monoliths.

**Testing rule.** Every accepted contract (handoff Part 2, #1–27) eventually owns three layers: a **geometry/pure test** (the math), a **reducer/state test** (the transaction), a **browser interaction test** (the gesture). The contract text is the source of truth; a test cites its contract number in its name (`R9.preview-equals-commit`, `#19.transitional-strings`). A slice is not done while its contracts are missing any layer that exists infrastructure-wise (browser layer becomes mandatory from Slice C when Playwright lands).

**Code-review checklist (every editor PR):**
```
□ Matches the cited interaction contract(s) — numbers named in the PR description
□ History: one entry per intention; no-ops create nothing; selection restore filters stale ids
□ Autosave: fires only from commits; revision passed through; conflict paths untouched or tested
□ Locked objects: excluded from mutation, included as targets, selectable
□ Cursor: no new writers besides the resolver + Konva's inner element
□ Precision: 0.01 grid on inspector/resize paths; 0.1 drag grid untouched; no new rounding sites
□ Bundle: budget script green; no editor import leaks into shared chunks
□ Geometry stays mm/pt through @baxter/domain units module — no inline conversion constants
□ Tests added at the layers available; fixtures updated if a contract scenario changed
□ File-size targets respected; no new dependencies without a recorded decision
□ Constitution voice on any user-facing copy
```

**Performance budgets (measured, enforced per slice; measurement harness = `performance.mark` spans asserted in Playwright traces from Slice C, manual profiler before that).** Reference machine: Ben's dev Mac; reference doc grows per slice (A: empty zine; C: 30 elements; G: +2,000-word text; J: 96-page magazine).

| Budget | Target | Measured from |
|---|---|---|
| Editor island interactive (route click → pannable spread) | ≤ 1 500 ms warm, ≤ 3 000 ms cold | A |
| Non-editor shared First-Load JS | baseline (102 kB) + ≤ 1 kB, ever | A (CI) |
| Pan/zoom frame rate | ≥ 55 fps sustained | A |
| Interaction latency (pointer event → visual response) | ≤ 16 ms (one frame) | C |
| Drag / resize frame rate | ≥ 55 fps on reference doc | C / D |
| Typing latency in text overlay (keystroke → paint) | ≤ 30 ms | G |
| Commit → reducer → paint | ≤ 10 ms | B |
| Autosave round-trip (local dev) | ≤ 400 ms P50 / 1 200 ms P95 | A |
| History memory at reference doc, 100 entries | ≤ 50 MB heap growth | C, re-checked G/J |
Exceeding a budget makes optimisation part of *that* slice — not a backlog item.

---

# Phase 4 — Unknowns, ranked

**Critical (block a named slice; decision owners assigned):**
1. **Text overflow print semantics** — matters because the doc model and export cannot both stay honest without it; must be decided **before Slice G persistence** (model) and finally at M2.4 (exporter). Owner: Ben, with the (a)/(c) demo from handoff Part 10. Depends: G, M2.4.
2. **Font licensing/sourcing for self-hosting + embedding** (Fraunces, DM Sans; the DIN question) — gates all Slice G measurement work; procurement starts **now** (lead-time risk, zero code dependency until G). Owner: Ben.
3. **Editor-image validation & AV policy** — "quarantine" currently scans nothing; images broaden the input surface; policy (accept as-is / add scanning / restrict types) must exist **before Slice E ships to anyone but Ben**. Owner: Ben (product), engineering executes.

**Important (shape a slice; don't block Slice A):**
4. Editor-asset visibility (public CDN variants like today's previews vs signed) — decide at E design.
5. Margin/safe values for A4 + square presets — Ben confirms at Slice A review (numbers proposed in 2.1).
6. Browser-support matrix — needed when Playwright configures at C (proposal: evergreen desktop Chrome/Safari/Firefox/Edge).
7. History memory profile at 96-page scale — measure at C and G against the budget; patch-based history is the prepared fallback.
8. Middleware cost under autosave — measure after A; carve-out is the prepared fallback.
9. `page_count` authority handover (preflight-owned → editor-owned at export) — M2.4 design item.
10. Export text-metric parity end-to-end (editor wrap serialization → pdf-lib) — first M2.4 spike; golden-doc harness specified in handoff Part 12.
11. PDF/X-ICC position — waits on MGS calibration; explicitly unclaimed until then.

**Future (recorded, nothing depends on them yet):** templates (M2.6); mobile/tablet posture beyond "open on desktop"; collaboration/presence; accessibility depth beyond the keyboard map; DIN display-face licensing beyond editor needs; BroadcastChannel same-user tab advisory; IndexedDB recovery (unless J's evidence says otherwise).

---

# Phase 5 — Slice roadmap review (challenged, two changes)

**Changes:** (1) **A3** — test infra + CI move from J into A (rationale above). (2) **A4** — page management is explicitly housed in **Slice I: "Pages & viewing modes"** (add/duplicate/delete/reorder + navigator maturation + Clean View + Review Book); Slice A carries doc initialization + read-only unit navigation so multi-unit documents are visible from day one.

**Order re-challenged and kept, with reasons:** B before C (selection must exist before group actions); C before D (resize reuses drag's target/guide machinery and union semantics); E after B but freely parallel to C/D (frames are elements; the pipeline work is backend-heavy and staffable in parallel — the one true parallelism opportunity); F after both E (frames with content) and D (cursor system carries crop cursors); G stays late-but-before-H not because lines depend on text but because G is the heaviest slice and H is the smallest relief valve after it; I after there is content worth viewing (mode contracts are content-agnostic but meaningless to review against empty spreads); J last by definition. Considered and rejected: moving G earlier (its font gate and overlay complexity would stall the geometry slices that D/E/F unblock); moving I earlier for page management alone (page ops are `pages[]` array surgery + COMMIT — they have no dependency pressure and don't unblock anything).

---

# Phase 6 — Definition of Done: Slice A

Every criterion objectively verifiable; no adverbs.

**Functional acceptance:**
- F1 Opening `/studio/editor/[id]` as the owner of a `draft` or `revisions` publication renders the editor island; as any other user → 404; signed out → sign-in redirect (middleware); as owner of any other status → the not-editable screen (no island loaded, verified by network tab absence of the editor chunk).
- F2 First open creates exactly one `editor_documents` row (revision 0, schemaVersion 1) whose page structure equals `newEditorDoc(preset)` for that publication's preset; two simultaneous first opens converge on one row (POST race test).
- F3 The spread renders trim, bleed, margin and safe guides whose on-screen geometry matches the preset values within 0.5 px at 100 % zoom (measured programmatically from stage transforms).
- F4 Wheel pans; ctrl/pinch zooms about the pointer within 0.15–8.0× of 3.4 px/mm; Space-drag pans with grab/grabbing cursors; Fit Page / Fit Spread / 100 % buttons produce the documented view rects; unit list navigates between cover/spreads/back and auto-fits.
- F5 A forced document edit (dev-only dispatch, since A has no editing UI) round-trips: dirty dot → save within 2–12 s → revision increments → reload renders the saved doc byte-equal (zod-parsed deep-equal).
- F6 The Tab-A/Tab-B walkthrough of §2.6 reproduces exactly: second saver receives 409, shows the banner verbatim, canvas becomes inert, reload converges.
- F7 Status flipped to `in_review` mid-session (via the real submit action in another tab) → next save returns 423 → read-only banner.
- F8 Coarse-pointer or < 900 px viewport → the "open on desktop" message, island never imported.
- F9 With `NEXT_PUBLIC_NATIVE_PUBLISHING` unset, no link renders anywhere and direct navigation still works only for owners (flag gates discovery, ownership gates access) — verified in a production build.

**Engineering acceptance:**
- E1 Files created/modified match §2.1 exactly; deviations are listed in the PR description with reasons.
- E2 No file exceeds the Phase 3 size targets; `npm run typecheck` and `lint` are clean workspace-wide.
- E3 Migration 0007 applied on the Supabase project; the SQL file is idempotent (second application is a no-op, demonstrated); drizzle journal untouched; `schema.ts` documents the table.
- E4 Dependencies added: exactly `vitest`, `@vitest/coverage-v8`, `jsdom` (dev). Nothing else.
- E5 The editor chunk loads only on the editor route (network evidence); shared First-Load JS ≤ baseline + 1 kB (CI script output committed with the PR).

**Testing acceptance:**
- T1 Vitest suites exist and pass in CI for: units conversion; `computeUnits` (odd/even interiors, cover/back); `newEditorDoc` per preset; zod parse/migrate (valid v1, unknown version rejection, malformed rejection); reducer transitions (INIT/SAVED/CONFLICT/WINDOW_CLOSED + dirty derivation by reference); autosave machine timing (fake timers: debounce, max-wait, backoff tiers, in-flight non-abort); save route handler (200/409/423/400 paths, revision arithmetic) — ≥ these seven suites, all green.
- T2 CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests, build + bundle budget on the PR and is green.
- T3 The §2.6 conflict scenario is automated at the API level (two clients, interleaved PUTs).

**Performance acceptance:**
- P1 Island interactive ≤ 1 500 ms warm / 3 000 ms cold on the reference machine (three-run median, numbers recorded in the PR).
- P2 Pan/zoom ≥ 55 fps over a 10 s scripted pan/zoom loop (DevTools trace attached).
- P3 Autosave round-trip P50 ≤ 400 ms locally (logged over ≥ 20 saves).

**Documentation acceptance:**
- D1 `decisions.md` gains D-031 (editor persistence: `editor_documents`, revision concurrency, jsonb schemaVersion) following the house format.
- D2 The canonical HANDOFF.md §7 updated: Slice A shipped, pointer to the blueprint's DoD results; tri-location checksums match.
- D3 Migration header cites the handoff + this blueprint; `budget.json` baseline committed with a comment naming the source build.

**Rollback criteria (any one triggers rollback; rollback is objectively: revert the slice's commits — the app must then build, deploy, and serve every existing route identically):**
- R1 Shared First-Load JS regression > 1 kB that cannot be fixed forward same-day.
- R2 Any non-editor route's behaviour or build output changes (snapshot: `next build` route table before/after).
- R3 Data incident: any write to a publication outside the draft/revisions window, or any `editor_documents` write without a matching revision increment.
- R4 The migration proves non-idempotent or interferes with existing RLS (verified negative before merge; this criterion covers production surprise).
The `editor_documents` table itself is additive and survives rollback (documented as acceptable residue).

---

## Returns summary

**1 · Handoff changes:** amendments A1–A7 (history-by-reference; props-based load; CI-in-A; doc init + navigation in A and page management housed in Slice I; bounded keepalive with beforeunload as the guarantee; `(editor)` route group; zero-dep bundle assertion) — the handoff otherwise stands verbatim, re-challenged decision by decision in Phase 1. **2 · Blueprint:** Phase 2 (repo map §2.1, lifecycle §2.2, autosave §2.5, concurrency §2.6). **3 · Diagrams:** reducer §2.3, ownership §2.4. **4 · Standards:** Phase 3. **5 · Roadmap:** Phase 5 (two changes, rest kept with stated reasons). **6 · DoD:** Phase 6. **7 · Risks that would justify delay:** none block Slice A. The three Critical unknowns gate G and E, not A; the only true pre-A dependency is applying migration 0007 during the slice itself. Font procurement should start now purely for lead time. **The next session begins Slice A against this document.**
