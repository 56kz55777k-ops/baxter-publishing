# Slice 5 — Ceremonial Submission Flow — Plan

**Date:** 2026-06-18
**Builds on:** Slices 1–4 (live). Preflight (3b) gates submission; previews (4) give the summary something to show.
**Status:** design decisions **locked** (`D-016`). Two-surface model: editing in the workspace, declaration on a read-only review page. Ready to build once the Resend prerequisite is set. (Section 6 below is superseded by D-016.)

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

## 6. Design decisions — LOCKED (see `D-016`)

Resolved via a design pass (Claude + ChatGPT + Ben). Summary; full rationale in `decisions.md` D-016.

1. **Email provider:** **Resend.**
2. **Flow shape:** **two-surface model** — *submission is a declaration, not a form.*
   - **Workspace** (`/studio/publications/[id]`): editable; holds title, subtitle, description, category, price, edition, file, previews; normal save; used in `draft` and `revisions`. Marketplace info (price/description/edition) is entered here (new quiet section).
   - **Review** (dedicated page, named "Review"): **read-only**, shows cover/title/format/page count/preflight/category/description/price/edition + review notice; **one action, "Submit for review," no editable fields**; "Edit publication" returns to the workspace.
   - **Copy:** notice = "Baxter will review this publication within five business days."; confirmation = "Submitted." + that notice; under-review = "Under review" / "Baxter is reviewing this publication." / "Submitted [date]".
3. **Pricing:** collected **now**, in the workspace.
4. **Tags:** **deferred** (no migration).
5. **Sensitive-category notice:** high-risk categories only — "Some categories require additional review. Submission does not guarantee publication."
6. **SLA:** five business days.

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
