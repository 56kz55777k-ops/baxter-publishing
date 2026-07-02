# Baxter Publishing — Slice 6 Design Questions

**Date:** 2026-07-02
**From:** Claude Code (paired with Ben Gibson)
**For:** review before implementation
**Builds on:** `docs/implementation-plan.md` §Slice 6, `decisions.md` (D-013 result-UI voice, D-016 submission-as-declaration, D-017 manual Inngest sync), the Editorial Constitution, and the shipped Slice 5 flow.
**Slice 6 goal (from the plan):** the admin review queue — the other half of the submission ceremony. Admin sees submitted work, reviews it, and decides. The creator learns the outcome. On approval the publication moves toward the marketplace.

---

## STATUS — LOCKED (2026-07-02)

Ben reviewed these questions with ChatGPT and locked the answers. Recorded as **D-019, D-020, D-021** in `decisions.md`; the Editorial Constitution and implementation plan are updated to match. The open-question framing below is retained for the record. Resolutions:

- **Decision 0 (state model) → D-019.** No `approved`, no `rejected`, no migration. Two admin actions only: **Publish** (`in_review → published`) and **Request revisions** (`in_review → revisions`). Declining an edition is expressed as revisions + a note. Publish sets `published` directly (data-live; browsable only from the creator `[handle]` profile until the Slice 7 marketplace exists). → *Option A.*
- **Decision 1 (reason codes) → D-020.** Vocabulary lives in `@baxter/domain`; selected ids recorded in `publication_events.payload`. **But reason codes are internal-only** — analytics/reporting/filtering. They are never shown to creators, never templated into creator copy. → *storage 1b-A; the vocabulary is metadata, not message.*
- **Decision 2 (actions as ceremonies) → D-020.** The pivotal question is resolved decisively toward **the editor writes the real sentence**; codes are quiet internal scaffolding, never the message. The review surface **prioritises writing over clicking.** Note optional on Publish, required on Request revisions.
- **Decision 3 (creator-facing copy) → D-021.** Split into **two voices**: Institutional (system states — "Published.", "Under review.") and Editorial (the editor's written note). Approved in-app resolves quietly to live; a written email carries any editorial note. Exact strings drafted at build against D-021.
- **Decision 4 (approval → marketplace) → D-019.** Publish sets `published` now; Editor's Picks deferred to Slice 7. → *Option A.*
- **Decision 5 (admin surface) → build per D-020.** Admin-role-gated; the editorial note is the primary element of the review page. Layout details settled at build.
- **Decision 6 (audit + email) → build per D-017/D-020.** Payload `{ reasonCodes, note }`; one new decision-email Inngest function → **manual Resync required after deploy (D-017).**

**Foundational takeaway (beyond Slice 6):** *the software records, the editor writes* (D-020), and Baxter speaks in *two voices* (D-021). These are product principles, not Slice 6 details — they extend to all future outbound copy.

---

## 1. What Baxter is, in two paragraphs

Baxter is a curated publishing marketplace. Creators upload print-ready PDFs; Baxter preflights them, generates previews, and — as of Slice 5 — lets a creator *declare* a publication ready by submitting it for editorial review. A publication now sits in `in_review` with an admin email already firing on submission.

Slice 6 is the editorial desk. It is where a human decides whether a submitted publication is approved, sent back for revisions, or turned away. Every one of those three moments reaches a creator who has slid their manuscript across the desk and left the room. The Constitution is explicit (§Slice 6): the admin surface may look *slightly* more functional than the rest of the product, but **reviewer notes and decision emails to creators use the same voice as everything else — written, not templated-feeling.** This is not an ordinary CRUD admin panel. The three decisions are the most emotionally exposed outbound messages Baxter sends.

---

## 2. Where Slice 6 sits

**Upstream (shipped):** `draft → Review page → Submit → in_review`, admin notified by email from `notifications@baxter.press`. The publication is locked read-only in an "Under review" state. Preflight has already passed (submission is gated on it), and cover + previews already exist.

**This slice:** an admin-only surface that lists `in_review` publications, presents each for review (previews, preflight result, creator, metadata), and offers **Approve / Request revision / (Reject?)**. Each decision writes an audit event, notifies the creator (in-app state + email), and moves the publication's status.

**Downstream (not yet built):** the marketplace (Slice 7) is the public home for a `published` publication. **It does not exist yet.** That is central to Decision 4.

---

## 3. Verified current state (confirmed against the live code)

- **Status enum** (`packages/db/src/schema.ts` + `packages/domain/src/state-machines/publications.ts`) is exactly: `draft · in_review · revisions · published · unpublished · archived`. **There is no `approved` state and no `rejected` state.**
- **Legal admin transitions from `in_review`:** `→ published` and `→ revisions` only. (`in_review → draft` exists but is a *creator* withdrawal.) **Admin cannot currently reach `archived` from `in_review` at all** — the machine has no such edge.
- ⚠️ **The plan contradicts the machine.** `docs/implementation-plan.md` §Slice 6 says "On approve: publication transitions to `approved`, then `published`" and lists a **Reject** action. Neither `approved` nor `rejected` exists, and no reject edge exists. **This is Decision 0 — it must be settled first; every other decision maps onto whichever state model we choose.**
- **Audit trail exists:** `publication_events` (insert-only) has `from_status`, `to_status`, `actor_id`, and a free-form `payload` jsonb (`{ note, reason, ... }`). **There is no dedicated reason-code column or enum** — see Decision 1.
- **Admin role exists but is un-gated:** `user_role` enum includes `admin`. No route currently checks for it. The `(admin)/admin/page.tsx` route is a one-line placeholder ("Submissions waiting on review will appear here.").
- **Email plumbing exists:** `lib/email/resend.ts` (env-driven, no-ops without a key) + Inngest. The admin-notify function already ships. **A creator decision email is a NEW Inngest function → it will require a manual Resync after deploy (D-017).**
- **No marketplace, no public publication page.** Public routes today are the homepage and `app/[handle]` (creator profile). A `published` publication has nowhere public to appear except (possibly) the creator's own profile.

### The constraint that shapes everything below
Decision 0 (the state model) gates Decisions 1–6. Decide it first. Whether "Reject" even exists in v1, whether we run a migration, and what words the creator reads all follow from it.

---

## 4. The voice you must design within (Constitution extract)

The decision copy (Decision 3 especially) is the most exposed tonal surface in this slice — more exposed than anything in Slices 3b–5, because it can carry *bad news*. Binding rules:

**Always:** plain English, short sentences, present tense, declarative. Time named directly ("within five business days," never "fast"). Small numbers spelled out ("five," not "5"). The creator's name appears as it would on a book spine.

**Never:** exclamation points · emojis · "we" as Baxter's voice (use "Baxter" or no attribution) · "awesome/great/fantastic/love it" · "get started/let's go/ready?" · "oops/uh oh/yikes" · flattery of the work · "powered by / made with" credits.

**Precedent to match (D-013):** the creator encounters *situations, not software states*. No "approved," "rejected," "failed," "success" as user-facing words. Success is the absence of friction, not an announcement. Warnings inform, never patronise. No liability language.

**Precedent to match (D-016):** decisive single actions, generous whitespace, short words, dignified waiting. A decision is a note from an editor, not a status badge.

**Constitution §Slice 6 (verbatim intent):** the admin surface may look *slightly* more functional — this is the one place that's allowed. But reviewer notes and decision emails to creators are *written, not templated-feeling*, and carry the same voice as the rest of the product.

---

## 5. The decisions

### Decision 0 — The state model: reconcile the three actions with the machine *(gates everything — decide first)*

The plan names three actions (Approve / Request revision / Reject) but the machine supports two edges (`→ published`, `→ revisions`) and no reject target. Three coherent ways to resolve it:

- **Option A — Two actions in v1 (no reject). No migration.** Ship **Approve** (`in_review → published`) and **Request revision** (`in_review → revisions`). Defer "Reject" until there's a real editorial need to permanently turn work away. Matches the machine exactly; zero schema change.
- **Option B — Three actions, reject = archive. One small state-machine edit, no enum change.** Add an `admin` edge `in_review → archived` and treat **Reject** as "archived with a reason." Reuses the existing terminal `archived` state; the creator-facing meaning is "not accepted." Machine edit only (plus, arguably, RLS), no new enum value or column type.
- **Option C — Three actions, first-class `rejected` state. Migration.** Add `rejected` to the `publication_status` enum + machine edges. Cleanest semantics (rejection ≠ archival), but a migration and the one thing that bit us before was an unapplied migration (Slice 3b). Also raises "can a rejected publication be resubmitted?" (probably terminal, like archived).

**Sub-question (applies to A and B):** the plan says approve goes `approved → published`. Since no `approved` holding state exists and there's **no marketplace to publish into yet**, do we (i) approve straight to `published` now (machine already supports it; it just won't render publicly until Slice 7), or (ii) introduce an `approved` holding state distinct from `published`? See Decision 4 — I recommend (i).

