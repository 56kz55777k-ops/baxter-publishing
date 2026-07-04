# Baxter Publishing — Slice 9 Design Questions

**Date:** 2026-07-04 · **Revised** to lead with the pricing-model reframe (Ben, "Pricing Model Revision — Foundational").
**From:** Claude Code (paired with Ben Gibson)
**For:** review before implementation
**Builds on:** the shipped order state machine + orders/publications schema, `decisions.md` (D-021/D-024 voices & actors, D-023 restrained commerce, D-026 held funds, D-027 one-question-per-screen), and Ben's Slice 8 review.
**Slice 9 goal:** close the business loop — **the pricing model, then fulfilment + commerce emails.** This is the last build slice of Milestone 1.

---

## STATUS — pricing model LOCKED (2026-07-04)

Ben locked the pricing foundation with four adjustments; recorded as **D-028** (pricing — production not commission) and **D-029** (the estimator service), with the Constitution updated. The four adjustments, folded into the decisions below:

1. **Production margin is configurable** — starts at 30%, consumed from config, never hard-coded (Decision 0a).
2. **Interior (B&W / Colour) is an explicit publication property** — set by the creator, authoritative for the estimator *and* the printer; never inferred from format. Needs a `publications.interior` migration + a creation-form field (Decision 0d / 0b).
3. **Expanded, transparent pricing breakdown** for creators — show how retail is built (print cost → Baxter production → your earnings → estimated retail); transparency *is* the position (Decision 0c).
4. **Creator test prints charged at production cost only** (print + shipping) — **no earnings, no Baxter margin.** Baxter earns when creators sell, not when they proof (Decision 1).

**Shipping locked separately (D-030).** Shipping is a **third, distinct system** (logistics), not part of production economics and **not** a Baxter estimator. Built **live from day one** behind a `ShippingProvider` abstraction targeting an **aggregator (EasyPost)**; quoted at checkout after the address; **pass-through** (Baxter earns nothing on postage). The production estimator additionally outputs **estimated weight + parcel dimensions**, which feed the shipping quote. No placeholder tiers. See "Shipping (logistics)" below.

Still open (proceeding on the brief's leans unless redirected): the exact placeholder **print-rate values** (0e — accepted as placeholders, tune to MGS later), email copy (I'll draft), and the remaining fulfilment confirmations. **New dependency:** an EasyPost account/key + a ship-from origin (like the Stripe setup) before shipping goes live.

---

## 0. The reframe (read first)

Ben has reframed Baxter's economics, and it changes the order of everything below. **Baxter is a publishing and print-production platform, not a marketplace that taxes creators.** Baxter earns because it *manufactures books* — not by taking a cut of the creator's margin. The current model (creator sets retail, Baxter skims 10%) is replaced by:

```
Retail price = Print cost  +  Baxter production margin (30% of print cost)  +  Creator's earnings per copy
```

Worked: print $10 → +$3 Baxter → +$18 creator → **$31 retail**. Buyer pays $31; printer gets $10; Baxter keeps $3; creator gets $18. The creator never thinks about retail — they answer one question: **"How much would you like to earn from each sale?"** ("**Your earnings per copy**" — not "royalty"; plain English, Baxter restraint.)

**Stripe architecture is unchanged** (one held payment, transfer at fulfilment). Only the *math* changes, plus a new **print-estimator service** that becomes the single source of truth for print economics.

---

## 1. Where Slice 9 sits

Through Slice 8, a buyer can pay and funds are held — but the pricing doesn't cover production (Baxter would lose money fulfilling), nothing is emailed, and there's no way to fulfil. Slice 9 fixes the economics, then makes the order actionable: OMS + fulfilment + the Transfer that releases held funds + the commerce emails.

---

## 2. Verified current state (confirmed against the live code)

