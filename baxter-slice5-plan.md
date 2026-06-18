# Slice 5 — Ceremonial Submission Flow — Plan

**Date:** 2026-06-18
**Builds on:** Slices 1–4 (live). Preflight (3b) gates submission; previews (4) give the summary something to show.
**Status:** planned; a short design-questions pass is recommended before building (lead items: email provider + confirmation-state voice).

---

## 1. Scope

The moment a creator hands a finished publication to Baxter for editorial review. Slice 5 takes a `draft` publication, walks the creator through a final confirmation, and transitions it to **`in_review`** — notifying an admin. It is the bridge between the private studio (Slices 3–4) and the admin review queue (Slice 6).

Per the Editorial Constitution, submission is one of the five named **emotional pressure points** — *"sliding a manuscript across a desk. The desk is clean. The room is quiet. You leave."* Explicitly **not** a SaaS "Submit! 🎉" moment.

**Ends at:** submitted → under review → admin notified. **Out of scope:** the admin queue + approve/reject (Slice 6); payments (Slice 8).

---

## 2. How it builds on what's shipped

- **Preflight (3b) becomes a gate** — only a publication whose canonical artifact `passed` can be submitted; the flow surfaces a live preflight check.
- **Previews (4)** give the submission summary a cover + the work to show.
- **Status machine is ready** — the `publication_status` enum already has `in_review`, and RLS (`publications_update_own_draft`) already permits a creator to move their own publication `draft → in_review`. The `publication_events` audit table and `submitted_at` column already exist.

---

## 3. The flow (V2 brief §21)

1. **Publication summary** — title, cover, format, page count; a last look.
2. **Live preflight check** — confirm the canonical file `passed` (reuses 3b). Blockers stop submission.
3. **Marketplace info** — price, description, (tags — see decisions).
4. **Category declaration** — extended notice if the category is political/sensitive.
5. **Review notice** — "Baxter will review your work within [N] business days." (time named directly).
6. **Final submit** — one decisive action.
7. **Confirmation state** — generous whitespace, calm, no celebration ("designed as if it's a poster, not a screen").

Then: `draft → in_review`, the publication shows **"Under review"**, and an **admin notification email** fires.

---

## 4. Architecture

- **State transition** — `draft → in_review`, driven through the pure `packages/domain/state-machines/publications.ts`, recorded in `publication_events`, stamping `submitted_at`. Server-action, server-validated.
- **Submission gate** — server-side check that the canonical artifact's `preflight_status = passed` before allowing the transition (don't trust the client).
- **Admin notification** — an Inngest job on submit (async, retryable). **Requires a transactional email provider** (plan names Resend) — a new integration (account, API key, from-address). Distinct from the pre-launch *custom SMTP* item, which is for Supabase **auth** emails.
- **Lock-down** — once `in_review`, uploads/edits are blocked (RLS already restricts edits to `draft`/`revisions`); the UI reflects the read-only "Under review" state.

---

## 5. The Constitution-critical tension

A **multi-step flow that must not feel like a wizard.** The Constitution bans *"Step 1 of 4"* framing and progress bars. So the central question: how to sequence the steps without a stepper? And the **confirmation state** is the single most over-engineered moment in most products — it gets disproportionate design attention here. This is the Slice 5 equivalent of D-013 (the preflight result-UI voice).

---

## 6. Design decisions to settle (proposed design-questions pass)

1. **Email provider** — Resend (plan's choice) vs alternative. Gating prerequisite: account, API key, verified from-address. (App-sent transactional, separate from Supabase auth SMTP.)
2. **Flow shape** — one scrolling ceremonial page vs discrete steps-without-a-stepper; the exact confirmation-state copy and voice.
3. **Pricing now vs later** — collect price/edition at submission, or defer to approval? (Stripe isn't until Slice 8, so price may be informational for now.)
4. **Tags** — schema has `category` (single text) but **no tags column**; ship tags in 5 (needs a migration) or defer.
5. **Sensitive-category notice** — which categories trigger the extended notice and what it says.
6. **Review SLA wording** — exact phrasing/number ("within five business days"), named directly per the copy doctrine.

---

## 7. Prerequisites

- **Transactional email provider** set up (Resend account + API key + verified sender domain) and its env var in Vercel. This is the one external dependency, analogous to Cloudflare Images in Slice 4 — set it up in parallel.

---

## 8. Schema / migration outlook

- **Likely no migration.** `price_minor`, `currency`, `edition_size`, `description`, `subtitle`, `submitted_at` all exist; `publication_events` exists; `in_review` is in the enum.
- **The exception is tags** (decision #4) — adding tags needs a column (e.g. `text[]` or a join table). Defer unless wanted now.
- Carry the Slice 3b lesson: any migration ships **with** the deploy that needs it.

---

## 9. Suggested approach

The rhythm that worked for 3b and 4: **design-questions pass → decisions → build → production verify.** The two genuinely gating items are the **email provider** (account/key you set up) and the **confirmation-state voice** (a Constitution call worth making deliberately). Recommend running the design-questions pass first.
