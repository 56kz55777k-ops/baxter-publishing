# Baxter Publishing — Claude Code Handoff

**Date:** May 20, 2026
**From:** Ben Gibson (working with Perplexity Computer)
**To:** Claude Code
**Project:** Baxter Publishing — curated independent publishing marketplace
**Status:** Slice 2 (Auth + Creator Profile) — code complete, deployed to Vercel, runtime 500 on most pages — most likely an Edge cache issue that a fresh build should resolve. This document gives you everything you need to verify, diagnose, and finish Slice 2 safely.

---

## 1. Identity & roles

- **Account holder on most third-party tools:** Nik Varlamov (`nik@torontocreatives.com`).
- **Actual user / founder of Baxter:** **Ben Gibson** (`benjamin@benjamingibson.ca`). Address him as Ben.
- **Working mode the user prefers:** "I drive, you review at milestones." Concretely:
  - Ben runs commands in his Mac Terminal. You do not push to GitHub on his behalf.
  - You produce code, tarball it, walk him through extraction, commit, push.
  - All builds happen on Vercel — Ben's Mac has **no Node, no npm, no Homebrew**.
- **Editor Ben works with on Baxter side:** himself, with curation pass coming later.

---

## 2. The Editorial Constitution (binding — read this before touching copy or UI)

These are not preferences. Every UI string and design decision must pass these.

- **Attention Respect** — no dark patterns, no manufactured urgency, no count theatre, no exit-intent pop-ups, no autoplay, no "limited time".
- **Platform Humility** — Baxter sets the room; publications and creators must overshadow it. The platform chrome is a thin frame.
- **Composed Warmth** — human, never cold or performative. The voice is a small press, not a SaaS.
- **"Atmosphere is the moat."** — the differentiation is felt, not advertised.

**Forbidden tokens (do not generate, ever):**
- Exclamation points (`!` in copy).
- "We" used as Baxter's voice ("Baxter" is third-person; copy is observational).
- "Get started", "Awesome", "Great", emojis in product copy.
- "Within 5 business days" written ambiguously — always **"Reviewed within five business days."**
- Apologetic phrasing in error messages ("Sorry,...", "Oops!"). Errors name the issue directly and propose the next move.

**Type pairing (already wired):**
- **Shell / UI:** DIN proxy (DM Sans is the holding choice via `next/font/google`).
- **Editorial / body:** Fraunces with `opsz` and `SOFT` axes set.

Production Baxter will swap DM Sans for licensed DIN; do not change the proxy without Ben's say-so.

---

## 3. Repository & deploy targets

