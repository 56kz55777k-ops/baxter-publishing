# Baxter — Architectural Decisions

A running record of foundational choices. Each decision states what was chosen, why, and what would force a reconsideration. Slice 1 entries.

---

## D-001 · Monorepo via Turborepo + npm workspaces

**Chosen.** `apps/web` + `packages/{db,domain,ui-tokens,eslint-config}`.

**Why.** The data model, state machines, and design tokens are not coupled to Next.js. Keeping them in their own packages lets future surfaces — an admin desktop tool, a printer-facing API, a static marketing site — pull from the same source of truth without dragging the web app along.

**What would force reconsideration.** If we never grow past one app, the monorepo overhead is paid for nothing. Acceptable cost for the optionality.

---

## D-002 · Next.js 15 (App Router) on Vercel

**Chosen.** Server Components by default, route groups for `(marketing)`, `(app)`, `(admin)`.

**Why.** Editorial pages are mostly static — Server Components let us ship almost no JS to readers. The creator surface and admin surface need server-driven mutations; Server Actions remove a layer of API plumbing for V1.

**What would force reconsideration.** If Konva or the editor canvas requires patterns that fight Server Components, we may pull the editor into its own client-only sub-route. Spike C will tell us.

---

## D-003 · Supabase Postgres + Drizzle ORM

**Chosen.** Supabase for Auth and Postgres. Drizzle as the ORM — schema in `packages/db/src/schema.ts`, migrations in `packages/db/migrations/`.

**Why.** Supabase gives us auth, row-level security, and a managed Postgres in one move. Drizzle's TypeScript-first schema means the database shape and the application types stay in lock-step without code generation drift.

**What would force reconsideration.** If RLS expressiveness becomes a wall — particularly around admin-only routes — we may fall back to service-role queries from a server layer rather than client-side RLS-bound reads.

---

## D-004 · Cloudflare R2 + Cloudflare Images

**Chosen.** R2 for raw artifacts (PDFs, source files). Cloudflare Images for derived imagery (covers, page previews, avatars).

**Why.** R2 has S3-compatible APIs with zero egress fees — important when print-ready PDFs are large and may be retrieved by printers, creators, and admins repeatedly. Cloudflare Images handles resize and delivery without us standing up Sharp/ImageMagick pipelines.

**What would force reconsideration.** If a printing partner requires a specific S3 endpoint or signed URL format that R2 cannot produce, we may keep R2 for editorial assets and add an S3 mirror for fulfillment.

---

## D-005 · Stripe Connect (Express) with separate charges + transfers

**Chosen.** Buyers pay Baxter. Funds are held until the creator marks the order `fulfilled`. Then Baxter transfers the creator's share to their Connect account, retaining the platform fee.

**Why.** The held-funds pattern protects buyers from non-delivery and protects Baxter from clawbacks. Express onboarding keeps the creator's friction low — they don't need a full Stripe account.

**What would force reconsideration.** If we move to digital-only delivery, automatic capture + immediate transfer becomes appropriate. Print needs holding; digital often does not.

---

## D-006 · Type pairing — DIN (proxy: DM Sans) × Fraunces

**Chosen.** Fraunces (variable, `opsz` 24, `SOFT` 50) for body and editorial headlines. DM Sans for shell, navigation, metadata, captions. DM Sans is the holding choice until DIN proper is licensed; the visual contract was selected from Pairing B in the type specimen exercise.

**Why.** DIN reads as architectural — correct for an editorial shell that should not perform. Fraunces' optical-size and softness axes let the body breathe at 18px / 1.65 without becoming precious; at headline sizes the softness reads as warmth rather than sweetness. The pairing carries the Composed Warmth principle.

**What would force reconsideration.** Licensing DIN is the only known unlock. The visual decision is held; only the substitute font changes.

---

## D-007 · Design tokens centralized in `packages/ui-tokens`

