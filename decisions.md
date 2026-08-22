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

## D-022 · Slice 7 — the marketplace front door and publication URL

**Chosen.** The homepage **becomes the front door to the marketplace** — not a separate marketing page, and not an e-commerce storefront. Baxter's **opening statement remains** at the top (it establishes tone and identity); the published work simply **begins beneath it**. The sequence is deliberate: *you first understand where you are, then you begin looking at the work* — entering a quiet independent bookstore or gallery, not landing on a shop.

Public publication URL is locked as **`/[handle]/[slug]`** — a work lives at an address nested under its creator.

**Why.** A marketplace whose homepage hides the work behind a marketing page inverts Platform Humility; a homepage that opens as a storefront inverts Attention Respect. The opening-statement-then-work sequence holds both: identity first, then the work leads. The nested URL reinforces that **the creator is the primary author** and Baxter is the publisher/curator — the creator's name is part of the address, like a book spine, and matches the schema (`publications.slug`, unique per creator; the homepage already promises "when published, it lives at its own address").

**Notes.** The current marketing prose is distilled to the held opening line; longer prose (premise, for-creators, for-readers) moves to a quiet `/about` if kept at all. Requires confirming `slug` is populated at creation (schema `notNull`).

**What would force reconsideration.** A future need for a true landing/marketing page (campaigns, SEO) separate from the shelf — at which point marketing lives at its own route and `/` stays the shelf.

---

## D-023 · Marketplace — price is quiet metadata (remove performative commerce, not commerce)

**Chosen.** Price **appears** in the publication grid — reversing the initial instinct to hide it — but only as the **quietest element** of the card. A publication card is exactly four lines, in strict visual hierarchy:

1. **Cover** (the protagonist)
2. **Title**
3. **Creator**
4. **Price** — quietest of all

Nothing else. No badges, no "From…", no discount or sale language, no "Buy now"/CTA, no urgency, no availability messaging. Price is presented **like page count or edition size — information, not persuasion**. A visitor notices the work, then the name, then the price only if they care to look.

**Why.** Collectors don't browse like impulse shoppers. Price is part of *evaluating* a work — is this within today's budget, an accessible edition, a significant purchase, worth investigating further — and hiding it creates friction, not restraint. **Price transparency is not commerce-forward design.** Galleries, luxury retail, and auction houses show prices quietly *because transparency builds confidence*. The problem was never showing price; the problem is making price **perform**. The Baxter principle: **we remove performative commerce, not commerce.** The publication stays the protagonist; price simply helps the visitor understand the work.

**Applies to.** The grid/card (this decision), and consistently the publication page (price shown plainly, no cart theatre — see the Slice 7 build). The transaction itself is Slice 8; until then any purchase affordance is a single honest Institutional line, never a button pretending to work.

**What would force reconsideration.** None on the principle. Presentation may refine (exact weight/placement of the price line) once real covers populate the grid, but price stays the quietest line and never gains persuasion.

---

## D-024 · The three actors — Platform, Editor, Creator

**Chosen.** Baxter has **three distinct actors**, and the product must reinforce their separation rather than blur it. This extends the two-voice model (D-021) by naming the Creator as the third — and the protagonist.

- **The Platform — Institutional Voice.** Factual, calm, invisible. States what is true and gets out of the way. Owns system state, the marketplace chrome, prices/specs as facts.
- **The Editor — Editorial Voice.** Human judgement and curation; the only place interpretation lives. Owns review notes and **Editor's Picks**.
- **The Creator — the protagonist.** Always the primary author. The work leads; every publication page ultimately belongs to the creator.

Mapped to Slice 7 surfaces: **the homepage is Baxter's institutional voice**; **Editor's Picks represents the editor's judgement**; **every publication page ultimately belongs to the creator** (nested at `/[handle]/[slug]`, D-022). Protect that separation as each surface is built.

**Why.** The whole feeling Baxter protects — engaging with an independent publishing house, not a software platform — depends on these roles staying legible. Blur them (the platform editorializing, the editor's picks reading as "staff faves" merchandising, the creator demoted beneath Baxter's brand) and the illusion collapses. Naming the actors makes every surface answerable to "whose voice is this, and does the creator still lead?"

