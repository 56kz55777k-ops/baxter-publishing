# Baxter Publishing — Progress Report

**Date:** 2026-06-05 · **Updated:** 2026-07-13 — Slice 9 (production economics + OMS + fulfilment + commerce emails) built, deployed, and **non-shipping smoke test passed** end to end (commits `eaead4d` build, `47e8b16` fulfilment-actor fix). Retail is built up from production (print + configurable Baxter margin + creator earnings); shipping is a separate live system behind a `ShippingProvider` abstraction, **fail-safe gated until EasyPost is enabled**. **Slices 1–9 are closed** (shipping quote wiring + live-send email verification deferred to the EasyPost follow-up). *(Prior: Slice 8 shipped 2026-07-04 — a real test order paid, funds held.)*
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

**Update (branded email sender):** **The branded `baxter.press` email sender is live and verified in production.** `baxter.press` is verified in a **new, dedicated Resend account** (the free tier allows one domain per account, and the existing account already held `resend.torontocreatives.com`); DKIM + SPF DNS records were added in GoDaddy; Vercel now carries the new account's `RESEND_API_KEY` and `RESEND_FROM_ADDRESS=Baxter <notifications@baxter.press>`. An end-to-end production submission confirmed the admin notification **Delivered** to `benjamin@benjamingibson.ca` **from `notifications@baxter.press`**. No code change (the integration point was already in place). Details in section 17. This closes outstanding item 12.

**Update (Slice 6):** **Slice 6 (admin review queue) is shipped and production-verified end to end** (commit `bd17ab1`; decisions `D-019`, `D-020`, `D-021`). The editorial desk (`/admin`, role-gated), the review page (`/admin/[id]`), the writing-first decision desk (editorial note primary; internal-only reason codes), the two decision actions (Publish / Request revisions — no reject state), the two-voice creator states + decision email, and a new `publication-decided-notify` Inngest function all shipped. **No migration** (reason codes ride in `publication_events.payload`). A full production smoke test passed: create → submit → desk → request revisions → creator sees the editor's note → resubmit → publish → creator sees "Published", with DB rows and the revision email confirmed. Two foundational principles were locked alongside the build — *the editor writes, the software records* (`D-020`) and *two voices: Institutional and Editorial* (`D-021`) — plus a fourth Constitution principle, *an editorial office, not a moderation platform*. Details in section 19.

**Update (Slice 7):** **Slice 7 (marketplace shell) is shipped and production-verified end to end** (commit `8bd0a4e`; decisions `D-022`–`D-025`). The homepage is now the marketplace **front door** (opening statement, then the work beneath it); the public publication page lives at **`/[handle]/[slug]`**; browse is at `/publications` with a quiet category filter and no search; the creator profile lists real published works; and Editor's Picks is set by an admin-only toggle. **Migration `0004`** adds `editor_pick_at` (a timeline, not a flag). The homepage is architected as a **composition** (`composeHome()` → ordered typed sections), not a chronological feed. A full production smoke test passed: publish a work → it appears in New Releases with the Cover→Title→Creator→Price card, its `/[handle]/[slug]` page renders (price plain, "Ordering opens soon", no cart), `/publications` filters by category, the profile lists it, and the Editor's Pick toggle moves it into an Editor's Picks section on the homepage. Foundational principles locked: *the marketplace front door* (`D-022`), *price is quiet metadata — remove performative commerce, not commerce* (`D-023`), *the three actors — Platform / Editor / Creator* (`D-024`), and *the homepage is a curated composition, not a feed* (`D-025`; also locks "no fictional signals" and "browse before search"). The one test publication ("Slice 7 Test") is intentionally left live and Editor's-Picked so the marketplace has a real work for demos. Details in section 20.

