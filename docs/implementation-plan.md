# Baxter Publishing — Week 1 Implementation Plan

**Milestone 1 goal:**
A creator can sign up → create a publication shell → upload a print-ready PDF → submit for review → admin approves → publication appears in marketplace → buyer places a test order → order enters the OMS.

This proves the full business loop. Editor work happens in parallel as a guarded prototype route.

---

## 1. Build philosophy for Week 1

- **Vertical slices, not horizontal layers.** Each slice ends in something a real user can click. No "build the whole data layer first."
- **Mock what isn't on the critical path.** Email goes to a console logger first, then Resend. Stripe runs in test mode. R2 can be a local MinIO container day-1 if R2 setup is slow.
- **Schema-ready for v1.1, scoped for v1.** The data model anticipates editions, comments, multi-creator collaborations, multiple fulfillment partners — but the UI only exposes what's in scope.
- **State machines are explicit from day one.** Publications and orders both. Allowed transitions enforced at the DB layer (CHECK constraints + a transitions table), not in application code.

---

## 2. Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────┐
│  Next.js 15 (App Router) — single codebase, three surfaces      │
│  ├─ /(marketing)        Public homepage, about, creator pages   │
│  ├─ /(app)              Creator studio, library, submissions    │
│  └─ /(admin)            Review queue, OMS, curation             │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼──────────────────┐
            │                 │                  │
            ▼                 ▼                  ▼
   ┌──────────────┐  ┌────────────────┐  ┌──────────────┐
   │  Supabase    │  │  Cloudflare R2 │  │   Stripe     │
   │  ├─ Postgres │  │  ├─ quarantine │  │   Connect    │
   │  ├─ Auth     │  │  ├─ originals  │  │              │
   │  └─ RLS      │  │  └─ artifacts  │  └──────────────┘
   └──────────────┘  └────────────────┘
                              │
                              ▼
                     ┌────────────────┐
                     │ Cloudflare     │
                     │ Images (public │
                     │ delivery)      │
                     └────────────────┘

   Async work (Resend email, preflight jobs, payouts):
   → Inngest (workflow engine, gives us retries + observability)
```

**Why this shape:**
- Single Next.js app keeps deploys simple. Route groups give us clean separation of marketing/app/admin without three codebases.
- Supabase handles DB + auth + RLS. We use it as Postgres-with-batteries, not as a backend framework.
- R2 holds private originals and PDFs; Cloudflare Images is the public delivery layer for thumbs/previews.
- Inngest is the workflow engine for any work that isn't a request/response — preflight, email, payouts, retries. Doubles as the OMS state machine driver later.

---

## 3. Repository structure

```
baxter/
├── apps/
│   └── web/                       # The Next.js app (only app for v1)
│       ├── app/
│       │   ├── (marketing)/       # Public surfaces
│       │   ├── (app)/             # Authenticated creator/buyer
│       │   ├── (admin)/           # Admin-only
│       │   ├── api/
│       │   │   ├── upload/        # R2 presigned URL minting
│       │   │   ├── stripe/        # Webhooks
│       │   │   └── inngest/       # Inngest webhook
│       │   └── layout.tsx
│       ├── components/
│       │   ├── ui/                # Primitives (Button, Card, etc.)
│       │   ├── editorial/         # Brand components (PublicationCard, HeroFeature)
│       │   └── admin/
│       └── lib/
│           ├── supabase/
│           ├── r2/
│           ├── stripe/
│           └── inngest/
├── packages/
│   ├── db/                        # Drizzle schema + migrations
│   ├── domain/                    # Pure TS: state machines, pricing, preflight
│   ├── ui-tokens/                 # Design tokens (colors, type, spacing)
│   └── eslint-config/
├── infrastructure/
│   ├── supabase/                  # SQL migrations, RLS policies
│   └── inngest/                   # Function definitions
└── turbo.json
```

**Key discipline:** `packages/domain` is pure TypeScript with no React, no DB, no network. Order state transitions, pricing math, preflight rules, submission validation — all live here as testable functions. This is what lets us add a mobile app later without rewriting business logic.

---

## 4. The data model (Week 1 scope)

I'll write this as Drizzle schema in code, but here's the shape — annotated with what's in v1 vs. future-ready.

### Core entities

```ts
// users — managed by Supabase Auth, mirrored here for relations
users (
  id uuid pk                       // = auth.users.id
  email text unique
  display_name text
  handle text unique               // @nikvarlamov
  bio text
  avatar_key text                  // R2 key
  role enum                        // 'creator' | 'admin' | 'buyer' (default: creator+buyer)
  stripe_connect_id text           // null until creator onboards to payouts
  created_at timestamptz
)

