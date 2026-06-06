# Baxter Publishing — Slice 3b Design Questions

**Date:** 2026-06-05
**From:** Claude Code (paired with Ben Gibson)
**For:** ChatGPT — to help Ben work through the decisions below
**Companion docs:** `baxter-progress-report.md` (what shipped), `baxter-claude-code-handoff.md` (prior handoff)

This document is **self-contained** — you do not need the codebase to reason about it. It carries the context, the verified current state, the voice constraints, and the open decisions. Work through the decisions with Ben; the answers feed directly into writing the Slice 3b worker and result UI.

---

## 1. What Baxter is, in two paragraphs

Baxter Publishing is a curated marketplace for independent print publications — zines, photobooks, art books, chapbooks. Creators upload print-ready PDFs; readers buy physical copies. It is deliberately **not** a SaaS app: it has an *Editorial Constitution* (a voice-and-tone doctrine that carries equal weight to the technical plan) whose central commitment is that the platform recedes so the work is the hero. No dark patterns, no celebration confetti, no progress percentages, no exclamation points. Restraint is the design, not a constraint.

Stack: Next.js 15 (App Router) on Vercel · Supabase (Postgres + Auth + RLS) · Cloudflare R2 (file storage) · Inngest (async workers) · Drizzle ORM. Work is shipped in vertical "slices."

## 2. Where Slice 3b sits

The creator's upload flow is: sign in → create a publication (draft) → upload a print-ready PDF directly from the browser to an R2 **quarantine** bucket → the file is registered in the database.

**Slice 3a (shipped & verified)** got the file into quarantine and currently shows the creator a holding state: *"File received. Awaiting check."*

**Slice 3b (about to be built)** is the "check." An Inngest worker wakes on upload, runs **preflight** validation on the PDF (does it meet print requirements?), writes the result back, and — if it passes — **promotes** the file from the quarantine bucket to the clean bucket. The creator then sees the preflight result on the publication page.

Slice 3b's *infrastructure* is fully in place and tested (Inngest is wired and synced to production; a second R2 bucket `baxter-clean` exists; env vars set; a stub worker runs green on a test event). What remains is **application code only**:
1. Emit a `publication/artifact.uploaded` event when a file is registered.
2. Replace the stub worker body with the real preflight logic + bucket promotion.
3. Build the preflight-result UI on the publication detail page.

The decisions in this document gate that work.

## 3. Verified current state (Claude Code confirmed against the live code)

- Repo builds; typecheck green across all packages.
- The worker is a genuine stub — no checks, no promotion yet.
- The register step does **not** yet emit the Inngest event.
- The publication page hardcodes *"File received. Awaiting check."* and does not read any preflight data yet.
- **Page count is already derived** from the uploaded PDF (via `pdf-lib`) at registration time, stored on both the artifact and the publication row. (In Slice 3b this logically belongs in the worker; minor.)

### Technical constraints that shape the options below
- **The worker runs server-side with no signed-in user.** Postgres row-level security is keyed to the logged-in user's identity, and the worker has none — so it must write using the privileged service-role database client. (That client already exists in the codebase.) Practical effect: the worker *can* update artifact/publication rows freely; we just note it so the options are realistic.
- **The database already supports bucket promotion.** Each artifact row stores which bucket it lives in and its object key, so "promote" = copy the object to the clean bucket and update those two fields. No schema change needed for promotion itself.
- **There is currently no dedicated "preflight status" field** — see Decision 0, which gates the UI.

---

## 4. The voice you must design within (Editorial Constitution extract)

The result UI (Decision 2 especially) is the most exposed tonal surface in this slice. These are the binding rules.

**Three foundational principles (these win over everything):**
- **Attention Respect** — no urgency, no manipulation, no anxiety.
- **Platform Humility** — Baxter supports the work, never overshadows it. The work is the hero.
- **Composed Warmth** — composed, respectful, quietly warm. Not corporate, not playful, not sterile. *"Restraint is not coldness."*

