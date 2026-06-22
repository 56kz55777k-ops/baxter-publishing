# Baxter Publishing — Progress Report

**Date:** 2026-06-05
**From:** Claude Code (paired with Ben Gibson)
**For:** ChatGPT — review
**Builds on:** `baxter-claude-code-handoff.md` (Perplexity Computer's handoff) and the prior progress reports.
**Session scope:** resolve the production 500 → close Slice 2 (smoke test + email rewrite + auth callback + self-serve deletion) → ship Slice 3a (publication shell + R2 upload to quarantine) → polish → derive page count from PDF instead of the creator → set up Slice 3b infrastructure (Inngest + second R2 bucket).

---

## 1. Summary

Production is healthy. Slice 2 is fully closed and verified end-to-end. Slice 3a (publication shell + browser-direct upload to R2 quarantine, with page count auto-derived from the uploaded PDF) shipped and verified. Slice 3b infrastructure is in place: Inngest is wired into the Next.js app, the production endpoint is synced with Inngest Cloud, a stub preflight function runs successfully against a test event, and the second R2 bucket (`baxter-clean`) exists. What's left for Slice 3b is purely application code — the real preflight worker body, event emission from the artifact-register API, and the preflight-result UI — plus four design decisions worth taking deliberately, captured in section 11.

**Update (later session):** the four design questions are resolved (decisions `D-012`, `D-013`, `D-014` in `decisions.md`), **Slice 3b is implemented (commit `8b9895b`), migration `0003` is applied to prod, and the production smoke test passed — Slice 3b is LIVE.** All five preflight paths plus the retention sweep were verified end-to-end in production. Details in sections 13 and 14.

**Update (Slice 4):** **Slice 4 (preview & cover generation) is shipped and verified live in production** (commits `9bcb450` + `808b4ed`; decision `D-015`). On a preflight pass the worker rasterizes the cover + first six pages with mupdf (TrimBox-cropped), uploads them to Cloudflare Images, and the publication page renders the cover + previews. No migration was needed (reuses `assets` + `cover_asset_id`). Cloudflare Images is now standing infrastructure (enabled, three Vercel env vars, three variants). Details in section 15.

**Update (Slice 5):** **Slice 5 (ceremonial submission flow) is shipped and verified live in production** (commits `08f1979` + `7ce25f0`; decision `D-016`). Submission is a declaration, not a form: editing lives in the workspace, declaration on a read-only Review page with one action; `draft→in_review` via the state machine + audit event; "Submitted." poster and "Under review" state; admin notification via Inngest → Resend (now `Delivered` to `benjamin@benjamingibson.ca`). No migration. Two operational notes surfaced: Inngest sync is **manual** (no Vercel integration — `D-017`), and email currently sends from the verified `resend.torontocreatives.com` (branded `baxter.press` sender is a follow-up). Details in section 16.

---

## 2. The production 500 — diagnosed and fixed (commit `b09392d`)

The handoff diagnosed the site-wide 500 as a Vercel edge-cache issue. It wasn't — fresh probes showed `x-vercel-cache: MISS` with `age: 0` while still returning 500. Vercel runtime logs revealed:

```
Cannot find module 'next/dist/compiled/source-map'
Require stack:
- /var/task/node_modules/next/dist/compiled/next-server/server.runtime.prod.js
- /var/task/apps/web/___next_launcher.cjs
```

Next.js's serverless runtime lazily `require`s `source-map`; the file tracer doesn't follow dynamic requires, so the module was missing from every deployed function bundle. Edge middleware (bundled separately) was unaffected — which is why `/settings/profile` always returned a correct 307 while every page render 500'd. Build succeeded because tracing happens after compilation and a miss isn't a build error.

Fix in `apps/web/next.config.js`: set `outputFileTracingRoot` to the monorepo root, add `outputFileTracingIncludes` to force-bundle `next/dist/compiled/source-map`. Production immediately green after deploy.

---

## 3. Slice 2 smoke test — 14 / 14

Run against production per handoff section 7. Account 1 handle: `ben-in-toronto`. Account 2 handle: `ben2`. Step 13 (pending-handle gate) was verified by temporarily setting `ben2`'s handle to `~pending-test` in Supabase, confirming the middleware bounced authed routes to `/settings/profile`, then reverting.

In-app copy was audited end to end against the Editorial Constitution — sign-up, sign-in, check-email, profile, public profile, follow button, app shell, error strings. Clean: no exclamation points, no emojis, no "we" as Baxter's voice, composed error phrasing throughout.

---

## 4. Slice 2 polish

### Confirmation email (commits `8963666` + `8849389`, pasted into Supabase)

The stock Supabase "Confirm signup" email breached the Constitution: a ⚡ emoji, a "powered by Supabase" credit, and generic SaaS voice. Replaced with a Baxter-voiced HTML template — warm canvas, ink-bordered button matching the app, serif body, no emoji, no credits. Committed at `infrastructure/supabase/email-templates/confirm-signup.html` as the source of truth, then pasted into Supabase → Authentication → Email Templates → Confirm signup. The expiry sentence was omitted intentionally so the wording doesn't drift if Supabase's OTP-expiration setting changes (commit `8849389`).

Open: the sender still reads "Supabase Auth `<noreply@mail.app.supabase.io>`". Fixing requires custom SMTP with a Baxter domain. Pre-launch.

### PKCE auth callback (commit `961396e`)

The original code pointed `emailRedirectTo` straight at `/settings/profile`, but Supabase email links use PKCE — the user arrives with a `?code=…` that must be exchanged for a session. Without a callback route to do the exchange, the user landed on `/settings/profile` with no session, was bounced to `/sign-in`, and had to authenticate manually before reaching the handle-claim form. The smoke test passed loosely because the end state matched; this fix removes the detour.

Added `apps/web/app/auth/callback/route.ts` to call `exchangeCodeForSession` and forward to `?next=` (defaulting to `/settings/profile`). Updated `signUp`'s `emailRedirectTo` accordingly.

### Self-serve account deletion (commit `f35dd58`)

Account deletion was missing — Ben hit the gap himself trying to remove a test account. Added a "Delete your account" section to the claimed-state profile page, with a type-handle-to-confirm pattern (no anxiety-theatre modal). The action deletes both `public.users` (cascades follows/assets) and `auth.users` (via the service-role admin client), signs out, redirects to `/`. New `apps/web/lib/supabase/admin.ts` for the service-role client, kept server-only.

Deliberately deferred:
- Soft-delete / PII anonymization (needed once publications + orders exist; not now).
- Pending-handle delete UX (claim a handle first).
- Account-removed confirmation email.
- Symmetric `on_auth_user_deleted` SQL trigger (current action deletes both rows explicitly).

---

## 5. Slice 3a — Publication shell + R2 upload to quarantine (commit `bee01db`)

Vertical slice of the creator's first half: sign in → `/studio` ("Begin a publication.") → `/studio/new` form (title, format preset, category) → save as draft → `/studio/publications/<id>` (metadata + upload form) → upload PDF → "File received. Awaiting check." Library at `/library`.

### What's in

Routes:
- `/studio` — landing with the CTA + recent in-progress drafts.
- `/studio/new` — create form.
- `/studio/publications/[id]` — detail + upload.
- `/library` — full list of the creator's publications.
- `POST /api/upload/r2-presigned` — mints a presigned PUT URL into the quarantine bucket.
- `POST /api/publications/[id]/artifacts/register` — records the artifact row after the browser PUT completes.

Infrastructure:
- `apps/web/lib/r2/` — Cloudflare R2 S3-compatible client + presigned URL helper.
- `packages/domain/formats.ts` — three format presets (A5 Zine, A4 Magazine, Square Photobook 210mm) and ten categories (Zine, Photobook, Art Book, Chapbook, Magazine, Monograph, Comic, Essay, Photojournalism, Experimental). Pure TypeScript in the domain package.
- Dependencies: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
- Cloudflare R2 bucket `baxter-quarantine` with a CORS policy permitting `PUT` from the production origin.

Migration `0002_role_default_creator.sql`:
- Backfills existing `reader` rows to `creator`.
- Changes `users.role` default to `creator`.
- Updates the `handle_new_user()` auth trigger to insert `creator`.

The implementation plan's original schema doc intended this; the 0001 trigger diverged. Restoring it removes the implicit "reader cannot publish" gap.

### Decisions made

- **Upload progress is indeterminate** — no percentage. Constitution §Submission. Copy reads "Uploading [filename]." then "File received. Awaiting check."
- **Format presets in code, not DB.** The plan called for a `publication_formats` table; the schema didn't add it. Keeping format dimensions stored directly on the publication row + presets in `@baxter/domain`. Easier to evolve.
- **`/library` and `/studio` are separate routes.** `/studio` is the action surface (begin + recent), `/library` is the full list.

### Two snags worth recording

1. **First create-publication attempt failed with "Something prevented…"** The catch-all error message swallowed a Supabase RLS rejection — the migration had been read but not yet applied. Re-running the (idempotent) migration fixed it. The polish commit below adds `console.error` to every catch-all path so future RLS bites are visible in Vercel logs immediately.
2. **First PDF upload hit a CORS preflight 403** even with R2's CORS policy correctly configured in the dashboard. After Ben re-saved the policy and waited for propagation, the next attempt worked. A defensive R2 client config change (commit `fea6984`) sets `forcePathStyle: true` and `requestChecksumCalculation: 'WHEN_REQUIRED'` — both AWS SDK v3 defaults that bite browser PUTs to R2. In honesty, the actual fix appears to have been CORS propagation, but the SDK config is still sensible to keep.

---

## 6. Slice 2/3a polish (commit `02c35a3`)

Four small cleanups, no new features:

- **Dead links removed.** The homepage nav and footer + the 404 page pointed at six routes (Publications, Creators, About, All publications, Editorial standards, Contact) that won't exist until later slices. Each landed on the 404 page. Removed. Homepage footer distilled to a single `Baxter · Toronto · est. 2026` line.
- **Swallowed errors logged.** `console.error` added to every catch-all path: `createPublication`, `updateProfile`, both delete paths in `deleteAccount`, the non-unique-violation branch of `claimHandle`, and the artifact-register API. Future debugging is one Vercel-log lookup away.
- **Replace-file affordance.** Once an artifact exists, the publication detail page now shows the receipt with a quiet "Replace file" button; clicking switches to the upload form, and Cancel returns. New `artifact-section.tsx` client wrapper. `UploadForm` gained optional `onSuccess` and `cancel` props.

---

## 7. Page count auto-derivation (commit `07aa5d8`)

Following Ben's observation that asking for page count before upload is funnel-friction (and overlaps poorly with the studio editor where pages will be added and removed freely), the page-count field was dropped from the creation form. The publication row is now inserted with `page_count = null`. The register-artifact API downloads the just-uploaded object back from R2, parses it with `pdf-lib`, and writes the count into both the artifact's `preflight` jsonb and `publications.page_count`. Failure to parse is non-fatal — the artifact still registers and Slice 3b's worker will handle hard cases.

Upload helper copy updated to call out cover expectations: "Print-ready, single pages, with front and back covers."

New dependency: `pdf-lib` ^1.17.1.

---

## 8. Slice 3b infrastructure (commit `55ed70e`)

Slice 3b infrastructure is in place; no remaining infra prep is required to start the worker.

Added to the app:
- `apps/web/lib/inngest/client.ts` — Inngest client (app id `baxter-publishing`).
- `apps/web/lib/inngest/functions.ts` — one stub function `publication-preflight` listening on `publication/artifact.uploaded`. Slice 3b replaces this body with the real preflight worker.
- `apps/web/app/api/inngest/route.ts` — serve handler exporting GET/POST/PUT.
- `apps/web/package.json` — adds `inngest` ^3.30.0.

Inngest Cloud:
- App `baxter-publishing` synced against `https://baxter-publishing-web.vercel.app/api/inngest`.
- Sync succeeded; the stub function appears in the dashboard with the correct trigger.
- A test event sent from the Inngest dashboard completed a green Run (about three seconds, mostly cold-start). End-to-end wiring verified.

Vercel env vars added (Production + Preview, Sensitive):
- `INNGEST_EVENT_KEY` — for sending events.
- `INNGEST_SIGNING_KEY` — for verifying inbound webhook signatures.
- `R2_BUCKET_ARTIFACTS=baxter-clean` — destination bucket for preflight-passed objects.

Second R2 bucket `baxter-clean` created. No CORS or token configuration needed — the worker writes server-side, and the existing R2 token is scoped to all buckets.

---

## 9. Outstanding items

1. **Slice 3b go-live — DONE.** Migration `0003` applied to prod, deploy live, and the production smoke test passed (section 14). Slice 3b is live.
2. **Custom SMTP** so confirmation emails send from a Baxter domain rather than `noreply@mail.app.supabase.io`. Pre-launch.
3. **Other Supabase email templates** (Magic Link, Reset Password, Change Email, Reauthentication) are still stock. None are triggered in Slice 2.
4. **Replace-flow object cleanup** — resolved by the Slice 3b retention sweep (`D-014`): superseded objects are deleted at register time, keeping the active file plus its immediate predecessor.
5. **Custom domain** for production (`baxter.press` or similar). Pre-launch.
6. **Preflight calibration** — source real fixtures (low-DPI, non-embedded fonts), implement deferred DPI detection, and verify the best-effort font check against real exports. See section 13.
7. **Pre-existing ESLint 9 config breakage — DONE.** Migrated repo-wide to flat config (`eslint.config.mjs` + `@baxter/eslint-config` base/next), committed `aa9cd84`; `npm run lint` is green again.
8. **KB-aware file-size formatting** (follow-up polish) — the artifact receipt shows "0.0 MB" for files under ~50 KB because the formatter rounds MB to one decimal (`artifact-section.tsx`). Switch to KB-aware formatting (e.g. show KB below 1 MB). Cosmetic; surfaced by the synthetic test fixtures.
9. **Slice 4 (preview & cover generation) — DONE.** Shipped and verified in production (section 15).
10. **Preview-pipeline follow-ups (post-Slice-4)** — orphaned Cloudflare images / clean-bucket objects on *publication deletion* aren't swept (only re-render sweeps); creator cover-override is deferred; preview-generation could later move to its own Inngest function for independent retries (currently an isolated, catch-and-log step).
11. **Slice 5 (ceremonial submission flow) — DONE.** Shipped and verified in production, admin email included (section 16).
12. **Branded `baxter.press` email sender** — the admin notification currently sends from the verified `resend.torontocreatives.com`. `baxter.press` is purchased (GoDaddy); verify it in Resend (DNS) and set `RESEND_FROM_ADDRESS=Baxter <notifications@baxter.press>` before any customer-facing email (later slices). Supersedes the generic "custom domain" item for email purposes.
13. **Inngest sync is manual (operational policy, `D-017`)** — the Vercel-native Inngest integration is intentionally NOT installed. **After any deploy that adds a NEW Inngest function, Resync the app** (Inngest → Apps → baxter-publishing → Resync). Folded into per-slice verification.

---

## 10. Git and deployment state

- Repo: `https://github.com/56kz55777k-ops/baxter-publishing`, branch `main`.
- `origin/main` is at the latest commit on `main` (through Slice 4: `808b4ed`, plus subsequent doc updates). Local is in sync.
- Working copy lives at `~/Desktop/baxter-app` (moved from `~/Downloads/baxter-app` after Downloads got cleaned). The repo was re-cloned from origin mid-session after the original folder was inadvertently deleted; all pushed history is intact.
- Vercel project `baxter-publishing-web`, production URL `https://baxter-publishing-web.vercel.app`. The duplicate `project-w4oob` was removed earlier in the session.
- Supabase project `qnqbkihndxppommgfrxd`.
- Migrations applied to prod: `0000_initial_schema.sql`, `0001_rls_and_auth_trigger.sql`, `0002_role_default_creator.sql`, `0003_preflight_status.sql`. (`0003` was applied during the smoke test via the Supabase SQL editor — it had been missed before the deploy, which surfaced as a create-publication failure until applied; see section 14.) **Slice 4 added no migration** (reuses the existing `assets` table + `publications.cover_asset_id`).
- Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_QUARANTINE`, `R2_BUCKET_ARTIFACTS`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_IMAGES_API_TOKEN`, `CLOUDFLARE_IMAGES_ACCOUNT_HASH` (Slice 4), `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` (currently `…@resend.torontocreatives.com`), `ADMIN_NOTIFICATION_EMAIL` = `benjamin@benjamingibson.ca` (Slice 5). All Sensitive, Production + Preview.
- **Inngest sync is MANUAL (`D-017`).** The Vercel-native Inngest integration is not installed (it risks re-provisioning the working `INNGEST_*` keys / a separate project). **Runbook: after deploying a slice that adds a NEW Inngest function, Resync** (Inngest → Apps → baxter-publishing → Resync) or the new function won't register. This is exactly what silently broke the Slice 5 email until resynced.
- R2 buckets: `baxter-quarantine` (CORS allowing `PUT` from the production origin), `baxter-clean` (no CORS — server-side access only).
- Inngest Cloud app `baxter-publishing` synced against the production endpoint.
- Cloudflare Images: enabled on account `502673a122d7ad2ba3a5ad4f71f5b07e` (Images & Stream $0/mo plan); account hash `kuZbDeDRpro6gw7ZktB7TQ`; named variants `cover` (1200w), `grid` (600w), `full` (1600w), all `fit: scale-down`. Public delivery via `imagedelivery.net`.

### Commit timeline this session

| SHA | Message |
|---|---|
| `b09392d` | fix(web): bundle next source-map runtime into serverless functions |
| `8963666` | chore(email): add Baxter-voiced Supabase confirm-signup template |
| `8849389` | chore(email): omit link expiry from confirm-signup template |
| `961396e` | fix(auth): exchange PKCE code on email confirmation |
| `f35dd58` | feat(account): self-serve account deletion on /settings/profile |
| `bee01db` | feat(slice-3a): publication shell + R2 upload to quarantine |
| `fea6984` | fix(r2): force path-style addressing and skip default CRC32 checksums |
| `02c35a3` | chore(polish): dead links, error logging, replace-file affordance |
| `07aa5d8` | fix(publication): derive page count from the uploaded PDF, not from the creator |
| `55ed70e` | chore(inngest): wire Inngest SDK with a stub preflight function |
| `1816efe` | chore(deps): sync lockfile with Slice 3a/3b dependencies |
| `55f70d4` | docs(slice-3b): record preflight decisions and session handoffs |
| `05b71e6` | docs(slice-3b): record D-014 promotion, retention, and cleanup policy |
| `8b9895b` | feat(slice-3b): PDF preflight worker, promotion, and result UI |
| `4946c84` | docs(slice-3b): mark Slice 3b shipped in code, pending prod migration/deploy/smoke |
| `b88a9c3` | docs(slice-3b): mark production smoke test passed |
| `ab85f6f` | docs: Slice 3b post-implementation review |
| `1493632` | docs(slice-4): preview & cover generation plan |
| `aa9cd84` | chore(lint): migrate to ESLint 9 flat config |
| `9bcb450` | feat(slice-4): render cover + previews to Cloudflare Images on preflight pass |
| `808b4ed` | feat(slice-4): show cover + previews on the publication page |

Note: `07aa5d8` was authored with a placeholder identity because the fresh clone didn't have git config set at commit time. Future commits will use the correct `Ben Gibson <benjamin@benjamingibson.ca>` identity (global git config has since been set). The one outlier is cosmetic — content is correct.

---

## 11. Slice 3b — open design questions

> **Resolved.** All four were decided and recorded as `D-012` (checks + status model), `D-013` (result UI), and `D-014` (promotion, retention, cleanup) in `decisions.md`; test PDFs (question 4) are tracked as a fixtures sub-task. The original framing is kept below for the record. The as-built behaviour is in section 13.

Four decisions worth taking before writing the worker. Especially the second, which sets the voice for one of the most exposed moments in the product.

1. **Which preflight checks ship in 3b, and which are blocking vs warning?** Candidates from the implementation plan:
   - Page count vs format min/max (and a multiple-of-4 check for saddle-stitch).
   - Page dimensions match the chosen format.
   - Embedded fonts.
   - Minimum DPI per image.
   - Bleed presence.
   
   Suggested split: dimensions, page count, multiple-of-4 are blockers (a printer literally won't accept it otherwise); fonts, DPI, bleed are warnings (creator can override at their own risk). Open to revision.

2. **How the preflight result UI reads.** The constitution-critical decision.
   - **Framing.** A composed list ("Three things to address."), a note from an editor ("Baxter found a few things…"), or something else?
   - **Severity wording.** "Failed" / "passed" vs softer ("ready" / "needs attention")?
   - **Pass display.** Silence, a hairline, or a single composed line?

3. **Promotion + cleanup behaviour.**
   - When preflight passes: copy quarantine → clean and delete the quarantine object, or keep the quarantine copy for archive?
   - When preflight fails: keep the quarantine object so the creator can see what they sent, or auto-delete and force re-upload?

4. **Test PDFs to develop against.** A handful of real PDFs covering:
   - A clean print-ready PDF (passes everything).
   - One with wrong dimensions for the chosen format.
   - One with too-low-DPI images.
   - One missing bleed.
   - One with non-embedded fonts.
   - An encrypted / corrupt PDF (edge case — should fail gracefully).

---

## 12. Recommended next steps

1. **Decide the four open questions in section 11** — especially the result-UI tone.
2. **Open a fresh chat for Slice 3b** seeded with this report. Slice 3b is a clean milestone boundary and the result-UI design benefits from a clean context.
3. **In that chat:** emit the Inngest event from the artifact-register API, replace the stub function body with real preflight logic, write the result UI, and verify end-to-end with the test PDFs.
4. **Custom SMTP** can wait until shortly before public launch, but it's small and worth doing early so the rest of the email surfaces inherit a Baxter sender from the start.

---

## 13. Slice 3b — shipped in code (pending production migration / deploy / smoke test)

Implemented and pushed as commit **`8b9895b`**. **Status: in code on `main`, not yet live.** Go-live is gated on migration `0003`, a deploy, and the smoke test in section 14.

### Schema — migration `0003_preflight_status.sql` (REQUIRED before/with deploy)

Hand-written, consistent with `0001`/`0002`. **Must be applied to prod before or with the deploy that includes `8b9895b`** — the create action and the publication detail query reference the new columns; an un-migrated prod will error.

- `preflight_status` enum on `artifacts` — values **`pending | passed | failed`** (default `pending`). Written **server-side only** (the worker, via the service-role client); there is deliberately no client RLS UPDATE policy on artifacts, so a creator cannot set their own file to `passed` and bypass the check.
- `publications.format_preset_id` (text) — the `@baxter/domain` preset id, so the worker resolves page-count bounds and the multiple-of-four rule without inferring from trim dimensions. Existing rows backfilled by trim dimensions.

### Status model and check severity (`D-012`)

A file either can proceed (`passed`) or cannot (`failed`). There is no `warnings` status — warnings are annotations on a passed file and never change the status.

- **Blockers** (any present ⇒ `failed`): page dimensions match the selected format; page count within the format's bounds; page count is a multiple of four where the binding requires it.
- **Warnings** (annotate a `passed` file, require acknowledgement to continue but never block): image resolution below the recommended DPI; fonts possibly not embedded; no bleed detected on edge-to-edge pages.
- A fact that cannot be determined produces **no** warning (silence over a guess).

### Promotion, retention, cleanup (`D-014`)

- **On pass:** copy the object quarantine → clean, repoint the artifact at the clean bucket, mark it canonical, set `publications.page_count`, then delete the quarantine copy.
- **On fail:** keep the object in quarantine at `failed` so the creator can inspect it.
- **Replacement / supersession:** swept synchronously at register time (no cron).
- **Retention: two** — the active file plus its immediate predecessor — with a hard invariant that **the latest passed file is never swept**, even when newer failed attempts would push it past the count. R2 deletes are idempotent.

### Result UI copy (`D-013`)

The creator encounters situations, never internal status words.

- **Waiting:** "File received." / "Review in progress."
- **Cannot proceed:** "This file cannot proceed." then the blocking issues stated directly. No "failed" language, no preamble.
- **Can proceed, with notes:** "The file can proceed." then each warning, then a single **Acknowledge** action. No liability language ("proceed anyway", "I understand", "accepted risk"). After acknowledgement the warnings remain visible and the primary line is unchanged.
- **Passes clean:** no success message at all — the file simply becomes the active publication file.

### Verification status

- **Typecheck green** across all five packages.
- **Preflight harness 6/6** (`apps/web/test/preflight.verify.ts`, run with `node apps/web/test/preflight.verify.ts`): clean pass, wrong-dimensions blocker, multiple-of-four blocker, page-count-bounds blocker, missing-bleed warning, and corrupt-file graceful failure — all against the real inspector + evaluator on generated PDFs.
- Not yet exercised against R2 / Inngest / Supabase in production — that is the section 14 smoke test.

### Known calibration gaps

- **Real low-DPI fixture** — needed; not yet sourced.
- **Real non-embedded-font fixture** — needed; not yet sourced.
- **DPI detection deferred** — the inspector returns "undetermined" for image DPI (no warning) until a content-stream parser is added and calibrated.
- **Font check is best-effort** — a font-dictionary walk that treats standard-14 as embedded-equivalent; unverified against real exports.
- Fixture status is tracked in `apps/web/test/fixtures/preflight/README.md`. The format rule defaults (page bounds, which formats require multiple-of-four, bleed, min DPI) live in `packages/domain/src/formats.ts` and are worth a calibration pass.

### Pre-existing ESLint 9 config issue (separate from Slice 3b)

`npm run lint` fails repo-wide: ESLint 9.39.4 is installed (already in the committed lockfile at `55ed70e`) but the packages still use the old `.eslintrc.json` format that ESLint 9 dropped. **Not caused by Slice 3b**, and production builds (which use `next build`) are unaffected. Tracked as a separate cleanup (migrate to flat config).

---

## 14. Production smoke test — Slice 3b

Run after applying migration `0003` and deploying `8b9895b`. Production URL: `https://baxter-publishing-web.vercel.app`.

**Pre-flight (no pun intended):**

1. Apply `0003_preflight_status.sql` in the Supabase SQL editor (project `qnqbkihndxppommgfrxd`). Confirm: `artifacts.preflight_status` exists (enum, default `pending`) and `publications.format_preset_id` exists.
2. Confirm the deploy that includes `8b9895b` is live (Vercel) and that Inngest Cloud shows the `publication-preflight` function synced with the real body (not the stub) against `/api/inngest`.

**Happy path — clean file passes and promotes:**

3. Sign in, begin a publication (pick **A5 Zine**), reach the detail page.
4. Upload a **clean, print-ready A5 PDF** with a multiple-of-four page count (e.g. 8pp) and bleed. The page should first read **"File received." / "Review in progress."**
5. Within seconds, refresh: the result should resolve to the **clean-pass state** — no success banner, just the file as the active file (size · upload date) and a Replace affordance. The metadata page count should now be populated.
6. In Cloudflare R2: the object now exists in **`baxter-clean`** and is **gone from `baxter-quarantine`**. In Supabase: the artifact row has `preflight_status = passed`, `bucket = baxter-clean`, `is_canonical = true`, and `publications.page_count` is set.

**Blocking path — file cannot proceed:**

7. On a new (or replaced) publication, upload a **7-page** A5 PDF (or one at A4 dimensions). The result should read **"This file cannot proceed."** with the specific blocker(s) listed ("Page count must be a multiple of four." and/or "Page dimensions do not match the selected format.").
8. Confirm: `preflight_status = failed`, the object **remains in `baxter-quarantine`** (not promoted), and `publications.page_count` is unchanged.

**Warning path — passes with notes:**

9. Upload a clean, correctly-sized, multiple-of-four PDF **without bleed**. The result should read **"The file can proceed."** with a **Bleed** note and an **Acknowledge** action.
10. Click **Acknowledge**. The warning stays visible, the primary line is unchanged, and the button disappears. In Supabase the artifact's `preflight` jsonb has `warningsAcknowledgedAt` set; `preflight_status` stays `passed`.

**Retention / replacement:**

11. On a publication that already has a passed file, upload a replacement that passes. Confirm only **two** artifacts are retained (the new active + its immediate predecessor), older objects are swept from their buckets, and the **active passed file is never deleted** even if you then upload a failing file.

**Graceful failure:**

12. Upload a deliberately **corrupt or password-protected PDF**. The worker should not crash; the result should read **"This file cannot proceed."** with a composed "could not be read" message, and the file stays in quarantine.

**If anything is off:** check the Inngest dashboard run logs for the `publication-preflight` function (each step — load, inspect, record-verdict, promote, sweep — is visible), and Vercel logs for the register API's event-send.

### Result — PASSED (executed via the Chrome extension, DB verified in the Supabase SQL editor)

One defect found and fixed: **migration `0003` had not actually been applied to prod** before the deploy. It surfaced immediately as a create-publication failure ("Something prevented the publication from being created") because the create action inserts `format_preset_id`. Applied `0003` via the SQL editor, re-verified the columns/enum, and re-ran — all green thereafter.

All five preflight paths verified end-to-end in production (UI per D-013 + DB rows):

| Path | UI | DB |
|---|---|---|
| Clean A5 (8pp, bleed) | silent clean pass, page count 8 | `passed`, `baxter-clean`, canonical, page_count 8, no blockers/warnings |
| 7pp not-multiple-of-four | "This file cannot proceed." → multiple-of-four | `failed`, stays `baxter-quarantine`, page_count null |
| A4 in A5 | "This file cannot proceed." → page dimensions | `failed`, stays `baxter-quarantine` |
| No-bleed | "The file can proceed." + Bleed note + Acknowledge | `passed`, `baxter-clean`; after Acknowledge, `warningsAcknowledgedAt` set, status unchanged |
| Corrupt | "This file cannot proceed." → "could not be read" | `failed`, stays `baxter-quarantine`, worker did not crash |

**Retention sweep (D-014) verified** on the clean publication: a 2nd passing upload kept 2 artifacts (new canonical + predecessor); a 3rd passing upload swept the oldest (2 retained); a subsequent *failing* upload did **not** sweep the latest passed file — confirming the never-sweep-active invariant.

**Cleanup:** the five `Smoke Test 0…` publications were deleted from prod (cascade removed their artifact rows). The 7 orphaned R2 objects were left for manual deletion (the Cloudflare dashboard would not load during the session); delete these prefixes — `baxter-clean`: `publications/d970cadd-0cfd-4a8b-a2aa-eb8424212544/`, `publications/7854e234-835b-48a5-8e8d-3a4ea3893e8e/`; `baxter-quarantine`: `publications/d970cadd-0cfd-4a8b-a2aa-eb8424212544/`, `publications/bd9db2f2-b018-4a47-9bc8-8d26ef0eb509/`, `publications/67594610-0066-4710-8802-87c1c4283232/`, `publications/d9bfea44-0abe-4f0f-9304-6491c1565390/`.

---

## 15. Slice 4 — Preview & cover generation (shipped & verified)

Reframed from the original plan's "Preview Generation + Preflight UI" (preflight UI shipped in 3b), so Slice 4 was squarely **preview & cover generation**. Planned in `baxter-slice4-plan.md`; architecture recorded as `D-015`. **Shipped to `main` (`9bcb450` pipeline, `808b4ed` UI) and verified live in production.**

### What shipped

- **Render engine — mupdf (WASM).** `apps/web/lib/pdf/render.ts` rasterizes the cover (page 1) + first six pages, each cropped to its TrimBox (falls back to full page when absent), as one ~1600w JPEG master per page. Pure/unit-testable; no native binaries; proven by a spike (cover + 6 previews in ~0.3–0.5s, ~120 MB peak — comfortably within Vercel limits).
- **Delivery — Cloudflare Images.** `apps/web/lib/cloudflare/images.ts` uploads each master **public** (`requireSignedURLs: false`) and exposes idempotent delete + a delivery-URL builder. Responsive sizing via account variants (`cover`/`grid`/`full`). The source PDF stays private in `baxter-clean`; only derived images are public.
- **Worker step.** On a preflight pass, after promotion, the worker renders → uploads → writes one `preview_page` asset per page and sets `publications.cover_asset_id` to page 1. **No schema migration** (reuses `assets` + `cover_asset_id`).
- **Failure isolation.** Render/upload failure never unmakes a passed publication — it stays passed and live, the cover simply stays absent, and the failure is logged (and visible in the Inngest run). The retention sweep still runs.
- **Re-render on replace (D-014 parity).** A new passing file regenerates previews and deletes the superseded Cloudflare images + asset rows first.
- **UI.** The publication page shows the cover prominently with the remaining pages below in a quiet leafing column; the section is absent until previews exist.
- **Config.** `mupdf` marked `serverExternalPackages` and its WASM traced into the `/api/inngest` bundle (`next.config.js`).

### Production verification (executed via the Chrome extension)

- **Happy path:** uploaded a clean 8-page A5 → passed → the publication page rendered the cover + pages 2–6 from Cloudflare Images (cropped to trim). Cloudflare showed 6 images.
- **Re-render / sweep:** re-uploaded → previews regenerated and the old images were swept (Cloudflare held at 6, not 12) — confirming the re-render cleanup.
- The one real prod risk — the mupdf WASM loading inside the deployed Vercel function — is proven working by the successful render.
- **Cleanup:** the "Slice 4 Preview Check" test publication was deleted from prod (cascade). Two trivial manual deletions remained for the operator: the 6 Cloudflare images (Hosted images → select all → delete) and the `baxter-clean` prefix `publications/22c0237a-e84e-4e08-addc-7fd97888519c/`.

### Known follow-ups (carried in section 9)

- Orphaned Cloudflare images / clean-bucket objects on **publication deletion** aren't swept (only re-render sweeps).
- Creator cover-override deferred.
- Preview generation could later move to its own Inngest function for independent retries (currently an isolated catch-and-log step).

---

## 16. Slice 5 — Ceremonial submission flow (shipped & verified)

Decision `D-016`. **Shipped (`08f1979` + `7ce25f0`) and verified live in production, admin email included.**

### What shipped

- **Submission is a declaration, not a form** — a two-surface model:
  - **Workspace** (`/studio/publications/[id]`): editable Marketplace section (subtitle, description, price, edition) via `saveMarketplace`; confined to `draft`/`revisions`. Price entered in dollars, stored as minor units; blank edition = open edition.
  - **Review** (`/studio/publications/[id]/review`): read-only declaration — cover, format, page count, category (+ sensitive-category notice hook), description, price, edition, review notice; one **Submit for review** action, no editable fields; "Edit publication" returns to the workspace; shows what's missing when ineligible.
- **Submit** — server-validated, gated on canonical preflight `passed` + price + description; `draft|revisions → in_review` via the pure state machine; writes `status`/`submitted_at` + the insert-only `publication_events` audit row via service role; emits `publication/submitted`.
- **Confirmation + state** — the **"Submitted."** poster, then the read-only **"Under review"** state (locked D-013-style copy).
- **Admin notification** — Inngest `publication-submitted-notify` → Resend (`lib/email/resend.ts`, a clean integration point that no-ops without `RESEND_API_KEY`). Recipient `benjamin@benjamingibson.ca`.
- **No migration** (reuses existing publication fields + `publication_events`).

### Production verification (via the Chrome extension)

Full flow confirmed: create → workspace marketplace save → upload/preflight pass → read-only Review → Submit → `in_review` (DB: status, `submitted_at`, one `publication_events` row) → "Submitted." poster → "Under review" read-only state.

### The email debugging saga (worth remembering)

The admin email didn't arrive at first. Diagnosis ruled out, in order: not delivery/spam (Resend log empty), not a missing key (`RESEND_API_KEY` present in Vercel), not the from-address. **Root cause: the new `publication-submitted-notify` function had never synced to Inngest** — the app's last sync was Slice 3b ("1 function found"), and nothing re-syncs on deploy. Fixed by a manual **Resync** (both functions now registered); a fresh submission then **Delivered** to `benjamin@benjamingibson.ca` (confirmed in the Resend log). Operational policy recorded as `D-017` (manual sync + resync-after-new-function runbook).

### Follow-ups (in section 9)

Branded `baxter.press` email sender (currently TC domain); manual Inngest resync guardrail; test-data cleanup (publications `3b1744ea`, `3c617cd2`, `64c5c2e4` + their R2/Cloudflare objects).
