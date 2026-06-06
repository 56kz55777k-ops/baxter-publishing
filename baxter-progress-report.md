# Baxter Publishing — Progress Report

**Date:** 2026-06-05
**From:** Claude Code (paired with Ben Gibson)
**For:** ChatGPT — review
**Builds on:** `baxter-claude-code-handoff.md` (Perplexity Computer's handoff) and the prior progress reports.
**Session scope:** resolve the production 500 → close Slice 2 (smoke test + email rewrite + auth callback + self-serve deletion) → ship Slice 3a (publication shell + R2 upload to quarantine) → polish → derive page count from PDF instead of the creator → set up Slice 3b infrastructure (Inngest + second R2 bucket).

---

## 1. Summary

Production is healthy. Slice 2 is fully closed and verified end-to-end. Slice 3a (publication shell + browser-direct upload to R2 quarantine, with page count auto-derived from the uploaded PDF) shipped and verified. Slice 3b infrastructure is in place: Inngest is wired into the Next.js app, the production endpoint is synced with Inngest Cloud, a stub preflight function runs successfully against a test event, and the second R2 bucket (`baxter-clean`) exists. What's left for Slice 3b is purely application code — the real preflight worker body, event emission from the artifact-register API, and the preflight-result UI — plus four design decisions worth taking deliberately, captured in section 11.

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

1. **Slice 3b application code** — replace the stub worker body with real preflight logic, emit `publication/artifact.uploaded` from the artifact-register API, and build the preflight-result UI on the publication detail page. Infrastructure is done; design decisions in section 11 are open.
2. **Custom SMTP** so confirmation emails send from a Baxter domain rather than `noreply@mail.app.supabase.io`. Pre-launch.
3. **Other Supabase email templates** (Magic Link, Reset Password, Change Email, Reauthentication) are still stock. None are triggered in Slice 2.
4. **Replace-flow object cleanup** — when a file is replaced, the old R2 object stays in quarantine. Could be swept by the Slice 3b worker or as a separate cleanup job.
5. **Custom domain** for production (`baxter.press` or similar). Pre-launch.

---

## 10. Git and deployment state

- Repo: `https://github.com/56kz55777k-ops/baxter-publishing`, branch `main`.
- `origin/main` is at `55ed70e` (Inngest plumbing). Local is in sync.
- Working copy lives at `~/Desktop/baxter-app` (moved from `~/Downloads/baxter-app` after Downloads got cleaned). The repo was re-cloned from origin mid-session after the original folder was inadvertently deleted; all pushed history is intact.
- Vercel project `baxter-publishing-web`, production URL `https://baxter-publishing-web.vercel.app`. The duplicate `project-w4oob` was removed earlier in the session.
- Supabase project `qnqbkihndxppommgfrxd`.
- Migrations applied to prod: `0000_initial_schema.sql`, `0001_rls_and_auth_trigger.sql`, `0002_role_default_creator.sql`.
- Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_QUARANTINE`, `R2_BUCKET_ARTIFACTS`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.
- R2 buckets: `baxter-quarantine` (CORS allowing `PUT` from the production origin), `baxter-clean` (no CORS — server-side access only).
- Inngest Cloud app `baxter-publishing` synced against the production endpoint.

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

Note: `07aa5d8` was authored with a placeholder identity because the fresh clone didn't have git config set at commit time. Future commits will use the correct `Ben Gibson <benjamin@benjamingibson.ca>` identity (global git config has since been set). The one outlier is cosmetic — content is correct.

---

## 11. Slice 3b — open design questions

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
