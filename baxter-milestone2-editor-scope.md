# Baxter — Milestone 2: Native Publishing (scoping note)

**Date:** 2026-07-02
**From:** Claude Code (paired with Ben Gibson)
**Status:** **Scoping only — not scheduled, not committed to build.** This captures the canvas editor as the next major body of work *after* the business loop (Slices 8–10) closes, so the shape and the open questions are on record before we commit.

> **The milestone is *Native Publishing*, not just "the editor."** Native publishing means creating publications *inside* Baxter rather than uploading finished files. The **canvas editor is its first expression** — and over time the milestone is likely to grow to include document templates, layout systems, typography, asset management, collaborative editing, version history, AI-assisted publishing, and further creation workflows. "Editor" was too narrow a name; "Native Publishing" captures the long-term direction while remaining accurate today. This note scopes the canvas editor as the entry point into that milestone. *(The filename retains "editor" for link stability; the milestone's name is Native Publishing.)*

---

## 1. What this is

The **canvas editor** — the first capability of Native Publishing — is the in-app surface where a creator *builds a publication directly*: page by page, placing text and images on a canvas at the chosen trim size, instead of uploading a print-ready PDF. It is the "**or build directly in the editor**" half of the promise already on the homepage/about page.

It is **not** one of the ten business-loop slices, by original design (implementation plan §7: *"Studio editor as a real product surface — guarded `/studio/editor` route stub only"*; plan intro: *"Editor work happens in parallel as a guarded prototype route"*). It is the **single largest unbuilt surface** in Baxter, and it carries **two unresolved technical decisions**. Hence its own milestone.

---

## 2. The architectural framing that bounds it (the key insight)

The editor is, fundamentally, **a print-ready-PDF producer.** Everything downstream of "a PDF exists in R2" already works: preflight (Slice 3b), cover + preview generation (Slice 4), the submission ceremony (Slice 5), editorial review (Slice 6), and the marketplace (Slice 7) all consume a publication whose artifact is a PDF in the clean bucket.

So the editor **converges on the existing pipeline.** Its output is a PDF that lands in R2 quarantine exactly like an upload does, and the rest of the system runs unchanged. This is what keeps the milestone bounded: **the editor adds a new *input*, not a new *pipeline*.** It does not touch review, marketplace, orders, or fulfillment.

That single convergence point is also the milestone's central risk (Spike B): can we render a canvas to a genuinely print-ready PDF — correct trim, bleed, embedded fonts, image resolution — reliably and server-side?

---

## 3. Run the two spikes first (already in the plan)

These are prerequisites, not product slices. They settle the two open technical decisions before any editor UI is built.

- **Spike C — Konva editor PoC** *(plan §6)*. Validate the **feel of snapping** — the brief specifies *"soft and supportive, not rigid."* That's a feel question only a working prototype answers. Outcome: is **Konva** the right canvas primitive, or should we look at **Fabric**, **raw SVG**, or the **tldraw SDK**? (Decision `D-001` flags that a canvas may need to break the Server-Component default and live in a client-only sub-route — the spike confirms.)
- **Spike B — output pipeline** *(plan §6, "sets the entire Studio editor's output pipeline")*. Test how a canvas becomes a print-ready PDF: **DocRaptor (HTML→PDF)** vs **react-pdf** vs a **headless-render** approach vs the **canvas library's own PDF export**. The winner must produce correct trim + bleed + embedded fonts and pass the existing preflight checks. Run against a real printer's requirements.

**Nothing else in this milestone should start until B and C have answers.**

---

## 4. Open decisions (to settle in/after the spikes)

1. **Canvas primitive** — Konva vs Fabric vs SVG vs tldraw (Spike C).
2. **Output pipeline** — canvas → print-ready PDF (Spike B). Correct trim/bleed/embedded fonts is the bar.
3. **Does editor output go through preflight?** The editor can guarantee dimensions, page count, multiple-of-four, and bleed *by construction* — so blocking checks may be moot. But placed low-DPI images could still warrant a warning. Decision: **born-correct-but-still-inspected** (run preflight, expect it to pass, keep the DPI/font warnings) vs **trusted** (skip preflight for editor artifacts). Leaning born-correct-but-still-inspected — it reuses Slice 3b unchanged and keeps one code path.
4. **Client-only sub-route** (`D-001`) — the editor is heavy client JS and almost certainly its own client island, a deliberate exception to the Server-Component default. Confirm and isolate it so it can't leak bundle weight into the reader-facing marketplace.
5. **Document model + persistence** — the editor needs a saved scene graph (a JSON model of pages/blocks). Where does it live: a new `editor_documents` table, a JSONB column on `publications`, or a JSON object in R2? Plus autosave cadence and conflict handling.
6. **Editor assets** — creator-uploaded images for placement, distinct from the generated cover/previews. The `assets` schema comment already anticipates *"editor assets later."* Needs an asset library UI + R2 storage + the image-resolution warning surfaced at placement time.
7. **Fonts** — which fonts a creator may set in their own layouts (a curated Baxter-blessed set vs open), and the **DIN licensing** question (`D-003`: *"when to pull DM Sans and license real DIN"*). Embedding licensed fonts into exported PDFs has licensing implications.
8. **Mobile** — plan §7: a graceful *"open on desktop"* message, not a responsive editor.
9. **Templates / starting points** — do creators start from a blank trim, or format-specific starter templates? (Deferrable to a later sub-slice.)

---

## 5. Rough slice breakdown (indicative — re-sliced after the spikes)

> Numbered M2.x to keep them distinct from the business-loop slices. Sizes are guesses until the spikes land.

- **M2.0 — Spikes B + C.** Settle canvas primitive + output pipeline. *(Prerequisite.)*
- **M2.1 — Editor shell + single-page canvas.** `/studio/editor/[id]` (client island), one page at the publication's trim size, pan/zoom, the "soft" snapping feel, page margins/bleed guides. Reads the format preset from `@baxter/domain`.
- **M2.2 — Text + image blocks.** Place/edit text (the Fraunces/DM Sans type system), place images (upload → R2 editor assets), move/resize/snap, z-order. Image-resolution warning at placement.
- **M2.3 — Multi-page + document model.** Add/remove/reorder pages; the multiple-of-four constraint surfaced live; the persisted scene-graph model + autosave (decision #5).
- **M2.4 — Export to print-ready PDF (the convergence).** Render the document to a PDF (Spike B winner) with correct trim/bleed/embedded fonts; land it in R2 quarantine so the **existing** preflight → preview pipeline takes over. This is where the editor meets everything already built.
- **M2.5 — Asset library + polish.** Manage uploaded assets; editor empty/loading states in Constitution voice; the "open on desktop" mobile message.
- **M2.6 — Templates (optional).** Format-specific starting points.

After M2.4, an editor-built publication flows through submission → review → marketplace with **zero changes** to those surfaces — the payoff of the convergence framing.

---

## 6. Constitution considerations

- **The Creator is the protagonist (D-024).** The editor is *the* creator tool — it must feel like a considered instrument, not a SaaS builder. "Soft and supportive, not rigid" is the explicit feel target.
- **The one heavy client surface.** Everything reader-facing is server-rendered and near-JS-free (D-001). The editor is the deliberate exception; keep it walled off so it never taxes the marketplace.
- **Two voices still apply.** The editor's own chrome/state is Institutional; there's no Editorial voice inside a creator's own workspace (the editor isn't Baxter speaking — it's the creator working).

---

## 7. Dependencies / what must be true first

- **The business loop should close first** (Slices 8–10): Stripe, OMS, full-loop smoke test. The editor is worth nothing until a publication can be *bought and fulfilled*; finishing the loop on upload-only publications is the higher priority.
- **Spikes B and C** are the gate into M2.1+.
- **The homepage/about copy gap** (*"or build directly in the editor"*) should be reconciled before public launch — either this milestone ships, or that line is softened so the promise stays honest (Constitution).

---

## 8. Status and next step

**Not scheduled, not committed.** This note exists so Milestone 2 — Native Publishing (beginning with the canvas editor) is captured as the next major body of work after the business loop, with its shape and open questions on record.

**Next concrete step, when we get here:** run **Spike C** (Konva/canvas feel) and **Spike B** (canvas → print-ready PDF), then convert this note into a proper design-questions brief and a firm slice plan — the same way Slices 6 and 7 were designed before they were built.