// publications — the work itself
publications (
  id uuid pk
  creator_id uuid fk users
  title text
  slug text                        // generated, unique per creator
  description text
  category text                    // 'photobook' | 'zine' | 'magazine' | ...
  subject_tags text[]              // 'documentary', 'queer', 'political', etc.
  is_political bool                // triggers the extended review notice
  format_id uuid fk publication_formats
  page_count int
  creation_mode enum               // 'studio' | 'pdf_upload'
  status enum                      // see state machine below
  cover_image_key text             // R2 key, surfaced via Cloudflare Images
  pricing jsonb                    // { physical_msrp_cents, digital_msrp_cents, ... }
  edition_info jsonb               // future: limited, signed, numbered
  published_at timestamptz
  created_at timestamptz
  updated_at timestamptz
)

publication_formats (              // seeded: zine_a5, magazine_a4, photobook_square, etc.
  id uuid pk
  name text
  trim_width_mm numeric
  trim_height_mm numeric
  bleed_mm numeric
  min_pages int
  max_pages int
  page_count_multiple int          // e.g. 4 for saddle-stitch
  base_print_cost_cents int        // for v1 pricing math
)

// artifacts — versioned print-ready files (uploaded PDF or studio-rendered)
artifacts (
  id uuid pk
  publication_id uuid fk
  version int
  source enum                      // 'uploaded' | 'studio_rendered'
  storage_key text                 // R2 key
  byte_size bigint
  sha256 text                      // content-addressed, dedup
  page_count int
  preflight jsonb                  // structured check results
  preflight_status enum            // 'pending' | 'passed' | 'warnings' | 'failed'
  created_at timestamptz
  UNIQUE (publication_id, version)
)

// assets — uploaded images (covers, editor assets later)
assets (
  id uuid pk
  owner_id uuid fk users
  storage_key text
  status enum                      // 'pending' | 'clean' | 'rejected'
  mime_type text
  byte_size bigint
  width int
  height int
  dpi int
  sha256 text
  created_at timestamptz
)

// orders — both creator self-orders and marketplace purchases
orders (
  id uuid pk
  order_number text unique         // human-readable: BX-2026-0001
  type enum                        // 'creator_self' | 'marketplace'
  buyer_id uuid fk users
  publication_id uuid fk
  artifact_id uuid fk              // the exact artifact version being printed
  quantity int
  status text                      // FSM state, see below
  pricing jsonb                    // full breakdown: print, platform, creator, taxes, shipping
  shipping_address jsonb
  stripe_payment_intent_id text
  stripe_charge_id text
  digital_download_token text      // for digital purchases
  created_at timestamptz
  paid_at timestamptz
  shipped_at timestamptz
  completed_at timestamptz
)

// order_events — append-only audit log
order_events (
  id uuid pk
  order_id uuid fk
  actor_id uuid                    // null for system events
  actor_type enum                  // 'system' | 'admin' | 'buyer' | 'creator'
  event_type text                  // 'state_changed', 'note_added', 'refund_issued', ...
  payload jsonb
  created_at timestamptz
)

// publication_events — same pattern for publication moderation history
publication_events (
  id uuid pk
  publication_id uuid fk
  actor_id uuid
  actor_type enum
  event_type text                  // 'submitted', 'approved', 'rejected', 'revision_requested'
  payload jsonb                    // reason codes, comments
  created_at timestamptz
)

