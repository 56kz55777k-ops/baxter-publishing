import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { inngest } from '@/lib/inngest/client';

// Stripe signature verification needs the raw body + Node crypto.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook — the reliable source of truth for order state (Slice 8).
 *
 * The client return URL is only UX; the order is created here, on
 * `payment_intent.succeeded`, so a closed tab or a slow redirect never loses a
 * paid order. Writes go through the service-role client (there is no client
 * insert policy on orders by design). Idempotent: a repeated event for an
 * already-recorded payment is a no-op.
 *
 * Also syncs a creator's payout readiness on `account.updated`.
 */
function toInt(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get('stripe-signature');
  if (!secret || !signature) {
    return new Response('Webhook not configured.', { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error('stripe webhook: signature verification failed', {
      error: String(err),
    });
    return new Response('Invalid signature.', { status: 400 });
  }

  const db = createAdminClient();

  try {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const m = pi.metadata ?? {};
      const publicationId = m.baxter_publication_id;
      const buyerId = m.baxter_buyer_id;
      const creatorId = m.baxter_creator_id;

      // Not a Baxter checkout intent — ignore.
      if (!publicationId || !buyerId || !creatorId) {
        return new Response('ok', { status: 200 });
      }

      // Idempotency: skip if we already recorded this payment.
      const { data: existing } = await db
        .from('orders')
        .select('id')
        .eq('stripe_payment_intent_id', pi.id)
        .maybeSingle();
      if (existing) {
        return new Response('ok', { status: 200 });
      }

      const shipping = pi.shipping
        ? {
            name: pi.shipping.name ?? null,
            phone: pi.shipping.phone ?? null,
            address: pi.shipping.address ?? null,
          }
        : null;

      const { data: order, error } = await db
        .from('orders')
        .insert({
          buyer_id: buyerId,
          publication_id: publicationId,
          creator_id: creatorId,
          status: 'paid',
          unit_price_minor: toInt(m.unit_price_minor),
          quantity: toInt(m.quantity, 1),
          subtotal_minor: toInt(m.subtotal_minor),
          shipping_minor: toInt(m.shipping_minor),
          tax_minor: toInt(m.tax_minor),
          total_minor: toInt(m.total_minor, pi.amount),
          print_cost_minor: toInt(m.print_cost_minor),
          platform_fee_minor: toInt(m.platform_fee_minor),
          creator_earnings_minor: toInt(m.creator_earnings_minor),
          is_test_print: m.is_test_print === 'true',
          currency: m.currency ?? (pi.currency ?? 'cad').toUpperCase(),
          stripe_payment_intent_id: pi.id,
          shipping_address: shipping,
          // Selected carrier service (D-030), carried on the intent once EasyPost
          // is live; null until then.
          shipping_carrier: m.shipping_carrier ?? null,
          shipping_service: m.shipping_service ?? null,
          shipping_estimated_delivery: m.shipping_estimated_delivery ?? null,
        })
        .select('id')
        .single();

      if (error) {
        console.error('stripe webhook: order insert failed', {
          code: error.code,
          message: error.message,
          paymentIntent: pi.id,
        });
        // 500 so Stripe retries.
        return new Response('order insert failed', { status: 500 });
      }

      await db.from('order_events').insert({
        order_id: order.id,
        from_status: 'pending',
        to_status: 'paid',
        actor_id: null, // system (Stripe)
        payload: { via: 'stripe_webhook', payment_intent: pi.id },
      });

      // Fan out the commerce notifications (buyer receipt, creator sale, admin
      // production package). Async so a slow email never blocks the webhook ACK;
      // a send failure never un-books the paid order.
      try {
        await inngest.send({
          name: 'order/paid',
          data: { orderId: order.id },
        });
      } catch (sendErr) {
        console.error('stripe webhook: order/paid emit failed', {
          orderId: order.id,
          error: String(sendErr),
        });
      }

      return new Response('ok', { status: 200 });
    }

    if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account;
      // Transfers-only connected account (D-026): gate on the transfers
      // capability, not charges_enabled (which stays false for this model).
      const ready = account.capabilities?.transfers === 'active';
      await db
        .from('users')
        .update({
          stripe_charges_enabled: ready,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_account_id', account.id);
      return new Response('ok', { status: 200 });
    }

    // Unhandled event types are acknowledged.
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('stripe webhook: handler error', {
      type: event.type,
      error: String(err),
    });
    return new Response('handler error', { status: 500 });
  }
}
