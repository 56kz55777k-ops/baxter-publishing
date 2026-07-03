/* eslint-disable @next/next/no-img-element -- Cloudflare Images delivery URLs. */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { imageDeliveryUrl } from '@/lib/cloudflare/images';
import { SiteHeader } from '@/components/site-header';

export const metadata = {
  title: 'Order — Baxter',
};

function money(minor: number | null, currency: string): string {
  if (minor === null || minor === undefined) return '—';
  return `$${(minor / 100).toFixed(2)} ${currency}`;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// What happens next — Institutional voice, one line per state (D-021/D-024).
const NEXT_LINE: Record<string, string> = {
  paid: 'Baxter has your payment. Your order is being prepared for fulfilment.',
  in_fulfillment: 'The creator is preparing your order.',
  fulfilled: 'Your order has been fulfilled.',
  cancelled: 'This order was cancelled.',
  refunded: 'This order was refunded.',
  pending: 'Your payment is being confirmed.',
};

/**
 * A buyer's order — the one question this screen answers: what happens next?
 *
 * Read through the user client; RLS returns the row only to the buyer, the
 * work's creator, or an admin. Calm and factual; no tracking-number theatre.
 */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/orders/${id}`)}`);

  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, publication_id, status, subtotal_minor, shipping_minor, total_minor, currency, created_at'
    )
    .eq('id', id)
    .maybeSingle();
  if (!order) notFound();

  const currency = order.currency ?? 'CAD';

  const { data: publication } = await supabase
    .from('publications')
    .select('title, slug, creator_id, cover_asset_id')
    .eq('id', order.publication_id)
    .maybeSingle();

  const { data: creator } = publication
    ? await supabase
        .from('users')
        .select('handle, display_name')
        .eq('id', publication.creator_id)
        .maybeSingle()
    : { data: null };

  let coverUrl: string | null = null;
  if (process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH && publication?.cover_asset_id) {
    const { data: coverAsset } = await supabase
      .from('assets')
      .select('external_id')
      .eq('id', publication.cover_asset_id)
      .maybeSingle();
    if (coverAsset?.external_id) coverUrl = imageDeliveryUrl(coverAsset.external_id, 'grid');
  }

  const workHref =
    creator?.handle && publication?.slug
      ? `/${encodeURIComponent(creator.handle)}/${encodeURIComponent(publication.slug)}`
      : null;

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <article className="px-gutter pb-24 max-w-[40rem]">
        <p className="metadata mb-4">Order</p>
        <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
          {order.status === 'paid' ? 'Thank you.' : (publication?.title ?? 'Order')}
        </h1>
        <p className="font-serif text-lede text-ink-soft mt-6 max-w-measure">
          {NEXT_LINE[order.status] ?? 'Your order is being processed.'}
        </p>

        {/* The work. */}
        <section className="mt-14 pt-10 border-t border-rule flex gap-6">
          {coverUrl && (
            <img
              src={coverUrl}
              alt=""
              className="w-16 h-auto self-start border border-rule shrink-0"
            />
          )}
          <div className="flex-1">
            {workHref ? (
              <Link
                href={workHref}
                className="font-serif text-body text-ink border-b border-rule hover:border-ink transition-colors duration-300"
              >
                {publication?.title}
              </Link>
            ) : (
              <p className="font-serif text-body text-ink">{publication?.title}</p>
            )}
            {creator?.display_name && (
              <p className="metadata text-ink-faint mt-2">{creator.display_name}</p>
            )}
          </div>
        </section>

        {/* Amounts. */}
        <section className="mt-10 grid grid-cols-[8rem_1fr] gap-y-3 gap-x-8 text-[0.95rem]">
          <p className="metadata text-ink-faint">Subtotal</p>
          <p className="text-ink">{money(order.subtotal_minor, currency)}</p>
          {order.shipping_minor > 0 && (
            <>
              <p className="metadata text-ink-faint">Shipping</p>
              <p className="text-ink">{money(order.shipping_minor, currency)}</p>
            </>
          )}
          <p className="metadata text-ink-faint">Total</p>
          <p className="text-ink">{money(order.total_minor, currency)}</p>
        </section>

        <p className="metadata text-ink-faint mt-10">
          Ordered {formatDate(order.created_at)} · Reference {order.id.slice(0, 8)}
        </p>
      </article>
    </main>
  );
}