### GitHub
- **Repo:** https://github.com/56kz55777k-ops/baxter-publishing
- **Default branch:** `main`
- **Most recent commit at handoff:** `0f88d96` — "Slice 2: auth, profile claim, follow stub" (plus a follow-up empty commit Ben is pushing right now to bust Vercel's edge cache — the SHA after that push will supersede).
- **Important history note:** earlier today an erroneous commit (`08107f9`) was on `main`. Ben overwrote it with `git push --force-with-lease` and the current `0f88d96` is the correct state. Do not attempt to recover `08107f9`.
- **Collaborator situation:** Perplexity Computer's GitHub identity (`nevisme`) is not a collaborator on this repo. Ben is the only writer. If you (Claude Code) have write access via his Mac's `gh` auth, that's fine — confirm with `gh auth status` before pushing.

### Vercel
- **Project:** `baxter-publishing-web`
- **Production URL:** https://baxter-publishing-web.vercel.app
- **Org:** Benjamin's project (Hobby plan)
- **Region:** Washington, D.C. (`iad1`)
- **Latest build at handoff:** status **Ready**, commit `0f88d96`, duration 42s, deployed ~2 hours before handoff.
- **Framework auto-detected:** Next.js 15.5.18 via Turbo monorepo.
- **Install command:** `npm install --legacy-peer-deps` (Vercel infers this from `engines` + lockfile; do not change without testing).
- **Environment variables (Production + Preview, all four confirmed present):**
  - `NEXT_PUBLIC_SUPABASE_URL` = `https://qnqbkihndxppommgfrxd.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = (the `sb_publishable_...` key — **note: code uses `_PUBLISHABLE_KEY`, not the older `_ANON_KEY`**)
  - `SUPABASE_SERVICE_ROLE_KEY` = (server-only; do not expose)
  - `DATABASE_URL` = Supabase Postgres direct connection string
- **Missing env vars to add when Slice 3 begins:** `NEXT_PUBLIC_SITE_URL`, R2 keys, Stripe keys.

### Supabase
- **Project URL:** https://qnqbkihndxppommgfrxd.supabase.co
- **Project ref:** `qnqbkihndxppommgfrxd`
- **Dashboard owner:** Ben.
- **Migration policy:** OK to run migrations against production (no other environments yet, no real users). When real users exist this will change.
- **Tables (9):** `users`, `follows`, `publications`, `submissions`, `orders`, `audit_logs`, plus marketplace-supporting tables. Schema lives in `packages/db/migrations/0000_initial_schema.sql`.
- **RLS (20 policies):** `packages/db/migrations/0001_rls_and_auth_trigger.sql`. Two triggers run there: `on_auth_user_created` (inserts a `~pending-<uuid>` placeholder row into `public.users` when Supabase Auth creates a user) and the `updated_at` trigger.

### Ben's local workspace
- **Path:** `~/Downloads/baxter-app`
- **Git state:** `main` branch tracking `origin/main`.
- **`.env.local`:** present, mirrors the four Vercel env vars. Not in git.
- **No Node / npm / Homebrew installed.** This means:
  - You cannot ask Ben to run `npm install`, `npm run build`, or any node script locally.
  - If you need to verify a change builds, build it in your own sandbox and tarball the result for Ben, exactly the same pattern as below.

---

## 4. Current code state

### Stack
- **Framework:** Next.js 15.5 (App Router only) on React 19.
- **Monorepo:** Turborepo with `apps/web` and `packages/*`.
- **Styling:** Tailwind v3.4, with custom tokens declared in `apps/web/app/globals.css` and shared design tokens in `packages/ui-tokens/src/index.ts`.
- **Auth & DB:** Supabase (`@supabase/ssr` ^0.5.2, `@supabase/supabase-js` ^2.46.1) — App Router server client with cookie-bound RLS.
- **ORM (server-only):** Drizzle ORM ^0.36.4 (`drizzle-orm`) + `postgres` driver.
- **Payments (declared, not used yet):** `stripe` ^17.4.0.
- **Validation:** `zod` ^3.23.8.
- **Lint:** `eslint-config-next` ^15.5, shared config in `packages/eslint-config`.

### Repo layout (everything that exists on `main` right now)

```
.
├── README.md
├── decisions.md
├── docs/
│   ├── editorial-constitution.md
│   └── implementation-plan.md
├── package.json                 ← root: workspaces apps/* packages/*, React 19 overrides
├── package-lock.json
├── turbo.json
├── apps/
│   └── web/
│       ├── .eslintrc.json
│       ├── next.config.js       ← outputFileTracingRoot, transpilePackages, typedRoutes: false
│       ├── middleware.ts        ← root middleware, delegates to lib/supabase/middleware.ts
│       ├── package.json         ← Next 15.5, React 19, Supabase, Drizzle, Stripe, Zod
│       ├── postcss.config.js
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       ├── app/
│       │   ├── layout.tsx                            ← Fraunces + DM Sans, metadata
│       │   ├── globals.css                           ← tokens, prose-editorial, rule, gutters
│       │   ├── not-found.tsx                         ← "This page is not on the shelf."
│       │   ├── (marketing)/page.tsx                  ← Homepage (auth-aware in Slice 2)
│       │   ├── (auth)/
│       │   │   ├── layout.tsx                        ← Auth shell (Baxter wordmark + spare frame)
│       │   │   ├── actions.ts                        ← signUp, signIn, signOut + phraseAuthError
│       │   │   ├── sign-up/
│       │   │   │   ├── page.tsx                      ← "Create an account on Baxter."
│       │   │   │   ├── sign-up-form.tsx              ← Client component using useActionState
│       │   │   │   └── check-email/page.tsx         ← Composed "check your inbox" page
│       │   │   └── sign-in/
│       │   │       ├── page.tsx                      ← "Sign in to Baxter."
│       │   │       └── sign-in-form.tsx              ← Client component, reads ?next= for redirect
│       │   ├── (app)/
│       │   │   ├── layout.tsx                        ← Authed shell with sign-out
│       │   │   ├── studio/page.tsx                   ← Stub for Slice 3
│       │   │   └── settings/profile/
│       │   │       ├── page.tsx                      ← Two states: pending → claim, claimed → edit
│       │   │       ├── actions.ts                    ← claimHandle, updateProfile + validation
│       │   │       ├── claim-handle-form.tsx         ← Client component
│       │   │       └── update-profile-form.tsx       ← Client component
│       │   ├── (admin)/admin/page.tsx                ← Placeholder
│       │   ├── [handle]/page.tsx                     ← Public profile, includes signOut, refuses ~pending
│       │   └── api/follow/[handle]/route.ts          ← POST/DELETE follow, idempotent, refuses self-follow
│       ├── components/
│       │   └── follow-button.tsx                     ← Client toggle with optimistic state + revert
│       └── lib/
│           └── supabase/
│               ├── server.ts                         ← createServerClient bound to next/headers cookies
│               ├── browser.ts                        ← createBrowserClient
│               └── middleware.ts                     ← updateSession: refresh + route gates + pending-handle gate
└── packages/
    ├── db/
    │   ├── drizzle.config.ts
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── migrations/
    │   │   ├── 0000_initial_schema.sql
    │   │   ├── 0001_rls_and_auth_trigger.sql
    │   │   └── meta/
    │   └── src/
    │       ├── client.ts
    │       ├── index.ts
    │       └── schema.ts
    ├── domain/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts
    │       └── state-machines/
    │           ├── orders.ts
    │           └── publications.ts
    ├── eslint-config/
    │   ├── index.js
    │   └── package.json
    └── ui-tokens/
        ├── package.json
        ├── tsconfig.json
        └── src/index.ts
```

### Versions (critical — do not bump without testing)
- `next`: `^15.5.0`
- `react`, `react-dom`: `^19.0.0` (the root `package.json` declares `overrides` so the monorepo resolves React 19 everywhere — see `/package.json`)
- `@supabase/ssr`: `^0.5.2`
- `@supabase/supabase-js`: `^2.46.1`
- Node engine: `>=20.0.0`, `packageManager: npm@10.9.0`

### Slice 2 decisions already locked
1. **Handle on sign-up:** leave null at creation; trigger inserts a `~pending-<uuid-no-dashes>` placeholder; user is forced to claim a real handle before doing anything else.
2. **Password minimum:** **12 characters**, no strength meter (Editorial Constitution: do not perform anxiety theatre).
3. **Migrations:** OK to run against production Supabase.
4. **Email confirmation:** Supabase default — confirmation email required; user redirected to `/sign-up/check-email` after submitting; on click of confirmation link they land at `/settings/profile` (because `emailRedirectTo` is set if `NEXT_PUBLIC_SITE_URL` env var is configured — **currently not set on Vercel; you should set it so confirmation links route correctly**).
5. **Handle rules:** `^[a-z][a-z0-9-]{1,22}[a-z0-9]$`, no consecutive hyphens, reserved list defined in `apps/web/app/(app)/settings/profile/actions.ts`. Handles cannot be changed after claim (deferred to later slice).
6. **Pending-handle gate:** middleware bounces any signed-in user whose handle still starts with `~pending-` to `/settings/profile`. Public profile route 404s for pending handles.
7. **Follow:** idempotent POST/DELETE at `/api/follow/[handle]`. Refuses self-follow. Signed-out users see "Sign in to follow" which routes through `/sign-in?next=/<handle>`.

### Voice already shipped (do not paraphrase)
- Sign-up h1: **"Create an account on Baxter."**
- Sign-in h1: **"Sign in to Baxter."**
- 404 h1: **"This page is not on the shelf."**
- Profile claim h1: **"Choose how your name appears."**
- Homepage h1: **"Independent publishing, made carefully."**
- Homepage CTA: **"Begin a publication"** (never "Get started", never "Sign up free", never "Join now").
- All Supabase errors are translated via `phraseAuthError()` in `apps/web/app/(auth)/actions.ts`. Add new mappings there; do not surface raw Supabase strings.

---

## 5. The deployment incident — full timeline

This is what happened today. Read it before you touch anything — several of the failure modes are easy to re-introduce.

### Phase A — Built Slice 2 in sandbox (clean)
- Built all auth UI files, profile flow, public profile, follow button, follow API, updated middleware, updated homepage to be auth-aware.
- Discovered `useActionState` (React 19 hook) was being imported under React 18 — bumped `apps/web/package.json` to React 19 and added monorepo `overrides` block to root `package.json` so `@supabase/ssr` and Next would resolve a single React 19 instance.
- `npm run build` ran clean in sandbox: 10/10 routes generated, no type errors.
- Packaged `baxter-slice2.tar.gz` (229K) for Ben.

### Phase B — Ben extracted and pushed (where things went sideways)
- Ben downloaded the tarball, but the **extraction step was skipped** on his first attempt. He instead committed and pushed whatever was sitting in `~/Downloads/baxter-app` — which was still Slice 1.
- He then ran `npm install` to verify — failed with `zsh: command not found: npm` (no Node installed locally).
- In trying to "fix" this, he ran `rm package-lock.json` and committed the deletion. That commit `08107f9` reached `main`.
- Vercel auto-deployed `08107f9`. Pages returned **404** — because the Slice 2 routes (`(auth)`, `[handle]`, `not-found.tsx`, `api/`) had never reached the repo.
- We confirmed the missing folders via the GitHub Contents API and confirmed locally with `ls -la apps/web/app` that only Slice 1 folders existed on his Mac.

### Phase C — Recovery: extract the tarball, force-push
- Walked Ben through: backup the slice-1 directory aside, extract `baxter-slice2.tar.gz` over `~/Downloads/baxter-app`, restore his `.env.local` and `.git/`, `git add -A`, `git commit`.
- `git push` was rejected: no upstream set on the new commit and `main` had diverged.
- `git pull --rebase` hit a merge conflict on `package-lock.json` (the deleted-then-restored lockfile).
- `git rebase --abort`, then `git push --force-with-lease` succeeded. New SHA: `0f88d96`. Old `08107f9` is gone from `main`.

### Phase D — Vercel rebuild, but pages still 500
- Vercel auto-built `0f88d96`. Status: **Ready**. Duration: 42s. Confirmed via Deployments tab.
- Curl probes:
  - `/` → **500** with `x-matched-path: /500`, `x-next-error-status: 500`, **`age: 5810`** (≈1.6 hours old), `last-modified: 2026-05-21T00:17:07Z`.
  - `/settings/profile` → **307** redirect to `/sign-in?next=...` ← **middleware is working correctly**, which proves the server is alive and the build is good.
  - `/sign-up`, `/sign-in`, `/not-a-real-page` → also 500, also from cache.
- The 500 HTML was Pages-Router-style (`pages/_error`, `_app`), not App Router — confirming it's a **static cached error page**, not a fresh server crash.
- Vercel Logs → **"There are no runtime logs in this time range"** → no function invocations at all → confirms the 500 is being served from the edge cache, not from a runtime error.

### Phase E — Where the handoff sits right now
- The diagnosis is: Vercel's CDN cached a 500 page from the earlier broken deploy (`08107f9`, when routes were 404'd). The new `Ready` deploy `0f88d96` exists and should serve correctly, but the cache is intercepting.
- The fix prescribed to Ben (in progress at handoff): an **empty commit** to force a new deploy that issues a fresh `last-modified` and busts the edge cache.

  ```bash
  cd ~/Downloads/baxter-app
  git commit --allow-empty -m "redeploy to bust edge cache"
  git push
  ```

- If you (Claude Code) are picking this up after Ben has done that:
  - Probe `/`, `/sign-up`, `/sign-in`, `/not-a-real-page`, `/settings/profile` and check the `age:` header.
  - If `age:` is fresh (small number) and status is **200** for the public pages, the cache is gone and you can proceed to the smoke test in section 7.
  - If `age:` is still large, run the empty-commit fix again or perform a hard "Redeploy without build cache" from the Vercel UI.
- If the homepage is **still 500** with a *small* `age:`, that's a real runtime error — see section 6 for the diagnostic playbook.

---

## 6. Diagnostic playbook (in case the homepage is genuinely 500 after a fresh build)

Run these in order:

1. **Confirm the deploy is actually serving.**
   ```bash
   curl -sI https://baxter-publishing-web.vercel.app/ | head -20
   ```
   Look for `x-vercel-cache: MISS` and `age: 0` (or very small). If `age` is large, the cache is still serving stale; redeploy.

2. **Confirm middleware is alive.**
   ```bash
   curl -sI https://baxter-publishing-web.vercel.app/settings/profile | head -10
   ```
   Should be `HTTP/2 307` with `location: /sign-in?next=%2Fsettings%2Fprofile`. If it's 500, middleware itself is crashing (most likely env-var or `@supabase/ssr` resolution issue).

3. **Read the actual Vercel runtime log.**
   - Dashboard → `baxter-publishing-web` → **Logs** (top nav, not the per-deploy Logs button).
   - Filter: Last 5 minutes. Refresh the homepage in another tab. Click the red 500 entry. Expand the function/runtime log.
   - If there are no runtime logs at all → it's still cache, not runtime.
   - If there is a stack trace → the most likely roots are:
     - **Env var name mismatch** — code references `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Vercel currently has that exact name (confirmed). If you ever see `_ANON_KEY` instead, either rename on Vercel or update the three call sites in `apps/web/lib/supabase/{server,browser,middleware}.ts`.
     - **React duplicate** — if React 18 sneaks back into the resolution, anything using `useActionState` crashes. Root `package.json` has the `overrides` block; do not remove.
     - **Server action import boundary** — `signOut` is imported from `app/(auth)/actions.ts` into both `app/(marketing)/page.tsx` and `app/[handle]/page.tsx`. The file has `'use server'` at the top, which makes that legal. If a build ever moves `signOut` to a non-`'use server'` file, the import chain crashes server components.
     - **Missing `NEXT_PUBLIC_SITE_URL`** — referenced in `signUp` action as `emailRedirectTo`. If unset, the action falls back to `undefined`, which Supabase tolerates — Slice 2 still works, but the email link will land on Supabase's default, not on `/settings/profile`. **Set this on Vercel now** to `https://baxter-publishing-web.vercel.app` (or the custom domain when it's wired).

4. **If you suspect the lockfile is mismatched** (after the delete/restore drama):
   - From your sandbox, `git pull` the repo, `npm install --legacy-peer-deps`, `npm run build`. If the build is clean, the lockfile is fine.
   - Do not have Ben run npm locally — he has no Node. Tarball any fix and walk him through git replace + commit + push.

5. **If everything else looks fine but the homepage still 500s and you suspect the auth-aware change is at fault** — temporarily revert `apps/web/app/(marketing)/page.tsx` to a static version (no `createClient`, no `signOut` import). If that single change resolves the 500, the bug is in the homepage's server component; reintroduce in small steps and watch the logs.

---

## 7. Slice 2 smoke test (once the homepage loads)

Run this in order. Ben will be on the live site; you watch results.

1. **Homepage loads.** `/` returns 200, renders the editorial copy, "Begin a publication" links to `/sign-up`. Header shows "Sign in" (signed-out state).
2. **Sign up.** `/sign-up` → enter `benjamin@benjamingibson.ca` + a ≥12-character password → submit. Lands on `/sign-up/check-email`.
3. **Confirmation email arrives** from Supabase (check Supabase dashboard → Auth → Templates if it doesn't). Click the link.
4. **Land on `/settings/profile`** with the "Choose how your name appears." heading and the handle claim form (because the user still has a `~pending-...` handle).
5. **Claim a handle** (e.g. `ben`). On success: redirect to `/ben` (the public profile). The profile shows display name = handle (no display name set yet), no bio, follower count 0, "Edit profile" link (because it's self).
6. **Edit profile.** From `/ben`, click "Edit profile" → lands on `/settings/profile` in claimed state. Set display name and a bio. Save. Returns success state, revalidates layout, link reads "baxter.press/ben".
7. **Sign out** from the header form. Lands on `/`. Header now shows "Sign in".
8. **Visit `/ben`** while signed out. Profile loads. Follow button reads "Sign in to follow". Clicking routes to `/sign-in?next=/ben`.
9. **Sign in.** Enter the same email + password. After sign-in: because handle is no longer pending, lands at `/studio` (which is a Slice-3 stub — will render the stub page, not 404).
10. **Self-follow guard.** While signed in as `ben`, manually POST `/api/follow/ben` from the browser console:
    ```js
    fetch('/api/follow/ben', { method: 'POST' }).then(r => r.json()).then(console.log)
    ```
    Should return `{message: "You cannot follow your own profile."}` with status 400.
11. **Follow flow (second account).** Create a second account (different email), confirm, claim handle `ben2`. Visit `/ben`. Click Follow. Button toggles to "Following". Refresh — follower count on `/ben` reads 1.
12. **404 page.** Visit `/not-a-real-page` → renders "This page is not on the shelf."
13. **Pending-handle gate.** Don't claim a handle on the second account immediately. Try to visit `/studio` directly — middleware should bounce to `/settings/profile`.
14. **API auth gate.** While signed out, POST `/api/follow/ben` from a curl: should return 401 with the message "Sign in to follow creators."

If any step fails, fix the cause, redeploy, retest. Do not move on to Slice 3 with a red smoke test.

---

## 8. Shared artifacts (workspace files Ben has)

All paths below are relative to the Perplexity sandbox at `/home/user/workspace/`; Ben has equivalents downloaded:

- **`baxter-slice2.tar.gz`** (229K) — the Slice 2 source tarball. Already extracted to `~/Downloads/baxter-app` and pushed. Keep around as a snapshot.
- **`baxter-slice2-handoff.md`** — the previous handoff doc (mid-Slice-2). Superseded by this document.
- **`baxter_week1_plan.md`** — the original Slice 1 + Week 1 plan.
- **`baxter_tone_doctrine.md`** — the voice rules, expanded.
- **`baxter_pairing_a.png`, `baxter_pairing_b.png`, `baxter_pairing_c.png`** — the type pairing studies. Pairing B (DIN × Fraunces) was selected.

Ben also has:

- **Editorial Constitution** committed at `docs/editorial-constitution.md` in-repo.
- **Implementation plan** committed at `docs/implementation-plan.md`.
- **Decisions log** at `decisions.md` in repo root.

---

## 9. What comes next after Slice 2 is green

The full plan is in `docs/implementation-plan.md`. The pending items from the top-of-mind tracker are:

5. Publication shell creation (metadata, format, category, draft state)
6. PDF upload via R2 presigned URLs + quarantine bucket pattern
7. PDF preview generation + basic preflight checks
8. Ceremonial submission flow (multi-stage with live preflight)
9. Admin review queue with approve/reject/request-revision actions
10. Marketplace shell (homepage browse, publication page, creator profile w/ work)
11. Stripe Connect checkout + held-funds pattern
12. OMS state machine + audit log + admin email to `benjamin@benjamingibson.ca`
13. Risk spikes: Konva editor PoC, DocRaptor vs react-pdf print test
14. End-to-end smoke test of the full business loop

**Slice 3 will likely be the publication shell + R2 upload pattern.** Add `NEXT_PUBLIC_SITE_URL`, R2 credentials, and the R2 bucket name to Vercel env vars before starting Slice 3 work.

---

## 10. Gotchas to keep in mind

- **Never push directly to `main` as Claude Code without confirming with Ben** — he is the only authorized committer historically. If `gh auth status` shows you as Ben on his Mac, fine; otherwise, tarball-and-walk-through.
- **Ben has no Node locally.** Do not write instructions that assume `npm` is available. Every build runs on Vercel.
- **React 19 is required.** If you ever touch `apps/web/package.json` or the root `package.json` `overrides` block, run a sandbox build to confirm no React-18 ghost slips back in.
- **`@supabase/ssr` cookie handlers must use `getAll/setAll`, not the deprecated `get/set/remove`.** All three Supabase client files already do this. Keep it.
- **The two server actions in `app/(auth)/actions.ts` (`signUp`, `signIn`, `signOut`) and `app/(app)/settings/profile/actions.ts` (`claimHandle`, `updateProfile`) all return typed `AuthState` / `ProfileState` discriminated unions used by `useActionState` in the client forms.** Adding new fields requires updating both the action return type and the form's render branches.
- **Migrations are not yet wired into a CI step.** Running them is manual (Supabase SQL editor or `drizzle-kit`). When Slice 3 adds publication tables, write the migration as `0002_*.sql` and apply it through the Supabase SQL editor.
- **No exclamation points, ever.** This bears repeating because it slips through autocompletion.
- **The admin email for OMS notifications is `benjamin@benjamingibson.ca`.** Hard-code it once in Slice 3's email-out path; do not put it in code searchable elsewhere.

---

## 11. Sign-off

State of the world at handoff:

- Slice 2 code is on `main` at `0f88d96` (or one empty-commit forward, after Ben's cache-bust push).
- Vercel build is Ready.
- Production is serving a stale cached 500. A fresh push or no-cache redeploy should clear it.
- Middleware is verified alive. Supabase env vars are present and correctly named.
- Database has all Slice 1 + 2 tables and policies.
- Smoke test (section 7) is the next concrete action once the homepage returns 200.

Welcome to Baxter. Hold to the room.
