# Baxter — Slice 8 Stripe setup & smoke test

**Slice:** 8 — Stripe Connect + first purchase
**Commit:** `ee60a61` (build) · money-flow decisions `D-026`/`D-027`
**Status:** code shipped, typecheck/lint/build green. **Not deployed** — Slice 8 needs Stripe provisioning first (only you can do the account setup). Use **test mode** throughout.

No migration (the `orders` / `order_events` tables already exist). No Inngest change (no new function) — so no D-017 resync.

---

## 1. What you provision in Stripe (test mode)

1. **Enable Connect.** Stripe Dashboard → **Connect** → get started → platform profile. We use **Express** connected accounts with the **transfers** capability (Baxter charges buyers on its own account and transfers each creator's share at fulfilment — D-026).
2. **Get the API keys** (test): **Developers → API keys** → `pk_test_…` (publishable) and `sk_test_…` (secret).
3. **Create the webhook endpoint.** Developers → **Webhooks** → Add endpoint:
   - URL: `https://baxter-publishing-web.vercel.app/api/stripe/webhook`
   - Events: **`payment_intent.succeeded`** and **`account.updated`**
   - Copy the **signing secret** (`whsec_…`).

## 2. Vercel env vars (Production + Preview, Sensitive)

```
STRIPE_SECRET_KEY=sk_test_…
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PLATFORM_FEE_BPS=1000        # 10% platform fee (already the default)
```
Confirm `NEXT_PUBLIC_SITE_URL=https://baxter-publishing-web.vercel.app` is set (used for Connect return URLs). Then **redeploy**.

## 3. Two accounts needed for the test

A creator **cannot buy their own work** (by design), so the smoke test needs two accounts:
- a **creator** who is payout-ready (Connect set up), and
- a **buyer** signed in as a *different* account.

Simplest: set up payouts on **`ben-in-toronto`** (the creator of the live "Slice 7 Test"), then buy it from a **second account** (e.g. a `ben2`-style test account). Or create a fresh test publication under a second creator and buy it as `ben-in-toronto`.

---

## 4. Smoke test

### A. Creator payout onboarding
- [ ] As the **creator**, go to **`/settings/payouts`** → **Set up payouts** → complete Stripe Express onboarding (test mode accepts test values; use the "skip"/prefill helpers). Return to `/settings/payouts` → it reads **"Payouts are set up."**
- [ ] DB: `select stripe_account_id, stripe_charges_enabled from users where handle='…';` → account id set, `charges_enabled = true` (synced on return and by the `account.updated` webhook).

### B. Purchase (the first order)
- [ ] As the **buyer** (different account), open the creator's publication page. It now shows **"Own this publication"** (instead of "Ordering opens soon.").
- [ ] Click it → **`/[handle]/[slug]/buy`** ("How will you pay?"). The work is restated; the Payment Element renders in Baxter's palette; a shipping address is requested for print.
- [ ] Pay with test card **`4242 4242 4242 4242`**, any future expiry, any CVC, any postal code.
- [ ] You're returned to **`/orders/confirm`** → it resolves to **`/orders/[id]`** ("What happens next?" → *"Baxter has your payment. Your order is being prepared for fulfilment."*). (If the webhook lags a second, the confirm page shows a calm "Payment received" holding state with a Refresh link.)

### C. Verify the order + held funds
- [ ] **DB:**
  ```sql
  select status, total_minor, platform_fee_minor, stripe_payment_intent_id, shipping_address
  from orders order by created_at desc limit 1;                 -- status = paid
  select from_status, to_status, payload
  from order_events order by created_at desc limit 1;           -- pending -> paid, via stripe_webhook
  ```
- [ ] **Admin:** **`/admin/orders`** lists the order (buyer → creator, Paid, total).
- [ ] **Stripe:** the PaymentIntent shows **succeeded**; the payment sits in **Baxter's balance** (no transfer to the creator yet — that's Slice 9 at fulfilment). Confirm there is **no** `transfer_data`/`application_fee` on the PaymentIntent (held-funds model, D-026).

### D. Guards
- [ ] Signed **out**, "Own this publication" → checkout redirects to sign-in and back.
- [ ] As the **creator** viewing their **own** work, the purchase action does **not** appear (self-purchase blocked); it reads "Ordering opens soon."
- [ ] A publication whose creator is **not** payout-ready shows "Ordering opens soon."

---

## 5. Notes

- **Held funds (D-026):** the buyer is charged to Baxter's platform account and the money is held. The creator's payout (`total − platform fee`) is a **separate transfer created at fulfilment** — that's **Slice 9** (OMS), along with the order-detail page, clickable state transitions, and the production-package email. Slice 8 deliberately ends at "order created, funds held."
- **Idempotent webhook:** a repeated `payment_intent.succeeded` won't double-create an order (checked by `stripe_payment_intent_id`).
- **Stripe MCP:** if the session's Stripe MCP is connected to this account, it can help verify (read the PaymentIntent, the connected account, the balance) — but the app still needs its own keys in Vercel env.

---

## Next (Slice 9)

OMS: `/admin/orders/[id]` with clickable state transitions (`paid → in_fulfillment → fulfilled`), each writing `order_events`; the **Transfer to the creator** at fulfilment (releasing held funds); the production-ready email with signed artifact URLs; and status flowing back to the buyer's order page.