- **Order state machine ready** — `paid → in_fulfillment → fulfilled` (+`cancelled`/`refunded`); `fundsHeld()`; transfer released at fulfilment. Actors buyer/creator/admin/system.
- **Orders schema has the fulfilment fields** — `platform_fee_minor`, `stripe_transfer_id`, `shipping_address` (captured in Slice 8), `fulfilled_at`. But the **amount fields assume the old model** (`unit_price_minor`, `subtotal_minor`, `platform_fee_minor`) — they need remapping to the royalty model (Decision 0d).
- **`publications.price_minor`** currently means "retail price the creator set." Under the new model it becomes **the creator's earnings per copy** (retail is *computed*, never stored on the publication).
- **Print specs are a GAP** — binding and paper stock exist nowhere (only in preset comments). They are inputs to the estimator (Decision 0b).
- **Colour is not stored** — the estimator needs B&W vs colour; today we'd default it per format.
- **`packages/domain` is the home for pure rules** — formats, preflight, `pricing.ts` (Slice 8's `computeOrderAmounts`). The estimator belongs here too. `pricing.ts` will be **superseded/rewritten** by the estimator.
- **A real held test order exists** to fulfil against (`$18`, ref `61694821`) — though its amounts predate the new model.
- **Plan §Slice 9** already specifies the order-detail with clickable transitions, `order_events`, the Inngest email with **signed URLs (links, NOT attachments)**, and status flowing to the buyer.

### Constraint
New Inngest functions ship → **D-017 manual resync** after deploy. And the pricing reframe needs a **migration** (orders amount fields; possibly publications).

---

## 3. Voice / constraints
- All three commerce emails are **Institutional** (D-021); the creator "your work sold" note may carry composed warmth but never performs. The admin production email is **operational** (Baxter → printer): plain, complete, scannable.
- **Restrained commerce (D-023):** receipts are records, not marketing. No upsells, no urgency, no "rate us."
- **One question per screen:** the order-detail page answers *"what should happen to this order?"*; the creator's pricing input answers *"what do you want to earn?"*.
- **The estimate is never a promise.** Every surface says **"Estimated production cost."** The printer's invoice is the source of truth.

---

## 4. The decisions

### Decision 0 — The pricing model + the print-estimator service *(FOUNDATIONAL — gates the whole slice)*

Largely **locked by Ben**; the open parts are the rate values, the data model, and the "estimated" UX. Sub-parts:

**0a — The model (LOCKED).** `retail = printCost + baxterMargin + creatorEarnings`, where `baxterMargin = round(marginRate × printCost)` and **`marginRate` is configurable** (starts at 30%, consumed from config — never hard-coded). The production margin **replaces the 10% platform fee entirely** — Baxter's only revenue is the production margin. The creator sets **earnings per copy**; retail is computed and shown to them for approval.

**0b — The estimator as the single source of truth (LOCKED architecture).** One service in `@baxter/domain` that every surface consumes — publication page, checkout, orders, admin fulfilment, creator workspace, emails, Stripe transfers, analytics. **No duplicated math anywhere.**
```
estimateProduction(spec) → {
  printCostMinor, baxterMarginMinor, creatorEarningsMinor, retailMinor, breakdown,
  estimatedWeightGrams, parcelDimensionsMm: { length, width, height }
}
// spec = { formatPresetId, pageCount, interior: 'mono'|'colour', binding, paperStock, quantity=1, creatorEarningsMinor, marginRate }
```
It resolves binding + paper from the format preset and the explicit `interior`, computes `printCost = base + pageCount × perPageRate` from a **configurable rate card**, adds the (configurable) margin and the creator's earnings, returns the full breakdown — **and derives the physical parcel** (weight from paper gsm × trim area × sheets + cover; dimensions from trim size + spine thickness from page count × caliper). Pure, testable, versioned in git. Renamed from Slice 8's `estimatePrintCost`/`computeOrderAmounts`. The weight + dimensions are what the **shipping** system consumes (D-030) — production owns the *parcel*, logistics owns the *postage*.

**0c — Naming (LOCKED).** "**Your earnings per copy**" everywhere the creator sees it. The creator workspace shows:
```
Estimated print cost   $10.00
Baxter production      $3.00
Your earnings          $18.00
──────────────────────────────
Estimated retail       $31.00
```

**0d — Data model (open — my proposal).** Snapshot the breakdown onto each order at purchase time (immutable), because rate cards change:
- **`publications`:** reinterpret `price_minor` as **creator earnings per copy** (relabel UI), and **add `interior`** (`mono`/`colour`) as an explicit creator-set property (LOCKED — never inferred from format). *This means a publications migration + an interior field on the creation form.*
- **`orders`:** add **`print_cost_minor`** and **`creator_earnings_minor`**; repurpose **`platform_fee_minor` → the Baxter production margin**; `total_minor` = retail. *This is the one migration Slice 9 needs.* (`unit_price_minor`/`subtotal_minor` can hold earnings×qty for continuity.)
- The **transfer at fulfilment = `creator_earnings_minor`** (not "total − fee"); Baxter keeps the margin and pays the printer the print cost.

**0e — The rate card (open — confirm the numbers).** Placeholder CAD rates from research (short-run/on-demand; **calibrate to MGS Marketing Toronto** when you have their sheet). `printCost = base + pageCount × perPageRate`:

| Format | Binding | Default paper | Base | Per page (mono / colour) |
|---|---|---|---|---|
| A5 Zine | Saddle-stitch | 80lb uncoated text · 100lb cover | $2.50 | $0.04 / $0.20 |
| A4 Magazine | Saddle-stitch | 100lb coated text · 120lb cover | $3.00 | $0.06 / $0.22 |
| Square Photobook 210 | Perfect-bound | 100lb coated art · 12pt cover | $5.50 | $0.10 / $0.42 |

Sanity checks: 8pp mono zine → **$2.82**; 32pp colour magazine → **$10.04**; 60pp colour photobook → **$30.70**; ~$10-print book + 30% + $18 → **$31 retail**. Grounded in: POD base+per-page formulas (KDP ≈ $1.00 + $0.012/pg; colour ≈ $0.04–0.08/pg), local short-run $2.50–9/copy, coated/square premiums. **Confirm or tune these** (esp. once MGS quotes real stocks).

**What would force reconsideration:** MGS's real rate card (swap the numbers, same estimator); volume tiers (add a quantity curve to the estimator later); a format needing per-order spec overrides.

---

### Decision 0.5 — Shipping (logistics) *(LOCKED — D-030)*

Shipping is a **third system**, separate from production and commerce, and quoted **live** — never estimated by Baxter, never placeholder tiers.

- **`ShippingProvider` abstraction from day one:** `quoteShipping({ from, to, parcel }) → [{ carrier, service, amountMinor, currency, estimatedDeliveryDays }]`. Checkout consumes the interface; the provider is swappable.
- **First (and initially only) provider: EasyPost** (`apps/web/lib/shipping/easypost.ts`) — one API, 100+ carriers incl. Canada Post/Purolator/UPS/FedEx. Env-driven (`EASYPOST_API_KEY`), degrades gracefully without a key. Adapts the estimator's metric weight/dims → EasyPost's oz/in.
- **Inputs:** `from` = the ship-from origin (configured Toronto origin; MGS when formalised); `to` = the buyer's delivery address; `parcel` = the estimator's `estimatedWeightGrams` + `parcelDimensionsMm`.
- **Pass-through:** `shipping_minor` = the carrier's actual rate — no markup, no handling fee. Baxter earns nothing on postage.
- **Checkout flow change (address-first):** collect the delivery address → `quoteShipping` → present the rate(s) → `total = retail + shipping` → charge. The Stripe **PaymentIntent amount is set/updated *after* the quote** (Slice 8 created it upfront for retail-only). This fits one-question-per-screen: *"Where should it ship?"* (address → live quote) then *"How will you pay?"*.

**Open sub-questions:** (a) if multiple rates come back, show the **cheapest** by default, or let the buyer choose a service/speed? *Lean: cheapest by default for v1, with room to offer choices later.* (b) The ship-from origin string for v1 (a Toronto origin until MGS is set) — you provide. (c) Digital-only orders skip shipping entirely (no parcel).

**Dependency (like Stripe):** an EasyPost account + `EASYPOST_API_KEY` in Vercel, and the origin address, before shipping goes live. Until then the provider no-ops and checkout can fall back to $0/"shipping unavailable" in test.

---

### Decision 1 — Creator test prints (reverses the Slice 8 self-purchase block)

Allow a creator to buy their own *published* work as a **test print / proof** (relax the block in both places). The money model under the royalty scheme:

**LOCKED (adjustment 4):** a test print is charged at **production cost only — print cost + shipping, no Baxter margin, no creator earnings, no transfer.** Detected by `buyer_id == creator_id`; the order is flagged **"Test print"**; `baxter_margin = 0`, `creator_earnings = 0`, so retail = `printCost + shipping` (the $10 book → **$10** + shipping). The admin still gets the production package (the point is to make the proof). Baxter earns when creators *sell*, not when they *proof* (D-028).

---

### Decision 2 — The commerce emails (amounts from the estimate)

Fire at **`paid`** (the Slice 8 webhook), new Inngest functions:
- **Buyer** — confirmation + receipt (Institutional): work, creator, amounts (retail breakdown optional or just total), delivery address, reference, what's next. This *is* the receipt.
- **Creator** — "Your work sold." (warm, factual): which work, **your earnings for this copy** (`creator_earnings`), and that Baxter pays it **at fulfilment** (held-funds honesty). *Skipped for test prints.*
- **Admin** — production package (operational, **print orders only**): reference, **signed print-ready PDF link** (not attached), **specs** (trim · pages · binding · paper · colour, from the estimator/preset), **delivery address**, buyer/creator, and **Test print** flag. What you forward to the printer.

*Confirm:* all three at `paid`; admin email print-only; no extra fulfilment-time emails in v1 (buyer's order page carries status).

---

### Decision 3 — Order detail + fulfilment (`/admin/orders/[id]`)
Full detail (work, buyer+address, creator+**earnings**, specs, the retail breakdown, held-funds status, `order_events` timeline) + **download the print-ready PDF** (fresh signed URL) + clickable **`paid → in_fulfillment → fulfilled`** (state-machine-validated service-role action + `order_events`; the Slice 6 pattern, not a DB function). **Fulfilment fires the Stripe Transfer** of `creator_earnings_minor` to the creator's connected account (stored in `stripe_transfer_id`, stamps `fulfilled_at`), **skipped for test prints**, failure-isolated. Buyer's `/orders/[id]` reflects the new status.

---

### Decision 4 — Refunds & cancellations
*Lean: defer* to a later slice (Stripe refund + transfer reversal is its own careful work). Slice 9 = the happy path.

---

## 5. What to send back
1. **Decision 0** — confirm the model (locked), the estimator-as-service (locked), the naming (locked), and specifically **(0e) the placeholder rates** (tune or accept) and **(0d) the data-model approach** (default colour per format v1 + the one orders migration).
2. **Decision 1** — test prints allowed; keep or waive the Baxter margin on a creator's own proof.
3. **Decision 2** — confirm the three emails + triggers (I'll draft copy).
4. **Decision 3** — confirm the transfer = earnings and the exposed transitions.
5. **Decision 4** — confirm refunds deferred.

Once locked (`D-028…`), I build the estimator first (the spine), then the order/checkout/marketplace consume it, then fulfilment + transfer + emails — and we fulfil the real held test order to watch the transfer + emails fire. That closes Milestone 1's build; Slice 10 is the full-loop smoke test.

---

### Sources (rate research)
- [Foglio — Short-run printing Canada](https://www.foglioprint.com/blog/short-run-printing-canada) · [Gobook — paperback cost 2025](https://www.gobookprinting.com/cost-to-print-paperback-book/) · [books.by — POD cost formulas](https://books.by/guides/print-cost-comparison) · [ebookpbook — colour POD cost](https://www.ebookpbook.com/2026/04/24/colour-interior-printing-cost-pod/) · [Quarter Pop Press — riso/zine pricing](https://www.quarterpop.press/pricing-guide) · [QinPrinting — art book costs](https://www.qinprinting.com/blog/art-book-printing-costs/)
