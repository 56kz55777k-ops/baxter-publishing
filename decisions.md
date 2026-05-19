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

## Open Decisions (deferred to later slices)

- **PDF rendering pipeline** — DocRaptor vs `react-pdf` vs Vercel function with Puppeteer. Spike B.
- **Editor canvas** — Konva/react-konva proven against a single-page layout. Spike C.
- **Inngest topology** — which workflows are durable steps vs server actions vs cron. Slice 5–6.
- **DIN licensing** — when to pull DM Sans and license real DIN. After Slice 4 ship.