**Chosen.** Color, layout, motion, and type axes live in one TypeScript module. CSS variables in `globals.css` mirror them. Tailwind reads them via `var(--token)`.

**Why.** Tokens are the constitutional minimum. If they live in three places — Tailwind config, CSS, component props — they drift. One source, mirrored downward.

**Tokens locked:** `--canvas #f5f3ee`, `--ink #1a1a1a`, `--ink-soft rgba(26,26,26,.72)`, `--ink-faint rgba(26,26,26,.5)`, `--rule rgba(26,26,26,.12)`, `--accent #8a2820`. Gutter `clamp(60px, 12vw, 180px)`. Body `18px / 1.65`. Motion easing `cubic-bezier(0.22, 0.61, 0.36, 1)` at 400–600ms.

---

## D-008 · State machines as pure TypeScript

**Chosen.** `packages/domain/src/state-machines/{publications,orders}.ts`. No I/O, no React, no Drizzle. The app layer consults them before writing; the DB will eventually enforce them via triggers reading from a transition log.

**Why.** A state machine that lives only in handler code becomes a state machine that lives nowhere. Keeping it pure means we can test it in isolation, share it with admin tooling, and migrate the enforcement to the DB later without rewriting the rules.

**What's enforced today:** legal `from → to` transitions, actor authority (creator vs admin vs system), terminal states. The `fundsHeld(status)` helper centralizes the held-funds rule.

---

## D-009 · Editorial doctrine as committed source

**Chosen.** `docs/editorial-constitution.md` will be vendored into the repo from `baxter/02-emotional-tone-doctrine.md`. Component copy, error messages, and ceremonial transitions reference it in code comments.

**Why.** Atmosphere is the moat. If the doctrine lives only in a planning folder, it will be the first thing that drifts when features are added under deadline.

---

## D-010 · Comments deferred. Star ratings + written reviews only, post-purchase.

**Chosen.** The `reviews` table exists in the schema; UI is excluded from MVP. No threaded comments at any point in current scope.

**Why.** Comments are the wrong shape for this room. Reviews tied to verified purchase carry the standard the doctrine requires.

---

## D-011 · Deployment shape for Slice 1

**Chosen.** The Next.js source tarball is the canonical deliverable. A static HTML mirror of the homepage was deployed to the Slice 1 preview URL for visual review. Production Vercel deployment requires Nik's GitHub auth.

**Why.** The Computer environment cannot deploy a running Next.js app to Vercel under Nik's account without his GitHub. Mirroring the homepage as static HTML — same tokens, same fonts, same markup structure — lets the editorial atmosphere be reviewed today; full app deployment lands when Nik pushes the tarball and connects Vercel.

**The mirror is throwaway.** It exists for Slice 1 review only. All production work continues against the Next.js source.

---

## D-012 · Slice 3b preflight — status model and check severity

**Chosen.** Preflight resolves an artifact to one of three states: `pending`, `passed`, `failed`. There is no `warnings` status. A file either can proceed or it cannot.

Blocking checks (any failure ⇒ `failed`, the file cannot proceed):
- Page dimensions match the selected format (e.g. an A4 PDF in an A5 publication, or a portrait PDF in a square publication, fails).
- Page count within the selected format's permitted bounds.
- Multiple-of-four page count, where the print format requires it (e.g. saddle stitch).

Warning checks (annotations on a `passed` file; never change status):
- Image resolution below recommended print DPI.
- Fonts that may not be embedded.
- No bleed detected on pages with edge-to-edge artwork.

Warnings require acknowledgement before the creator continues, but: warnings are not a status, do not prevent passing, and are not failures. A single acknowledgement covers all warnings; the creator cannot continue until it is recorded; after acknowledgement the warnings remain attached to the file and remain visible.