**Update (Slice 8):** **Slice 8 (Stripe Connect + first purchase) is shipped and production-verified end to end** (commits `ee60a61` build, `9bbb9db` fix; decisions `D-026`, `D-027`). Creator payout onboarding (Connect Express) at `/settings/payouts`; the publication page shows "Own this publication" when the creator is payout-ready and the viewer isn't the creator; a Baxter-hosted Stripe **Payment Element** checkout; a **held-funds** PaymentIntent on the platform account (`D-026` — no destination charge/`application_fee`; the creator payout is a separate transfer at fulfilment in Slice 9); the `payment_intent.succeeded` webhook creates the order (`paid`) + audit event; buyer confirmation at `/orders/[id]`; a minimal `/admin/orders` ledger. **No migration** (the orders tables already existed). Stripe set up in the Toronto Creatives test account (Connect enabled, webhook "Baxter Publishing" for `payment_intent.succeeded` + `account.updated`, four Vercel env vars). A full production smoke test **passed**: onboarding → buyable → checkout → **$18 test purchase** → webhook order `paid` → buyer "Thank you." page → `/admin/orders` → **funds held** (net $17.03 in the platform balance, no transfer to the creator). **One real bug caught and fixed** (`9bbb9db`): payout readiness was gated on `charges_enabled`, which is always false for a transfers-only connected account — now gated on the **transfers capability**. Details in section 21.

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
2. **Custom SMTP for Supabase auth emails — DONE.** Supabase Auth now sends via Resend SMTP (`smtp.resend.com:465`, username `resend`, the baxter.press account's API key) from `Baxter <notifications@baxter.press>`. Verified: a magic-link email **Delivered** from that sender (section 18).
3. **Other Supabase email templates** (Magic Link, Reset Password, Change Email, Reauthentication) are still stock. None are triggered in Slice 2.
4. **Replace-flow object cleanup** — resolved by the Slice 3b retention sweep (`D-014`): superseded objects are deleted at register time, keeping the active file plus its immediate predecessor.
5. **Custom domain** for production (`baxter.press` or similar). Pre-launch.
6. **Preflight calibration** — source real fixtures (low-DPI, non-embedded fonts), implement deferred DPI detection, and verify the best-effort font check against real exports. See section 13.
7. **Pre-existing ESLint 9 config breakage — DONE.** Migrated repo-wide to flat config (`eslint.config.mjs` + `@baxter/eslint-config` base/next), committed `aa9cd84`; `npm run lint` is green again.
8. **KB-aware file-size formatting** (follow-up polish) — the artifact receipt shows "0.0 MB" for files under ~50 KB because the formatter rounds MB to one decimal (`artifact-section.tsx`). Switch to KB-aware formatting (e.g. show KB below 1 MB). Cosmetic; surfaced by the synthetic test fixtures.
9. **Slice 4 (preview & cover generation) — DONE.** Shipped and verified in production (section 15).
10. **Preview-pipeline follow-ups (post-Slice-4)** — orphaned Cloudflare images / clean-bucket objects on *publication deletion* aren't swept (only re-render sweeps); creator cover-override is deferred; preview-generation could later move to its own Inngest function for independent retries (currently an isolated, catch-and-log step).
11. **Slice 5 (ceremonial submission flow) — DONE.** Shipped and verified in production, admin email included (section 16).
12. **Branded `baxter.press` email sender — DONE.** Verified in a dedicated Resend account, DNS in GoDaddy, Vercel env updated, and a production submission confirmed delivery from `notifications@baxter.press` (section 17). Note: this covers **transactional/admin** email via Resend; Supabase **auth** emails are handled separately via custom SMTP (also Resend) — now DONE (item 2, section 18).
13. **Inngest sync is manual (operational policy, `D-017`)** — the Vercel-native Inngest integration is intentionally NOT installed. **After any deploy that adds a NEW Inngest function, Resync the app** (Inngest → Apps → baxter-publishing → Resync). Folded into per-slice verification.

---

## 10. Git and deployment state

- Repo: `https://github.com/56kz55777k-ops/baxter-publishing`, branch `main`.
- `origin/main` is at the latest commit on `main` — through Slice 5 (`08f1979` + `7ce25f0`), then the branded-email and auth-SMTP doc updates (`c6c6ceb`, `937a9fa`; current HEAD). Local is in sync. The branded `baxter.press` sender and Supabase auth SMTP were external-service + env changes — no code commits.
- Working copy lives at `~/Desktop/baxter-app` (moved from `~/Downloads/baxter-app` after Downloads got cleaned). The repo was re-cloned from origin mid-session after the original folder was inadvertently deleted; all pushed history is intact.
- Vercel project `baxter-publishing-web`, production URL `https://baxter-publishing-web.vercel.app`. The duplicate `project-w4oob` was removed earlier in the session.
- Supabase project `qnqbkihndxppommgfrxd`.
- Migrations applied to prod: `0000_initial_schema.sql`, `0001_rls_and_auth_trigger.sql`, `0002_role_default_creator.sql`, `0003_preflight_status.sql`. (`0003` was applied during the smoke test via the Supabase SQL editor — it had been missed before the deploy, which surfaced as a create-publication failure until applied; see section 14.) **Slice 4 added no migration** (reuses the existing `assets` table + `publications.cover_asset_id`).
- Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_QUARANTINE`, `R2_BUCKET_ARTIFACTS`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_IMAGES_API_TOKEN`, `CLOUDFLARE_IMAGES_ACCOUNT_HASH` (Slice 4), `RESEND_API_KEY` (now the **dedicated baxter.press Resend account's** key — replaced the torontocreatives key), `RESEND_FROM_ADDRESS` = `Baxter <notifications@baxter.press>`, `ADMIN_NOTIFICATION_EMAIL` = `benjamin@benjamingibson.ca` (Slice 5). All Sensitive, Production + Preview.
- **Inngest sync is MANUAL (`D-017`).** The Vercel-native Inngest integration is not installed (it risks re-provisioning the working `INNGEST_*` keys / a separate project). **Runbook: after deploying a slice that adds a NEW Inngest function, Resync** (Inngest → Apps → baxter-publishing → Resync) or the new function won't register. This is exactly what silently broke the Slice 5 email until resynced.
- R2 buckets: `baxter-quarantine` (CORS allowing `PUT` from the production origin), `baxter-clean` (no CORS — server-side access only).
- Inngest Cloud app `baxter-publishing` synced against the production endpoint.
- Cloudflare Images: enabled on account `502673a122d7ad2ba3a5ad4f71f5b07e` (Images & Stream $0/mo plan); account hash `kuZbDeDRpro6gw7ZktB7TQ`; named variants `cover` (1200w), `grid` (600w), `full` (1600w), all `fit: scale-down`. Public delivery via `imagedelivery.net`.
- **Resend (transactional email): two accounts.** The **authoritative** account for Baxter is the **dedicated `baxter.press` account** (created via GitHub login; free tier; domain `baxter.press` **Verified**, region `us-east-1`/North Virginia; its key is the one in Vercel's `RESEND_API_KEY`). The older account (holding `resend.torontocreatives.com`) is **no longer used** by this project — its key was replaced. Free tier = one verified domain per account, which is why a second account exists. Sends originate from `notifications@baxter.press`.

### Commit timeline (first session — through Slice 4)

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

**Since (later sessions):** Slice 5 shipped (`08f1979` ceremonial submission flow + admin notification; `7ce25f0` email from-address fix). The branded `baxter.press` email sender and Supabase auth SMTP added no application code — they were external-service + env changes, recorded in docs commits `c6c6ceb` (branded sender) and `937a9fa` (auth SMTP). `main` HEAD is `937a9fa`. (Intervening per-slice docs commits — Slice 3b review, Slice 5 plan/decisions — are omitted from the table above.)

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

## 12. Recommended next steps (archived)

> **Archived — superseded.** This section planned the Slice 3b build (decide the four design questions, open a fresh chat, write the preflight worker + result UI). All of it shipped: Slice 3b (sections 13–14), Slice 4 (section 15), Slice 5 (section 16), the branded `baxter.press` email sender (section 17), and Supabase auth SMTP (section 18 — which closed the "Custom SMTP" item this section originally flagged). **Slices 1–5 are closed; the next milestone is Slice 6 — the admin review queue.**

---

## 13. Slice 3b — shipped & production-verified

Implemented and pushed as commit **`8b9895b`**. **Status: LIVE in production** — migration `0003` applied, deployed, and the section 14 smoke test passed (all five preflight paths plus the retention sweep). The as-built design is recorded below; the earlier "pending go-live" framing has been retired now that it's verified.

### Schema — migration `0003_preflight_status.sql` (REQUIRED before/with deploy)

Hand-written, consistent with `0001`/`0002`. **Applied to prod** during the section 14 smoke test (via the Supabase SQL editor — it had been missed before the deploy, which surfaced as a create-publication failure until applied). The create action and the publication detail query reference these columns.

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
- Exercised against R2 / Inngest / Supabase in production and verified end-to-end (section 14).

### Known calibration gaps

- **Real low-DPI fixture** — needed; not yet sourced.
- **Real non-embedded-font fixture** — needed; not yet sourced.
- **DPI detection deferred** — the inspector returns "undetermined" for image DPI (no warning) until a content-stream parser is added and calibrated.
- **Font check is best-effort** — a font-dictionary walk that treats standard-14 as embedded-equivalent; unverified against real exports.
- Fixture status is tracked in `apps/web/test/fixtures/preflight/README.md`. The format rule defaults (page bounds, which formats require multiple-of-four, bleed, min DPI) live in `packages/domain/src/formats.ts` and are worth a calibration pass.

### Pre-existing ESLint 9 config issue (separate from Slice 3b)

`npm run lint` failed repo-wide at the time: ESLint 9.39.4 was installed (in the committed lockfile at `55ed70e`) but the packages still used the old `.eslintrc.json` format that ESLint 9 dropped. **Not caused by Slice 3b**, and production builds (which use `next build`) were unaffected. **Resolved** — migrated repo-wide to flat config (commit `aa9cd84`; see section 9, item 7).

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

Branded `baxter.press` email sender — **DONE** (section 17). Manual Inngest resync guardrail (`D-017`). Slice 5 test-data cleanup (publications `3b1744ea`, `3c617cd2`, `64c5c2e4`) was completed; the DB is back to zero publications.

---

## 17. Branded `baxter.press` email sender (shipped & verified)

The admin notification now sends from the brand domain. **No application code changed** — the Resend integration point (`apps/web/lib/email/resend.ts`, reads `RESEND_API_KEY` / `RESEND_FROM_ADDRESS`) was already in place from Slice 5; this was purely an external-service + env-var change, analogous to standing up Cloudflare Images in Slice 4.

### The account constraint (why a second Resend account)

Resend's free tier allows **one verified domain per account**, and the existing account already held `resend.torontocreatives.com`. Adding `baxter.press` to it (and the "Create Team" path) both hit a paywall. Rather than pay, a **new, dedicated Resend account** was created (GitHub login) to own `baxter.press`. That account is now the **authoritative** sender for Baxter; the older account is no longer used by this project. (See section 10 → Resend.)

### Setup steps performed

1. **Resend → Add domain `baxter.press`** (region North Virginia / `us-east-1`) in the new account → "Manual setup" revealed the DNS records.
2. **GoDaddy → DNS Management for `baxter.press`** → added three records (Save All Records → "Success"):

   | Type | Name | Value | Priority |
   |---|---|---|---|
   | TXT | `resend._domainkey` | the DKIM public key (`p=MIGfMA0GCSqGSIb3…wIDAQAB`, a 1024-bit RSA key — validated as 162 DER bytes before entry) | — |
   | MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |

   GoDaddy already had a default `_dmarc` TXT record, so **no DMARC record was needed**, and there were no conflicting SPF/DKIM/MX records. (Resend's underlying transport is Amazon SES, hence the `amazonses.com` SPF include and SES feedback MX.)
3. **Resend verification** flipped `baxter.press` to **Verified** ("Your domain is ready to send emails") within minutes — provider auto-detected as GoDaddy.
4. **Vercel env vars** (Production): `RESEND_API_KEY` replaced with the **new account's** key (pasted by the operator — never handled in-session), and `RESEND_FROM_ADDRESS` set to `Baxter <notifications@baxter.press>`. `ADMIN_NOTIFICATION_EMAIL` unchanged (`benjamin@benjamingibson.ca`). Redeployed.

**No Inngest resync was required** — no new function was added; the existing `publication-submitted-notify` is invoked at the stable production `/api/inngest` URL, so the redeploy's new env vars take effect automatically (consistent with `D-017`: resync is only needed for *new* functions).

### Production verification (executed via the Chrome extension)

A full end-to-end submission was run against production: created an A5 Zine "Baxter Sender Test", saved marketplace (description + $12.00), uploaded a clean 8-page A5 PDF → preflight **passed** (page count 8, cover/previews rendered) → read-only Review (eligibility green) → **Submit for review** → `in_review` + "Submitted." poster. The Resend **Emails** log then showed, within seconds:

- **From:** `notifications@baxter.press`
- **To:** `benjamin@benjamingibson.ca`
- **Subject:** "Submitted for review: Baxter Sender Test"
- **Events:** Sent → **Delivered**
- (Message id `7da08ee2-fe34-4a39-bd08-2d…`)

A Delivered status is itself proof the branded sender is correctly configured — Resend rejects any send whose From-domain isn't verified in the account, and `baxter.press` is the only verified domain there. (The Resend "Preview" pane shows empty only because `sendAdminEmail` sends plain `text`, not HTML — expected.)

### Test-data cleanup

The verification publication **"Baxter Sender Test"** (`1296dcd4-6fca-4a12-8c12-b7b05e5e9d5f`) was deleted from prod via the Supabase SQL editor (`cover_asset_id` nulled, then `DELETE` — cascading to its artifact, 6 `preview_page` assets, and `publication_events`); a follow-up count confirmed **zero publications remain**. Orphaned storage objects left for manual purge (the Cloudflare dashboard wedges browser automation):

- **R2 `baxter-clean`** — prefix `publications/1296dcd4-6fca-4a12-8c12-b7b05e5e9d5f/` (and check `baxter-quarantine` for the same prefix).
- **Cloudflare Images** — 6 ids: `56ca6a5f-8867-46df-9338-9aafd9317c00`, `663f352b-6b07-4dbb-8756-9ef1c0c1cc00`, `728eca90-3a4c-4427-dc12-80ecde773c00`, `9965c977-88e5-43c7-08c5-686172654a00`, `7f0a6aff-bd94-4377-71d3-6291db844a00`, `1b4c2641-e791-4b31-0979-17c23a8e0f00`.

### Residual

- **Supabase auth emails** are now sent via custom SMTP through the same Resend account — see section 18 (resolves outstanding item 2).
- The old torontocreatives Resend account/key is now dead weight (harmless); can be removed later.

---

## 18. Supabase auth email — custom SMTP via Resend (shipped & verified)

Resolves outstanding item 2. Supabase's authentication emails (magic link, confirm-signup, password recovery, etc.) no longer send from `noreply@mail.app.supabase.io`; they route through Resend's SMTP using the same dedicated `baxter.press` account as the transactional sender (§17).

**Config** — Supabase → Authentication → Emails → **SMTP Settings**, "Enable custom SMTP" on:

- **Sender:** `Baxter <notifications@baxter.press>`
- **Host / Port:** `smtp.resend.com` / `465`
- **Username:** `resend`
- **Password:** the baxter.press Resend account API key (the same `re_…` key as `RESEND_API_KEY`; pasted by the operator, never handled in-session)
- Enabling custom SMTP also raised Supabase's auth email rate limit to **30/hour** (adjustable).

**Verification (production):** sent a magic link to `benjamin@benjamingibson.ca` from Supabase → Authentication → Users. The Resend log shows it **Delivered** from **`"Baxter" <notifications@baxter.press>`** (subject "Your sign-in link", id `2672496d-…`). Supabase accepting the send (its success toast) is itself proof the SMTP handshake + credentials are valid; a bad config errors at that step.

**Notes:**
- Reuses the full-access Baxter key (operator's choice over a dedicated SMTP key) — one key now serves both the app's transactional sends and Supabase's auth SMTP.
- The Slice 2 confirm-signup HTML template (`infrastructure/supabase/email-templates/confirm-signup.html`, pasted into Supabase) is unaffected — only the transport/sender changed. The other stock templates (magic link, recovery, etc.) now at least send from the Baxter domain; tailoring their copy to the Constitution is a separate, optional polish.

---

## 19. Slice 6 — Admin review queue (shipped & production-verified)

The other half of the submission ceremony: an editor reads submitted work and decides; the creator learns the outcome. **Shipped as commit `bd17ab1` and verified live in production.** Decisions locked first as `D-019`/`D-020`/`D-021` (commit `954a36d`).

### The locked decisions (foundational, not just Slice 6)

- **`D-019` — state model unchanged.** No `approved`, no `rejected`, no migration. Two admin actions on an `in_review` publication: **Publish** (`in_review → published`) and **Request revisions** (`in_review → revisions`). Declining an edition is expressed as revisions + a written note, never a terminal reject state. Publishing is iterative, not transactional.
- **`D-020` — the editor writes, the software records.** Editorial feedback is always hand-written by the editor; reason codes are internal-only metadata (analytics/operational), never shown to creators, never templated into copy. The review surface **prioritises writing over clicking** — the note is the primary element; codes are a quiet secondary control.
- **`D-021` — two voices.** *Institutional Voice* states facts (calm, declarative — "Under review", "Published"); *Editorial Voice* is the editor's interpretation (the only place interpretation lives). Recorded in the Editorial Constitution; extends to all future outbound copy. A fourth Constitution principle was also added: **an editorial office, not a moderation platform** — the editor decides, never moderates/flags/rejects; the moderation lexicon is banned.

### What shipped

- **Reason-code vocabulary** — `packages/domain/src/reason-codes.ts`, internal-only, three groups (Production / Content and metadata / Editorial fit). No "violation" language by design.
- **Admin gate + shell** — `apps/web/app/(admin)/layout.tsx`: role-gated ("editorial desk"). A non-admin who knows the URL gets a **404** (not a redirect), revealing nothing. `lib/auth/admin-guard.ts` re-verifies the role on every admin page and action (defense in depth — a layout is not a security boundary for server actions).
- **The desk** — `/admin`: queue of `in_review` work, **oldest submitted first** (a queue, not a feed). Cover thumbnail, title, creator + handle, category, submitted date. Composed empty state.
- **The review page** — `/admin/[id]`: work-led (cover + previews), quiet metadata, creator identity, a signed download link to the print-ready PDF (`presignedGetUrl` on the clean bucket), preflight notes, and the decision desk.
- **The decision desk** (`review-desk.tsx`, client) — writing-first: a large serif note field is the primary element; reason codes are tucked into a collapsed "For Baxter's records" marked *"the creator never sees these"*. Two actions: Publish · Request revisions. Note required to return, optional to publish.
- **The action** (`decidePublication`) — re-verifies admin, checks the pure state machine, writes status (+`published_at` on publish) and an insert-only `publication_events` row (`payload = {action, reasonCodes, note}`) via the service-role client, emits `publication/decided`.
- **Decision email** — new `publication-decided-notify` Inngest function → two-voice creator email (Institutional frame around the editor's verbatim note). Publish: subject `Published: <title>`, body `<title> is now published.` Revision: subject `A note from Baxter on <title>`, body frames the editor's note + `Edit and resubmit when you're ready.`
- **Creator-facing states** — workspace shows **"From the editor"** (Editorial Voice, note verbatim) on `revisions` with the work editable/resubmittable, and a quiet **"Published · <date>"** (Institutional Voice) on `published`. Reason codes never appear.
- **No migration** (`D-019`) — reason codes + note live in the existing `publication_events.payload` jsonb.

### Verification

- **Typecheck, lint, `next build`** all green before deploy.
- **Deploy** — pushed to `main`; Vercel built `bd17ab1` successfully as the live production deployment.
- **Inngest resync (`D-017`)** — after deploy, re-registered the app; `{"modified": true}` confirmed the new `publication-decided-notify` function registered (2 → 3 functions). This is the mandatory manual step whenever a slice adds a new Inngest function.
- **Production smoke test — PASSED end to end** (driven via the Chrome extension; DB verified in the Supabase SQL editor). Access control 404s non-admins and opens for admins; the desk lists submitted work oldest-first; the note-required guard blocks an empty return; reason codes render internal-only in three groups; **Request revisions** moved `in_review → revisions` with `payload {action: request_revisions, reasonCodes: ["page_sequence"], note}` and the creator saw the note as "From the editor" (code hidden), and the revision email **Delivered** from `notifications@baxter.press`; **resubmit** returned it to `in_review`; **Publish** (no note) moved it to `published`, set `published_at`, wrote `payload {action: publish, note: null, reasonCodes: []}`, and the creator saw the quiet "Published" state. Test data was deleted afterward (DB back to zero publications).

### Notes / residuals

- The **publish decision email** was not directly viewed during the smoke test: Baxter sends from the dedicated **baxter.press** Resend account, and the browser was in the **torontocreatives** account. It is the same proven `publication-decided-notify` function/account that delivered the revision email (confirmed), and the DB shows the publish decision emitted the event — so delivery is effectively certain; view it in the baxter.press account as `Published: <title>` if hard confirmation is wanted.
- **Orphaned storage on publication delete is still not swept** (carried from Slice 4): the smoke-test publication's R2 prefix (`publications/<id>/`) and its 6 Cloudflare Images remain for manual purge. Harmless (free tier, unreferenced). A publication-deletion cleanup path is a pre-launch follow-up.
- **Admin role is set by hand in SQL** (`update public.users set role='admin' where handle='ben-in-toronto'`) — there is no admin-granting UI in v1, by design.

### Next

**Slice 7 — Marketplace shell.** The public home for `published` works (which today are data-live but only visible on the creator's own `[handle]` profile). Homepage sections (hero, editor picks, new releases), the public publication page, and basic browse/search — the "most important atmosphere slice" per the Constitution. Editor's Picks (an admin-controlled flag) was deferred from Slice 6 to here.

---

## 20. Slice 7 — Marketplace shell (shipped & production-verified)

The public home for `published` works — Baxter's front door. **Shipped as commit `8bd0a4e` and verified live in production.** Decisions locked first as `D-022`–`D-025` (commits `2039d18`, `6202f40`).

### The locked decisions (foundational, product-wide)

- **`D-022` — the front door.** The homepage *becomes* the marketplace (not a marketing page, not a storefront): the opening statement stays, then the work begins beneath it. Publication URL locked as **`/[handle]/[slug]`** (the creator is the primary author; their name is the address).
- **`D-023` — price is quiet metadata.** Price appears in the grid and on the page, but as the *quietest* element. A card is exactly **Cover → Title → Creator → Price**, nothing else — no badges, CTAs, urgency, or sale framing. Principle: *remove performative commerce, not commerce.*
- **`D-024` — the three actors.** Platform (Institutional Voice — the homepage/chrome), Editor (Editorial Voice — Editor's Picks), Creator (protagonist — the publication page). Surfaces keep them separate.
- **`D-025` — the homepage is a curated composition, not a feed.** Architected as an ordered list of typed sections (`composeHome()`), so future sections (seasonal, essays, featured creators, collections) slot in without assuming chronology. Also locks *no fictional signals* (Popular only when objectively earned) and *browse before search*.

### What shipped

- **Migration `0004`:** `editor_pick_at timestamptz` on publications (D-023 storage — a timeline, not a flag; partial index for the Picks shelf). Additive/idempotent; applied to prod before deploy.
- **`lib/marketplace/queries.ts`:** the public read layer (anon/RLS — published works, their assets, and users are all publicly readable) + the `composeHome()` seam (D-025). `getEditorsPicks` / `getNewReleases` / `getAllPublished` / `getCreatorPublished`, with bulk cover/creator resolution.
- **`PublicationShelf` + `PublicationCard`:** Cover → Title → Creator → Price, price the quietest line; natural cover aspect (no cropping), subtle hover, 3-across. Reused by homepage, browse, and profile.
- **Homepage front door** (`(marketing)/page.tsx`): opening statement retained, then the composed sections (Editor's Picks → New Releases) or a written empty state. Marketing prose relocated to a new `/about`.
- **`/[handle]/[slug]` publication page:** cover-dominant museum-catalogue page; the creator is the byline/protagonist (links to their room); quiet specs; price plain; **"Ordering opens soon."** (no cart, no disabled button); previews low. Admin-only Editor's Pick toggle (`editor-pick-toggle.tsx` + `toggleEditorPick` action, service-role, admin re-verified).
- **`/publications` browse:** all works + a quiet inline category filter (not a sidebar); **no search** (D-025 browse-before-search).
- **Creator profile** now lists real published works (was a placeholder). Shared `SiteHeader` across public surfaces.
- **No new Inngest function** — so no D-017 resync was needed this slice.

### Verification

- **Typecheck, lint, `next build`** all green (also cleared a stale pre-existing lint warning).
- **Migration** applied via the Supabase SQL editor and verified (`has_column = 1`, `has_index = 1`) *before* deploy.
- **Deploy** — pushed to `main`; Vercel built `8bd0a4e` successfully as the live production deployment.
- **Production smoke test — PASSED end to end** (driven via the Chrome extension). Front door renders (opening statement + empty state, then work); a published work ("Slice 7 Test") appeared in **New Releases** with the correct card hierarchy and price ($18.00 CAD) as the quietest line; the **`/[handle]/[slug]`** page rendered cover-dominant with the byline, quiet specs, plain price, "Ordering opens soon.", and low previews; **`/publications`** filtered correctly (Zine showed the work, Photobook showed the empty state); the **creator profile** listed the work; and the **Editor's Pick toggle** flipped to "Remove…" and grew an **Editor's Picks** section above New Releases on the homepage (the composeHome seam, live).

### Notes / residuals

- **The test publication is intentionally left live.** "Slice 7 Test" (`95abeb38-…`, slug `slice-7-test-27a569ef`, by `@ben-in-toronto`, $18.00) remains published and Editor's-Picked so the marketplace shows a real work for demos. It uses the synthetic clean-A5 fixture as its cover.
- **Reserved handles.** `/publications` and `/about` are concrete route segments that win over the `[handle]` dynamic route; no creator should be allowed to claim those handles (not enforced yet — minor pre-launch follow-up).
- **Popular / search deliberately omitted** (D-025) until there's real signal / catalogue size.
- **Reviews** remain deferred (table exists; UI later).

### Next

**Slice 8 — Stripe Connect + first purchase.** *(Now shipped — see section 21.)*

Beyond the business loop (Slices 8–10), the next major milestone — **Milestone 2: Native Publishing** (the in-app editor and creation workflows) — is now scoped and documented in `baxter-milestone2-editor-scope.md`.

---

## 21. Slice 8 — Stripe Connect + first purchase (shipped & production-verified)

Turns the "Ordering opens soon." boundary into a real transaction. **Shipped as commit `ee60a61` (+ fix `9bbb9db`) and verified live in production** — a real $18 test order was paid, recorded, and the funds held. Decisions `D-026`/`D-027` (commit `b1e714c`). **No migration** (the `orders`/`order_events` tables already existed).

### The money model (D-026 — held funds via separate charges and transfers)
The buyer's PaymentIntent is charged to **Baxter's platform account** with no `transfer_data`/`application_fee`; funds are **held** in Baxter's balance. The creator's payout (`total − platform fee`) is a **separate Stripe Transfer created at fulfilment** (Slice 9), recorded in `orders.stripe_transfer_id`. This matches the shipped schema + order state machine (`fundsHeld()`), and supersedes the plan's `application_fee_amount` (destination-charge) line, which would transfer at payment time and break held funds. Checkout is Baxter-hosted with the Stripe **Payment Element** (`D-027`), one question per screen.

### What shipped
- **Pricing** — `packages/domain/src/pricing.ts` (`computeOrderAmounts`: integer minor units; fee on subtotal; `creatorPayoutMinor = total − fee`).
- **Stripe lib** — `apps/web/lib/stripe/client.ts` (lazy, env-driven; degrades gracefully without keys).
- **Creator onboarding** — `/settings/payouts` ("Can Baxter pay you?"): creates an Express account with the `transfers` capability, mints an Account Link, syncs payout readiness. `stripe_*` written via service role.
- **Purchase affordance** — the publication page shows **"Own this publication"** when Stripe is live, the creator is payout-ready, there's a price, and the viewer isn't the creator; otherwise "Ordering opens soon."
- **Checkout** — `/[handle]/[slug]/buy` ("How will you pay?"): the held-funds PaymentIntent, Payment Element in Baxter's palette, optional shipping address for print. No cart, no urgency (`D-023`).
- **Webhook** — `/api/stripe/webhook`: `payment_intent.succeeded` → create order (`paid`) + `order_events`, idempotent; `account.updated` → sync creator payout readiness.
- **Buyer order pages** — `/orders/confirm` (return resolver) → `/orders/[id]` ("What happens next?"). Minimal `/admin/orders` ledger. Nav links for Payouts and Orders.
- **Deps** — `@stripe/stripe-js` + `@stripe/react-stripe-js` (React 19). No new Inngest function (no D-017 resync this slice).

### Stripe provisioning (test mode)
Set up in the **Toronto Creatives** account, test/sandbox: Connect enabled; webhook **"Baxter Publishing"** → `/api/stripe/webhook` for `payment_intent.succeeded` + `account.updated`, API version **2026-06-24.dahlia** (the account default `2015-10-16` predates PaymentIntents and would have sent broken payloads); four Vercel env vars (`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PLATFORM_FEE_BPS=1000`). Checklist: `baxter-slice8-stripe-setup.md`.

### Verification (production smoke test)
Passed end to end (driven via the Chrome extension; DB + Stripe confirmed): creator onboarding → payouts "set up" → publication buyable to a second account (`benjamin@benjamingibson.ca`) but not to the creator → checkout → **$18 test purchase** (`4242…`) → `payment_intent.succeeded` → order created **`paid`** (subtotal 1800, total 1800, **platform_fee 180**, shipping address captured, `order_events` pending→paid via `stripe_webhook`) → buyer "Thank you." page → `/admin/orders` lists it → Stripe shows the charge **Succeeded**, **net $17.03 held in the platform balance, no transfer to the connected account**.

**Bug found & fixed (`9bbb9db`).** Payout readiness was gated on `charges_enabled && payouts_enabled`, but a transfers-only connected account (our model) never has `charges_enabled` — so onboarding completed yet Baxter read "not finished." Now gated on `capabilities.transfers === 'active'` (payouts page + `account.updated` webhook).

### Notes / residuals
- **Test data intentionally left live** for Slice 9 to build against: the `$18` order (ref `61694821`, buyer `benjamin@benjamingibson.ca`) and the creator's Express connected account.
- **Stripe MCP is live-mode**; the test-mode order was verified in the Stripe **test** dashboard instead.
- **Commerce emails and the order-detail/fulfilment surface are Slice 9** (see below) — nothing emails yet.

### Next

**Slice 9 — OMS + fulfilment + commerce emails.** *(Now shipped — see section 22.)* The order-detail page (`/admin/orders/[id]`) with a downloadable print-ready PDF and the clickable state machine (`paid → in_fulfillment → fulfilled`); the **Transfer** at fulfilment that releases the held funds; and the commerce email set (buyer confirmation/receipt, creator "you made a sale", and the admin **production package** — signed print file + specs + delivery address — for any print order, including creators' own test prints). New Inngest functions → **D-017 resync** applies. Scoped in `baxter-slice9-design-questions.md`.

---

## 22. Slice 9 — Production economics + OMS + fulfilment + commerce emails (built & non-shipping-verified)

Built and deployed as commit **`eaead4d`**, with a one-line follow-up fix **`47e8b16`** (below). **Status: LIVE in production; non-shipping smoke test PASSED.** The live creator-earnings **transfer** and the **live-send** of commerce emails are the only pieces deferred — both require a correctly-priced order with live shipping, which is the dedicated EasyPost follow-up.

### What shipped

- **Print economics as the single source of truth (`D-029`).** `estimateProduction()` in `@baxter/domain` builds retail up from production: `retail = print cost + Baxter production margin + creator earnings`, and also returns estimated parcel **weight + dimensions**. The margin is **configurable** (`PRODUCTION_MARGIN_BPS`, default 30%), never hard-coded. **Baxter earns by manufacturing, not by taxing creators; and nothing from postage.**
- **Interior is explicit (`D-029`).** Black & white / Colour is declared on `/studio/new` (drives print cost), never inferred from format.
- **"Your earnings per copy."** The creator sets their earnings; the workspace shows a transparent breakdown (print, Baxter margin, earnings, retail). Buyers everywhere (publication page, marketplace grid, checkout) see the **retail**, never the earnings figure.
- **Test prints.** A creator can order a proof of their own work at **production cost only** — no margin, no earnings, no payout transfer (`is_test_print`).
- **OMS.** `/admin/orders/[id]` is the production package: specs (interior, pages, trim, binding, paper, est. weight, est. parcel), delivery address, a signed print-ready PDF link, full economics, and the fulfilment control. At **`fulfilled`**, the held creator earnings are released via a **separate Stripe Transfer** (skipped for proofs), stamping `stripe_transfer_id`/`fulfilled_at`.
- **Commerce emails.** `order/paid` (emitted by the Stripe webhook) fans out three emails via a new `order-paid-notify` Inngest function: buyer receipt, creator "your work sold" (skipped for proofs), and the admin **production package** (signed file + specs + address). Inngest **resynced** (`D-017`) — the app shows **4 functions** with `order-paid-notify → order/paid` registered.
- **Shipping as a separate live system (`D-030`).** A `ShippingProvider` abstraction with an EasyPost implementation behind a clean integration point; postage is pass-through (Baxter earns nothing). **Fail-safe:** with no `EASYPOST_API_KEY`, live shipping reports unavailable, physical checkout **creates no PaymentIntent**, and the buyer sees a calm Institutional "ordering is briefly unavailable" screen — *a paused sale over a wrong total.* Selected carrier service (carrier / service / cost / estimated delivery) is **persisted on every order** (migration `0006`) for reconciliation, support, and fulfilment; shown on the buyer receipt, admin order page, and admin production email when present.

### Migrations (applied to prod)

- **`0005_pricing_model.sql`** — `publications.interior` (existing rows backfilled to the **fail-safe `colour`** — overpricing a mono book is recoverable; underpricing a colour book as mono is not); `orders.print_cost_minor` / `creator_earnings_minor` / `is_test_print`; `platform_fee_minor` **repurposed** as the Baxter margin.
- **`0006_shipping_details.sql`** — `orders.shipping_carrier` / `shipping_service` / `shipping_estimated_delivery` (null until EasyPost is enabled).

Both additive and idempotent. Applied via the Supabase SQL editor.

### Non-shipping smoke test — PASSED (driven via the Chrome extension, admin account `ben-in-toronto`)

- **Retail computes correctly.** "Slice 7 Test" (8pp A5, backfilled to colour) shows **$23.33 CAD** = print $4.10 + 30% margin $1.23 + the creator's **$18.00** earnings. The buyer sees retail; the earnings figure is never exposed.
- **Shipping gate behaved correctly.** With no EasyPost key, the publication page shows "Ordering opens soon" (no buy link), and direct `/buy` renders the calm "Ordering is briefly unavailable" Institutional screen.
- **No PaymentIntent is created without live shipping.** The gate's early `return` fires before the Stripe call is ever reached — the calm screen rendering *is* the proof no intent was created.
- **Admin production package rendered correctly.** `/admin/orders/[id]` showed full specs (Colour, 8pp, 148×210mm, Saddle-stitch, 80lb/100lb, **61 g**, **210×148×4 mm** parcel), the delivery address (Ben Buyer, Toronto), the economics ($18.00 total), and the signed print-ready PDF link.
- **Fulfilment actor bug found and fixed.** The order state machine allowed `paid → in_fulfillment` for `creator`/`system` only — so the admin desk could Cancel but not begin fulfilment (`in_fulfillment → fulfilled` already included admin, so the actor list was simply incomplete). Fixed in **`47e8b16`** by adding `admin` to `paid → in_fulfillment`, consistent with the "Baxter manufactures and ships" model. Re-verified live: the desk moved the test order **`paid → in_fulfillment`**.
- **Commerce emails are wired and Inngest-resynced**, but **live-send verification remains deferred** until the first EasyPost-enabled paid order (Option A — no temporary shipping stub). `RESEND_API_KEY` is present in Vercel Production (from the existing Baxter email setup); a real send is gated behind a paid order.

### Test data

The `$18` order (ref `61694821`) is intentionally left in **`in_fulfillment`** as Slice 9 test data. It predates the new economics model (print cost $0, creator earnings $0, margin $1.80 from the old model), so it is **not** advanced to `fulfilled` — doing so would not exercise a real transfer, and its economics aren't representative. The first correctly-priced EasyPost order is where `fulfilled` + the live transfer get verified.

### Deferred to the EasyPost follow-up

1. Wire the live cheapest-rate quote into checkout (add `EASYPOST_API_KEY` + ship-from origin, redeploy). No checkout rewrite — the provider abstraction is already in place.
2. Verify a full **paid → fulfilled → creator-earnings transfer** cycle on a correctly-priced order.
3. Confirm the three commerce emails actually **send** (buyer receipt, creator sale, admin production package).