**The "Submission" emotional pressure point (directly relevant):**
- The confirmation state is generous in whitespace, short on words.
- No progress percentage during async work — show *that* work is happening, not how fast. (Upload already uses an indeterminate state per this rule.)
- The waiting state is *dignified, not anxious.*
- It should feel like *"sliding a manuscript across a desk. The desk is clean. The room is quiet. You leave."*

**Copy doctrine — Never:** exclamation points · emojis · "we" referring to Baxter (say "Baxter" or nothing) · "Awesome/great/fantastic" · "Get started/Let's go/Ready?" · "Oops/Uh oh/Yikes" · flattery of the work · "Powered by" credits.

**Copy doctrine — Always:** plain English, short sentences · present tense, declarative · time named directly ("within five business days," never "Fast!") · small numbers spelled out ("five publications," not "5").

**Calibration examples (from the Constitution):**
- Cold: *"Submission received. Reference #4471-A."*
- Performative: *"🎉 Amazing! Your submission is in!"*
- **Right (composed warmth):** *"Submitted. Baxter will review your work within five business days. Baxter will write to you when there's news."*
- Error, right: *"Something didn't work. Try again."* (never "Oops!")
- Success that needs no announcement: **silence** — the file is simply visible now.

When weighing UI options, the test is the Constitution's own: *"Does this feel like software, or does this feel like publishing? If I removed every brand mark, would someone still know this isn't a SaaS app?"*

---

## 5. The decisions

Each decision states the question, the options, the trade-offs, and Claude Code's leaning. Ben decides; nothing here is settled.

### Decision 0 — Where does the preflight *status* live? (gates Decision 2)

The result UI needs a single value to branch on — passed / has-warnings / failed / still-running. The original implementation plan called for a dedicated status field on the artifact with values `pending | passed | warnings | failed`. The schema that actually shipped does **not** have it; there is only a free-form JSON blob for detailed check output.

- **Option A — Add a real status column (enum).** A migration adds a typed `preflight_status` field. Clean to query, hard to get into an invalid state, matches the original plan. Cost: one more hand-written migration + RLS-free update path (worker uses service role, so fine).
- **Option B — Keep status inside the existing JSON blob.** No migration; the worker writes `{ status, checks, ... }` into the blob and the UI reads it. Faster to build now. Cost: status is unindexed/untyped; any later "show me all failed artifacts" admin view does JSON filtering; easier to drift.