**Why.** The platform blocks only on objective print failures — the things a printer literally rejects. Everything else is an artistic or production judgement that belongs to the creator. Collapsing "warnings" into a status would either gate work that is legitimately the creator's call or imply a third outcome that doesn't exist. Acknowledgement (not override) records that the creator saw the note without framing their choice as accepting a risk.

**What would force reconsideration.** If a "warning" turns out to reliably predict a printer rejection for a given format, it graduates to a blocker. The severity assignments are calibrated against real print output, not fixed.

---

## D-013 · Slice 3b preflight — result UI reads as situations, not software states

**Chosen.** The creator never sees internal status language — no "passed," "failed," "success," or "error." They encounter situations.

- **Waiting:** "File received." / "Review in progress." No percentages, no timers, no urgency.
- **Cannot proceed:** "This file cannot proceed.", then the blocking issues stated directly (e.g. "Page dimensions do not match the selected format." / "Page count must be a multiple of four."). No "failed" language, no framing preamble — the issues carry the context.
- **Can proceed, with notes:** "The file can proceed.", then each warning stated individually, then a single acknowledgement action. No liability language — no "accepted risk," "proceed anyway," "I understand," or "ignore warnings." After acknowledgement, the warnings stay visible and the primary line is unchanged.
- **Passes clean:** no success messaging at all. No banner, badge, chip, or celebratory copy. The file simply becomes the active publication file; success resolves into the normal state of the interface.

**Why.** Editorial Constitution. Success is communicated by the absence of friction, not by announcement; warnings inform rather than patronise; the work remains the hero. Exposing software states ("Success!") would make Baxter feel like a SaaS product at the most exposed moment in the upload flow. Silence on a clean pass is the deliberate, constitutional choice.

**What would force reconsideration.** If creator testing shows the silence reads as uncertainty ("did it work?") rather than calm, the clean-pass state gains the lightest possible confirmation — a single composed line — before any badge or banner is considered.

---

## D-014 · Slice 3b preflight — file promotion, retention, and cleanup

**Chosen.** Two buckets with distinct roles. `baxter-clean` holds passed files (the active file plus retained prior versions); `baxter-quarantine` is a staging area holding only `pending` and `failed` files. The lifecycle:

- **On pass:** copy the object from quarantine to `baxter-clean`, update the artifact row to point at the clean bucket and key, then delete the quarantine copy once the copy is confirmed. Clean is the single source of truth; quarantine never accumulates passed files.
- **On fail:** keep the object in quarantine with the artifact row at `failed`. The creator can re-download and inspect exactly what they sent. (Withdrawing a creator's file would be punitive — against Attention Respect.)
- **Replacement / supersession:** swept at the moment a new file is registered — synchronously, in the register/replace flow, no background job. Deleting the superseded object(s) from whichever bucket they live in and clearing their artifact rows.
- **Retention: two.** Keep the current active file plus its immediate predecessor. Older artifacts are swept on each new registration.

**The retention invariant.** "Two" counts the two most recent uploads (pass or fail), with one hard guarantee: **the latest passed artifact — the active publication file — is never swept**, even when newer failed attempts would otherwise push it past the count. So a creator who uploads a good file and then fails twice still has their good file. Concretely, keep: (a) the latest passed artifact (the active file), (b) the single artifact immediately preceding it, and (c) any in-flight `pending`/`failed` attempt newer than the active file; sweep everything else.

**Why.** A PDF is a processing file attached to a publication, not project history — there is no version-history surface today and none is planned for this slice (D-009 / data-model clarification). Retention is therefore an operational choice: enough to recover from a bad replace and to let an admin reference the prior submission during a revisions round, without turning the buckets into an archive or implying a versions feature that doesn't exist. Synchronous sweep over a cron keeps the infrastructure surface minimal until a real cleanup need appears.

**Implementation notes.** The existing `artifacts.is_canonical` flag (unused to date) can mark the active file, making "the active file" queryable and the never-sweep invariant enforceable in one predicate. Deletes should tolerate an already-absent object (idempotent) so a retried Inngest step or a partial prior failure self-heals.

**What would force reconsideration.** A creator-facing version-history feature, an admin requirement to retain every submitted artifact for audit, or print-partner rules requiring longer archival — any of which turns retention into a product feature rather than a cleanup policy, with its own slice.

---

## D-015 · Slice 4 preview & cover generation — render engine and delivery

**Chosen.** On a preflight pass, the worker rasterizes the cover (page 1) + first six pages and publishes them as public presentation images.

- **Engine: mupdf (WASM).** Renders each page cropped to its TrimBox (finished page, no bleed; falls back to full page when no TrimBox), as one ~1600w JPEG master per page. Pure, no native binaries — bundles cleanly into the Vercel/Inngest function (proven by spike: cover + 6 previews in ~0.3–0.5s, ~120 MB peak). Marked `serverExternalPackages` with its WASM traced into `/api/inngest`.
- **Delivery: Cloudflare Images** (per D-004). One master uploaded per page, **public** (`requireSignedURLs: false`); responsive sizing via account variants `cover` (1200w) / `grid` (600w) / `full` (1600w), `fit: scale-down`. The source PDF stays private in `baxter-clean`; only derived images are public.
- **Data: reuse, no migration.** One `assets` row per page (`provider='cloudflare_images'`, `kind='preview_page'`, `external_id`=image id, `meta`={page,w,h}); `publications.cover_asset_id` → page 1.
- **Pipeline shape.** A step in the existing preflight worker, not a separate trigger. Failure is **isolated** (caught + logged): a render/upload error never unmakes a passed publication — it stays passed, the cover stays absent, the sweep still runs. Re-render on replace deletes superseded images/assets first (D-014 parity).

**Why.** mupdf is the only rasterizer that fit the serverless runtime without native binaries or a separate service; the spike proved it well within limits. Cloudflare Images was already the chosen derived-imagery layer (D-004) and gives responsive variants for free — covers are the marketplace's shop window, so they deserve a real public image layer, not raw public R2. Reusing `assets` avoided a migration (the one defect in Slice 3b was an unapplied migration). Keeping generation an isolated step honours "a passed publication must never be blocked by preview work."

**What would force reconsideration.** A rasterization need mupdf can't meet (e.g. exotic PDF features) → revisit engine or add a rendering service. Heavy preview volume or a need for independent retries → promote preview generation to its own Inngest function. A creator cover-override feature → page-selection UI + a stored cover-page choice.

---

## D-016 · Slice 5 — ceremonial submission: a declaration, not a form

**Chosen.** Submission is the moment a creator declares a publication ready for review — not a place where information is gathered. This forces a **two-surface model**:

- **Surface 1 — the workspace** (the existing `/studio/publications/[id]` page). Editable; where the messy, iterative work lives (title, subtitle, description, category, price, edition, file, previews). Normal save. Used during `draft` **and** `revisions`. Marketplace info (price/description/edition) is entered here — it gets a quiet **Marketplace** section alongside the existing file/preview/metadata.
- **Surface 2 — the review** (a dedicated page; named **"Review"**, not "Submit"). **Read-only.** Shows cover, title, format, page count, preflight status, category, description, price, edition, and the review notice. **One decisive action — "Submit for review" — and no editable fields.** An "Edit publication" link returns to the workspace. The page performs review; the button performs submission.

This is the heart of the slice (the Constitution-critical surface). The earlier single-page idea was rejected: putting editable fields on the submission page makes it data-entry wearing a ceremony's clothes, forces a save-vs-submit dual action, and muddies the revisions loop. Separating editing (workspace) from declaration (review) makes the review page ask "Is this ready?" (a publishing question) rather than "What's left to fill in?" (a software question).

**Sequence:** `Draft → Review → Submitted → Under review`. On submit: `draft → in_review` via the pure state machine, recorded in `publication_events`, stamping `submitted_at`; **gated** on the canonical artifact being `passed`; an Inngest job sends the admin notification (Resend); the publication locks read-only.

**Copy (all pass the Constitution "Never" list):**
- Review notice: **"Baxter will review this publication within five business days."**
- Confirmation (poster, not a screen): large **"Submitted."** / small "Baxter will review this publication within five business days." Nothing else.
- Under-review state: title **"Under review"**, body "Baxter is reviewing this publication.", then "Submitted [date]".
- Sensitive-category notice (high-risk categories only — e.g. political campaigning, extremist advocacy, explicit sexual content, graphic violence, hate, potentially unlawful): **"Some categories require additional review. Submission does not guarantee publication."**

**Other rulings:**
- **Email provider: Resend** — modest needs (admin notification now; decision/operational emails later), simple, inexpensive, "disappears." Separate from the pre-launch custom-SMTP item (that's for Supabase auth emails).
- **Pricing: collected now**, in the workspace (price + edition). Informational until Stripe (Slice 8), but part of the publication and useful to the reviewer.
- **Tags: deferred** — `category` suffices; no tag system until discovery behaviour is understood. No migration.
- **SLA: five business days.**

**Why.** Editing and declaring are different psychological states; combining them weakens both. The two-surface model also makes the confirmation copy literally true ("Submitted." — the work was already complete) and keeps the ceremony a ceremony.

**Schema.** No migration (all fields exist: `price_minor`, `currency`, `edition_size`, `description`, `subtitle`, `submitted_at`; `in_review` in the enum; `publication_events` exists). Tags would need one — deferred.

**What would force reconsideration.** A discovery/search need that requires tags; a decision to defer pricing to post-approval; or admin-review findings that change what the review surface must show.

---

## D-017 · Inngest sync — manual, not the Vercel-native integration

**Chosen.** Keep Inngest connected manually: the `INNGEST_*` keys from the existing Toronto Creatives Inngest account ("Baxter" production env) live in Vercel, and the app serves functions at `/api/inngest`. **Do not install the Vercel Marketplace Inngest integration.** Guardrail: **when a deploy adds a *new* Inngest function, manually Resync the app** (Inngest → Apps → baxter-publishing → Resync) so it registers — folded into per-slice verification.

**Why.** The marketplace integration is "Vercel Native": it provisions and manages the `INNGEST_*` keys and, over an externally-created account on a Hobby plan, risks creating a separate Vercel-managed Inngest project and overwriting the working keys — which would disconnect the already-synced functions and break the preflight worker *and* the submission email. The recurrence cost of manual sync is ~one click, and only on the rare slice that adds a function. Surfaced when the Slice 5 email failed silently because `publication-submitted-notify` had never synced (the app's last sync was Slice 3b; nothing re-syncs on deploy).

**What would force reconsideration.** Frequent new functions, multiple deploys a day, or a deliberate migration to a Vercel-managed Inngest account — then revisit the integration, installed carefully with confirmation that it links the existing env rather than creating a new project.

---

## D-018 · Branded email — a dedicated Resend account for `baxter.press`

**Chosen.** Transactional/admin email sends from **`notifications@baxter.press`**, with `baxter.press` verified in a **new, dedicated Resend account** (created via GitHub login). That account is the **authoritative** sender for Baxter; its API key is the one in Vercel's `RESEND_API_KEY`, and `RESEND_FROM_ADDRESS=Baxter <notifications@baxter.press>`. The older Resend account (holding `resend.torontocreatives.com`, used as the interim sender in Slice 5) is **retired from this project** — its key was replaced.

**Why.** Resend's free tier verifies **one domain per account**, and the existing account already held `resend.torontocreatives.com`; adding `baxter.press` to it (and the "Create Team" path) both hit a paywall. A separate free account avoids a paid plan while giving Baxter its own brand-domain sender. DNS was added in GoDaddy: DKIM (`resend._domainkey` TXT), SPF MX (`send` → `feedback-smtp.us-east-1.amazonses.com`, pri 10), SPF TXT (`send` → `v=spf1 include:amazonses.com ~all`); GoDaddy's default `_dmarc` record sufficed, so no DMARC was added. No application code changed — the integration point (`lib/email/resend.ts`) was already env-driven from D-016/Slice 5. Verified end-to-end in production: an admin notification **Delivered** from `notifications@baxter.press` (progress report §17).

**Operational notes.**
- Beyond transactional/admin email, the same Resend account now also backs **Supabase auth email via custom SMTP** (`smtp.resend.com:465`, user `resend`, the account API key as password), sending auth mail from `Baxter <notifications@baxter.press>` — verified Delivered (progress report §18). One Resend account + one key serves both paths.
- Two Resend accounts now exist; only the `baxter.press` one is live. Future email work (decision emails, receipts) belongs in that account.

**What would force reconsideration.** Outgrowing the free tier (volume, multiple domains, team seats) → consolidate onto a paid Resend plan, at which point the two accounts could merge and the torontocreatives account be closed. A move to a different ESP would re-point `RESEND_*` env vars and the DNS records.

---

## D-019 · Slice 6 — publication state model: no `approved` or `rejected` state

**Chosen.** The publication state machine is left exactly as shipped. Slice 6 introduces **no new states, no new enum values, no migration.** The lifecycle remains:

```
draft → in_review → published
             ↘  revisions ↗  (editor returns work; creator edits and resubmits)
```

The admin has **two** decisions on an `in_review` publication:
- **Publish** — `in_review → published`.
- **Request revisions** — `in_review → revisions`, always accompanied by an editorial note.

There is deliberately **no `approved` holding state** (approval *is* publishing — the two are one act) and **no `rejected` state.** When Baxter chooses not to publish an edition, the publication moves back to `revisions` with an editorial note explaining why. A permanent decline is expressed as feedback, not as a terminal machine state.

**Why.** The editorial workflow should stay intentionally small and understandable. Publishing is **iterative, not transactional** — a work is either live or in conversation with the editor, never filed into a dead-end "rejected" bucket. Keeping the machine at its current four working states avoids inventing structure the business hasn't yet needed, and matches the D-016 spirit (submission is a declaration, review is a conversation). It also sidesteps the migration risk that bit Slice 3b.

**Approval → marketplace.** Publish sets `published` immediately, even though the marketplace (Slice 7) doesn't exist yet. The publication is genuinely live in data; it simply has no public browse surface until Slice 7 (it can surface on the creator's own `[handle]` profile in the interim). This is a slice boundary, not a gap — no backfill needed when the marketplace lands.

**What would force reconsideration.** A genuine business need to permanently turn work away *and* keep it out of the revisions loop (e.g. legal/abuse takedowns, or a curation posture where "declined" must be a durable, reportable status distinct from "in revision"). At that point a first-class `declined`/`rejected` state gets its own slice — added deliberately, with a migration, not retrofitted here.

---

## D-020 · Editorial feedback — the editor writes, the software records

**Chosen.** A foundational separation of responsibilities that applies beyond Slice 6:

- **Editorial feedback to a creator is always written manually by the editor.** It is never generated, never templated, never assembled from reason codes.
- **Reason codes are internal-only metadata.** They are never shown to creators, never transformed into creator-facing text, and never become part of the creator experience. Their purpose is analytics, reporting, operational consistency, search/filtering, and future insight into editorial trends — nothing more.

> The software records. The editor writes. Those are two different jobs.
> The creator remembers the note. The software remembers the reason code.

**Note requirements by action (V1):**
- **Publish** — editorial note **optional** (most approvals won't carry one; publishing is its own message).
- **Request revisions** — editorial note **required** (a revision without guidance is cruelty; the editor explains what should change).
- **Decline an edition** (expressed as `revisions` per D-019; a future terminal decline if it ever exists) — editorial note **required** (the editor explains why Baxter isn't publishing this edition).

**Admin-interface implication (binding on the build).** The review surface **prioritises writing over clicking.** The editorial note is the primary element — given real space, treated as prose, not a support-ticket field. Reason codes are a quiet, secondary metadata control (internal tags), never the centre of gravity. If a layout tradeoff arises, screen space goes to the note, not to dropdowns.

**Storage.** Reason-code vocabulary lives in `@baxter/domain` (versioned in git, like format presets and preflight rules); selected code ids plus the written note are recorded in the existing `publication_events.payload` jsonb — no migration.

**Why.** The creator is submitting work **to people, not to software.** Templated feedback — even well-worded — reads as automation and breaks the core illusion that matters most: that a human editor read the work. Separating the recorded metadata (codes) from the written conversation (note) lets Baxter gather operational signal without ever letting that machinery leak into what the creator reads.

**What would force reconsideration.** Editorial volume so high that hand-writing every revision note becomes untenable — at which point the answer is *more editors or saved personal snippets the editor chooses to insert*, never auto-generated creator-facing copy. The principle (editor writes, software records) does not bend; only the tooling that assists the editor's writing might.

---

## D-021 · Two voices — Institutional Voice and Editorial Voice

**Chosen.** Baxter speaks in **two distinct voices**, and the distinction is a Constitution-level principle (recorded in `docs/editorial-constitution.md`), not a Slice 6 detail.

**Institutional Voice** — belongs to Baxter the platform. It communicates **facts, never opinions.** Calm, declarative, restrained, factual. Never congratulatory, apologetic, emotional, performative, or promotional. It tells the creator what is *true*.
> "Submitted." · "Under review." · "Published." · "Baxter will review this publication within five business days."

**Editorial Voice** — belongs to the editor. It is **the only place inside Baxter where interpretation exists.** It may discuss sequencing, pacing, typography, image selection, production quality, printing concerns, editorial fit, storytelling. Still restrained and composed — but unmistakably a thoughtful human editor, not customer support and not automation.
> "The sequencing through the second half feels less resolved than the opening section. Consider whether the transition between pages twenty-two and twenty-six could be strengthened."
> "Baxter isn't able to publish this edition. The work doesn't align with the current editorial programme. Thank you for the submission."

**How they divide in the product.** System state, confirmations, notices, timing, receipts → **Institutional.** Review decisions, revision notes, decline explanations, anything carrying a human judgement about the work → **Editorial.** The existing Constitution "Never" list binds both; the Editorial Voice additionally *may* interpret, where the Institutional Voice may not.

**Why.** After a creator presses *Submit for review*, the software should largely disappear — the work is sitting on an editor's desk, because that is literally what is happening. The two-voice model is what makes that true rather than theatrical: the platform states facts plainly and gets out of the way, and the one moment of interpretation sounds like a person. This reinforces the defining feeling that a creator is engaging with an **independent publisher, not a software platform** — the same way the Editorial Constitution has guided every prior slice.

**What would force reconsideration.** None foreseen — this is intended as a durable, foundational characteristic. It should *extend* to future surfaces (decision emails, notifications, moderation, support, receipts) rather than be revisited; new outbound copy should be classified as Institutional or Editorial before it's written.

---

## Open Decisions (deferred to later slices)

- **Editor canvas** — Konva/react-konva proven against a single-page layout. Spike C.
- **Inngest topology** — which workflows are durable steps vs server actions vs cron. Slice 5–6.
- **DIN licensing** — when to pull DM Sans and license real DIN. After Slice 4 ship.
- **Preview lifecycle on publication delete** — orphaned Cloudflare images / clean-bucket objects aren't swept on publication deletion (only on re-render). Add a cleanup path if it matters pre-launch.

*(Resolved: "PDF rendering pipeline" — settled by D-015 (mupdf + Cloudflare Images).)*
