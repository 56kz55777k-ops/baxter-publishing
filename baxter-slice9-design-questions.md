# Baxter Publishing — Slice 9 Design Questions

**Date:** 2026-07-04
**From:** Claude Code (paired with Ben Gibson)
**For:** review before implementation
**Builds on:** `docs/implementation-plan.md` §Slice 9, the shipped order state machine + orders schema, `decisions.md` (D-016 submission ceremony, D-021/D-024 voices & actors, D-023 restrained commerce, D-026 held funds, D-027 one-question-per-screen), and Ben's Slice 8 review (commerce emails + print package + creator test prints).
**Slice 9 goal:** close the business loop — the **OMS + fulfilment + commerce emails**. Turn "order created, funds held" into "order fulfilled, creator paid, printer briefed, everyone notified."

This is the **last build slice of Milestone 1**. After it, Slice 10 is the full-loop smoke test.

---

## 1. What Baxter is / where Slice 9 sits

Through Slice 8, a buyer can pay: an order lands `paid` and the funds are **held** in Baxter's platform balance (D-026). But nothing happens next — no one is emailed, there's no way to fulfil the order, and the creator's money never moves.

Slice 9 makes the order *actionable*. Three strands, all sharing the same order + events:
1. **Commerce emails** (Ben's request) — at `paid`: the **buyer** gets a confirmation/receipt, the **creator** learns they made a sale, and for any **print** order the **admin** gets a production package (print file + specs + delivery address) to forward to the printer.
2. **The order-detail / fulfilment surface** — `/admin/orders/[id]`: full order info, a downloadable print-ready PDF (backup to the email), and the clickable state machine (`paid → in_fulfillment → fulfilled`).
3. **Releasing the held funds** — at fulfilment, a **Stripe Transfer** moves the creator's share (`total − platform fee`) to their connected account (D-026's other half), and the buyer's order page reflects the new status.

---

## 2. Verified current state (confirmed against the live code)

- **Order state machine is ready** (`packages/domain/src/state-machines/orders.ts`): `pending → paid → in_fulfillment → fulfilled`, plus `cancelled`/`refunded`. `fundsHeld()` returns true for `paid`/`in_fulfillment`; the model is "release the transfer when the creator marks fulfilled." Actors: buyer/creator/admin/system.
- **Orders schema has the fulfilment fields** (no migration for the transfer): `platform_fee_minor`, `stripe_transfer_id` (nullable), `shipping_address` (jsonb, **captured** in Slice 8 — verified), `fulfilled_at`. Plus `order_events` (insert-only audit).
- **Print specs are a GAP.** `publications` has trim size (`trim_width_mm/height_mm`) and `page_count`, and the format preset id — but **binding and paper stock exist nowhere** (only referenced in preset *comments*). The admin print package can't list them until we decide where they come from → **Decision 0**.
- **Self-purchase is currently BLOCKED** in two places: the publication page (`viewer.id !== creator.id`) and the buy-page guard (`user.id === creator.id`). Ben wants creators to be able to order **test prints of their own books** → this reverses that rule → **Decision 1**.
- **Email plumbing exists** — `lib/email/resend.ts` (`sendEmail({to,subject,text})`), used by the Slice 5/6 notifications. Print file lives in the R2 `baxter-clean` bucket; `presignedGetUrl` already mints signed GET URLs (used on the review desk). Inngest is wired.
- **A real held order exists to build against** — the Slice 8 test order (`$18`, ref `61694821`, buyer `benjamin@benjamingibson.ca`, creator `ben-in-toronto`), funds held, no transfer yet.
- **Plan §Slice 9** already specifies: order-detail with clickable transitions, transitions write `order_events`, an Inngest email with **signed URLs to the PDF (links, NOT attachments** — per V2 brief §32), status flowing back to the buyer.

### The constraint that shapes everything
New Inngest functions ship this slice → the **D-017 manual resync** applies after deploy. And there's **no migration for the transfer/fulfilment** — the only possible migration is if print specs (Decision 0) need a column.

---

## 3. The voice you must design within