**Leaning:** **Option A** for v1. Approve + Request revision are the two moves a curator actually needs on day one; "Reject" as a distinct, permanent verdict is heavier than an early-stage catalog needs and is easy to add later as its own small slice once the editorial posture is real. If you want three now, **Option B** (reject = archive-with-reason) avoids a migration. I'd avoid Option C until rejection is a proven editorial need. *Decide this first.*

---

### Decision 1 — The reason-code vocabulary (the controlled vocabulary itself + where it lives)

The plan calls for "a reason code system (controlled vocabulary), seeded." Two parts:

**1a — What the vocabulary is.** These are the editorial reasons a publication is sent back or turned away. They serve two masters: they structure the admin's decision (pick from a list, don't freetext everything) and they *seed* the creator-facing note. Proposed starting set (revise freely) — grouped:

- *File & production:* Trim or bleed inconsistent with the format · Image resolution too low for print · Cover does not read as a cover · Page sequence unclear.
- *Content & metadata:* Description does not match the work · Category does not fit · Title or credits incomplete.
- *Editorial fit:* Outside Baxter's current catalog · Requires the sensitive-category review path (ties to D-016's sensitive-category notice).
- *Catch-all:* Other (note required).

**Question:** is this roughly the right *shape* and granularity, or do you want a shorter, blunter list? Each code needs a short internal id and a composed human phrase (the phrase is what seeds the creator note — Decision 3).

