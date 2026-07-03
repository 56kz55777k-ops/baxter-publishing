import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SiteHeader } from '@/components/site-header';

export const metadata = {
  title: 'Order — Baxter',
};

/**
 * Checkout return (Slice 8). Stripe redirects here after payment with
 * `?payment_intent=…`. The order is created by the webhook, so we resolve the
 * order for this payment and forward to its page. If the webhook hasn't landed
 * yet (a second or two), we show a calm holding state the buyer can refresh —
 * never a spinner-with-"just a moment" (Constitution §Transitions).
 */
export default async function OrderConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ payment_intent?: string }>;
}) {
  const { payment_intent: paymentIntent } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  if (paymentIntent) {
    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq('stripe_payment_intent_id', paymentIntent)
      .maybeSingle();
    if (order) redirect(`/orders/${order.id}`);
  }

  // Webhook not landed yet — a dignified holding state.
  return (
    <main className="min-h-screen">
      <SiteHeader />
      <section className="px-gutter py-32 max-w-[40rem]">
        <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
          Payment received.
        </h1>
        <p className="font-serif text-lede text-ink-soft mt-8 max-w-measure">
          Baxter is recording your order. This page will show it in a moment.
        </p>
        <div className="mt-12">
          <Link
            href={
              paymentIntent
                ? `/orders/confirm?payment_intent=${encodeURIComponent(paymentIntent)}`
                : '/orders/confirm'
            }
            className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
          >
            Refresh
          </Link>
        </div>
      </section>
    </main>
  );
}
