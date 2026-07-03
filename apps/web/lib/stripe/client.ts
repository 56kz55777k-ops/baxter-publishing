/**
 * Stripe server client (server-only).
 *
 * Lazily constructed so the app builds and runs without Stripe configured —
 * `stripe()` throws a clear error only when actually called without a key, and
 * `stripeConfigured()` lets surfaces degrade gracefully (a publication whose
 * creator isn't payout-ready simply stays "Ordering opens soon.").
 *
 * Money model (D-026): charges land on Baxter's platform account and are held;
 * the creator's payout is a separate Transfer at fulfilment (Slice 9). We do NOT
 * use destination charges / `application_fee_amount` (those transfer at payment
 * time, which would break the held-funds order state machine).
 */
import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function stripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set — Stripe is not configured.');
  }
  // apiVersion omitted: use the account's default pinned version.
  _stripe = new Stripe(key);
  return _stripe;
}

/** True when a secret key is present. Lets surfaces degrade without Stripe. */
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Platform fee in basis points (1000 = 10%). Charged on the subtotal. */
export const PLATFORM_FEE_BPS = Number(process.env.STRIPE_PLATFORM_FEE_BPS ?? '1000');

/** Publishable key for the browser (Payment Element). */
export const STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