**Leaning:** Option A. The status is a first-class lifecycle fact (it gates promotion, it'll gate the admin queue in a later slice), and it's cheap now. *Decide this first — Decision 2's wording maps onto whichever value set we choose.*

**Sub-question:** if A, what are the exact values? Plan's `pending | passed | warnings | failed` — or softer internal names? (Internal field names need not match user-facing words; Decision 2 handles the words.)

### Decision 1 — Which checks ship in 3b, and which block vs. warn?

Candidate checks (from the implementation plan):
- **Page count vs. format min/max** (e.g. an A5 zine has sensible page bounds).
- **Multiple-of-4 page count** (saddle-stitch binding physically requires it).
- **Page dimensions match the chosen format** (an A4 doc in an A5 publication won't print right).
- **Embedded fonts** (un-embedded fonts reflow or drop on the printer's RIP).
- **Minimum image DPI** (low-res images print muddy; 300 DPI is the print standard).
- **Bleed presence** (artwork running to the page edge needs bleed margin or you get white slivers).

A check is either a **blocker** (publication can't proceed until fixed) or a **warning** (creator is told, can override at their own risk).

**Claude Code's suggested split:**
- **Blockers:** dimensions, page count vs. format, multiple-of-4. *Rationale: a printer literally rejects these.*
- **Warnings:** embedded fonts, DPI, bleed. *Rationale: undesirable but the file is still printable; the creator owns the risk.*

**Open questions for Ben:**
1. Do all six ship in 3b, or is the first cut smaller (e.g. the three blockers only, warnings in a follow-up)? What's technically detectable server-side with the current PDF library vs. what needs a heavier tool later is itself a calibration question.
2. Is the blocker/warning split above right? In particular: should **bleed** or **embedded fonts** ever be a hard blocker for certain formats?
3. Is there a creator **override** path for warnings in 3b, or do warnings just display (override deferred)?

### Decision 2 — How the preflight result *reads*. (the Constitution-critical one)

This is the most exposed tonal moment in the slice. Three sub-decisions:

**2a — Framing.** How is the result introduced? Options:
- A composed list with a quiet lead-in: *"Three things to address."*
- A note in an editor's register: *"Baxter looked over the file. A few things need attention before it can go forward."*
- Minimal/structural — just the checks, no prose lead-in at all (maximum restraint).

**2b — Severity wording.** What do we call the states?
- Plain/technical: *"Failed" / "Passed."*
- Softer/editorial: *"Ready" / "Needs attention."*
- Something in between, and **what is the word for a warning** (vs. a blocker) — e.g. "note," "to consider," "recommended"?

**2c — Pass display.** When everything passes, what does the creator see?
- **Silence** — the holding line simply resolves to the file being ready; no banner (the Constitution explicitly favours silence for success).
- A single composed line (*"The file is ready."*).
- A hairline / minimal marker, no words.

**2d — The waiting state.** While the worker runs (seconds, but cold-start can add a few), what shows? The current *"File received. Awaiting check."* already exists. Keep it, or refine? It must read as *dignified, not anxious* — no spinner-with-"just a moment," no percentage.

**Claude Code's leaning (for reaction, not adoption):** editor's-register framing (2a option 2) but trimmed to one sentence; warning state called *"needs attention"* and a blocker called something firmer but still composed; **silence on full pass** (2c option 1) per the Constitution's own success example. But this is exactly the call worth Ben's hand — bring taste.

### Decision 3 — Promotion + cleanup behaviour

**3a — On pass.** When preflight passes and the file is promoted to the clean bucket:
- **Copy then delete the quarantine object** (clean bucket is the single source of truth; quarantine stays empty of passed files).
- **Copy and keep the quarantine original** (archival; costs storage; R2 has no egress fees but objects still cost at rest).

**3b — On fail.** When preflight fails:
- **Keep the quarantine object** so the creator can re-download / see exactly what they sent.
- **Delete it and force a fresh re-upload.**

**3c — Replace-flow leftovers (known open item).** When a creator replaces a file, the *old* quarantine object is currently orphaned (left behind). Should the 3b worker sweep superseded quarantine objects, or is that a separate cleanup job? Does the answer change based on 3a/3b?

**Claude Code's leaning:** on pass, copy-then-delete (clean = source of truth, tidy); on fail, keep the quarantine object (the creator should be able to see what they sent — withdrawing that would feel punitive, against Attention Respect). Replace-flow sweep: fold into the worker if cheap, else a small separate job — low priority.

### Decision 4 — Test PDFs to develop against

The worker can't be honestly verified without real fixtures. The set needed:
- A clean, print-ready PDF (passes everything).
- One with wrong dimensions for its chosen format.
- One with too-low-DPI images.
- One missing bleed.
- One with non-embedded fonts.
- An encrypted / corrupt PDF (must fail *gracefully*, not crash the worker).

**Question for Ben:** do these exist already (real InDesign/Affinity exports on hand), or should generating/sourcing them be a tracked sub-task before the worker is built? Real exports are far more valuable than synthetic ones for calibrating what's actually detectable.

---

## 6. What to send back

For each decision, a short ruling is enough — Claude Code turns them into the worker + UI. Most valuable:
- **Decision 0** (pick first — it unblocks everything).
- **Decision 2** in the most detail — exact words for each state, the framing sentence(s), and what a full pass shows. Drafting the actual strings here saves a round-trip.
- For Decisions 1 & 3, the blocker/warning split and the two storage behaviours.
- For Decision 4, just whether the fixtures exist or need sourcing.

Where a decision implies copy, **write the copy** — in Baxter's voice (§4). That's the part hardest to delegate and most valuable to nail by hand.
