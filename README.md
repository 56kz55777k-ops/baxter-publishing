# Baxter

A curated marketplace for independent publications — zines, art books, photo journals, chapbooks, monographs.

> Atmosphere is the moat.

This repository is the Baxter codebase. The editorial doctrine that governs every visual and copy choice lives in [`docs/editorial-constitution.md`](./docs/editorial-constitution.md). Architectural decisions live in [`decisions.md`](./decisions.md).

---

## Repository layout

```
baxter/
├── apps/
│   └── web/                  # Next.js 15 — marketing, app, admin route groups
│       ├── app/
│       │   ├── (marketing)/  # public-facing editorial surfaces
│       │   ├── (app)/        # authenticated creator surfaces
│       │   ├── (admin)/      # admin review queue
│       │   └── api/inngest/  # workflow webhook
│       ├── components/
│       │   ├── ui/           # primitives, no business logic
│       │   ├── editorial/    # composed editorial pieces
│       │   └── admin/        # admin-only surfaces
│       └── lib/
│           ├── supabase/     # browser + server clients
│           ├── r2/           # presigned URLs, bucket access
│           ├── stripe/       # Connect onboarding, intents, transfers
│           └── inngest/      # event definitions
├── packages/
│   ├── db/                   # Drizzle schema, migrations, server client
│   ├── domain/               # pure TS state machines, pricing, preflight
│   ├── ui-tokens/            # color, type, spacing, motion tokens
│   └── eslint-config/        # shared lint config
├── infrastructure/
│   ├── supabase/             # SQL: RLS, policies, migrations
│   └── inngest/              # workflow definitions
└── docs/
    └── editorial-constitution.md
```

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router, Server Components) |
| Database | Supabase Postgres |
| Auth | Supabase Auth |
| Object storage | Cloudflare R2 (S3-compatible, no egress) |
| Image delivery | Cloudflare Images |
| Payments | Stripe Connect (Express) — separate charges + transfers |
| Email | Resend |
| Workflows | Inngest |
| ORM | Drizzle |
| Styling | Tailwind |
| Monorepo | Turborepo + npm workspaces |
| Hosting | Vercel |
| PDF rendering | DocRaptor (TBV — Spike B) |
| Editor canvas | Konva / react-konva (TBV — Spike C) |

---

## Getting started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Copy `.env.example` to `.env.local`** and fill in the values for Supabase, R2, Stripe, Resend, and Inngest.

3. **Generate the database schema**
   ```bash
   cd packages/db
   npm run generate    # writes SQL migration to migrations/
   npm run migrate     # applies it to Supabase
   ```

4. **Run the web app**
   ```bash
   npm run dev
   ```
   The marketing site lives at `/`. The auth flow at `/sign-in`. The admin queue (once Slice 5 lands) at `/admin`.

5. **Lint & typecheck**
   ```bash
   npm run lint
   npm run typecheck
   ```

---

## Editorial discipline

This codebase has constitutional rules that override convenience:

- **Never use exclamation points in user-facing copy.**
- **Never use the word "we" as Baxter.**
- **Never use "Get started", "Let's go", "Awesome", "Great", "Oops", or other casual idioms.**
- **Always name time directly.** "Reviewed within five business days" — not "soon", not "shortly".
- **Business logic does not live in React components.** It lives in `packages/domain`.
- **State changes go through the state machines.** Direct writes to `publications.status` or `orders.status` without going through `canTransition` / `canTransitionOrder` are bugs.

See [`docs/editorial-constitution.md`](./docs/editorial-constitution.md) for the full doctrine.

---

## Where things live

- **Data model** → `packages/db/src/schema.ts`
- **State machines** → `packages/domain/src/state-machines/`
- **Design tokens** → `packages/ui-tokens/src/index.ts` (mirrored in `apps/web/app/globals.css`)
- **Editorial constitution** → `docs/editorial-constitution.md`
- **Architectural decisions** → `decisions.md`
- **Implementation plan** → `docs/implementation-plan.md`

---

## License

All rights reserved. Internal repository.
