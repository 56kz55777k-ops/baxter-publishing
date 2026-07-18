# Baxter — Session Handoff

**For:** a new Claude Code session continuing this work.
**Written:** 2026-07-18. **Working with:** Ben Gibson (Benjamin Gibson), Creative Director / co-owner, Toronto Creatives (`info@torontocreatives.com`).

---

## 0. TL;DR — where things stand

Two parallel threads:

1. **Baxter App (the product) — Milestone 1 is SHIPPED.** A curated editorial print-production marketplace. The whole "business loop" (upload → preflight → review → publish → buy → OMS → fulfilment → commerce emails) is live in production. **One deferred item:** the EasyPost live-shipping verification, waiting on Ben's API key.

2. **Milestone 2 — Native Publishing (the in-app editor) — ACTIVE.** We are deep in an **interaction-design prototype ("Spike C v2")** that Ben reviews iteratively. The architecture is settled and praised; we are now in **precision/craftsmanship polish**. This is a **throwaway prototype**, isolated from the production repo, at `~/Desktop/baxter-spikes/spike-c2/`.

**If you're picking up the active work, it's almost certainly the Spike C v2 editor.** Jump to §5 and §7.

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
- **Browser-screenshot coordinates are unreliable.** The in-app browser (`mcp__Claude_Browser__*`) reports screenshots as "800×450" but the real viewport is larger (~1280×720). Pixel-coordinate clicks frequently miss. **Drive the prototype through JavaScript instead:** `javascript_tool` to click DOM buttons by `textContent`, or fire Konva events via `window.Konva.stages[0]`. Synthetic mouse events do **not** reliably drive Konva pointer tracking (drags come out wrong) and don't propagate React state (e.g. `shiftHeld`) in time — so test multi-select with **⌘A**, text-edit with a fired `dblclick`, etc.
- **The dev server is cleaned up between sessions** — just restart it (`npm run dev`, or `mcp__Claude_Browser__preview_start {url:"http://localhost:5200"}`).
- **Two Chrome extensions can connect** (Ben's machine + "Nik's Mac") for the *real* Baxter site / Vercel / Inngest via `claude-in-chrome`. You MUST select **Ben's** (deviceId `0c0509aa-…`) and **never** drive Nik's Mac. (The in-app `mcp__Claude_Browser` used for the localhost prototype is a separate surface — no selection needed.)
- **Credentials:** Ben pastes all secrets himself (Stripe keys, EasyPost key). **Never handle secret values**; the publishable `pk_test_` is safe to reference. Don't work around credential-classifier denials.
- Node 22, npm. No PDF CLIs (poppler/qpdf/gs) available — use JS libs (pdf-lib, pdfjs, mupdf).

---

## 2. Milestone 1 status (business loop) — SHIPPED

Slices 1–9 shipped and production-verified. Latest work = **Slice 9** (production economics + OMS + fulfilment + commerce emails).

- **Commits:** `eaead4d` (Slice 9 build) · `47e8b16` (fix: admin can begin fulfilment) · `b968804` (docs). All pushed to `main`, deployed.
- **Migrations applied to Supabase:** `0005_pricing_model.sql` (publications.interior, orders economics columns; existing rows backfilled `interior='colour'`) and `0006_shipping_details.sql` (orders shipping_carrier/service/estimated_delivery). Migrations are **hand-written and applied manually in the Supabase SQL editor** (only `0000` is in the drizzle journal).
- **Inngest resynced** — `order-paid-notify` registered on `order/paid` (D-017: manual resync required after adding functions).
- **Economics model (D-029):** `estimateProduction()` in `@baxter/domain` is the single source of truth — `retail = print cost + configurable Baxter margin (PRODUCTION_MARGIN_BPS, default 30%) + creator earnings`. Baxter earns by manufacturing, not commission, and **nothing from postage**. Buyers see retail; creators set "your earnings per copy." Test prints (creator proofs) are cost-only.
- **Non-shipping smoke test PASSED** (documented in `baxter-progress-report.md` §22). Verified: retail computes ($23.33 for the test zine), shipping fail-safe blocks checkout with **no PaymentIntent** when EasyPost is absent, admin production package renders (specs/address/economics/signed PDF), fulfilment `paid → in_fulfillment` works.
- **Production test data:** order `61694821` left in `in_fulfillment`; publication "Slice 7 Test" published; accounts `ben-in-toronto` (admin + creator), `ben2` (`baxter.press/ben2`, non-admin), `benjamin@benjamingibson.ca` (Stripe). Admin desk at `/admin`.

### DEFERRED (Milestone 1): EasyPost live-shipping verification
The shipping architecture is fully built and **fail-safe**: with no `EASYPOST_API_KEY`, `shippingConfigured()` is false, physical checkout renders a calm "ordering is briefly unavailable" screen and **creates no PaymentIntent** (a paused sale over a wrong total). Files: `apps/web/lib/shipping/{provider,easypost,index}.ts` (D-030). When Ben provides the key:
1. Add `EASYPOST_API_KEY` + ship-from origin (MGS Marketing, Toronto) to Vercel.
2. Wire the live cheapest-rate quote into checkout — needs the **address-first flow** (recompute the PaymentIntent amount after the buyer enters their address; currently `shippingMinor = 0` stub).
3. Persist the selected carrier/service/est-delivery on the order (columns exist from migration 0006) and surface on the buyer receipt, admin order page, and admin production email.
4. Verify end-to-end: rates → checkout → PI total → `paid → fulfilled → creator-earnings Stripe transfer` → the three commerce emails actually **send** (Resend live-send was deferred; `RESEND_API_KEY` is reportedly set in Vercel prod).
Ben framed this as a dedicated focused follow-up; don't hold up other work for it.

---

## 3. Milestone 2 (Native Publishing) — scope & Stage-0 spike outcomes

Scope doc: `baxter-app/baxter-milestone2-editor-scope.md`. The editor is an in-app surface where a creator **builds a publication directly** (page by page) instead of uploading a PDF. **Central insight:** the editor is a *print-ready-PDF producer* — it converges on the existing pipeline (its output is a PDF in R2 quarantine; review/marketplace/orders unchanged). It adds a new **input**, not a new pipeline.

### Stage-0 spikes (technical risks — RETIRED)
- **Spike B (canvas → print-ready PDF): WINNER = `pdf-lib` + `@pdf-lib/fontkit`.** Produces real vector PDFs with explicit MediaBox/TrimBox/BleedBox, 3 mm bleed, embedded subset fonts, **native selectable text**, real image DPI, byte-deterministic output; **passes the repo's actual preflight** (`inspectPdf` + `evaluatePreflight`) and the mupdf preview pipeline. Convergence proven end-to-end (editor scene graph → exporter → PDF → preflight PASS). **NOT PDF/X** (no OutputIntent/ICC — open item pending MGS). *(Spike B lived in the scratchpad and was wiped; its conclusions are locked and re-derivable from the transcript if code is needed again.)*
- **Spike C (canvas primitive): WINNER = `Konva` (react-konva).** Bundle ≈136 KB gzip → must be a **lazy-loaded client island** (D-001). Perf: ~2000 objects/page at ~7 ms/draw (60fps headroom well past realistic page counts).
- **Editor output decision:** *born-correct-but-still-inspected* — editor PDFs still run through preflight (one code path; they pass clean).
- **Open dependency (recorded):** **printer calibration** — MGS Marketing (Toronto) real specs: bleed, min DPI, PDF/X flavour, ICC/output-intent, **CMYK** colour. The prototype uses Baxter's current preflight thresholds and RGB as interim.

---

## 4. The interaction philosophy (LOCKED by Ben — preserve it)

> Baxter should feel like **Apple Pages meets Affinity Publisher, with the calmness, restraint and confidence of Apple's software.** Never Photoshop. Never Illustrator. Never a generic canvas editor.

- **The publication is always the hero.** As users mature they should stop thinking about *objects / layers / transforms / coordinates / selection boxes* and think about *pages / stories / photography / typography / rhythm / narrative*. "The remaining work is making Baxter disappear."
- **The spread is the editing coordinate system; pages are the printing coordinate system.** Objects move freely across the gutter and can span it; on drop they re-parent to the page their centre lands in. This matters for full-bleed / cross-gutter photography.
- **Object identity is preserved** — a text frame stays a text frame, an image frame stays an image frame; only contents/properties change.
- **The inspector is the primary editing surface** — push editing into the inspector rather than adding floating controls; keeps the workspace calm.
- **Selection is dependable** — preserved through undo/redo, editing, and tool changes where reasonable.
- **Restraint:** show information *while it helps the current action*, then remove it (anchors, guides, readouts, badges are temporary; avoid permanent chrome).
- **Editing legibility:** "The creator is the hero while creating; the publication is the hero while viewing." The in-place text editor uses high-contrast ink while editing regardless of the publication's own (possibly light) colour, then restores publication styling on exit — **without recomposing** the text (identical width/wrap/size/leading/alignment).
- **One creation language for every tool** (rect/ellipse/text/image/line): Click → anchor appears → drag → live preview → snapping/guides → release → selected → inspector available → click away to finish.

---

## 5. Spike C v2 — architecture & file map (the ACTIVE work)

Throwaway. `~/Desktop/baxter-spikes/spike-c2/src/`. Everything in **millimetres**, top-left origin relative to each page's trim. Font sizes are in **points** (converted via `PT_MM = 25.4/72` at render).

- **`model.js`** — the BOOK document model.
  - `newDoc()` → `{ meta:{name,formatPresetId,trimWidthMm:148,trimHeightMm:210,bleedMm:3,marginMm:12,safeMm:5}, pages:[…] }`. `PX_PER_MM = 3.4`.
  - Pages have `kind: 'cover' | 'interior' | 'back'` and `elements[]`.
  - Element types: `text` (x,y,width,text,fontSize[pt],lineHeight,fill,font['body'|'heading'],align,opacity,locked), `image` (…,src[dataURL],natW,natH,fit['fill'|'fit'],cropZoom,focal{x,y}), `rect` (…,fill,stroke,strokeWidth,cornerRadius,bleed), `ellipse`, `line` (x,y,width,height as start→end delta; stroke,strokeWidth). `newElement(type, {x,y})` factory.
  - `computeUnits(pages)` → view units: cover (single), interior pages paired into **spreads**, back (single); each unit `{type,pages,label,nums}`.
  - Persistence: `saveDoc`/`loadDoc`/`clearDoc` (localStorage, debounced).
- **`App.jsx`** — orchestrator. **Multi-selection model: `selIds` is an array of element ids** (across the spread).
  - History `hist` stack of `{doc, sel}`; **undo/redo restore the selection set** if still valid.
  - Object ops: `onCreate` (returns new id; images open the file picker after the frame is drawn), `moveElement` (single re-parent), `applyMoves` (batch multi-move/re-parent in one commit), `arrange` (single), `toggleLock`/`patchAll` (batch), `removeSel`, `duplicateSel`, `copySel`/`paste` (clipboard = array), `nudge` (batch). `commitEl(pageId,elId,patch)`.
  - Book ops: `insertInterior`, `duplicateUnit`, `deleteUnit` (confirm), `reorderInterior`.
  - Keyboard: `⌘A` (select all on spread), `⌘Z`/`⇧⌘Z`, `⌘D`, `⌘C/X/V`, Delete, Escape (clear + Select tool), arrows (nudge; Shift ×10), tool letters (v/h/t/i/r/l), Space (hand), Tab (Clean View).
  - `DEV = ?dev` gates developer controls. Name-on-create modal. `PROPS_W = 280`, `NAV_W = 232`.
- **`Workspace.jsx`** — the Konva editing surface (the biggest file).
  - **Spread coordinate system:** both facing pages render in one group; `pageForCentre()` re-parents an object to the page its centre lands in. Content clipped to the spread's bleed (nothing spills to the pasteboard).
  - **Multi-select:** shift-click toggles (reads App `shiftHeld`), **marquee** (drag on empty selects intersecting bboxes), **unified single/multi drag** (`drag` object: dragging any selected object moves the whole non-locked set via a shared delta; commits with `applyMoves`).
  - **Transformer:** resize handles for a single non-line object; a dashed **border only** for multi-selection; **endpoint handles** for a single line (a real vector, not a box).
  - **Creation:** click-drag rubber-band with an **anchor dot**, **live size / length·angle readout**, and **snapping**. `finishDraft` creates via `onCreate`; text enters edit mode; image opens picker.
  - **Snapping + alignment guides:** `buildTargets(exclude)` (page edges/centre/margins + every other object's edges/centre) + `bestSnap`. Applied to **creation**, **drag**, and **line-endpoint** editing. Guides (`setGuides`) render as thin oxblood lines and clear on release. `SNAP = 1.6` mm.
  - **In-place text editor:** an overlay `<textarea>` positioned/scaled to the frame (identical width/font/size/leading/align → identical wrapping), but **forced high-contrast** (dark ink `#141414`, oxblood caret, warm readable panel) while editing; underlying canvas text hidden during edit; publication styling restored on blur.
  - **Crop mode:** double-click a filled image → `cropId` set → drag pans the focal point inside the fixed frame; **Esc exits** (keeps frame selected); crop-zoom lives in the inspector.
  - Cursors per mode (currently: hand/grab, crop/grab, text, crosshair for creation, default). **Full cursor set is still TODO.**
- **`Properties.jsx`** — the inspector.
  - Branches: **page** (nothing selected — page settings), **single object** (`ObjectProps`: Position&Size or line Endpoints, then text/image/shape/line controls, Appearance opacity, Arrange, Lock), **multiple** (`MultiProps`: shared Opacity, Lock all, Delete all).
  - **Consistent control system:** `PADX=14`, `LABELW=78`, uniform 26px field height / 6px radius. Components: `Num` (min/step/**fine** sub-1 steps/**Shift-arrow** for larger), `Color` (with first-class **None**), `Select`, `Seg`, `Slider`, `Focal`, `Row`, `Head`, `Section`, `Grid2`.
  - **Stroke model:** `None` is distinct from a thin stroke; changing width activates the stroke (assigns a default colour), picking a colour assigns a default width.
- **`Navigator.jsx`** — left panel: SVG page/spread thumbnails, page numbers, selected state, **drag-to-reorder with an insertion-line indicator** (translucent source + oxblood insertion bar), Duplicate/Delete, `+ Page` / `+ Spread`.
- **`Chrome.jsx`** — `Toolbar` (title + save dot; tool group Select/Hand/Text/Image/Shape/Line + rect/ellipse chooser; editing group undo/redo/duplicate/delete + `▢ Ratio` aspect-lock toggle; **Clean View** + **Review Book**) and `StatusBar` (save state; Fit Page / Fit Spread / 100% + zoom; dev block only under `?dev`).
- **`PreviewBook.jsx`** — **Review Book**: the full-publication reader. Steps through every unit (cover → spreads → back), arrow-key + button nav, counter, exit; reuses `Workspace` in `preview` mode (read-only, no guides/handles).
- **`main.jsx`** — React entry.

**Clean View vs Review Book:** *Clean View* (Tab / toolbar) hides guides/handles on the **current spread** for a quick visual check. *Review Book* is the whole-publication **reader**. Keep them distinct.

**Convergence contract:** the editor serializes to a scene graph in the exact shape Spike B's `docToScene()` → pdf-lib exporter consumes. When the real export (M2.4) is built, editor output → PDF in R2 quarantine → the existing preflight → preview → submission → review → marketplace pipeline runs unchanged.

---

## 6. Review history (how we got here)

Ben reviews each build in detail (he often analyses screen recordings with ChatGPT). The arc:
- **Stage 0** — technical spikes; Konva + pdf-lib chosen; risks retired.
- **Pass 1** — book model, left navigator, centred workspace, tool model, calm selection, transforms, Clean View, Mac trackpad gestures, publishing language, dev-mode gate, save-status + persistence.
- **Pass 2A** — Properties inspector, in-place text editing, real local image upload + crop/fit/fill/focal, shapes (rect/ellipse/line), object lock, keyboard shortcuts.
- **Test 4** — **spread coordinate model** (cross-gutter movement), image-frame selection fix, line live-preview + endpoint handles, **Review Book** reader.
- **Review 5** — fixed the text-editing regression (a dropped `onDblClick` in the spread rewrite) + image-placeholder flow; **on-canvas crop mode**; **navigator drop indicator**.
- **Review 6** — **multi-selection & marquee** (the named milestone): shift-click, marquee, move/copy/paste/duplicate/delete together, shared inspector; plus more communicative creation (anchor + readout).
- **Review 7** — **text-editing legibility** (high-contrast editor layer); **snapping + alignment guides** for creation & dragging; crop cursor.
- **Review 8 (most recent)** — **numeric steppers** (min/step/fine/Shift-arrow; None ≠ hairline); **inspector spacing/consistency system**; **line-endpoint snapping** (live preview + guides, commit == preview).

Tone note from Ben: shorter reviews now = the editor is better, not less engagement. "The architecture is no longer the concern. Now we are tuning the instrument."

---

## 7. NEXT — prioritized (from Review 8)

1. **Snapping for RESIZE (object + image-frame).** The top remaining concrete item. Extend snapping (currently on create/drag/line-endpoints) to Transformer resizing. Tricky part: the Konva Transformer's `boundBoxFunc` boxes are in absolute/stage coordinates — you must convert to spread-mm to snap edges to the same `buildTargets`, and ensure the **release position exactly matches the previewed (snapped) position** (no post-release jump). Also cover multi-selection movement snapping (single-anchor already snaps).
2. **Full cursor set.** Distinct cursors for: selection, move, text-editing, text-frame creation, shape creation, line creation, crop, crop-drag, resize-directions, line-endpoint editing, hand/pan, marquee. The cursor should predict the action before mousedown.
3. **Very-long-form text editing.** Verify/refine: caret tracking near the frame bottom, scroll-while-selecting, Shift-selection across lines, pasting several paragraphs, undo/redo while the editor is active, clicking away after scrolling, and **no layout shift** entering/during/exiting edit mode.
4. **Final inspector consistency pass** across all object types (equivalent controls share height/radius/label spacing/typography/focus/disabled/hover). Position/dimension/endpoint fields should feel like one family.
5. **Clean View context preservation** (Review 8 #8): confirm exiting Clean View restores the exact spread, zoom, pan, selection. (Selection/zoom/unit are preserved today; check pan doesn't visually shift when the nav/inspector re-appear.)
6. **Deferred small refinements** (still non-blockers): toolbar icons, right-click context menus, drag images from Finder, larger navigator thumbnails (~+10%), resizable inspector.

**Ben's standing acceptance sequence** (he tests this each round — make every step calm/predictable/responsive): create a publication · reorder spreads with the indicator · shift-select · marquee-select · move multiple · copy/paste multiple · undo preserving selection · add text · comfortably edit long-form text · add image via placeholder · replace · crop · move image across the spread · add a shape · draw a line · snap it to nearby objects · edit its endpoints · save · reload · Review Book.

---

## 8. Decisions & key docs

- **Decisions log:** `baxter-app/decisions.md` (D-001 … D-030). Most relevant to M2: **D-001** (reader-facing is server-rendered/near-JS-free; the editor is the one heavy client island), **D-029** (production economics), **D-030** (shipping as a separate live system).
- **Editorial Constitution:** `baxter-app/docs/editorial-constitution.md` (two voices — Institutional / Editorial; three actors — Platform / Editor / Creator; restrained commerce; "an editorial office, not a moderation platform").
- **Progress report:** `baxter-app/baxter-progress-report.md` (§22 = Slice 9, the latest).
- **M2 scope:** `baxter-app/baxter-milestone2-editor-scope.md`.
- **Spike C v2 lives entirely at** `~/Desktop/baxter-spikes/spike-c2/` (no repo footprint).

---

## 9. Working style with Ben

- He is a Creative Director; his feedback is precise and craft-focused. Reflect his exact vocabulary back (e.g. "the publication is the hero"). Map your work to his numbered points and acceptance checks.
- **Be honest about what's NOT done.** He values a clear "here's what I fixed, here's what remains" over overclaiming. Name deferred items plainly.
- Deliver a **runnable link** each round (`http://localhost:5200`) and a short summary mapped to his review. Verify what you can via `javascript_tool` (DOM/Konva), then hand off for his hands-on feel test — the subjective "feel" is his to judge.
- Prefer **staged, reviewable passes** over one giant build (he chose staged early and it's worked well).
- Keep the prototype **throwaway and isolated**; nothing enters the production repo until the real M2.1+ build begins (which will be a fresh, deliberate implementation informed by this prototype, not a port of it).

---

## 10. First moves for the new session

1. `cd ~/Desktop/baxter-spikes/spike-c2 && npm run dev` → open `http://localhost:5200?dev`.
2. Read `src/Workspace.jsx` (the crux), then `src/App.jsx` (selection/ops), then `src/Properties.jsx`.
3. Pick up **§7 item 1 (resize snapping)** unless Ben directs otherwise.
4. `npm run build` after changes to catch errors; verify interactions via `javascript_tool` (fire Konva events / click DOM), not pixel clicks.
5. Reset state between tests with `localStorage.removeItem('baxter.spikec2.doc.v2')`.
