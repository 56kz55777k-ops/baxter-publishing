/**
 * Order pricing — pure money math (Slice 8).
 *
 * No I/O, no Stripe, no rounding surprises: everything is in integer minor units
 * (cents). One function computes every amount an order row stores, so the
 * checkout, the PaymentIntent, and the order record can never disagree.
 *
 * The platform fee is charged on the **subtotal** (the work's price), not on
 * shipping or tax — Baxter takes a cut of the work, not of postage.
 *
 * Held-funds model (D-026): the buyer is charged `totalMinor` to Baxter's
 * platform account; the creator's payout (`creatorPayoutMinor`) is transferred
 * separately at fulfilment (Slice 9). Baxter keeps `platformFeeMinor`.
 */

export interface OrderAmounts {
  unitPriceMinor: number;
  quantity: number;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** Baxter's cut, charged on the subtotal. */
  platformFeeMinor: number;
  /** What the creator receives at fulfilment: total minus the platform fee. */
  creatorPayoutMinor: number;
}

export interface OrderAmountsInput {
  unitPriceMinor: number;
  quantity?: number;
  /** Platform fee in basis points (e.g. 1000 = 10%). */
  platformFeeBps: number;
  /** Flat shipping in minor units. v1 default 0. */
  shippingMinor?: number;
  /** Tax in minor units. v1 default 0 (Stripe Tax deferred). */
  taxMinor?: number;
}

export function computeOrderAmounts(input: OrderAmountsInput): OrderAmounts {
  const quantity = input.quantity ?? 1;
  const shippingMinor = input.shippingMinor ?? 0;
  const taxMinor = input.taxMinor ?? 0;

  if (!Number.isInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) {
    throw new Error('unitPriceMinor must be a non-negative integer (minor units).');
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('quantity must be a positive integer.');
  }

  const subtotalMinor = input.unitPriceMinor * quantity;
  const totalMinor = subtotalMinor + shippingMinor + taxMinor;
  // Fee on the subtotal only, rounded to the nearest cent.
  const platformFeeMinor = Math.round((subtotalMinor * input.platformFeeBps) / 10000);
  const creatorPayoutMinor = totalMinor - platformFeeMinor;

  return {
    unitPriceMinor: input.unitPriceMinor,
    quantity,
    subtotalMinor,
    shippingMinor,
    taxMinor,
    totalMinor,
    platformFeeMinor,
    creatorPayoutMinor,
  };
}
