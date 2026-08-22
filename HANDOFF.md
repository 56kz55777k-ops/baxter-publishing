# Baxter — Project Handoff (Detailed)

**For:** Ben's review, and any new Claude Code session continuing this work.
**Written:** 2026-07-18 · **This revision:** 2026-08-22 — D-033 closure pass (Ben accepted the publication-bleed amendment as implemented; PR #2 re-verified green and left open for his merge; stale SHAs and dates corrected). Previous revisions: 2026-08-19 session-resume backup (D-033 branch pushed, PR #2 opened); 2026-08-19 D-033 + Blueprint Amendment 2; 2026-08-17 post-merge synchronization (PR #1 merged 2026-08-12, hosted CI's first run green). Work dates as recorded per section.
**Working with:** Ben Gibson (Benjamin Gibson), Creative Director / co-owner, Toronto Creatives (`info@torontocreatives.com`).
**This handoff lives in three places** — canonical: `~/Desktop/baxter-spikes/HANDOFF.md`; copies: `~/Desktop/baxter-app/HANDOFF.md` and the Vault `handoffs/2026-07-18_baxter-native-publishing-spike-c2_HANDOFF.md`. **Re-propagate the canonical copy to the other two whenever it changes** (byte-identical; verify with matching `shasum`).

---

## 0 · TL;DR — where things stand

1. **Milestone 1 (the marketplace business loop): SHIPPED** and live at `https://baxter-publishing-web.vercel.app`. One deferred item: EasyPost live-shipping verification (waiting on Ben's API key). One operational lesson learned the hard way this milestone-2 cycle: the production Supabase project silently auto-paused on the free tier and the site served empty shells for weeks — resumed 2026-08-03; prevention mechanism is Ben's open decision (D-032).

2. **Milestone 2 (Native Publishing, the in-app editor): Slice A is BUILT, LIVE-VERIFIED, ENGINEERING-REVIEWED, and HARDENED.** The interaction prototype (Spike C v2) completed all 13 review passes and is now a *behavioural specification, not code*. The production foundation — versioned document persistence, revision-guarded autosave, the lazy Konva editor island, preset-derived documents, the empty spread surface with pan/zoom/fit/navigation, conflict and closed-window handling, tests/CI/bundle protection — is implemented in the real repo, verified against the production database in real Chrome, then hardened through an accepted engineering review. **[PR #1](https://github.com/56kz55777k-ops/baxter-publishing/pull/1) is MERGED (2026-08-12): merge commit `7826384e41b2c6ce7d4f9a131711b2b0837c1f85` on `main`; the merged head is `565cc57`. Slice A + the hardening gate now constitute the production foundation on `main`.** The merge push also produced GitHub-hosted CI's first-ever run — `success` on the merge commit itself (run 31567943010), meaning the account-verification hold has cleared. Slice B (shapes + selection) is technically ready; the remaining gate is a product decision, not engineering: the provisional A4/square margin ruling.

3. **Publication bleed is settled — D-033's RULING ACCEPTED by Ben, 2026-08-19** (the implementation's separate acceptance is recorded in the Status sentence below). The "quarter-inch bleed" reported from Ben's printing partners was independently researched, challenged, and resolved as **¼ inch added to each full page dimension** — i.e. **0.125 in = 3.175 mm = 9 pt per applicable edge**, not 0.25 in per edge. A survey of 13 book/magazine printers found no publication specification anywhere requiring 0.25 in per edge. All presets and the inngest fallback moved `bleedMm: 3 → 3.175` (derived in code from the imperial value). Bleed is documented as **per-edge and destined to become profile-owned** — gutter bleed is forbidden by IngramSpark, KDP and Gorham — but stays scalar until output profiles exist, because the conversion is migration-free (bleed is derived, never persisted). Margins and safe are deliberately untouched. Full evidence: `baxter-print-geometry-verification-report.md`. **Status: the IMPLEMENTATION was ACCEPTED by Ben on 2026-08-22** (distinct from the 2026-08-19 acceptance of the ruling itself). It lives on branch `amendment/d-033-publication-bleed` — implementation commit `465c939`, with documentation commits on top — cut from post-Slice-A `main` (`819f473`; the Slice A merge `7826384` is an ancestor). Opened as [PR #2](https://github.com/56kz55777k-ops/baxter-publishing/pull/2) against `main` on 2026-08-22: 14 suites / 111 tests green, typecheck clean, hosted GitHub CI `success`, Vercel preview `success`, `MERGEABLE`, diff confined to the ten D-033 files with no unrelated changes. **Left open for Ben's merge — not self-merged.** (An earlier revision recorded the PR as already open; verification on 2026-08-19 found the branch unpushed and no PR — corrected by pushing and opening PR #2 during the resume backup.)

4. **RESUME POINT (2026-08-22) — where the last session left off.** `main` = `ec3fdd4` (Slice A + hardening + post-merge and resume docs; hosted CI green on every push since the merge). Open PR: **#2 (D-033 bleed)** — every check green, `MERGEABLE`, awaiting Ben's merge. Local repo parked on `main`, clean tree (four pre-existing untracked folders only). Branches retained: `slice-a-native-publishing` (merged record), `amendment/d-033-publication-bleed` (PR #2). Nothing is half-done: no uncommitted code, no unpushed commits, no pending migration. The next human action is Ben's: merge PR #2 (implementation already accepted), then rule on the A4/square margins; the next engineering action is Slice B (§9) on a fresh `slice-b-*` branch off `main` after those two.

**Ben's open items (§8):** rule on the provisional A4/square margins (the Slice B gate) · choose the D-032 availability mechanism · the two standing items (EasyPost key; Slice G font procurement). PR #1 and the Actions hold are closed; D-033's ruling (2026-08-19) and implementation (2026-08-22) are both accepted, and PR #2 awaits Ben's merge.

---

## 1 · Repositories, environment, how to run

### Production app
- **Path:** `/Users/benjamingibson/Desktop/baxter-app` (Turborepo monorepo, npm workspaces — **not** in the Toronto Creatives vault).
- **Packages:** `@baxter/web` (Next 15.5 App Router, React 19), `@baxter/domain` (pure TS rules — now includes the editor document schema), `@baxter/db` (Drizzle schema **as documentation**; migrations are hand-written SQL applied via the Supabase SQL editor; only `0000` is in the drizzle journal — never run `drizzle-kit generate`), `@baxter/ui-tokens`, `@baxter/eslint-config`.
- **Stack:** Supabase (Postgres + RLS + Auth; project ref `qnqbkihndxppommgfrxd`), Stripe Connect Express (held funds), Inngest, Cloudflare R2 (`baxter-quarantine`/`baxter-clean`) + Cloudflare Images, Resend, EasyPost (key pending). Konva 10 + react-konva 19 (editor island only).
- **Accounts (observed, D-032):** GitHub `56kz55777k-ops/baxter-publishing` (public; `gh` authed as that account) · Supabase org "56kz55777k-ops's Org" · Vercel team `benjamin-baxter`, project `baxter-publishing-web` (auto-deploys `main`; PR previews on).
- **Branches:** `main` (everything — Milestone 1 + Slice A + hardening, via merge commit `7826384`) · `slice-a-native-publishing` (merged; retained local + remote at `565cc57` as the reviewed-head record — delete only if Ben asks).
- **Verify:** `npm run typecheck` · `npm run lint` · `npm run test` (vitest) · `npm run build` · `npm run budget -w @baxter/web` (bundle guard) · `cd apps/web && npm run test:e2e` (Playwright smoke; needs `.env.e2e.local`).
- **Local env:** `apps/web/.env.local` (gitignored) holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public-class values), `NATIVE_PUBLISHING=1` (the editor discovery flag — server-read; see ADR-002). `apps/web/.env.e2e.local` (gitignored) holds `E2E_EMAIL` / `E2E_PASSWORD` / `E2E_PUBLICATION_ID` for the smoke (Ben creates/maintains; currently points at draft publication `9ea2cae6-eb98-4289-af4d-0d30f8dff900`).
- **Dev editor:** `cd apps/web && npm run dev` → `http://localhost:3000/studio` → any draft publication → "Open in the editor". A dev-only commit handle `window.__baxterEditorDevCommit(label?)` exists until Slice B ships real editing (NODE_ENV-stripped from production builds).

### Spike C v2 prototype (COMPLETE — behavioural spec only)
- **Path:** `~/Desktop/baxter-spikes/spike-c2/` (`npm run dev` → `http://localhost:5200?dev`). Vite 5 + React 18 + Konva 9. Throwaway; consult **only** when a production interaction question cannot be resolved from the written contracts. Per-review snapshots/audits/demo players in `~/Desktop/baxter-spikes/` are the accepted baselines — preserve, never regenerate.

### ⚠️ Standing operational rules (unchanged — they still bite)
- **Scratchpad is ephemeral** (`/private/tmp/claude-501/...` wipes between sessions). Durable work lives under `~/Desktop/` or the repo. (Spike B's code was lost this way; its conclusions are locked in the production handoff.)
- **Credentials:** Ben pastes all secrets himself. Never handle secret values; publishable-class keys (`pk_test_`, `sb_publishable_`) are safe to reference. **Don't work around credential-classifier denials** — twice this cycle the classifier blocked an action (key extraction from a public bundle; driving the Supabase SQL editor) and the correct move was Ben doing it by hand.
- **Two Chrome extensions can connect** (Ben's machine + "Nik's Mac"). You MUST select **Ben's** (deviceId `0c0509aa-…`) and never drive Nik's Mac. When identity matters, verify visibly (this cycle: a blinking beacon tab Ben confirmed on screen).
- **Hidden/backgrounded pages run no rendering frames** — rAF and Resize/IntersectionObserver callbacks starve; timers throttle 1 s → 60 s; layout (`getBoundingClientRect`) still computes on demand. This graduated from a test-harness gotcha to a real production incident (§5) and is now ADR-001.
- **Konva:** Transformer boxes are absolute screen px; anchor cursors write to the stage's INNER content element (the race-free two-owner cursor architecture); the DragEngine arms on any fired mousedown (synthetic-drive gotcha).
- **`.env.local` overrides shell env under `next dev`/`next start`** — to run a dark flag locally, edit the file (ADR-002 footnote).
- Node 22, npm (not pnpm). No PDF CLIs — JS libs only (pdf-lib, mupdf).

---

## 2 · The Milestone 2 arc — everything done, in order

### Phase 1 — Spike C v2, Reviews 9–13 (ACCEPTED; complete 2026-08-03)
Thirteen review passes total (Stage-0 spikes + Passes 1–8 + Reviews 9–13) produced the full accepted interaction vocabulary. The final five, each with a preserved baseline (source zip + audit doc + captioned demo player):
- **R9 — resize snapping:** moving-edges-only snapping via edge-diff; preview == commit mathematically on the 0.01 mm grid; ratio-lock via single scale factor, min-outranks-snap; union-box multi-move snapping; resize never re-parents.
- **R10 — cursor system:** one resolver on the outer wrapper, Konva's directional anchor cursors untouched on the inner element; cursor predicts the action before mousedown. Architecture explicitly approved to preserve.
- **R11 — long-form text:** viewport-clamped editor window onto the text; caret-to-click; one changed-only commit per session; retained limitations recorded (wrap drift, 15% zoom, Tab exits, IME expected-not-verified, overflow semantics open).
- **R12 — inspector consistency:** one token system; buffered numeric contract (transitional strings never commit); em-dash mixed values; locked members never silently mutated.
- **R13 — Clean View + coherence:** 0.0 px mode-transition continuity; one pan state; view-only Clean View; Review Book fully keyboard-modal (fixed the Blocking reader Delete-leak that autosaved a loss). **Spike declared COMPLETE.**

### Phase 2 — Production planning (approved 2026-08-03)
- **`native-publishing-production-implementation-handoff.md`** — the canonical specification. 15 parts: the **27 consolidated interaction contracts**; verified repo reconnaissance; prototype→production mapping with a do-not-port list; the `editor_documents` domain model; state ownership; autosave/revision design; font/image/export boundaries (text-overflow decision deliberately open, gated at Slice G/M2.4); Slices A–J; layered test strategy; ranked risk register; definition of ready (all checked).
- **`native-publishing-slice-a-blueprint.md`** — the final planning pass: amendments A1–A7 (history by reference, props-based load, CI-in-A, doc-init + unit navigation in A with page management housed in Slice I, bounded keepalive, `(editor)` route group, zero-dep bundle script), the repo map, data-flow trace, reducer/state design, autosave + §2.6 concurrency walkthrough, engineering standards (file-size targets, contract-numbered tests, review checklist, performance budgets), ranked unknowns, and the objective Definition of Done. Later amended by **Amendment 1** (§ below).

### Phase 3 — Slice A implementation (built 2026-08-03)
Everything per blueprint, ~30 files:
- **Domain** (`packages/domain/src/`): `units.ts` (mm↔pt); `editor/document.ts` (zod v1 schema — no stored text height, `font` as role token, `assetId`-only images, first-class stroke-None, hex sRGB, cover-first/back-last/unique-ids structure, model floors; `parseEditorDoc` with forward-only migration rejecting unknown versions); `editor/factories.ts` (spike creation defaults); `editor/units-of-view.ts` (`computeUnits` ported); `editor/init.ts` (born documents total exactly `minPages` — deviation D1); `formats.ts` gained per-preset `layout` margins (zine 12/5 final; **A4 15/6 + square 14/6 PROVISIONAL**).
- **Persistence:** migration `0007_editor_documents.sql` (idempotent, additive, RLS mirroring the draft/revisions window, no client DELETE, DB-stamped `updated_at`); documented in `schema.ts`; **applied to production** with Ben's hands (§4).
- **API** (`app/api/editor/[id]/route.ts` + `lib/editor/db.ts`): POST create-if-absent (race-safe via ON CONFLICT DO NOTHING + re-select); PUT conditional save (`WHERE revision = base`; `schema_version` derived from the validated doc, never client-claimed); 401/404/423/400/409/413/500, first-write-wins, never last-write-wins.
- **Route** (`app/(editor)/…`): bare-layout route group; server component authorizes (owner + draft/revisions) and passes the doc as props (no GET endpoint); client desktop gate (coarse pointer / <900 px → "The editor opens at a desk."), then `next/dynamic` `ssr:false` island — the only module tree importing Konva.
- **State** (`components/editor/state/`): two contexts (document vs UI); the reducer as a pure transaction log (generic `COMMIT`, reference-equality no-ops, 100-entry capped history holding references, terminal `conflict`/`window-closed`); dirty = `doc !== savedDoc`; `AutosaveScheduler` (2 s debounce / 10 s max-wait, one in-flight, 10-30-60 retry ladder, terminal outcomes); the autosave hook (serialize once at the boundary, `SAVED` pins the exact sent reference, beforeunload prompt + <60 KB keepalive courtesy).
- **Surface** (`components/editor/`): `SpreadStage` (paper/bleed/trim/margin/safe guides via `StageGuides`, wheel pan, pointer-centred zoom 0.15–8× of 3.4 px/mm, Space/Hand drag-pan, wrapper-owned cursor resolver), `UnitList` (read-only navigation), `StatusBar` (tools, fits, zoom), `EditorShell`, flag-gated workspace link.
- **Infra:** Vitest (with a TypeScript-based TSX pre-transform working around Vite 8/OXC honouring the app's `jsx: preserve` — deviation D3), CI workflow, zero-dep `bundle-budget.mjs` (records baseline 350,315 B shared; fails >+1 KB; proves Konva island containment by manifest AND chunk-content sweep).

### Phase 4 — Live verification (2026-08-03→06)
The environment had no credentials; every unblock was Ben's by design: dashboard sign-in (with a browser-identity verification Ben demanded and got — beacon-confirmed device, then org/project identity), `.env.local` (Ben pasted the publishable key), migration execution (classifier blocked me from the SQL editor; Ben ran the checkpointed SQL and pasted the evidence grid: **columns/policies/trigger verified, idempotent second apply, RLS CHECK-1..8 all PASS, fixture cleaned**). Along the way: **the production database was discovered paused** (§0) — identity proven operationally by a bogus-login probe flipping from network-failure to "That email and password do not match" at the exact moment Ben resumed the project. Then the **13-scene real-Chrome demo** on the live stack: creation flow → flag-gated link → lazy island → first-open init (born 4-page zine at revision 0) → unit navigation → pan + pointer-centred zoom (89→153%) → fits + 100% → guides close-up → 20-save autosave series with the full label choreography → reload rehydration → **two-tab 409** (calm banner verbatim, loser frozen-visible, winner symmetric, reload converges) → **423 window-closure** (distinct terminal state) → desk gate on a genuine mobile reload → dark-flag production build.

### Phase 5 — The production stage incident (found, root-caused, fixed 2026-08-06)
**Symptom:** production editor shell rendered, stage absent, zoom frozen. **Boundary trace:** wrapper laid out at 1349×805, observer attached to the right element — and no ResizeObserver callback, ever, because `document.visibilityState === "hidden"`: **RO delivery rides the rendering-frame pipeline; hidden pages run no frames; layout computes on demand regardless.** Dev never exposed it (dev tab always visible). Trigger for real users: ⌘-click into a background tab. **Fix:** synchronous initial `getBoundingClientRect` measure in the layout effect; observer for subsequent changes only; zero-dimension guard (now `useViewportMeasure`, the ADR-001 reference implementation). **Regression proof:** hidden mounts ×5, visible ×5, 3 hard reloads, 2,312 live RO deliveries during Ben's real window drags, attach/disconnect balanced ×3 entry/exit, no console errors, unit + navigation integrity. Also caught in this phase: the **flag leak** (`NEXT_PUBLIC_` build-inlining froze the toggle → server-read `NATIVE_PUBLISHING`, deviation D5, ADR-002; dark build proven on one artifact/two serve configs).

### Phase 6 — Performance certification (production build, real Chrome, live DB)
- **P1** island interactive: warm 912/959/1402 ms (median 959; budget 1500) · cold 1717 ms + 3287 ms fresh-chunk worst case (budget 3000; methodology note: one true cold exists per distinct build).
- **P2** 10 s continuous pan+zoom: 1,204 frames, **120 fps avg, p95 frame 9.1 ms, worst 9 ms, zero drops >34 ms**.
- **P3** 20/20 production saves, zero failures: **P50 425 ms / P95 660 ms** (local-dev budget 400/1200; the 25 ms P50 overage is us-west-2 RTT from Toronto). Full raw series in the session record.

### Phase 7 — Engineering review + hardening gate (accepted and implemented, 2026-08-06)
`slice-a-engineering-review.md` (tri-location) audited architecture/contracts/performance/tests/docs with every finding cited to file:line, and produced a 9-item gate, all implemented:
1. Shell-level `useEditorKeyboard` — one typing/editable-target guard (behaviour-preservation tests included; jsdom exposed and fixed a strict-boolean coercion in the guard).
2. Single `buildSavePayload` for autosave + keepalive (equivalence-tested; the safe keepalive/in-flight race left uncoordinated, documented as safe-by-revision-protocol).
3. **1 MB PUT bound on bytes actually consumed** — honest Content-Length fast path, chunked/no-header delivery cancelled mid-stream; 413 vs 400 distinct; five route tests including a genuine streamed no-header body.
4. Commit observation by **document-reference comparison** (`commit-observer.ts`) — save-machine transitions provably cannot arm the debounce (tested across all five transitions with a dirty doc).
5. Dead `INIT` reducer branch + inert provider `useMemo` deleted (grep-verified no call sites).
6. `useViewportMeasure` extracted + the incident regression suite (observer-never-fires → sync measure still initializes; delivery updates; zero-guard; disconnect; no remount duplication).
7. `use-autosave` hook-seam suite: real reducer + scheduler, mocked network — 200/409/423/400/network-failure/**late-response-after-terminal**/mid-flight-commit, asserting reducer state AND user-visible labels.
8. **Playwright smoke, live-passed against the production DB** (`test/e2e/editor-smoke.spec.ts`): sign-in → uninteracted stage mount with non-zero dims → real commit → autosave completion → reload rehydration (post-reload save proves revision) → clean console. Honesty built in: runs on `next dev` (no production editing surface exists until B; flips to `next start` then); headless Chromium can't reproduce hidden-tab starvation — that mechanism is pinned by item 6's unit suite; skips cleanly without `.env.e2e.local`.
9. **Evidence-gated render boundaries** — measured before/after (StrictMode-doubled counts; ratios): save-cycle re-renders of SpreadStage/UnitList/StatusBar **3→1** (only the commit render); UnitList pan churn **5→0** (now driven by a `unitIndex` prop instead of subscribing to the UI context). Implemented as `SaveStateChip` (self-subscribing), `memo` ×3 with genuinely stable props, `useCallback` handlers — no custom equality functions. All temporary instrumentation stripped.

**Final battery:** 13 suites / **103 unit+integration tests** green · typecheck (app + test tree) clean · lint clean · production build green · budget PASS (+234 B shared, unchanged; Konva contained) · hardened build mounts in a hidden tab · smoke `1 passed (22.7 s)`.

### Phase 8 — PR review & merge (CLOSED 2026-08-12)
PR #1 "Slice A — Native Publishing foundation", head `565cc5737706c8c3018b2bbfcc33eb9834703f91`, description rewritten post-hardening with precise verification language. At merge time: Vercel deployment SUCCESS on that head; GitHub-hosted CI had produced zero runs (the account-level verification hold — the honest at-merge record). Ben reviewed (with ChatGPT independently checking GitHub before and after) and **merged: commit `7826384e41b2c6ce7d4f9a131711b2b0837c1f85`** (parents `767d10e` + `565cc57`; ancestry and content verified locally — 103/103 tests green on the merged tree). **The merge push triggered hosted CI's first-ever run — `success` on `7826384`** (run 31567943010: typecheck, test-tree typecheck, lint, unit tests, build, bundle budget, all on GitHub runners), so the verification hold is cleared and CI now executes on pushes to `main`/`slice-*` and on PRs. Branch history: `7ea2225` (Slice A) → `668b5c3`/`f4a845e` (CI trigger attempts) → `24fc8cb` (hardening gate) → `1103be0` (review doc) → `565cc57` (HANDOFF); workflows-only `767d10e` on `main` registered Actions.

---

## 3 · The interaction philosophy (LOCKED by Ben — preserve verbatim)

> Baxter should feel like **Apple Pages meets Affinity Publisher, with the calmness, restraint and confidence of Apple's software.** Never Photoshop. Never Illustrator. Never a generic canvas editor.

The publication is always the hero · spread = editing coordinates, pages = print coordinates · object identity preserved ("frames remain frames; contents change") · the inspector is the primary editing surface · selection is dependable · restraint (temporary information) · one creation language for every tool · the cursor predicts the action before mousedown · situation-not-status copy in Baxter's voice (Editorial Constitution; Baxter never says "we").

**The 27 consolidated interaction contracts live in `native-publishing-production-implementation-handoff.md` Part 2** — the single behavioural source of truth for Slices B–J. Tests cite contract numbers by name.

---

## 4 · Production database state

- `editor_documents` **live in production** (migration 0007): `publication_id` PK→publications CASCADE · `doc` jsonb · `schema_version` (server-derived) · `revision` (conditional-write counter) · `updated_at` (trigger-stamped) · `updated_by` · `autosave_state` (diagnostics only). RLS: owner-or-admin SELECT; owner INSERT/UPDATE only in draft/revisions; no client DELETE. Evidence grid (Ben-run, in the session record): all columns/policies/trigger verified; second apply idempotent; behavior probes CHECK-1..8 PASS.
- **Fixtures:** `9ea2cae6-eb98-4289-af4d-0d30f8dff900` "Hardening RC probe (throwaway)" — draft, owned by Ben, serves as the e2e smoke fixture (keep). `bf171826-…` "Slice A Demo (throwaway)" — archived (cleanup done).
- Migration convention unchanged: hand-written idempotent SQL via the dashboard SQL editor; journal untouched.

## 5 · Deviations & decision records from this cycle

- **D1** Born documents: interiors = `minPages − 2` so totals pass their own preflight (blueprint prose would have made zines ×4-invalid).
- **D2** `konva`/`react-konva` added as production deps (blueprint E4 omitted them while mandating the island).
- **D3** Vitest TSX handling via a `typescript`-package pre-transform plugin (Vite 8/OXC honours the app tsconfig's `jsx: preserve` per file).
- **D4** Schema hardening beyond the field list (structure refinements, uuid-validated ids/clientId).
- **D5** Discovery flag is server-read `NATIVE_PUBLISHING` (ADR-002); discovery-only, authorization independent.
- **decisions.md:** **D-031** (editor persistence: `editor_documents`, revision concurrency, jsonb schemaVersion) · **D-032** (availability incident record + observed account map; mechanism = Ben's open decision) · **D-033** (publication bleed: 0.125 in = 3.175 mm = 9 pt per applicable edge; per-edge and profile-owned as recorded direction; 3 mm ≠ 3.175 mm; future PDF page-box and two-family preflight invariants recorded, not built).
- **ADRs (`docs/adr/`):** ADR-001 frame-independent initialization · ADR-002 runtime environment flags · ADR-003 editor state ownership (the seven invariants, with render evidence).
- **Blueprint Amendment 1:** browser smoke before Slice B; sizing + flag descriptions superseded by ADR-001/002. Original blueprint preserved as history.
- **Blueprint Amendment 2:** preset bleed 3 → 3.175 mm per applicable edge; `bleedMm` documented as per-edge and provisionally scalar; guides/fit/preflight behaviour unchanged; margins/safe explicitly out of scope. Original blueprint and Amendment 1 preserved as history.

## 6 · Documents & artifacts index

**Tri-location (canonical `~/Desktop/baxter-spikes/`, copies repo root + Vault handoffs/):** this HANDOFF · `native-publishing-production-implementation-handoff.md` (THE spec) · `native-publishing-slice-a-blueprint.md` + `…-amendment-1.md` + `…-amendment-2.md` · `slice-a-engineering-review.md`.
**Repo:** `decisions.md` (D-001…D-033) · `docs/adr/ADR-001..003` · `docs/editorial-constitution.md` · `baxter-milestone2-editor-scope.md` · migration `0007` · `apps/web/scripts/budget.json` (bundle baseline + methodology).
**Print-geometry research (historical evidence for D-033; preserved unaltered, never rewritten; tri-location — canonical copies added to `~/Desktop/baxter-spikes/` 2026-08-19):** `baxter-print-geometry-research-verification-handoff.md` (the original research + review mandate) · `baxter-print-geometry-verification-report.md` (independent adversarial verification — verdict CONFIRMED WITH CHANGES; 13-printer evidence table, PDF/PDF-X page-box model, BleedBox clipping risk assessment, 13 corrections).
**Spike baselines (keep, never regenerate):** `spike-c2-review{9..13}-snapshot-*.zip` + `review{9..13}-*-demo.html` + audits (`review9-progress-for-chatgpt.md`, `cursor-audit.md`, `longform-text-audit.md`, `inspector-audit.md`, `coherence-audit.md`).
**Milestone 1 record:** `baxter-progress-report.md` (§22 = Slice 9) — M1 sections of the previous handoff revision are preserved in git history of the repo copy.

## 7 · Known limitations & accepted edge cases (carried deliberately)

Autosave 400 rides the retry ladder with a loud console error (a designed `rejected` terminal phase is deferred) · single-page units show "Fit page · Fit page" (dedupe deferred) · boot-error retry is a full reload · SPA-nav-away relies on unmount + beforeunload (no route-change flush) · preset-less publications get a calm 400 at editor init · spike-carried limitations stand (drag-through-minimum with Ben's recorded calmer alternative; long-form retained limitations; 0.1 drag grid vs 0.01 elsewhere) · **text overflow print semantics remain deliberately open** — decision gated before Slice G text persistence and finally at M2.4 (options laid out in the production handoff Part 10).

## 8 · OPEN — Ben's queue

*(Closed since the last revision: PR #1 — merged 2026-08-12, commit `7826384`; GitHub Actions verification — cleared, first hosted run green on the merge commit.)*

0. **Merge [PR #2](https://github.com/56kz55777k-ops/baxter-publishing/pull/2) — D-033 publication bleed** (ruling ACCEPTED 2026-08-19; implementation ACCEPTED by Ben 2026-08-22; presets carry 3.175 mm per applicable edge; fully verified — 111 tests green, hosted CI `success`, Vercel preview `success`, `MERGEABLE` — no schema/persistence change, zero shared-bundle impact; branch `amendment/d-033-publication-bleed`, implementation commit `465c939`; not self-merged — the merge is Ben's). Reading: `native-publishing-slice-a-blueprint-amendment-2.md`, then D-033 in `decisions.md`.
1. **Margins (product decision — the Slice B gate):** confirm or revise A4 15/6 and square 14/6 in `formats.ts` (zine 12/5 is the accepted spike value; D-031). Independent of D-033 — bleed and safe are separate problems.
2. **D-032 availability mechanism (operational/infrastructure):** Supabase Pro, an uptime probe on a data-backed endpoint, or both — so production can never silently pause again.
3. *(Standing, Milestone 1 — operational)* EasyPost key + live-shipping verification when ready.
4. *(Parallel, non-engineering — product/licensing)* Font procurement for Slice G: self-hostable Fraunces + DM Sans files licensed for embedding (lead-time item flagged since the production handoff).

## 9 · NEXT — Slice B and the road after

**Slice B — shapes and selection** (production handoff Part 11) — *technically ready now; gated only by the §8 margin ruling (Slice B's inspector surfaces preset-derived geometry, so the provisional values should be ruled on before they're rendered as truth):* rect/ellipse creation with the full creation language (contract #3), selection + marquee (#4, #6), the inspector shell with Position & Size / Fill & Stroke / Appearance / Arrange / Lock and the complete buffered-numeric contract (#18, #19), element persistence through the generic `COMMIT`, undo/redo with selection restore (#24), real autosave traffic. Element semantics as pure helpers producing `nextDoc` — the reducer stays a transaction log (ADR-003). Slice order after B: C movement/multi/union-snapping → D resize + cursor chain extension → E images/R2 (parallelizable) → F crop → G text (font gate + overflow decision first) → H lines → I pages & viewing modes → J hardening. Amendment-1 note: the e2e config flips to `next start` when B ships real editing; the smoke grows only deliberately.

**Slice B must not change:** the generic COMMIT transaction model · reference-equality dirty · conditional-revision protocol + terminal states · UI/viewport state excluded from autosave/history · cursor ownership at the wrapper (B *extends* the resolver's priority chain, never forks it) · lazy-island bundle isolation + the CI budget · desktop gate + route authorization · the 27 contracts.

## 10 · Working style with Ben

- Creative Director; precise, craft-focused feedback. Reflect his exact vocabulary ("the publication is the hero"). Map work to his numbered points; ask for approach approval before implementing (he says "go").
- **Be honest about what's NOT done** — "here's what I fixed, here's what remains" beats overclaiming. Separate product findings from harness artifacts. Preserve exact distinctions he draws (e.g. "CI has not executed" ≠ failed ≠ green).
- Deliverables: runnable link + evidence (captioned demo players for visual work; verbatim numbers for engineering work). He reviews recordings, often with ChatGPT, before hands-on.
- Staged, reviewable passes; every acceptance gets a preserved baseline; every governing doc is tri-location propagated with checksums.
- Ben executes anything credential-shaped or infrastructure-destructive himself (sign-ins, migrations via SQL editor, resumes, env files); prepare checkpoints and paste-ready artifacts for those moments.

## 11 · First moves for a new session

1. Read this handoff, then **`native-publishing-production-implementation-handoff.md`** (Part 2 contracts + Part 11 slices), then `slice-a-engineering-review.md` + the three ADRs.
2. `cd ~/Desktop/baxter-app && git fetch && git status` — expect **`main` at `ec3fdd4` or later** (if PR #2 has merged, `main` will be ahead; `git pull`), clean tree apart from four pre-existing untracked folders (`Resend Documentation/`, `Vercel Documentation/`, `brand/`, `baxter-slice6-smoke-test.md`). Branches present: `slice-a-native-publishing` (merged record) and `amendment/d-033-publication-bleed` (PR #2). Check `gh pr list` — if #2 is still open, it awaits Ben, not you.
3. Run the battery: `npm run test` · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run budget -w @baxter/web`. All green on the merged tree; hosted CI also runs on push (first run green on `7826384`).
4. Check Ben's queue (§8): PR #2 verdict, then the margin ruling. Once both are in: begin Slice B per §9 on a fresh `slice-b-*` branch off `main`, contracts open beside the code. Do not start Slice B features before the margin ruling.
5. For live work: `apps/web/.env.local` must exist (§1); the editor is at `/studio/editor/[id]` for any draft publication; dev commit handle drives saves until B.