**1b — Where it's stored.** Two options:
- **Option A — In code, in `@baxter/domain`** (like `formats.ts` / the preflight rules). A `reasonCodes.ts` array of `{ id, label, appliesTo: ['revision'|'reject'], group }`. No migration; easy to evolve; the audit event records the id(s) in `publication_events.payload`. Consistent with how format presets and preflight rules already live.
- **Option B — A seeded DB table** with a foreign key from the event. More "system," enables admin-editable vocab later, but adds schema and a migration for something that changes rarely.

**Leaning:** **1b Option A** (vocabulary in `@baxter/domain`, selected ids recorded in the existing `payload` jsonb). It matches the established pattern, needs no migration, and keeps the reason list versioned in git alongside the copy that quotes it. For **1a**, I lean toward the grouped set above trimmed to whichever codes you'd actually use in the first fifty reviews — a controlled vocabulary is only useful if it's short enough to scan.

---

### Decision 2 — The three actions as ceremonies (what each *does*)

Given Decision 0, specify each action's mechanics and admin-side UX. For each: the state transition, whether a reason/note is required, and whether it's single-click or confirmed.

- **Approve.** `in_review → published` (per Decision 4). **Question:** single decisive click, or a light confirm ("This publishes [title]." → Publish)? A note is optional. My lean: one confirm step, because it's irreversible-feeling to the creator and publishes to the world — but no modal theatre.
- **Request revision.** `in_review → revisions`. **A note is required** (a revision with no guidance is cruelty). Admin picks one or more reason codes (Decision 1) and writes a short composed note. My lean: reason code(s) + freetext note, both feeding one creator-facing message.
- **Reject** *(only if Decision 0 = B or C).* Terminal. **A note required.** Heaviest of the three; deserves the most deliberate confirm.

