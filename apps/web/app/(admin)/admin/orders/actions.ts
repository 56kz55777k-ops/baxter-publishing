'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdminUser } from '@/lib/auth/admin-guard';
import { stripe } from '@/lib/stripe/client';
import { canTransitionOrder, type OrderStatus } from '@baxter/domain';

export type AdvanceResult = { ok: true } | { ok: false; message: string };

/**
 * Advance an order through fulfilment from the desk (Slice 9 OMS).
 *
 * The desk is the fulfilment actor: paid → in_fulfillment → fulfilled. The
 * held-funds release happens exactly once, at `fulfilled` — a Stripe transfer of
 * the creator's earnings from Baxter's platform balance to their connected
 * account (D-026). Test prints release nothing (no margin, no earnings — D-029).
 * All writes are service-role; the transition is validated by the pure machine.
 */
export async function advanceOrder(
  orderId: string,
  to: OrderStatus
): Promise<AdvanceResult> {
  const admin = await getAdminUser();
  if (!admin) return { ok: false, message: 'Not authorized.' };

  const db = createAdminClient();
  const { data: order, error } = await db
    .from('orders')
    .select(
      'id, status, creator_id, creator_earnings_minor, is_test_print, currency, stripe_transfer_id'
    )
    .eq('id', orderId)
    .maybeSingle();
  if (error || !order) return { ok: false, message: 'Order not found.' };

  const from = order.status as OrderStatus;
  const check = canTransitionOrder({ from, to, by: 'admin' });
  if (!check.ok) {
    return { ok: false, message: check.reason ?? 'That change is not allowed.' };
  }

  // Release the creator's earnings on fulfilment — once, and never for a proof.
  let transferId: string | null = order.stripe_transfer_id ?? null;
  if (
    to === 'fulfilled' &&
    !order.is_test_print &&
    !transferId &&
    (order.creator_earnings_minor ?? 0) > 0
  ) {
    const { data: creator } = await db
      .from('users')
      .select('stripe_account_id')
      .eq('id', order.creator_id)
      .maybeSingle();
    if (!creator?.stripe_account_id) {
      return {
        ok: false,
        message:
          'The creator has no connected payout account; earnings cannot be released.',
      };
    }
    try {
      const transfer = await stripe().transfers.create({
        amount: order.creator_earnings_minor,
        currency: (order.currency ?? 'CAD').toLowerCase(),
        destination: creator.stripe_account_id,
        metadata: { baxter_order_id: order.id },
      });
      transferId = transfer.id;
    } catch (transferErr) {
      console.error('advanceOrder: transfer failed', {
        orderId: order.id,
        error: String(transferErr),
      });
      return {
        ok: false,
        message:
          'The payout transfer did not go through. The order was not marked fulfilled.',
      };
    }
  }

  const patch: Record<string, unknown> = {
    status: to,
    updated_at: new Date().toISOString(),
  };
  if (to === 'fulfilled') {
    patch.fulfilled_at = new Date().toISOString();
    if (transferId) patch.stripe_transfer_id = transferId;
  }

  const { error: updateErr } = await db
    .from('orders')
    .update(patch)
    .eq('id', order.id);
  if (updateErr) {
    console.error('advanceOrder: order update failed', {
      orderId: order.id,
      code: updateErr.code,
      message: updateErr.message,
    });
    return { ok: false, message: 'The order could not be updated.' };
  }

  await db.from('order_events').insert({
    order_id: order.id,
    from_status: from,
    to_status: to,
    actor_id: admin.id,
    payload: transferId ? { transfer: transferId } : {},
  });

  revalidatePath(`/admin/orders/${order.id}`);
  revalidatePath('/admin/orders');
  return { ok: true };
}