- **Two voices / three actors (D-021/D-024).** All three commerce emails are **Institutional** — Baxter stating facts (an order, a sale, a shipment). None are Editorial (no interpretation of the work). The creator "you made a sale" note may carry *composed warmth* (it's a good moment) but stays factual, never performative ("Congratulations!!!" is out; "Your work sold." is in).
- **The admin production email is operational, not a customer email** — it's Baxter talking to itself/its printer. Plain, complete, scannable: specs, address, file link. No brand performance.
- **Restrained commerce (D-023).** Receipts and confirmations are honest and quiet — no "Thanks for your purchase! 🎉", no upsells, no "rate your experience" nudges. A receipt is a record.
- **One question per screen (Constitution).** The order-detail page answers *"what should happen to this order?"* — the state, the file, the address, and the next action. Not a dashboard.
- **Attention Respect.** No "your order is #47 in queue," no fake ETAs. Time named honestly ("Baxter will prepare your order for the printer").

---

## 4. The decisions

### Decision 0 — Where do print specs (binding + paper stock) live? *(gates the admin package — decide first)*

The admin print email + order detail must state **trim size, page count, binding, and paper stock** so you can brief the printer. Trim + pages exist; binding + stock don't. Options:

- **A — Format-preset defaults, in `@baxter/domain`.** Add `binding` and `paperStock` (with a sensible default string per preset: e.g. A5 Zine → *saddle-stitched*, A4 Magazine → *saddle-stitched*, Square Photobook → *perfect-bound*; each with a default paper, e.g. *"100lb uncoated text, 130lb cover"*). No migration; code-only, versioned in git. The admin package resolves specs from the publication's preset.
- **B — Per-publication fields the creator sets.** A migration adds `binding`/`paper_stock` columns the creator chooses at creation/marketplace. More creator control, but more onboarding friction and a migration.
- **C — Admin enters them at fulfilment.** No creator input; the admin fills specs on the order-detail page before forwarding. Flexible, but the info isn't in the email automatically.

*Lean: **A** for v1* (preset defaults in `@baxter/domain`), with the door open to a per-order **admin override** field later (a light version of C) if a specific order needs a different stock. This gets real specs into the email immediately with no migration, and the defaults are exactly the printer-facing values Baxter would choose per format. **Question for you:** confirm the default binding + paper stock per format (I'll propose concrete strings; you tune them to your actual printer's stocks).

---

### Decision 1 — Creator test prints (reverse the self-purchase block) + the money model

Ben: creators should be able to order **test prints of their own books**, and the same email logic applies. This reverses Slice 8's self-purchase block. Two parts:

**1a — Allow self-purchase.** Relax the block in both places so a creator can buy their own *published* work. (Keep blocking unpublished/others' drafts, naturally.)

**1b — The money model for a self-purchase** (the real decision — a creator can't meaningfully transfer to themselves). Options:
- **A — Cost-only test print, no transfer, no platform fee.** The creator pays (covers Baxter's Stripe fee + any print cost); `platform_fee_minor = 0`; **no transfer at fulfilment** (buyer == creator → skip). The order is flagged a **test print**. Baxter still fulfils (forwards the file to the printer). Cleanest and honest — it's a proof copy, not a sale.
- **B — Normal purchase, no transfer.** Charge full price, keep the fee, but skip the transfer (can't pay yourself). The creator overpays Baxter for a proof — odd.
- **C — Don't charge at all** (a "request a proof" flow, no payment). Simplest for the creator, but bypasses the whole payment path we just built and needs its own flow.

*Lean: **A** — a self-purchase is a **test print**: detected by `buyer_id == creator_id`, `platform_fee = 0`, **no transfer at fulfilment**, order marked so `/admin/orders` and the production email read "Test print — [creator]". The admin still gets the production package (the point is to make the proof).* **Sub-question:** is a test print's price the normal list price, or should Baxter charge only its cost (Stripe fee + print)? For v1 I lean list price (simple; the creator is buying a copy) unless you want a true at-cost proof.

---

### Decision 2 — The commerce email set (triggers, recipients, content)

All fire when an order reaches **`paid`** (the webhook we built), via new Inngest functions. Proposed set:

- **Buyer — confirmation + receipt** (Institutional). To the buyer's email. Contents: "Your order is confirmed.", the work + creator, amounts (subtotal/shipping/total), delivery address, order reference, and what happens next. This *is* the receipt (no separate PDF invoice in v1).
- **Creator — "your work sold"** (Institutional, quietly warm). To the creator's email. Contents: which work sold, the amount they'll receive (**their payout = total − platform fee**), and that Baxter pays them **when the order is fulfilled** (held-funds honesty). *Skipped for a test print* (they bought it themselves).
- **Admin — production package** (operational). To `ADMIN_NOTIFICATION_EMAIL`. **For print orders only** (skip digital). Contents: order ref, **the signed print-ready PDF link** (links, not attachments — V2 §32), **specs** (trim size · pages · binding · paper stock, from Decision 0), **delivery address**, buyer/creator, and whether it's a **test print**. This is what you forward to the printer.

**Questions:** (a) confirm all three fire at `paid` (not at fulfilment); (b) confirm digital-format orders skip the admin print email (nothing to print) — for v1 everything is `print`, but the branch should exist; (c) any second admin email at **fulfilment/shipped** (e.g. "order marked fulfilled") or is the buyer's order-page status enough? *Lean: fire all three at `paid`; admin print email is print-only; no extra fulfilment emails in v1 (status flows to the buyer's page instead).*

---

### Decision 3 — The order-detail + fulfilment surface (`/admin/orders/[id]`)

The OMS heart. Proposed:
- **Full order detail** — work (cover), buyer + delivery address, creator + payout amount, specs (Decision 0), amounts, held-funds status, timeline from `order_events`.
- **Download the print-ready PDF** — a fresh signed URL from `baxter-clean` (backup to the email).
- **Clickable state transitions** — `paid → in_fulfillment → fulfilled`, each validated against the pure state machine (the Slice 6 pattern: service-role action + `order_events`; *not* the plan's "DB function" — we standardised on the state machine + service role) and re-verifying admin.
- **The Transfer at fulfilment** — marking `fulfilled` creates a **Stripe Transfer** of `creatorPayoutMinor` to the creator's connected account, stored in `stripe_transfer_id`, stamps `fulfilled_at`. **Skipped for test prints** (Decision 1). Failure-isolated: a transfer error must not corrupt the order state (log + retry, surface the failure).
- **Status flows back to the buyer** — `/orders/[id]` already renders per-status lines; `in_fulfillment`/`fulfilled` show the right message.

**Questions:** (a) confirm the exposed transitions are just `paid → in_fulfillment → fulfilled` for v1 (cancel/refund deferred — see Decision 4); (b) the Transfer at `fulfilled` — from the platform's available balance (test-mode funds available immediately); confirm we transfer `total − platform_fee` (the creator's share, which includes shipping reimbursement) and Baxter keeps the fee (its net is fee − Stripe processing).

---

### Decision 4 — Refunds & cancellations (scope for v1)

The state machine supports `cancelled` (pre-fulfilment) and `refunded` (post-fulfilment, admin-only, requires reversing the transfer). Question: does Slice 9 build these, or defer? *Lean: **defer to a later slice.*** Slice 9 covers the happy path (`paid → in_fulfillment → fulfilled` + transfer + emails); refunds/cancellations (with Stripe refund + transfer reversal) are their own careful slice. Note the deferral so Slice 10's smoke test doesn't expect them.

---

## 5. What to send back

Priority order:
1. **Decision 0** — print-spec home (A/B/C) and confirm the default binding + paper stock per format. Gates the admin package.
2. **Decision 1** — allow creator test prints (yes), and the money model (my lean: cost/fee-0, no transfer, flagged test print; + list-price-or-at-cost sub-question).
3. **Decision 2** — confirm the three emails, their `paid` trigger, print-only admin email, and any copy you want to steer (I'll draft the strings).
4. **Decision 3** — confirm the fulfilment transitions + the Transfer mechanics.
5. **Decision 4** — confirm refunds/cancellations are deferred.

Once settled I'll lock them as `D-028…` in `decisions.md` and build — then we run the fulfilment on the **existing held test order** (mark it fulfilled → watch the $16.20 transfer to the creator's connected account, and the emails fire), and Slice 10 closes Milestone 1.
