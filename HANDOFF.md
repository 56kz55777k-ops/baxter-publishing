# Baxter — Session Handoff

**For:** a new Claude Code session continuing this work.
**Written:** 2026-07-18 · **Updated:** 2026-07-20 (Reviews 9 AND 10 accepted; long-form text pass underway). **Working with:** Ben Gibson (Benjamin Gibson), Creative Director / co-owner, Toronto Creatives (`info@torontocreatives.com`).

---

## 0. TL;DR — where things stand

Two parallel threads:

1. **Baxter App (the product) — Milestone 1 is SHIPPED.** A curated editorial print-production marketplace. The whole "business loop" (upload → preflight → review → publish → buy → OMS → fulfilment → commerce emails) is live in production. **One deferred item:** the EasyPost live-shipping verification, waiting on Ben's API key.

2. **Milestone 2 — Native Publishing (the in-app editor) — ACTIVE.** Interaction-design prototype ("Spike C v2"), reviewed iteratively by Ben. Architecture settled and praised; now in precision/craftsmanship polish. **Reviews 9 (resize snapping + union multi-move), 10 (cursor system) and 11 (long-form text editing) are all ACCEPTED** — snapshots, audits and demo players are the accepted baselines. Approved architecture to preserve: the outer-wrapper/inner-Konva cursor ownership boundary; the Review-11 editor contract (viewport-clamped window onto the text, one changed commit per session). No further cursor or long-form changes unless later work exposes a real regression. **Review 12 (inspector consistency) is ACCEPTED** — spinner removal approved (no permanent plus/minus controls in the next pass); retained limitations: keyboard stepping not yet visually discoverable, long slider scrubs may create several entries, drag commits stay on the 0.1 mm grid vs 0.01 elsewhere. **Review 13 (Clean View + coherence) is ACCEPTED — Spike C v2 is COMPLETE.** The prototype is the final interaction baseline; no further prototype polishing passes. Current task: the production implementation-readiness handoff (`native-publishing-production-implementation-handoff.md`). Throwaway prototype, isolated from the production repo, at `~/Desktop/baxter-spikes/spike-c2/`.

**If you're picking up the active work, it's the Spike C v2 editor.** Jump to §5, §6 and §7.

---

## 1. Repositories, environment, and how to run

### Production app (Milestone 1)
- **Path:** `/Users/benjamingibson/Desktop/baxter-app` (Turborepo monorepo — **not** in the Toronto Creatives vault).
- **Packages:** `@baxter/web` (Next.js 15 App Router, React 19), `@baxter/domain` (pure TS rules), `@baxter/db` (Drizzle schema + hand-written SQL migrations), `@baxter/ui-tokens`, `@baxter/eslint-config`.
- **Stack:** Supabase (Postgres + RLS + Auth), Stripe Connect Express (**held-funds** via separate charges & transfers), Inngest (async jobs), Cloudflare R2 (`baxter-quarantine`, `baxter-clean`) + Cloudflare Images, Resend email (`notifications@baxter.press`), EasyPost (shipping aggregator — key pending).
- **Git:** `https://github.com/56kz55777k-ops/baxter-publishing.git`, work on `main` (this project commits directly to main).
- **Vercel:** project `baxter-publishing-web` (team `benjamin-baxter`), production URL `https://baxter-publishing-web.vercel.app`. Auto-deploys on push to `main`.
- **Verify:** `npm run typecheck` · `npm run lint` · `npm run build` (turbo; repo uses **npm**, not pnpm).

### Spike C v2 prototype (Milestone 2, ACTIVE)
- **Path:** `~/Desktop/baxter-spikes/spike-c2/` (STABLE on the Desktop — deliberately not the scratchpad).
- **Run:** `cd ~/Desktop/baxter-spikes/spike-c2 && npm run dev` → **http://localhost:5200** (append `?dev` to reveal developer controls). `node_modules` is already installed.
- **Build check:** `npm run build` (Vite; catches errors fast).
- **Stack:** Vite 5 + React 18 + Konva 9 + react-konva 18. **Throwaway** — no dependency of this ever goes into the production repo.
- localStorage key: `baxter.spikec2.doc.v2`. Clear it for a fresh start: `localStorage.removeItem('baxter.spikec2.doc.v2')`.