**What would force reconsideration.** None foreseen — foundational, like D-021. New surfaces should be classified by actor before they're designed.

---

## D-025 · The homepage is a curated composition, not a feed

**Chosen.** The homepage is understood — and architected — as an **editorial composition ("an issue")**, not a chronological listing of published works. It is a *composed*, ordered set of **sections**, each an editorial act with its own source and heading, not a single query rendered as a grid.

Slice 7 ships two sections (**Editor's Picks**, **New Releases**) beneath the opening statement, plus a quiet "All publications" link. But the architecture treats the page as `opening statement → [ordered sections] → footer`, where a section is a typed block (`kind`, heading, works/content). Future sections — seasonal selections, essays, featured creators, collections — slot in as new kinds and new renderers **without** restructuring the page or assuming chronology.

**Concretely (the seam to preserve):** a `composeHome()`-style function returns an ordered `HomeSection[]`; the page maps over it and renders each via a section component; a shared card/grid renders any work-bearing section. No code path may hardcode "the homepage = published-ordered-by-date." Editor's Picks is sourced by `editor_pick_at desc` (D-023 storage), which is a **timeline**, not a flag — it already supports future "Recently selected / Current / Past picks" views with no schema change.

**Two principles this locks in (Constitution):**
- **No fictional signals.** Baxter never surfaces a signal it cannot honestly measure. "Popular" is not built until it means something objectively *earned* (real orders/behaviour) — never a rename of "recent," "featured," or "selected." Recency and curation are honest; popularity-without-data is not.
- **Browse before search.** A small catalogue should invite *browsing* (discovery — Baxter's job), not *searching* (which presumes the visitor already knows what they want). Search arrives only when the catalogue is too large to browse comfortably. Until then, don't optimise for the wrong behaviour.

**Why.** Baxter is a publishing house; a publishing house composes issues, it doesn't paginate a feed. Building the homepage as a generic chronological list now would bake in an assumption that every future editorial section would have to fight. The composition seam is cheap today and keeps the door open to the editorial surfaces Baxter is clearly heading toward.

**What would force reconsideration.** None on the principle. The set of section *kinds* grows over time; the composition model is the durable part.

---

## D-026 · Payments — held funds via separate charges and transfers

**Chosen.** The buyer's PaymentIntent is charged to **Baxter's platform account** with **no** `transfer_data`/`application_fee_amount`. Funds are held in Baxter's balance from `paid` through `in_fulfillment`; the creator's payout (`creatorPayoutMinor = total − platformFee`) is a **separate Stripe Transfer** created at **fulfilment** (Slice 9), recorded in `orders.stripe_transfer_id`. Baxter keeps `platformFeeMinor`.

**Why.** This is what the shipped schema and order state machine already encode: a nullable `stripe_transfer_id` *separate* from `stripe_payment_intent_id`, `platformFeeMinor`, the held-funds transitions, and `fundsHeld()` ("Baxter holds funds from paid through in_fulfillment; release the transfer when the creator marks fulfilled"). The implementation plan's Slice 8 line mentioning `application_fee_amount` describes a **destination charge**, which transfers to the creator *at payment time* — that would break held funds (a creator could be paid before fulfilling, and pre-fulfilment cancellations would require clawing funds back). The schema is the source of truth; the plan line is superseded. This is a plan-vs-schema reconciliation, not a blocking conflict (the schema told us exactly what to build).

**Implications for Slice 9.** Fulfilment creates the Transfer (needs the connected account's `transfers` capability, requested at onboarding); post-fulfilment refunds require reversing that transfer; the connected account never touches the buyer's card.

**What would force reconsideration.** A need for instant creator payout (no holding period) or Stripe-managed negative-balance protection → revisit destination charges, at the cost of the held-funds guarantees.

---

## D-027 · Checkout is Baxter-hosted (Payment Element), one question per screen

**Chosen.** Checkout is **Baxter-hosted** using the **Stripe Payment Element** (embedded), not Stripe's hosted Checkout page. The buy flow is split so each screen answers exactly one question: the **publication page** asks *"would you like to own this?"* (the "Own this publication" action), **checkout** asks *"how will you pay?"* (address + Payment Element), and the **order page** answers *"what happens next?"*.

**Why.** Keeping payment inside Baxter preserves the publishing atmosphere at the most commerce-exposed moment, rather than bouncing to a Stripe-branded page. It also lets the one-question-per-screen discipline (see the Constitution) hold through commerce. The Payment Element keeps card data in Stripe's iframe (SAQ-A scope) while Baxter controls layout and voice, styled to the Baxter palette. Commerce is present but never performs (D-023): no cart, no upsell, no urgency, no disabled-button theatre.

**What would force reconsideration.** PCI/compliance needs that favour full redirect, or a payment-method mix the Payment Element can't present well → reconsider hosted Checkout (still restrained, but Stripe-branded).

---

## D-028 · Pricing — Baxter earns by manufacturing, not by commission

**Chosen.** Baxter's revenue model is reframed. Baxter is a **publishing and print-production platform**, not a marketplace that taxes creators. The flat 10% platform fee (Slice 8) is **removed entirely**. Retail is built up from production:

```
Retail = Print cost  +  Baxter production margin  +  Creator earnings per copy
```

- **Baxter production margin** = a **configurable** percentage of print cost (starts at **30%**, consumed from config — never hard-coded). This is Baxter's only revenue: it is earned on manufacturing, not skimmed from the creator.
- **Creator earnings per copy** — what the creator sets. They never think in retail price; they answer one question: *"How much would you like to earn from each sale?"* The retail price is **computed** and shown to them for approval, and is **never stored on the publication** (it's derived; it moves if rates change).
- **Naming:** "**Your earnings per copy**" — plain English, not "royalty" (publishing jargon). A creator instinctively knows what "$18 per copy" means.
- **Transparency:** the creator sees the **full breakdown** (estimated print cost → Baxter production → your earnings → estimated retail), because transparency is the point — Baxter earns visibly through production, never through hidden commission.
- **Creator test prints are charged at production cost only** (print + shipping) — **no creator earnings and no Baxter production margin.** Baxter earns when creators *sell* books, not when they're perfecting them (D-030 covers the mechanics).

**Money flow (Stripe architecture unchanged — D-026 held funds).** The buyer pays retail (held on the platform account). At fulfilment, Baxter transfers **the creator's earnings** to their connected account (not "total − fee"), keeps the **production margin** as revenue, and pays the printer the **print cost** out of the held balance. One payment, held, transfer at fulfilment — exactly as built; only the *amounts* change.

**Why.** A commission model ("we take 10% of what you set") frames Baxter as extracting from artists and — critically — never covers the cost of actually printing, so Baxter would lose money fulfilling. Building retail up from production instead means the **buyer pays for production**, the **creator keeps 100% of their earnings**, and **Baxter profits from the service it genuinely provides** (manufacturing books). It is a healthier long-term identity and it is economically correct for print-on-demand.

**What would force reconsideration.** A future non-print (purely digital) product where there's nothing to manufacture — that needs its own revenue treatment (a digital-delivery fee or a different split), decided when it arrives.

---

## D-029 · The print estimator — one service, the single source of truth

**Chosen.** All print economics live in **exactly one place**: a pure `estimatePrintCost()` service in `@baxter/domain`. Every surface — publication page, checkout, orders, admin fulfilment, creator workspace, emails, Stripe transfers, analytics — **consumes** it. There is **no duplicated pricing math anywhere.**

```
estimatePrintCost({ formatPresetId, pageCount, interior, binding, paperStock, quantity, creatorEarningsMinor })
  → { printCostMinor, baxterMarginMinor, creatorEarningsMinor, retailMinor, breakdown }
```

- **Interior (Black & White / Colour) is an EXPLICIT publication property** — set by the creator at creation, stored on the publication, and authoritative for both the estimator and the printer. It is **never inferred** from the publication's format/type (a photobook can be B&W; a zine can be colour). (Migration: add `interior` to publications; add the field to the creation form.)
- **Binding + paper stock** resolve from the format preset defaults (D-028's rate card) — with room for a per-order admin override later.
- **The rate card is configurable data** — placeholder CAD short-run values now (see below), swapped wholesale for **MGS Marketing Toronto**'s real rate sheet later, with no code change to the estimator or its consumers.
- **The estimate is never a promise.** Every surface reads **"Estimated production cost."** The printer's invoice remains the source of truth.

**Placeholder rate card (CAD, per copy, on-demand/short-run — calibrate to MGS).** `printCost = base + pageCount × perPageRate`:

| Format | Binding | Default paper | Base | Per page (mono / colour) |
|---|---|---|---|---|
| A5 Zine | Saddle-stitch | 80lb uncoated text · 100lb cover | $2.50 | $0.04 / $0.20 |
| A4 Magazine | Saddle-stitch | 100lb coated text · 120lb cover | $3.00 | $0.06 / $0.22 |
| Square Photobook 210 | Perfect-bound | 100lb coated art · 12pt cover | $5.50 | $0.10 / $0.42 |

Grounded in POD base+per-page formulas (KDP ≈ $1.00 + $0.012/pg; colour ≈ $0.04–0.08/pg) and local short-run rates ($2.50–9/copy; coated/square premiums). Sanity: 8pp mono zine → $2.82; 32pp colour magazine → $10.04; 60pp colour photobook → $30.70.

**Data model.** `publications`: reinterpret `price_minor` as **creator earnings per copy** + add **`interior`**. `orders` (snapshot at purchase, immutable): add **`print_cost_minor`** and **`creator_earnings_minor`**; repurpose **`platform_fee_minor` → Baxter production margin**; `total_minor` = retail. The fulfilment transfer amount is `creator_earnings_minor`.

**Why.** Print economics touch a dozen surfaces; if any of them re-derived the math, they would drift. One service means the publication page, the receipt, the admin package, and the Stripe transfer can never disagree, and recalibrating to the real printer is a one-file change. Making interior explicit (not inferred) guarantees the estimator and the printer always have authoritative data.

**What would force reconsideration.** Volume/quantity tiers (add a quantity curve to the estimator); a printer whose pricing isn't base+per-page (re-model inside the one service — consumers unaffected).

---

## D-030 · Shipping — a separate logistics system, live via an aggregator, pass-through

**Chosen.** Shipping is a **third, distinct system**, cleanly separated from production (D-029) and commerce. Three responsibilities:
- **Production** (`estimateProduction`, `@baxter/domain`, pure): print cost, margin, earnings, retail — **and the physical parcel** (estimated weight + dimensions, derived from trim/pages/paper/cover/binding).
- **Commerce** (checkout/orders/Stripe): `total = retail + shipping`; held funds; the fulfilment transfer.
- **Logistics** (a `ShippingProvider` abstraction): **live** carrier quotes at checkout.

Rulings:
- **No placeholder shipping tiers.** Shipping is quoted **live** from real carrier rates, never estimated by Baxter. Carriers already compute postage perfectly; a Baxter shipping estimator would be code with a built-in expiry date.
- **A `ShippingProvider` interface from day one** (minimal first implementation is fine): `quoteShipping({ from, to, parcel }) → [{ carrier, service, amountMinor, currency, estimatedDeliveryDays }]`. The checkout consumes the interface; only the provider changes.
- **Target an aggregator — EasyPost** (Shippo fallback), not a direct Canada Post/UPS integration. Baxter is a platform and will support many carriers (Canada Post, UPS, Purolator, FedEx, DHL, international) behind one API — the same reasoning as Stripe over Visa. EasyPost: one API, 100+ carriers incl. Canada Post; rating takes from/to addresses + parcel weight (oz) + dims (in), so the provider adapts the estimator's metric weight/dims.
- **Computed at checkout, after the address.** Retail shows on the publication page; once the buyer enters the delivery address, the provider returns live quotes and the chosen rate is added to the total. The estimator's `estimatedWeight`/`parcelDimensions` are the inputs.
- **Pass-through — Baxter earns nothing on postage.** `shipping = the carrier's actual rate`, no markup, no handling fee. A fulfilment fee, if ever, is a separate future conversation.
- **Origin** = the printer's ship-from address (MGS Toronto when formalised; a configured Toronto origin until then). Env-driven (`EASYPOST_API_KEY`), degrades gracefully without a key (like Stripe/Resend).

**Why.** Print cost is Baxter's to model (it owns production); shipping is the carriers' to compute (they own the rate tables). Keeping them separate — and quoting live rather than faking tiers — means the checkout is carrier-agnostic forever: adding UPS/Purolator/FedEx later is a provider change, not a checkout change. Pass-through postage keeps logistics transparent and separate from Baxter's production revenue (extends D-028: Baxter earns by manufacturing, *and not from postage either*).

**Implications.** Checkout becomes **address-first**: collect the delivery address → quote shipping → finalise `total = retail + shipping` → charge. The Stripe PaymentIntent amount is set/updated *after* the shipping quote (Slice 8 created it upfront for retail-only). Needs an EasyPost account/key + a ship-from origin before going live in production.

**What would force reconsideration.** The printer drop-ships and bundles postage into its invoice → use the printer's shipping rate behind the same `ShippingProvider` interface (a different provider). Moving off EasyPost → swap the provider; checkout unchanged.

---

## D-031 — Editor document persistence: `editor_documents` + integer-revision concurrency

**Chosen.** Native Publishing documents live in a new `editor_documents` table (migration 0007, hand-written per house convention): one row per publication — `doc` jsonb (the scene graph, self-describing via an internal `schemaVersion`), a `schema_version` column mirror derived server-side, an integer `revision` for optimistic concurrency, DB-stamped `updated_at`, `updated_by`, and diagnostics-only `autosave_state`. Saves are conditional (`UPDATE … WHERE revision = base`); zero rows updated is a 409 carrying the server revision — **first write wins, the loser is told immediately and goes read-only until reload. Never last-write-wins, no merge, no CRDT.** RLS mirrors `publications_update_own_draft` exactly (creators write only in draft/revisions; no client DELETE; admin via the guarded service-role pattern). The doc shape is validated by zod in `@baxter/domain` (`editor/document.ts`) on every server write and on every client load; migrations are forward-only and unknown versions are rejected, never guessed. Format presets gained editor `layout` defaults (margin/safe): **zine_a5 12/5 (the Spike C v2 accepted values); A4 15/6 and square 14/6 are PROVISIONAL pending Ben's confirmation.**

**Why.** The `publications` row is contended (marketplace saves, admin status transitions, audit events) and carries no concurrency column; a separate table isolates a high-frequency autosave stream, owns its revision, and stays additive. jsonb (not a column on publications, not R2 JSON) keeps RLS, queryability, and atomic conditional writes. Two tabs are trivially easy to open — the revision guard makes the failure loud and calm instead of silently destructive.

**Implications.** The editor route (`/studio/editor/[id]`, `(editor)` route group, lazy `ssr:false` island) is the only consumer; Konva lives in the island chunk only, enforced by `apps/web/scripts/bundle-budget.mjs` in CI (shared First-Load may grow ≤1 kB over the recorded pre-editor baseline). The drizzle schema documents the table; the journal stays untouched.

**What would force reconsideration.** Real collaborative editing (per-op sync) — a different architecture, explicitly out of scope; or fleet-migration pain at scale pushing `schemaVersion` handling from load-time to batch jobs.

---

## D-032 — Production availability: the Supabase auto-pause incident and the operations accounts

**What happened (operational record, 2026-08-03).** During Slice A verification, production sign-in failed with a network-class error rather than an auth error. Investigation in the Supabase dashboard found the production project `baxter-publishing` (ref `qnqbkihndxppommgfrxd`) **paused** — Supabase pauses free-plan projects after inactivity — with usage at zero for the billing cycle. The deployed site had been serving shell pages with silently failing data for an unknown period (last deploy-era activity ~Jul 13). Identity was proven operationally, not assumed: with a deliberately wrong login, production returned the generic failure while paused and flipped to "That email and password do not match" at the exact moment the project was resumed; `/publications` began rendering data again at the same moment. Ben resumed the project; the outage ended.

**Where things live (as observed in this session, no ownership claims beyond observation).** Supabase: project `baxter-publishing` under org "56kz55777k-ops's Org" (a second org, "Toronto Creatives", holds the unrelated `tea-squared-trade-portal`). GitHub: `56kz55777k-ops/baxter-publishing` (public), `gh` authenticated as `56kz55777k-ops`. Vercel: the PR integration reports deployments under team `benjamin-baxter`, project `baxter-publishing-web`. GitHub Actions: workflow registered and active, but the account creates no runs across qualifying events — the pattern of an account-level Actions verification hold; visible only in the GitHub UI.

**Chosen.** Record the incident and the account map; treat "production must not silently pause again" as a REQUIRED outcome with the mechanism an **open decision for Ben**: upgrade the Supabase project to Pro (removes auto-pause), or add an uptime probe against a data-backed endpoint (e.g. a scheduled check that `/publications` renders rows), or both.

**Why.** A paused database behind a healthy-looking static shell is the worst failure shape: no error page, no alert, quietly empty. Discovery was accidental (a slice verification), not operational.

**Implications.** Until the open decision is made, any quiet week can pause production again. The GitHub Actions hold also blocks hosted CI (local battery + Vercel checks remain the working gates).

**What would force reconsideration.** Moving off the free plan resolves the pause class entirely; consolidating the split Vercel/GitHub identities would simplify the account map but is Ben's call, not an engineering requirement.

---

## D-033 — Publication bleed: ⅛ inch (3.175 mm) per applicable edge, profile-owned, safe kept separate

**Status: RULING ACCEPTED by Ben, 2026-08-19; IMPLEMENTATION ACCEPTED by Ben, 2026-08-22**, after verification including typecheck, lint, 111 unit tests, preflight harness 6/6, production build, bundle budget, hosted CI `success`, and Vercel preview `success` — zero shared-bundle impact, no schema or persistence change. The two acceptances are separate events and are not to be collapsed. **PR #2 was open and unmerged when this was written; merging is Ben's.**

**Chosen.** The "quarter-inch bleed" reported from Baxter's printing partners is formally interpreted as **¼ inch added to each full page dimension** — i.e. **⅛ in / 0.125 in / 3.175 mm / 9 pt of bleed per applicable edge**, measured outward from trim. The rejected reading is ~~0.25 in / 6.35 mm per edge~~. A 6 × 9 in page bleeding on all four edges occupies **6.25 × 9.25 in**. `0.25 in` is never encoded as a per-edge value.

All three format presets and the inngest generic-rules fallback move from `bleedMm: 3` to `3.175`, derived in code from `GENERIC_PUBLICATION_BLEED_IN = 0.125` so the imperial origin stays visible (`0.125 × 25.4 === 3.175` and `0.125 × 72 === 9` are both exact in IEEE-754 — 25.4/8 and 72/8 are exact binary scalings).

**Unit rule, binding.** 3 mm and 3.175 mm are industry synonyms in prose — Adobe itself writes *"0.125 inches (3 mm)"* — but they are 0.175 mm apart and must never be silently substituted. The generic profile uses the exact imperial-derived 3.175 mm; a future printer profile must remain able to state a true 3.0 mm requirement. `bleedMm` stays a plain number for exactly that reason.

**Why.** An independent adversarial verification of the print-geometry research surveyed 13 book, magazine and publication printers from primary spec pages (Bookmobile, Friesens, Sheridan, Sheridan Random Lake, Mixam, Lulu, Amazon KDP, IngramSpark/Lightning Source, PrintNinja, Smartpress, BookBaby, Blurb, 48 Hour Books, Gorham). Findings: **0.125 in / ~3 mm per edge is dominant; no surveyed book or magazine specification required 0.25 in per edge** (the only 0.25-in-per-edge bleed found anywhere was Smartpress large-format signage). Where "0.25 inch" appears in publication literature it means **total dimensional increase** (Lulu: *"Page size must be 0.25 in larger in both width and height — a 6 × 9 in book requires a PDF with pages sized 6.25 × 9.25 in"*) or the **internal safe area** (Sheridan, Mixam, KDP cover, IngramSpark cover). Ben confirmed the total-dimensional interpretation was the intended premise.

**Architectural consequences recorded now, built later.**
- **Bleed is per-edge geometry, not permanently a scalar.** It is scalar today only because every current preset bleeds symmetrically on four edges. Publication workflows forbid gutter bleed — IngramSpark: *"Please do not add bleed to the bind (gutter) edge"*; Gorham: *"Toner in the gutter will compromise the binding adhesive. We will remove your gutter bleeds before printing."* Conversion to `{top,right,bottom,left}` needs **no migration**: bleed is derived from the preset and never persisted into `editor_documents.doc` (D-031 froze only margin/safe). Deferred until output profiles exist — building it now would be speculative infrastructure with no consumer.
- **Bleed is profile-owned.** Bleed, gutter rule, safe insets, page-count-dependent gutter, printer marks and PDF/X target belong to a future output/publication profile, not to a universal Baxter constant. Not built in this amendment.
- **Safe stays independent of bleed.** Bleed = artwork coverage outside trim; safe = protection of critical content inside trim. Neither derives from the other. Safe values are unchanged by this decision; the A4/square margin/safe ruling remains open (D-031).
- **Trim remains the finished page.** Bleed, safe and margin are never called trim.
- **The two-bleed proposal is withdrawn.** There is no "minimum bleed reference" nested inside a larger Baxter bleed; 3.175 mm is the generic profile's actual bleed.

**Future PDF/export invariants (recorded, not implemented).** TrimBox = exact finished page; prefer TrimBox over ArtBox and never emit both under PDF/X (they are mutually exclusive). BleedBox = the actual authored bleed extent, per-edge capable; never emit artwork beyond the declared BleedBox, and never declare bleed that intended bleeding content fails to fill. **MediaBox is a hard invariant: it must contain everything intended to survive production, including BleedBox and any marks/slug allowance** — Esko's rule is *"Information outside the MediaBox is never used"*, and ISO 32000 permits content outside MediaBox to be discarded. CropBox is omitted or set equal to MediaBox (GWG 2022 R0003: *"the CropBox shall coincide with the MediaBox… or by omitting the CropBox"*); it is never an independent production-geometry control. Printer marks are profile-dependent and default off — POD houses (IngramSpark, KDP, Lulu, Blurb, BookBaby, PrintNinja, Gorham) explicitly reject embedded marks.

**Future preflight architecture (recorded, not implemented).** Two independent families. **(A) Bleed coverage, per edge:** intended full-bleed edge below the profile requirement → FAIL; bleed on an edge the profile forbids → FAIL; BleedBox declaring a region intended bleeding content does not fill → FAIL; artwork beyond the declared BleedBox → FAIL. The **active profile owns the threshold**; 3.175 mm is not hard-coded through preflight, it is merely what the default profile specifies. **(B) Critical-content safety:** entirely separate, and must be able to become per-edge, asymmetric, gutter-aware and page-count-aware (KDP's gutter runs 0.375 in → 0.875 in with page count).

**Implications.** The editor's bleed rectangle grows 0.175 mm per edge — 0.595 px at the 3.4 px/mm base, 4.76 px at 8×. Because bleed is derived rather than frozen, **existing documents pick the new value up on next open**; that is the intended consequence of D-031's deliberate choice not to persist trim/bleed. Preflight behaviour is unchanged: its bleed check gates on `rules.bleedMm > 0`, never on the magnitude. No schema, migration, persistence or API change. Shared First-Load JS unchanged (measured: identical 342.3 kB before and after).

**What would force reconsideration.** A named printing partner stating 0.25 in *per edge* in writing — then the generic profile value changes, but the per-edge/total distinction recorded here still holds. A printer requiring a true 3.0 mm — expressible today, and the reason `bleedMm` was not made a fixed constant. The arrival of real output profiles — at which point bleed becomes per-edge and profile-owned as described above.

---

## Open Decisions (deferred to later slices)

- **Editor margins for A4 + square presets** — 15/6 and 14/6 shipped PROVISIONAL in `formats.ts` (D-031); confirm or revise at the Slice A review. Unaffected by D-033.
- **Per-edge bleed + output profiles** — D-033 records that bleed must become `{top,right,bottom,left}` and profile-owned (gutter bleed is forbidden by IngramSpark/KDP/Gorham). Deferred until a profile actually needs it; migration-free whenever taken, since bleed is derived, never persisted.
- **Production availability mechanism** — Supabase Pro vs uptime probe vs both (D-032). Ben decides.
- **Inngest topology** — which workflows are durable steps vs server actions vs cron. Slice 5–6.
- **DIN licensing** — when to pull DM Sans and license real DIN. After Slice 4 ship.
- **Preview lifecycle on publication delete** — orphaned Cloudflare images / clean-bucket objects aren't swept on publication deletion (only on re-render). Add a cleanup path if it matters pre-launch.

*(Resolved: "PDF rendering pipeline" — settled by D-015 (mupdf + Cloudflare Images).)*