// reviews — star + written, post-purchase only
reviews (
  id uuid pk
  publication_id uuid fk
  buyer_id uuid fk
  order_id uuid fk                 // proof of purchase
  stars int                        // 1-5
  body text
  status enum                      // 'pending' | 'published' | 'hidden'
  created_at timestamptz
)

// follows
follows (
  follower_id uuid fk users
  followee_id uuid fk users
  created_at timestamptz
  PRIMARY KEY (follower_id, followee_id)
)
```

### State machines

**Publications:**
```
draft → submitted → under_review → {approved, revision_requested, rejected}
approved → published
revision_requested → draft
published → unpublished | archived
```

**Orders (per V2 brief §31):**
```
pending_payment → paid → preparing_files → preflight_review →
sent_to_printer → printing → binding → packing → shipped → completed

Branches:
* → cancelled (with rules — can't cancel after shipped)
paid → refunded
completed → reprint_required → preparing_files
```

Both state machines are enforced via a `state_transitions` table that lists allowed `(from, to, role)` tuples, checked in a Postgres function called on every status update. This is what makes the state machine "real" rather than a status column.

---

## 5. Module-by-module Week 1 scope

Following your milestone definition, here's the slice list. Each slice is ~1 day of work, ends in something clickable.

### Slice 1: Foundation (Day 1)
- Turborepo + Next.js 15 + TypeScript + Tailwind + Drizzle scaffold
- Supabase project + RLS baseline
- Design tokens applied: DIN headings, neutral palette, type scale
- Working `/` homepage in brand tone (static, no data yet)
- Deploy to Vercel preview from day one

**Demo at end:** Visit a deployed URL, see the Baxter homepage in correct tone.

### Slice 2: Auth + Creator Profile (Day 2)
- Supabase Auth: email + magic link
- Onboarding: pick handle, display name, brief bio
- `/[handle]` creator profile page (empty state with quiet copy)
- Profile edit screen
- Follow/unfollow button (stub — DB only, no notifications)

**Demo at end:** Sign up as two test users, follow each other, see each other's profiles.

### Slice 3: Publication Shell + R2 Upload (Day 3)
- `/studio/new` flow: pick format, page count, mode (Studio | PDF Upload)
- Save as `draft` publication
- For PDF Upload mode: R2 presigned URL flow, direct browser→R2 upload, file lands in `baxter-quarantine` bucket
- Inngest worker: validate file, run preflight, promote to `baxter-artifacts` bucket, update DB
- `/library` page showing the creator's draft publications

**Demo at end:** Create a publication, upload a real PDF, see it appear in library with preflight results.

### Slice 4: Preview Generation + Preflight UI (Day 4)
- Inngest job: render first ~6 pages of PDF to JPEG previews via `pdf-lib` + `sharp` (or `pdfjs` headless)
- Cover thumbnail extraction
- Preflight checks (pure TS in `packages/domain`):
  - Page count vs format min/max
  - Bleed presence
  - Embedded fonts
  - Min DPI per image
  - Page dimensions match format
- Preflight result UI on the publication detail page: green checks + warnings + blocking failures

**Demo at end:** Upload a problem PDF, see specific warnings; upload a clean PDF, see all green.

### Slice 5: Ceremonial Submission Flow (Day 5)
- Multi-step submission UX (per V2 brief §21):
  1. Publication summary
  2. Live preflight check
  3. Marketplace info (pricing, description, tags)
  4. Category declaration (with extended notice if political)
  5. Review notice ("Your work will be reviewed by our editorial team. This typically takes 2–5 days.")
  6. Final submit
  7. Confirmation state — generous, calm, no startup-y celebration
- Submission transitions publication: `draft → submitted`
- Inngest job sends admin notification email
- Creator sees "Under review" state on their publication

**Demo at end:** Walk through the full submission flow, land on the confirmation moment.

### Slice 6: Admin Review Queue (Day 6)
> **Locked by D-019, D-020, D-021** (see `decisions.md`). This section is updated to match; the original "Approve / Request Revision / Reject" + `approved` sub-state framing is superseded.
- `/admin/*` (admin-role-gated) — queue of `in_review` publications
- Per-publication review page: previews, preflight, creator info, all metadata — and an editorial-note field that is the primary element of the surface (writing over clicking, D-020)
- **Two actions only (D-019): Publish · Request revisions.** No `approved` or `rejected` state; declining an edition is expressed as revisions + an editorial note. Publish sets `published` directly.
- **Editorial note** — written by a person, in the Editorial Voice (D-021). Optional on Publish, required on Request revisions. Never templated.
- **Reason codes** — internal-only metadata (D-020): analytics/reporting/filtering. Never shown to creators, never turned into creator-facing text. Vocabulary lives in `@baxter/domain`; selected ids + the note recorded in `publication_events.payload` (no migration).
- Creator learns the outcome in two channels: the in-app state on their publication (Institutional Voice) and a written decision email (Editorial Voice for any note). Decision email is a NEW Inngest function → requires a manual Resync after deploy (D-017).
- On Publish: `in_review → published` immediately. The marketplace (Slice 7) doesn't exist yet, so the work is data-live but only browsable from the creator's `[handle]` profile until then.

**Demo at end:** As admin, publish a submitted publication (or return it with a written note). As creator, see it go live, or see the editor's note and resubmit.

### Slice 7: Marketplace Shell (Day 7)
- Homepage sections: Hero, Editor Picks (admin-controlled), New Releases, Popular (stub: order by published_at for v1)
- Publication page: cover, preview pages, description, creator, price, "Buy print" / "Buy digital" buttons
- Search by creator and category (basic, no fancy ranking)
- All in editorial tone, image-led

**Demo at end:** Browse the marketplace, click into a publication, see it presented like a gallery bookstore page.

### Slice 8: Stripe Connect + Test Order (Day 8)
- Creator Stripe Connect Express onboarding (in profile settings)
- Buyer checkout flow: address, payment, confirm
- Stripe payment intent with `application_fee_amount` for platform cut
- On payment success webhook: create order, transition to `paid`
- Order appears in `/admin/orders` and in creator's earnings view
- Order detail page for buyer

**Demo at end:** Buyer pays test card, order is created, payment held, admin sees it in OMS.

### Slice 9: OMS + Audit Log + Admin Email (Day 9)
- `/admin/orders/[id]` detail page with state machine UI (clickable transitions)
- State transitions enforced via DB function
- Each transition writes to `order_events`
- Inngest job sends production-ready email to `benjamin@benjamingibson.ca` with full order details + signed URLs to PDF artifact
- Production package: full order info + links, NOT attachments (per V2 brief §32)
- Status updates flow back to buyer's order page

**Demo at end:** Walk an order through paid → preparing_files → sent_to_printer → shipped → completed. Audit log shows every step.

### Slice 10: Smoke test the full loop (Day 10)
- End-to-end test scenario: sign up, create, upload, submit, approve, publish, buy, OMS, ship.
- Fix the rough edges.
- Document what's working, what's stubbed, what's broken.

---

## 6. Risk spikes (run in parallel with above)

These don't block the business-loop milestone but need to be running so we have answers by end of Week 2.

### Spike A: R2 + Cloudflare Images integration
Sized: 0.5 day. Confirm the presigned-URL upload flow, signed-URL access for private files, and Cloudflare Images variants pipeline. Settles infra config.

### Spike B: DocRaptor vs react-pdf print test
Sized: 1 day. Build two minimal renderers of the same source content (a 16-page test publication with images, text, page numbers, bleed). Render with both engines. **Send both to a real printer.** Compare:
- Trim accuracy
- Color (CMYK vs RGB fidelity)
- Font rendering
- File size
- Production cost (Prince licensing vs nothing)

This decision sets the entire Studio editor's output pipeline. Worth the printed test.

### Spike C: Konva editor PoC
Sized: 1.5 days. Minimal canvas with:
- A page (fixed dimensions with bleed/safe-area guides)
- Image placement via drag-drop
- A text box
- Snap to halves/thirds/margins
- A "next/prev page" toggle (no real multi-page state yet)

Goal: validate the **feel** of snapping. The brief specifies "soft and supportive, not rigid." That's a feel question only a working prototype answers. Outcome informs whether Konva is the right primitive or whether we should look at alternatives (Fabric, raw SVG, tldraw SDK).

### Spike D: Stripe Connect held-funds + payout simulation
Sized: 0.5 day. Test in Stripe sandbox: buyer pays → funds held → mark order shipped → transfer to creator → simulate refund and reverse transfer. Validates the marketplace plumbing before Slice 8.

### Spike E: PDF preflight depth
Sized: 0.5 day. Test our preflight checks against 5-10 real InDesign exports (mix of clean and intentionally broken). Calibrates what we can detect server-side vs what needs a paid tool (e.g., Apryse) later.

---

## 7. What is intentionally NOT in Week 1

- Studio editor as a real product surface (guarded `/studio/editor` route stub only)
- Comments (deferred per your call)
- Digital downloads beyond a stub (no DRM, no watermarking yet)
- Reviews/ratings UI (data model ready, UI later)
- Email customization / branded transactional emails (uses plain Resend defaults)
- Creator earnings dashboard (data is there; UI is a v1.1 thing)
- Tax handling beyond Stripe's basic
- Shipping rate calculation (flat rate per region for v1)
- Edition systems (schema-ready, not surfaced)
- Comment moderation system (not building because not shipping comments)
- Real printer API integrations (all manual, by design)
- Mobile responsive editor (graceful "open on desktop" message only)
- Native iOS/Android apps

---

## 8. Open decisions to make in Week 1 (don't block scaffolding)

Per V2 brief §42, these need answers but the architecture is robust to all of them:

1. **Print formats and trim sizes** — needs printer conversation. Seed with 3 formats (zine A5, magazine A4, photobook square 210mm). Adjustable.
2. **Paper and binding options** — same. Seed with one option per format for v1.
3. **Pricing structure details** — need numbers for: platform fee %, processing fee passthrough, shipping rates by region. Default to placeholders.
4. **PDF rendering engine** — answer from Spike B by end of Week 2.
5. **Review SLA** — propose 2-5 business days, surface in submission UI.
6. **Creator payout schedule** — propose weekly automated transfers via Stripe Connect, on orders in `completed` state.

I'll proceed with sensible defaults and flag where they need your input.

---

## 9. Working agreement (per your "I drive, you review at milestones" call)

- **End of Week 1:** Deployed preview URL of the full business loop. You walk through it. We hold a milestone review against this doc.
- **Mid-week check-ins:** Only if I hit a genuinely two-way-door decision (something hard to reverse). Otherwise I keep moving.
- **Decision log:** I'll maintain `baxter/decisions.md` capturing every meaningful call I make so you have an asynchronous review trail.
- **Risk spike outcomes:** Documented in `baxter/spikes/` with print samples and recommendations.

---

## 10. The honest list of what could go wrong in Week 1

1. **R2 + Supabase auth boundary** is the trickiest plumbing — Supabase JWT-signed URLs for R2 is doable but has gotchas. Budget half a day extra.
2. **Stripe Connect onboarding** in test mode sometimes hangs on the "verification" step. Have a manual override path.
3. **Cloudflare Images variants** look easy but the URL signing for private originals is fiddly. Plan a fallback to direct R2 signed URLs if Images doesn't cooperate.
4. **The first PDF preview generation** will be slow without tuning — `pdfjs` headless is heavy. Inngest job + caching saves us, but expect to revisit performance in Week 2.
5. **Email deliverability to benjamin@benjamingibson.ca** — Resend's free tier should work, but configure SPF/DKIM properly even for the test phase so it doesn't end up in spam during the actual first order.

---

That's the plan. The next concrete artifact would be Slice 1 — the scaffolded repo with the Baxter homepage in brand tone — assuming this plan reads right to you.