**Cross-cutting question:** should the admin note be *composed by the admin in Baxter's voice* (the reviewer writes the actual sentence the creator reads), or should the admin pick codes + rough notes and Baxter *renders* the final creator-facing copy from templates keyed to the codes? The Constitution says "written, not templated-feeling" — which argues for the admin writing real prose, with reason codes as scaffolding rather than the message itself. **This is the pivotal UX question of the slice.** My lean: **codes structure + admin writes the human sentence**; Baxter provides a composed frame ("Baxter reviewed [title]. To move forward:") and the admin's prose fills the substance.

---

### Decision 3 — The creator-facing decision copy *(the Constitution-critical one — draft the actual strings here)*

This mirrors D-013's job for preflight: define exactly what the creator encounters, as *situations*, for each outcome — in **both** channels (the in-app state on their publication, and the decision email). No "approved/rejected" as words. Draft strings (revise):

- **Approved (in-app):** the "Under review" state resolves — ideally, like a clean preflight pass, into the *normal* state of a live publication, with the lightest composed line, e.g. **"Published [date]."** No banner, no confetti, no "Congratulations." **Question:** silence-plus-live (D-013 style), or one composed line marking the moment?
- **Approved (email):** short. e.g. *"Baxter has published [title]. It is now part of the catalog."* + link. **Question:** does approval even warrant an email, or is going live enough? (My lean: yes, one quiet email — going live silently is worse than a composed note.)
- **Revision requested (in-app):** publication returns to an editable workspace state (`revisions`) showing the reviewer's note prominently. e.g. header **"Revisions requested"**, then the reviewer's prose, then the work stays editable and re-submittable. **Question:** where does the note render — top of the workspace, a dedicated panel, both?
- **Revision requested (email):** e.g. *"Baxter reviewed [title]. Before it can be published: [reviewer note]. Edit and resubmit when ready."* Composed, specific, no apology-theatre and no flattery.
- **Turned away (in-app + email)** *(only if Decision 0 = B/C):* the hardest copy in the product. It must be honest, brief, and free of both false warmth and coldness. Draft needed if we include Reject. e.g. *"Baxter will not be publishing [title]. [reviewer note]."* — no "unfortunately," no "we regret."

**What to send back for this decision, in the most detail:** the exact words for each state in each channel, and specifically whether **Approved** is silent-live or gets one line. This is where a round-trip is most expensive, so drafting the real strings now is worth it.

---

### Decision 4 — How approval moves a publication toward the marketplace

The marketplace (Slice 7) does not exist yet. So "approve" has to mean something concrete *today*.

- **Option A — Approve sets `published` now; it's simply invisible until Slice 7.** The state machine already supports `in_review → published`. The publication is genuinely live in data; the *only* thing missing is a public surface to browse it. It can already appear on the creator's own `app/[handle]` profile (verify at build). When Slice 7 lands, published works appear with no backfill. Simplest; honours the machine.
- **Option B — Introduce an `approved` holding state, publish as a later step.** Distinguishes "editorially accepted" from "publicly live." More ceremony and a schema change, and it defers "live" to a marketplace that isn't built — arguably inventing a state to solve a problem we don't have yet.

**Adjacent question (defer or seed?):** the plan's Slice 7 mentions **Editor's Picks (admin-controlled)**. Does the review approval moment *also* let the admin flag a publication as an Editor's Pick (a boolean set at approval), or is that entirely Slice 7's concern? My lean: **defer** — one ceremony per slice; picks belong to the marketplace slice.

