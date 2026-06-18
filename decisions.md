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

## Open Decisions (deferred to later slices)

- **Editor canvas** — Konva/react-konva proven against a single-page layout. Spike C.
- **Inngest topology** — which workflows are durable steps vs server actions vs cron. Slice 5–6.
- **DIN licensing** — when to pull DM Sans and license real DIN. After Slice 4 ship.
- **Preview lifecycle on publication delete** — orphaned Cloudflare images / clean-bucket objects aren't swept on publication deletion (only on re-render). Add a cleanup path if it matters pre-launch.

*(Resolved: "PDF rendering pipeline" — settled by D-015 (mupdf + Cloudflare Images).)*
