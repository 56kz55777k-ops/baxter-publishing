/**
 * Order state machine.
 *
 * Held-funds pattern: Baxter holds funds from `paid` through `in_fulfillment`,
 * and only releases the transfer when the creator marks the order `fulfilled`.
 * Cancellations before fulfillment return funds; refunds after fulfillment
 * require an explicit reversal.
 */

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'in_fulfillment'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded';

export type OrderActor = 'buyer' | 'creator' | 'admin' | 'system';

const TRANSITIONS: Record<
  OrderStatus,
  Array<{ to: OrderStatus; by: OrderActor[] }>
> = {
  pending: [
    { to: 'paid', by: ['system'] }, // Stripe webhook
    { to: 'cancelled', by: ['buyer', 'system', 'admin'] },
  ],
  paid: [
    // Baxter manufactures and ships (D-029), so the desk begins fulfilment.
    // 'creator'/'system' retained for compatibility; 'admin' is the desk.
    { to: 'in_fulfillment', by: ['creator', 'system', 'admin'] },
    { to: 'cancelled', by: ['admin', 'buyer'] }, // pre-shipment cancel
  ],
  in_fulfillment: [
    { to: 'fulfilled', by: ['creator', 'admin'] },
    { to: 'cancelled', by: ['admin'] }, // rare; e.g. creator failure
  ],
  fulfilled: [
    { to: 'refunded', by: ['admin'] }, // post-fulfillment refund only by admin
  ],
  cancelled: [], // terminal
  refunded: [],  // terminal
};

export interface OrderTransitionRequest {
  from: OrderStatus;
  to: OrderStatus;
  by: OrderActor;
}

export interface OrderTransitionResult {
  ok: boolean;
  reason?: string;
}

export function canTransitionOrder({
  from,
  to,
  by,
}: OrderTransitionRequest): OrderTransitionResult {
  if (from === to) {
    return { ok: false, reason: 'No-op transition.' };
  }
  const legal = TRANSITIONS[from];
  const match = legal.find((t) => t.to === to);
  if (!match) {
    return { ok: false, reason: `Illegal order transition: ${from} → ${to}.` };
  }
  if (!match.by.includes(by)) {
    return { ok: false, reason: `Actor ${by} cannot perform ${from} → ${to}.` };
  }
  return { ok: true };
}

export function nextOrderStates(from: OrderStatus, by: OrderActor): OrderStatus[] {
  return TRANSITIONS[from].filter((t) => t.by.includes(by)).map((t) => t.to);
}

export function isOrderTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * Whether funds should currently be held by Baxter (not yet transferred to creator).
 * Centralizes the held-funds rule.
 */
export function fundsHeld(status: OrderStatus): boolean {
  return status === 'paid' || status === 'in_fulfillment';
}