**Leaning:** **Option A.** Approve → `published` immediately. Accept that it's data-live-but-not-yet-browsable until Slice 7; that's a natural slice boundary, not a gap. Confirm at build that a creator's `[handle]` profile lists their published works so "live" isn't *entirely* invisible in the interim.

---

### Decision 5 — The admin queue + review surface (and how admin access is gated)

- **5a — Access control.** How is `/admin/*` gated to `role = 'admin'`? Options: (i) a check in the `(admin)` layout (server component reads the user's role, 404/redirect otherwise), (ii) middleware (like the pending-handle gate), or (iii) both. And: Ben's account role is set to `admin` manually in Supabase (there's no admin-granting UI, nor should there be in v1). My lean: **layout-level role check** (co-located, testable), role set by hand in SQL for now.
- **5b — The queue (`/admin/queue` or `/admin`).** A list of `in_review` publications: cover thumbnail, title, creator handle, submitted date, category, sensitive-category flag if set, preflight state. Ordered oldest-submitted-first (a review queue, not a feed). **Question:** does the queue show *only* `in_review`, or also a "recently decided" section for context? My lean: `in_review` only, clean; decided work is out of scope for the queue.
- **5c — The review page (`/admin/queue/[id]`).** Everything a reviewer needs on one composed surface: the cover + preview pages (already generated), preflight result (blockers/warnings from D-013), all metadata (title, subtitle, description, category, price, edition, page count, format), creator identity, and the sensitive-category notice hook. Then the decision actions (Decision 2). **Question:** anything else a reviewer needs to see to decide — e.g. a link to download the actual clean PDF, prior revision history for a resubmission? My lean: include a signed download link to the clean PDF (a reviewer should be able to open the real file) and, for resubmissions, show the prior reviewer note inline.
- **5d — Tone.** Per the Constitution, this is the one surface allowed to look *slightly* more functional. It should still be quiet — no dashboard chrome, no dense tables-for-tables'-sake. Confirm you want it restrained rather than "admin panel."

---

### Decision 6 — Audit trail + decision email plumbing

Mostly mechanical, but two rulings needed:

- **6a — Event payload shape.** Every decision writes a `publication_events` row (`from_status`, `to_status`, `actor_id` = the admin, `payload`). Confirm the payload convention: `{ reasonCodes: string[], note: string }` for revision/reject; `{}` or `{ note? }` for approve. (This reuses the existing jsonb — no migration, consistent with Decision 1 Option A.)
- **6b — The decision email.** A **new** Inngest function (e.g. `publication-decided-notify`) triggered by a `publication/decided` event, sending via Resend from `notifications@baxter.press` to the *creator's* email. **This is a new function → it REQUIRES a manual Inngest Resync after deploy (D-017), or it silently won't fire** — exactly the bug that bit the Slice 5 email. Folded into the slice's verification checklist. **Question:** one function that branches on outcome, or separate functions per outcome? My lean: one function, branch on the decision — fewer sync surfaces.

---

## 6. What to send back

Priority order:

1. **Decision 0** — the state model (A / B / C) and the approve-target sub-question. Everything else maps onto this; pick it first.
2. **Decision 3** — in the most detail: the actual creator-facing strings for each outcome in each channel, and specifically whether **Approved** is silent-live or one composed line. Drafting real copy here saves the most round-trips.
3. **Decision 2** — the pivotal "codes-as-scaffolding vs. Baxter-renders-templates" question, and whether Approve gets a confirm step.
4. **Decision 1** — whether the proposed reason vocabulary is the right shape/granularity, and code-vs-DB storage (my lean: code).
5. **Decision 4** — approve-to-`published`-now vs. a holding state; Editor's Pick defer or seed.
6. **Decisions 5 & 6** — admin gating approach, what the review page must show, and the payload/email plumbing (confirm the D-017 resync is in the checklist).

Once these are settled I'll lock them as `D-018…` in `decisions.md` and build — mirroring how D-012/D-013 were locked before the 3b worker.