### ⚠️ Environment gotchas (read these — they will bite you)
- **The scratchpad is ephemeral.** `/private/tmp/claude-501/.../scratchpad` gets **wiped between sessions/days**. The original Spike B (`spike-b-pdf`) and Spike C v1 (`spike-c-canvas`) and `SPIKE-RESULTS.md` were lost this way. **Keep all durable work under `~/Desktop/`.** `spike-c2` survives because it's there.
- **Browser-screenshot coordinates are unreliable.** The in-app browser (`mcp__Claude_Browser__*`) reports screenshots as "800×450" but the real viewport is larger. Pixel-coordinate clicks frequently miss. **Drive the prototype through JavaScript instead:** `javascript_tool` to click DOM buttons by `textContent`, or fire Konva events via `window.Konva.stages[0]`.
- **Konva's DragEngine arms on any fired `mousedown` on a draggable node (ROOT CAUSE of "synthetic drags come out wrong").** If you `node.fire('mousedown', …)` to select something and never complete the click, Konva registers the node in `Konva.DD._dragElements`; every later `window` mousemove (e.g. driving the Transformer) then ALSO drags that node, corrupting geometry in ways that look like app bugs. Remedy in test drivers: after a synthetic mousedown, dispatch a real `window` mouseup AND call `Konva.DD._dragElements.clear()` before gestures.
- **Hidden/backgrounded tabs throttle hard.** The in-app browser pane never fires `requestAnimationFrame` (Konva never paints — force with `stage.draw()`; screenshots are stale otherwise) and timers degrade 1 s → 60 s (Chrome intensive throttling). Even the real Chrome throttles when the tab is backgrounded. React's MessageChannel scheduler is NOT throttled — build test-driver sleeps on MessageChannel, not setTimeout. A backgrounded tab also never engages `autoFocus` (the in-place text editor won't take focus → programmatic `blur()` no-ops; exit it with a dispatched `focusout` instead).
- **Transformer boxes are absolute screen px.** `boundBoxFunc` boxes are in screen pixels relative to the stage container (the Transformer overrides `getAbsoluteTransform()`); convert with `mm = (px − view.x|y) / view.zoom`. Konva writes anchor-hover cursors to the stage's INNER `content` element; react-konva's `style` prop lands on the OUTER container — two separate elements (this is what makes the Review-10 cursor architecture race-free).
- **Full-fidelity page captures without a screen recorder:** serialize the live DOM (clone; bake input values as attributes; swap each canvas for an `<img>` of its bitmap via an intermediate canvas; strip scripts/links/meta and non-`data:` srcs) and show frames in an `<iframe srcdoc>` player. Chrome blanks fully-`sandbox=""`ed srcdoc frames — omit the attribute (frames are script-stripped). Chrome may also hold scripted `a.click()` downloads pending; deliver files from the page via `fetch` POST to a one-shot local `node` HTTP receiver instead.
- **The dev server is cleaned up between sessions** — just restart it (`npm run dev`).
- **Two Chrome extensions can connect** (Ben's machine + "Nik's Mac") for `claude-in-chrome`. You MUST select **Ben's** (deviceId `0c0509aa-…`) and **never** drive Nik's Mac. If both are connected the harness forces a browser-selection question — ask it; Ben picks his. (The in-app `mcp__Claude_Browser` used for the localhost prototype is a separate surface — no selection needed.)
- **Credentials:** Ben pastes all secrets himself (Stripe keys, EasyPost key). **Never handle secret values**; the publishable `pk_test_` is safe to reference. Don't work around credential-classifier denials.
- Node 22, npm. No PDF CLIs (poppler/qpdf/gs) available — use JS libs (pdf-lib, pdfjs, mupdf).

---

## 2. Milestone 1 status (business loop) — SHIPPED

Slices 1–9 shipped and production-verified. Latest work = **Slice 9** (production economics + OMS + fulfilment + commerce emails).

- **Commits:** `eaead4d` (Slice 9 build) · `47e8b16` (fix: admin can begin fulfilment) · `b968804` (docs). All pushed to `main`, deployed.
- **Migrations applied to Supabase:** `0005_pricing_model.sql` and `0006_shipping_details.sql` (hand-written, applied manually in the Supabase SQL editor; only `0000` is in the drizzle journal).
- **Inngest resynced** — `order-paid-notify` registered on `order/paid` (D-017: manual resync required after adding functions).
- **Economics model (D-029):** `estimateProduction()` in `@baxter/domain` is the single source of truth — `retail = print cost + configurable Baxter margin (PRODUCTION_MARGIN_BPS, default 30%) + creator earnings`. Baxter earns by manufacturing, not commission, and **nothing from postage**. Test prints (creator proofs) are cost-only.
- **Non-shipping smoke test PASSED** (documented in `baxter-progress-report.md` §22).
- **Production test data:** order `61694821` left in `in_fulfillment`; publication "Slice 7 Test" published; accounts `ben-in-toronto` (admin + creator), `ben2` (`baxter.press/ben2`, non-admin), `benjamin@benjamingibson.ca` (Stripe). Admin desk at `/admin`.

### DEFERRED (Milestone 1): EasyPost live-shipping verification
Architecture fully built and **fail-safe**: with no `EASYPOST_API_KEY`, `shippingConfigured()` is false, physical checkout renders a calm "ordering is briefly unavailable" screen and **creates no PaymentIntent**. Files: `apps/web/lib/shipping/{provider,easypost,index}.ts` (D-030). When Ben provides the key: (1) add `EASYPOST_API_KEY` + ship-from origin (MGS Marketing, Toronto) to Vercel; (2) wire the live cheapest-rate quote into checkout — needs the **address-first flow**; (3) persist carrier/service/est-delivery on the order (columns exist) and surface on receipt/admin/production email; (4) verify end-to-end incl. the three commerce emails actually sending. Ben framed this as a dedicated follow-up; don't hold up other work for it.

---

## 3. Milestone 2 (Native Publishing) — scope & Stage-0 spike outcomes

Scope doc: `baxter-app/baxter-milestone2-editor-scope.md`. The editor is an in-app surface where a creator **builds a publication directly** instead of uploading a PDF. **Central insight:** the editor is a *print-ready-PDF producer* — it converges on the existing pipeline (output is a PDF in R2 quarantine; review/marketplace/orders unchanged). It adds a new **input**, not a new pipeline.

- **Spike B (canvas → print-ready PDF): WINNER = `pdf-lib` + `@pdf-lib/fontkit`.** Real vector PDFs (MediaBox/TrimBox/BleedBox, 3 mm bleed, embedded subset fonts, native selectable text, real image DPI, byte-deterministic); **passes the repo's actual preflight** and the mupdf preview pipeline. **NOT PDF/X** (no OutputIntent/ICC — open item pending MGS). *(Spike B code was lost to the scratchpad wipe; conclusions locked.)*
- **Spike C (canvas primitive): WINNER = `Konva` (react-konva).** ≈136 KB gzip → must be a **lazy-loaded client island** (D-001). Perf: ~2000 objects/page at ~7 ms/draw.
- **Editor output decision:** *born-correct-but-still-inspected* — editor PDFs still run through preflight.
- **Open dependency:** **printer calibration** — MGS Marketing real specs (bleed, min DPI, PDF/X flavour, ICC/output-intent, CMYK). Prototype uses current preflight thresholds and RGB as interim.

---

## 4. The interaction philosophy (LOCKED by Ben — preserve it)

> Baxter should feel like **Apple Pages meets Affinity Publisher, with the calmness, restraint and confidence of Apple's software.** Never Photoshop. Never Illustrator. Never a generic canvas editor.

- **The publication is always the hero.** "The remaining work is making Baxter disappear."
- **The spread is the editing coordinate system; pages are the printing coordinate system.** Objects move freely across the gutter; on drop they re-parent to the page their centre lands in. (Resize deliberately does NOT re-parent — that stays a drop decision.)
- **Object identity is preserved** — a text frame stays a text frame; only contents/properties change.
- **The inspector is the primary editing surface** — keeps the workspace calm.
- **Selection is dependable** — preserved through undo/redo, editing, and tool changes where reasonable.
- **Restraint:** show information *while it helps the current action*, then remove it (anchors, guides, readouts, badges are temporary).
- **Editing legibility:** the in-place text editor uses high-contrast ink while editing, then restores publication styling on exit — without recomposing the text.
- **One creation language for every tool:** Click → anchor → drag → live preview → snapping/guides → release → selected → inspector → click away.
- **The cursor predicts the action before mousedown** (Review 10's addition to the language).

---

## 5. Spike C v2 — architecture & file map (the ACTIVE work)

Throwaway. `~/Desktop/baxter-spikes/spike-c2/src/`. Everything in **millimetres**, top-left origin per page trim; font sizes in **points** (`PT_MM = 25.4/72`). Model values live on a 0.01 mm grid (drag/creation commit at 0.1; inspector and resize at 0.01).

- **`model.js`** — the BOOK model. `newDoc()` → meta (A5 zine 148×210, bleed 3, margin 12, safe 5) + pages (`cover | interior | back`) of `elements[]`: `text` (x,y,width,text,fontSize[pt],lineHeight,fill,font,align), `image` (…,src,natW,natH,fit,cropZoom,focal), `rect`, `ellipse`, `line` (width/height = start→end delta). `computeUnits(pages)` pairs interiors into spreads. Persistence: debounced localStorage (400 ms).
- **`App.jsx`** — orchestrator. Multi-selection `selIds` array; history stack `{doc, sel}` (undo/redo restore selection); object ops (`onCreate`, `moveElement`, `applyMoves` batch, `arrange`, `toggleLock`, `patchAll`, `removeSel`, `duplicateSel`, copy/paste, `nudge`, `commitEl`); book ops; fit/centre; keyboard (⌘A/Z/D/C/X/V, Delete, Esc, arrows, tool letters, Space hand, Tab Clean View). Window-blur hygiene clears `shiftHeld`/`spaceHand` (Review 10). `DEV = ?dev`.
- **`Workspace.jsx`** — the Konva editing surface (the crux).
  - **Spread coordinate system:** both facing pages in one group; `pageForCentre()` re-parents on drop; content clipped to the spread's bleed.
  - **Multi-select:** shift-click, marquee, unified single/multi drag (`drag` object) committed via `applyMoves`.
  - **Snapping (Review 7–9):** `buildTargets(exclude)` = page edges/centres/margins + every other object's edges/centres (text uses **measured render height** for vertical targets); `bestSnap`, `SNAP = 1.6` mm; oxblood guides while engaged. Applies to **creation**, **drag** (via the **union box** of the whole moving set — a single object is a union of one), **line endpoints**, and **Transformer resize**.
  - **Resize snapping (Review 9, ACCEPTED):** `boundResize` (the `boundBoxFunc`) converts boxes screen-px ↔ spread-mm, snaps ONLY the edges the gesture moves (edge-diff vs oldBox — robust to ratio locks, alt/centred scaling, and Konva's flip anchor-renaming), preserves ratio exactly under ⇧/Ratio via a single scale factor (min-size outranks snap), enforces minimums in preview (text ≥10 w, shapes ≥4, grandfathered), freezes on drag-through (no flip — `flipEnabled` false), quantizes to the 0.01 mm grid (fixed edges are identity under rounding — provably pinned), and stores the box so **`onTransformEnd` commits exactly the previewed numbers** (full x/y/w/h; text x/width only). Anchor-click with no movement commits nothing (no history entry). Live W × H pill (width-only for text) shares the creation readout. Resize never re-parents.
  - **Cursor system (Review 10, awaiting review):** ONE resolver derives the cursor from interaction state and writes it (via `useLayoutEffect`) to the wrapper div; Konva's Transformer keeps writing its directional, angle-aware resize cursors to the stage's inner `content` element — inner wins while set, inherits back when cleared: **two owners separated by CSS containment, no race possible**. Priority: Clean View/editing → crop (grab/grabbing over content, default off-image) → object drag (`move`, held) → marquee (`default`, stable) → pan (`grabbing`) → hand (`grab`, outranks hover) → creation tools (`crosshair`; text tool `text`) → endpoint gesture/hover (`crosshair`, outranks line body) → object hover (`move`; locked stays `default` — neutral, never `not-allowed`) → `default`. Hover state stores only the element id (lock state is looked up live — lock/unlock updates the cursor without pointer movement). Window blur clears all transient cursor state.
  - **In-place text editor (Review 11, long-form):** overlay `<textarea>` matching frame metrics (identical wrap width/font/size/leading; measured drift ≈ 1 wrap point in 214 lines) but forced high-contrast. **Height-managed:** hugs content (min ~3 lines), grows on input, clamps to the visible workspace — long documents scroll INSIDE the editor; the spread never pans while writing. If the frame head is above the viewport the box pins 8 px from the workspace top (width/wrap unchanged — access outranks alignment). **Caret-to-click** on entry (line from Konva `textArr`, column by prefix measurement, passage centred); creation-entry selects the placeholder. Uncontrolled input: typing/paste/native-undo never touch React or history; **blur commits once per session and only if the text changed** (no phantom entries; Escape/⌘Enter/click-away = blur; `isComposing` guarded; `overscroll-behavior: contain`). Editor follows pan/zoom live during a session.
  - **Crop mode:** double-click a filled image → drag pans the focal point; Esc exits.
- **`Properties.jsx`** — the inspector (Review 12: one token system — 14 px inset, 26 px fields, 30/26/20 button scale, one radius/border/focus-ring; full record in `inspector-audit.md`). Page / single object (Position & Size or line Endpoints; type sections; Appearance; Arrange; Lock) / multi. **Numeric contract:** buffered text fields (`inputMode=decimal`) — transitional strings (empty/"-"/"12.") never reach the model; commit on blur/Enter/arrow-press only; invalid input restores; clamps only at real bounds; display = model at 0.01 mm (≤2 dp); keyboard ↑/↓ step (Shift = big), native spinners removed; Escape restores; no-ops commit nothing. **Multi:** "N objects · M locked" header; mixed values show an em dash (never an average); one edit applies to all unlocked members in one history action; `patchAll` structurally skips locked (`setLockAll` is the one permitted lock mutation). Stroke: None is distinct from thin; line stroke rows share shape terminology; Size carries a quiet `pt` suffix. The fieldset `min-width: min-content` quirk (the historic cause of edge-crowding) is fixed.
- **`Navigator.jsx`** — left panel: thumbnails, drag-to-reorder with insertion indicator, Duplicate/Delete, `+ Page` / `+ Spread`.
- **`Chrome.jsx`** — `Toolbar` (title/save; tools; undo/redo/dup/delete with `not-allowed` when disabled; `▢/▣ Ratio` aspect toggle; Clean View; Review Book) and `StatusBar` (save state; Fit Page/Fit Spread/100%; dev block under `?dev`).
- **`PreviewBook.jsx`** — **Review Book**: full-publication reader (reuses `Workspace` in `preview` mode).

**Clean View vs Review Book (contracts finalized in Review 13):** *Clean View* (Tab / toolbar; Tab or Esc to exit) is the SAME continuous viewport with chrome removed and is strictly **view-only** — entry compensates `view.x` by ±NAV_W so the spread never moves on screen; pans made while viewing become the editing viewport; selection/tool/history/autosave untouched; transients cleared and crop exited on entry; every mutation key stands down. *Review Book* is the whole-publication reader and is **fully modal to the keyboard** (`if (reviewBook) return` guards the App handler): reader owns ← → Space Esc; nothing reaches the document, selection or tool; paging creates no history; exit returns to the originating editing context exactly. One rule for tools: **viewing modes never touch the active tool.** Keep the two modes distinct.

**Convergence contract:** the editor serializes to the scene-graph shape Spike B's exporter consumes; when the real export (M2.4) is built, editor output → PDF in R2 quarantine → existing preflight → pipeline unchanged.

---

## 6. Review history (how we got here)

Ben reviews each build in detail (he often analyses the demo recordings with ChatGPT). The arc:
- **Stage 0** — technical spikes; Konva + pdf-lib chosen; risks retired.
- **Pass 1** — book model, navigator, centred workspace, tool model, calm selection, transforms, Clean View, trackpad gestures, publishing language, dev-mode gate, save status.
- **Pass 2A** — Properties inspector, in-place text editing, image upload + crop/fit/fill/focal, shapes, lock, keyboard shortcuts.
- **Test 4** — spread coordinate model (cross-gutter movement), image-frame selection fix, line live-preview + endpoint handles, Review Book.
- **Review 5** — text-editing regression fix, image-placeholder flow, on-canvas crop, navigator drop indicator.
- **Review 6** — multi-selection & marquee; more communicative creation (anchor + readout).
- **Review 7** — text-editing legibility; snapping + alignment guides for creation & dragging; crop cursor.
- **Review 8** — numeric steppers; inspector spacing system; line-endpoint snapping (commit == preview).
- **Review 9 — ACCEPTED (2026-07-20).** Resize snapping (objects + image frames): moving-edges-only snapping with the same targets/guides as drag; preview == commit mathematically (0.01 mm grid; fixed edges provably pinned); ratio-locked corners snap one axis and derive the other; alt/centred skips snapping; minimums enforced in preview (grandfathered); anchor-click is a no-op; resize never re-parents; live W × H pill. Union-box **multi-selection movement snapping** (single drag = union of one). Ride-along fixes: stale x/y after top/left resizes (full-box commit), locked objects no longer expose handles, no-op history entries gone, text frames' vertical snap targets use measured height. Baseline artifacts: `spike-c2-review9-snapshot-2026-07-20.zip`, `review9-resize-snapping-demo.html` (34-frame captioned player), `review9-progress-for-chatgpt.md`.
- **Review 10 — ACCEPTED (2026-07-20).** The cursor system: one authoritative resolver (see §5); cursors predict the action before mousedown; Konva's directional anchor cursors preserved untouched; all 16 audit states + transitions verified programmatically in real Chrome, including no-stomp during resize, live lock/unlock, Clean View, Escape, tool switches, window blur, two zoom levels, both pages. Review 9 regression re-verified post-change. Ben: "predicts actions clearly … consistent with Baxter's calm publishing interaction language"; the **outer-wrapper/inner-Konva ownership boundary is approved — preserve that architecture**. Baseline artifacts: `spike-c2-review10-snapshot-2026-07-20.zip`, `cursor-audit.md`, `review10-cursor-demo.html` (21-frame player with live-sampled cursor chip).

- **Review 11 — ACCEPTED (2026-07-22).** Ben: "supports genuine publication-scale writing while preserving Baxter's established interaction philosophy." **Limitations retained by decision, not to be solved now:** occasional one-word wrap drift at engine boundaries; 15% zoom technically editable but visually impractical; Tab exits via native focus movement; live IME / press-and-hold accents / emoji expected-but-not-fully-verified; publication overflow semantics remain an open export/preflight decision. Baseline: `spike-c2-review11-snapshot-2026-07-22.zip`, `longform-text-audit.md`, `review11-longform-text-demo.html`. Original entry: Very-long-form text editing. Audit-first (full record: `longform-text-audit.md`): the defining defect was the editor's missing height (`rows=2` → a 2.3-line keyhole over a 2,159-word document); also caret-always-at-0, phantom history entries on unchanged visits, no IME guard, off-screen editors for off-screen frames. Fixes (editor block of `Workspace.jsx` only): managed height clamped to the visible workspace, caret-to-click entry, placeholder-selected creation entry, changed-only commits, `isComposing` guard, scroll containment, viewport top-pinning. Contract: one session = one history entry, only if changed; in-session undo is native; commit-only exits. Publication overflow semantics deliberately untouched (width-constrained, height-auto, clipped at the bleed) — the print meaning of overflow is an open decision for the export pass. Verified against a deterministic 2,159-word stress doc (paste 2,481 words in 3–4 ms; entry ~41 ms; full battery green; R9 + R10 regressions re-verified). Artifacts: `longform-text-audit.md`, `review11-longform-text-demo.html` (19-frame player; editors rendered from real caret/scroll/selection state).

- **Review 12 — ACCEPTED (2026-07-22).** Ben: "one deliberately designed editing system"; spinner removal accepted; the three retained limitations stand (stepping discoverability, slider scrub entries, 0.1 drag grid). Baseline: `spike-c2-review12-snapshot-2026-07-22.zip`, `inspector-audit.md`, `review12-inspector-demo.html`. Original entry: Final inspector consistency pass. Measured-first audit found: fieldset min-content quirk pushing every container 10 px past the panel edge; bare numeric fields 289 px wide in a 280 px panel; four button heights; per-keystroke numeric commits with `parseFloat||0` committing 0 for transitional strings; 0.1 display over a 0.01 model; a fabricated multi-selection opacity average; `patchAll` mutating locked members; **Review Book crashed on open** (stale pre-Review-6 props — fixed, verified paging and exit). All fixed under one token system + buffered numeric contract (see §5 and `inspector-audit.md`). Known decisions for the hands-on: native spinners removed in favour of keyboard stepping; drag commits remain 0.1 vs inspector/resize 0.01 (reported, unchanged). Artifacts: `inspector-audit.md`, `review12-inspector-demo.html` (23-frame player).

- **Review 13 — ACCEPTED (2026-08-03). SPIKE C v2 COMPLETE.** Both mode contracts approved verbatim; strict view-only Clean View (incl. undo block) accepted; mid-pointer-gesture mode switch accepted as documented edge case, not to be designed further. **Final interaction baseline:** `spike-c2-review13-snapshot-2026-08-03.zip` + `coherence-audit.md` + `review13-coherence-demo.html`. Original entry: Clean View context preservation + coherence sweep. Audit-first (record: `coherence-audit.md`): found ONE Blocking (every canvas shortcut leaked through Review Book — Delete deleted objects from reader mode and the loss autosaved; proven the hard way when the audit's own probe persisted a deletion across sessions) and five Major issues (the deferred 232 px Clean View pan jump; Escape-in-Clean-View destroying the selection; mutation keys live while chrome hidden; crop surviving into Clean View; transients surviving into Clean View). All fixed minimally (`App.jsx` togglePreview + keyboard guards, `Workspace.jsx` cleanup effect + viewing-cursor branch). Contracts: Clean View = same viewport, view-only, 0.0 px measured continuity both ways, one pan state; Review Book = keyboard-modal reader returning to the originating context; viewing modes never touch the tool. Artifacts: `coherence-audit.md`, `review13-coherence-demo.html` (20-frame player with measured continuity chips).

Tone note from Ben: shorter reviews = the editor is better, not less engagement. "The architecture is no longer the concern. Now we are tuning the instrument."

---

## 7. NEXT — prioritized

1. **Slice A: SHIPPED, ENGINEERING-REVIEWED, HARDENED (2026-08-06) — awaiting Ben's PR review; Slice B ready.** The accepted engineering review (`slice-a-engineering-review.md`, tri-location) produced a 9-item hardening gate, all implemented and pushed (commits 24fc8cb/1103be0 on `slice-a-native-publishing`, PR #1 open, unmerged): shell-level useEditorKeyboard (one typing guard); single buildSavePayload for autosave+keepalive; 1 MB PUT bound enforced on consumed bytes (413/400 distinct, chunked-no-header tested); commit observation by doc-reference (save transitions can't arm the debounce); dead INIT removed; useViewportMeasure extracted with the incident regression suite (observer-never-fires -> sync measure still initializes); use-autosave hook-seam suite (200/409/423/400/network/late-response-after-terminal/mid-flight); Playwright smoke LIVE-PASSED against production DB (sign-in -> uninteracted mount -> commit -> autosave -> reload rehydration -> zero console errors; dev-server caveat + hidden-tab honesty documented in the spec); evidence-gated render boundaries (SaveStateChip + memo x3 + UnitList unitIndex-prop: save-cycle canvas re-renders 3->1, UnitList pan churn 5->0). 103 tests / 13 suites green; budget +234 B unchanged; hardened prod build mounts in a hidden tab. New records: docs/adr/ADR-001 (frame-independent init), ADR-002 (runtime env flags), ADR-003 (state ownership), blueprint amendment 1 (smoke-before-B), D-032 (availability incident, observed facts; pause-prevention mechanism = Ben's open decision). E2E fixture: publication 9ea2cae6-eb98-4289-af4d-0d30f8dff900 (draft throwaway) + Ben's .env.e2e.local (gitignored). STILL OPEN for Ben: PR review/merge; A4+square provisional margins; GitHub Actions account verification; D-032 mechanism choice. PREVIOUS STATE (superseded but kept for the record):  Migration 0007 APPLIED to production (qnqbkihndxppommgfrxd — identity proven operationally via probe-flip when Ben resumed the paused project; production had been silently down on a free-tier auto-pause, now restored), idempotency proven (second apply), RLS CHECK-1..8 all PASS. Full 13-scene real-Chrome demo complete on the live stack (first-open init, save round-trips, two-tab 409 first-write-wins with calm banner, 423 window-closure, desk gate on genuine mobile reload, dark-flag proof). Performance: P1 warm 912/959/1402ms (median 959, budget 1500) cold 1717/3287ms (budget 3000; 3287 was a fresh-chunk worst case); P2 120fps avg, 0 dropped frames, worst 9ms; P3 20/20 production saves P50 425ms/P95 660ms (vs 400/1200 local-dev budget — 25ms over P50 explained by us-west-2 RTT). **Production stage incident (found in verification, FIXED):** editor loaded in a hidden tab never mounted the stage — ResizeObserver delivery rides rendering frames and hidden pages run none; dev never exposed it (tab always visible). Fix: synchronous initial getBoundingClientRect measure in the layout effect (layout computes on demand even hidden), RO for subsequent changes only; verified hidden-mount x5, visible x5, 2312 live RO deliveries during real window-resize drags, leak-balanced across entry/exit x3. Deviations recorded D1-D5 (D5: flag is server-only `NATIVE_PUBLISHING` — NEXT_PUBLIC_ vars are build-inlined everywhere incl. server components, which froze the toggle; discovery-only, authorization independent, dark-build proven; local note: .env.local overrides shell vars under `next start`, deploys unaffected). Throwaway demo publication bf171826-6187-4213-9e36-c4b3044150b3 pending Ben's archive. A4/square margins remain PROVISIONAL in formats.ts. Next: Ben's Slice A review -> margins confirmation -> Slice B (shapes + selection). Spike C v2 is a behavioural specification — consult only when a production question can't be resolved any other way; no further prototype passes.
2. **Remaining small refinements** (unchanged): toolbar icons, context menus, drag-in images, larger navigator thumbnails, resizable inspector; plus candidates: live image re-crop during resize, drag-commit precision alignment, visible stepper affordance, slider-scrub history coalescing.
3. **Clean View context preservation** (exiting restores exact spread/zoom/pan/selection — pan shift when panels reappear).
4. **Deferred small refinements:** toolbar icons, context menus, drag images from Finder, larger navigator thumbnails (~+10%), resizable inspector. Plus candidates noted in Review 9: live image re-crop during resize (Pages-like), drag-commit precision alignment (0.1 → 0.01).

**Known, accepted edge case (do not "fix" casually):** *drag-through-minimum* — dragging a resize edge far through the opposite edge freezes the box at the minimum (no flip, no slide); if the user KEEPS dragging, Konva's anchor rename makes the gesture resume from the opposite edge. Commit always equals preview. **Ben's design note (2026-07-20):** accepted for now, but the mid-gesture change of the pointer's implied responsibility is perceptually unusual — **if later user testing shows it occurring in ordinary use, the preferred calmer alternative is to hold at the minimum until mouseup and require a fresh gesture to resize from the opposite edge.**

**Ben's standing acceptance sequence** (make every step calm/predictable/responsive): create a publication · reorder spreads · shift-select · marquee · move multiple · copy/paste multiple · undo preserving selection · add text · edit long-form text · add image via placeholder · replace · crop · move image across the spread · add a shape · draw a line · snap it · edit endpoints · resize with snapping · save · reload · Review Book.

---

## 8. Decisions, key docs & baseline artifacts

- **Decisions log:** `baxter-app/decisions.md` (D-001 … D-030). Most relevant to M2: D-001 (editor is the one heavy client island), D-029 (production economics), D-030 (shipping as a separate live system).
- **Editorial Constitution:** `baxter-app/docs/editorial-constitution.md`.
- **Progress report:** `baxter-app/baxter-progress-report.md` (§22 = Slice 9).
- **M2 scope:** `baxter-app/baxter-milestone2-editor-scope.md`.
- **Spike C v2 lives entirely at** `~/Desktop/baxter-spikes/spike-c2/` (no repo footprint).
- **Review 9 accepted baseline (keep):** `~/Desktop/baxter-spikes/spike-c2-review9-snapshot-2026-07-20.zip` (source snapshot) · `review9-resize-snapping-demo.html` (demonstration player) · `review9-progress-for-chatgpt.md` (full verification report).
- **Review 10 accepted baseline (keep):** `spike-c2-review10-snapshot-2026-07-20.zip` · `cursor-audit.md` · `review10-cursor-demo.html` (the dark chip is instrumentation showing the live-sampled cursor).
- **Review 11 artifacts (awaiting review):** `longform-text-audit.md` (audit → contract → results) · `review11-longform-text-demo.html` (19-frame player; editors rendered from real caret/scroll/selection state).
- **This handoff lives in three places** — canonical: `~/Desktop/baxter-spikes/HANDOFF.md`; copies: `~/Desktop/baxter-app/HANDOFF.md` and the Vault `handoffs/2026-07-18_baxter-native-publishing-spike-c2_HANDOFF.md`. **Re-propagate the canonical copy to the other two whenever it changes.**

---

## 9. Working style with Ben

- He is a Creative Director; his feedback is precise and craft-focused. Reflect his exact vocabulary back (e.g. "the publication is the hero"). Map your work to his numbered points and acceptance checks.
- **Be honest about what's NOT done.** He values "here's what I fixed, here's what remains" over overclaiming. Name deferred items plainly. Separate real product findings from test-harness artifacts explicitly (the Review 9 report's §6 is the model).
- Deliver a **runnable link** each round (`http://localhost:5200?dev`) plus a captioned demo player when the work is visual; he reviews the recordings (often with ChatGPT) before the hands-on.
- Verify what you can via `javascript_tool` (DOM/Konva) — the feel test is his.
- Prefer **staged, reviewable passes**; get explicit approval of an approach before implementing (he'll say "go").
- Keep the prototype **throwaway and isolated**; nothing enters the production repo until the real M2.1+ build (a fresh implementation informed by the prototype, not a port).

---

## 10. First moves for the new session

1. `cd ~/Desktop/baxter-spikes/spike-c2 && npm run dev` → open `http://localhost:5200?dev`.
2. Read `src/Workspace.jsx` (the crux), then `src/App.jsx`, then `src/Properties.jsx`.
3. If Review 10 feedback exists, address it; otherwise pick up §7 item 2 (long-form text) after Ben's direction.
4. `npm run build` after changes; drive interactions via `javascript_tool` (respect the DragEngine and throttling gotchas in §1).
5. Reset state between tests: `localStorage.removeItem('baxter.spikec2.doc.v2')`.
