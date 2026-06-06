# Slice 3b — Post-Implementation Review

**Date:** 2026-06-06
**Status:** Shipped, verified in production, accepted.
**Scope of this doc:** product + architecture. Implementation detail lives in the code, `decisions.md` (D-012/13/14), and the progress report (§13–14).

---

## 1. What shipped

The creator's file-validation loop, end to end:

- **Preflight pipeline.** A file uploaded to the quarantine bucket triggers an asynchronous worker that inspects the PDF, judges it, records a verdict, and — on success — promotes it to the clean bucket. The creator sees the outcome on the publication page.
- **A binary status model** (`pending → passed | failed`) with **warnings as annotations** on a passed file rather than a third state. A file either can proceed or it cannot.
- **Blocking vs. warning checks.** Blockers (page dimensions, page-count bounds, multiple-of-four) are objective print failures. Warnings (bleed, embedded fonts, image DPI) inform but don't stop a creator who owns the trade-off.
- **A retention policy** (keep the active file + its predecessor; never delete the live passed file) so the buckets stay a working area, not an archive.
- **A result UI written to the Editorial Constitution** — situations, not software states; silence on a clean pass; a single composed acknowledgement for warnings; no liability language.

All five paths plus the retention sweep were verified in production.

---

## 2. What changed from the original plan

| Area | Plan | Shipped | Why it matters |
|---|---|---|---|
| Preflight **UI** | Slice 4 | Shipped in 3b | Slice 4 narrows to preview generation (see §5). |
| Status model | `pending / passed / warnings / failed` | `pending / passed / failed`, warnings as annotations | A publishable file is a yes/no; a "warnings" status muddied that and implied a third outcome. |
| Format rules | a `publication_formats` DB table | rules in code (`@baxter/domain`) + `format_preset_id` on the publication | Rules are logic, not data, at this stage; code is easier to evolve and test. Revisit if formats become user-editable. |
| Page count | captured at creation, then at upload | derived authoritatively by the worker | Page count is a property of the file, not a creator input. |
| Check coverage | all five checks | blockers solid; bleed/fonts best-effort; **DPI deferred** | Some checks need a heavier PDF engine than the current library — exactly the calibration the plan's Spike E anticipated. |
| Retention | unspecified | formalized (D-014) | The two-bucket model needed an explicit "what do we keep" rule. |

Net: the slice is **tighter** than planned — a cleaner status model, business rules kept as code, and honest scoping of what's detectable today.

---

## 3. Lessons learned

- **Schema migrations are the weak seam.** The only production failure was migration `0003` not being applied before the deploy — code shipped expecting columns that didn't exist. Migrations are out-of-band from the Vercel deploy, and nothing enforced that they travel together. This is the top process fix (see §4).
- **Server-controlled trust was the right call.** Preflight status is written only by the worker via the privileged client; creators have no path to mark their own file "passed." Deny-by-default on the file table made that natural.
- **Honest "undetermined" beats a confident guess.** Where a check couldn't be computed reliably, it produces no warning rather than a wrong one — which is also what the Constitution wants (silence over noise).
- **Keeping the rules pure paid off.** The judgment logic is plain, dependency-free code, so it was verified against generated PDFs without standing up storage or the worker — fast, real confidence before touching production.
- **The Constitution functioned as a spec.** The result-UI decisions were settled on paper first, so the build was deterministic and on-voice rather than improvised.
- **A note on verification ergonomics:** driving the production smoke test required manual file selection (the automation couldn't inject uploads). Fine at this scale; worth a lightweight seed/fixture path if we test uploads often.

---

## 4. Known follow-up items

- **Migration discipline** *(process, highest priority)* — make schema changes ship with the deploy that needs them (a deploy-time apply step or a pre-deploy gate), so the 3b gap can't recur.
- **Preflight calibration** — source real exports (low-DPI, non-embedded fonts), implement DPI detection, and verify the font check against real output. Promote any "warning" that reliably predicts printer rejection to a blocker.
- **Orphaned R2 test objects** — delete the six smoke-test prefixes (listed in progress report §14); the DB rows are already gone.
- **KB-aware file-size formatting** — cosmetic receipt polish; explicitly out of Slice 3b.
- **ESLint 9 flat-config migration** — pre-existing repo hygiene, unrelated to this slice; in progress.
- Pre-launch items unchanged: custom SMTP, custom domain, remaining email templates.

---

## 5. Recommendations for Slice 4

**Reframe the slice.** With preflight UI already shipped, **Slice 4 is preview & cover generation** — turning a passed PDF into the imagery the marketplace will sell with (a cover plus the first several pages). This is the visual foundation for Slice 7 (marketplace), so it should land before it.

**Product shape**
- On a clean pass, generate a cover image and a handful of preview pages; set the publication's cover and present previews on the publication page.
- Per the Constitution, the **cover gets disproportionate space** and previews should feel like *leafing through a copy*, not scanning a thumbnail grid.

**Architecture — the one big decision to make first: the image pipeline.**
- **Rasterization engine.** The current PDF library can't render to images. This needs a real renderer (headless PDF→image) plus resizing — and it must run within the serverless runtime's memory/time limits. Validate this early with a small spike on a representative file; if it doesn't fit, decide on an alternate runtime or a rendering service. This is the Slice 4 equivalent of the questions we settled before 3b.
- **Delivery.** Decide between Cloudflare Images (the original intent for derived imagery) and rendering to the clean bucket + serving directly. Pick before building so the publication/marketplace surfaces consume one source.
- **Reuse what exists.** Chain off the existing preflight worker on pass (one more durable step / event) rather than a new trigger; store output in the existing `assets` table (cover / preview-page kinds) and the publication's cover field. Avoid new infrastructure.

**Carry the 3b lessons in.** Any schema change ships with the deploy; keep derivable facts server-owned; prefer "show nothing" over a wrong artifact (e.g. a failed render shouldn't block a passed publication — surface it quietly and retry).

**Suggested approach:** a short design-questions pass (image pipeline + delivery + cover-selection UX) → decisions → build → production verify, mirroring how 3b ran.
