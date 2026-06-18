# Baxter Publishing — Handoff for ChatGPT (current through Slice 4; planning Slice 5)

**Date:** 2026-06-18
**From:** Claude Code (paired with Ben Gibson)
**For:** ChatGPT — to help work through the Slice 5 design decisions
**Companion:** `baxter-slice5-plan.md` (the internal plan). This document is **self-contained** — you don't need the codebase.

---

## 1. What Baxter is

Baxter Publishing is a curated marketplace for independent print publications — zines, photobooks, art books, chapbooks. Creators upload print-ready PDFs; readers buy physical copies. It is deliberately **not** a SaaS app: it has an *Editorial Constitution* (a voice-and-tone doctrine with equal weight to the technical plan) whose central commitment is that the platform recedes so the work is the hero. No dark patterns, no celebration, no progress percentages, no exclamation points. Restraint is the design.

**Stack:** Next.js 15 (App Router) on Vercel · Supabase (Postgres + Auth + RLS) · Cloudflare R2 (file storage) · Cloudflare Images (derived imagery) · Inngest (async workers) · Drizzle ORM. Work ships in vertical "slices."

---

## 2. The Editorial Constitution (the binding voice — matters most for Slice 5)

**Three foundational principles:** Attention Respect (no urgency/manipulation) · Platform Humility (the work is the hero) · Composed Warmth (composed, quietly warm; "restraint is not coldness").

**Submission is one of five named "emotional pressure points,"** and Slice 5 *is* that moment. The doctrine on it:
- The final submit is a **single decisive action, not a celebration**.
- The confirmation state is **generous in whitespace, short on words** — *"designed as if it's a poster, not a screen."*
- **No "Step 1 of 4" framing, no progress bar** (named in the Onboarding pressure point; the spirit applies to any multi-step flow).
- The waiting state is **dignified, not anxious**. No queue position ("#47").
- It should feel like *"sliding a manuscript across a desk. The desk is clean. The room is quiet. You leave."*

**Copy doctrine — Never:** exclamation points · emojis · "we" for Baxter (say "Baxter" or nothing) · "Awesome/great" · "Get started/Let's go" · "Oops" · flattery of the work · "Powered by." **Always:** plain English, present tense, declarative; **time named directly** ("within five business days," never "Fast!"); small numbers spelled out.

**Calibration:** Cold = "Submission received. Ref #4471-A." · Performative = "🎉 Your submission is in!" · **Right** = "Submitted. Baxter will review your work within five business days. Baxter will write to you when there's news."

The test for any screen: *"Does this feel like software, or like publishing? If you removed every brand mark, would someone still know this isn't a SaaS app?"*

---

## 3. Where the project stands (Slices 1–4 shipped & live)

- **Slice 1–2:** foundation, auth, creator profiles, follow — live.
- **Slice 3a/3b:** the creator can create a publication (`draft`), upload a print-ready PDF to a private quarantine bucket, and an async **preflight worker** validates it. Status model is `pending | passed | failed`; blockers (dimensions, page-count, multiple-of-four) vs warnings (DPI, fonts, bleed, with acknowledgement). On pass the file is promoted to a private clean bucket; failures stay in quarantine. Result UI reads as *situations, not software states* (silence on a clean pass). **Live and production-verified.**
- **Slice 4:** on a preflight pass, a worker rasterizes the **cover (page 1) + first six pages** (cropped to the finished page), uploads them **public** to Cloudflare Images, and the publication page shows the cover + previews. The **source PDF stays private**; only derived images are public. **Live and production-verified.**

Everything above is real and running in production.

---

## 4. Data model relevant to Slice 5 (already in place)

- **Publication status enum:** `draft → in_review → revisions → published → unpublished → archived`. "Submitted" maps to **`in_review`**.
- Row-level security **already permits a creator to move their own publication `draft → in_review`** (this was pre-built for submission).
- The publication row **already has** the fields submission needs: `price_minor`, `currency`, `edition_size`, `description`, `subtitle`, `category`, `submitted_at`. There is an insert-only **`publication_events`** audit table. State transitions run through a pure TypeScript state machine.
- **No "tags"** column exists today (only a single `category` text field).
- Preflight status lives on the artifact (`passed`/`failed`/`pending`); the canonical passed artifact is the active file.

Implication: Slice 5 likely needs **no migration** — *except* if we add tags.

---

## 5. Slice 5 — the ceremonial submission flow

**Goal:** take a `draft` publication, walk the creator through a final confirmation, transition it to `in_review`, notify an admin, and show an "Under review" state. Ends there. (Admin review/approve is Slice 6; payments are Slice 8.)

**The flow (from the implementation plan):**
1. Publication summary (title, cover, format, page count).
2. Live preflight check (must be `passed`).
3. Marketplace info (price, description, tags?).
4. Category declaration (extended notice if political/sensitive).
5. Review notice ("Baxter will review your work within [N] business days.").
6. Final submit (one decisive action).
7. Confirmation state (calm, poster-not-screen).

**Architecture:** a server-validated `draft → in_review` transition (via the state machine, recorded in `publication_events`, stamping `submitted_at`), **gated** on the canonical artifact being `passed`; an **Inngest job** sends an admin notification email; the publication locks to read-only "Under review."

---

## 6. The decisions to work through (your help wanted here)

The biggest is **#2** — it's the Constitution-critical surface, the Slice 5 equivalent of the preflight result-UI voice we settled earlier.

1. **Email provider.** App-sent transactional email is needed for the admin notification (the plan names **Resend**). Confirm Resend vs alternative; this is the one external prerequisite (account, API key, verified sender). Note: this is *separate* from a pre-launch "custom SMTP" item, which is only for Supabase auth emails.
2. **Flow shape + confirmation voice (most important).**
   - How do you sequence 7 steps **without a wizard/stepper** (which the Constitution bans)? One quiet scrolling page? Discrete moments without "Step 1 of 4"?
   - **Draft the actual confirmation-state copy** — the poster moment after submit — in Baxter's voice. Also the **review-notice** wording (the SLA sentence) and the **"Under review"** state copy.
3. **Pricing now or later?** Collect price/edition at submission, or defer pricing to approval? (Payments aren't until Slice 8, so price may be informational for now.)
4. **Tags.** Schema has single `category`, no tags. Ship tags in Slice 5 (needs a migration) or defer?
5. **Sensitive-category notice.** Which categories trigger the "extended notice," and what does it say?
6. **Review SLA wording.** Exact phrasing/number — named directly per the copy doctrine.

---

## 7. What to send back

A short ruling per decision is enough; Claude Code turns them into the build. Most valuable:
- **Decision 2 in detail** — the flow shape, plus **the actual copy** for the confirmation state, the review notice, and the "Under review" state, written in Baxter's voice (§2). That's the part hardest to delegate.
- **Decision 1** (email provider) so the prerequisite can be set up in parallel.
- Brief calls on 3–6.

Where a decision implies copy, **write the copy.** Pressure-test it against the Constitution's "Never" list before sending.
