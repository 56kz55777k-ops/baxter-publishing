/* eslint-disable @next/next/no-img-element -- Cloudflare Images delivery URLs. */
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { imageDeliveryUrl } from '@/lib/cloudflare/images';
import {
  stripe,
  stripeConfigured,
  STRIPE_PUBLISHABLE_KEY,
  PLATFORM_FEE_BPS,
} from '@/lib/stripe/client';
import { computeOrderAmounts } from '@baxter/domain';
import { CheckoutForm } from './checkout-form';

export const metadata = {
  title: 'Checkout — Baxter',
};

function money(minor: number, currency: string): string {
  return `$${(minor / 100).toFixed(2)} ${currency}`;
}

/**
 * Checkout — the one question this screen answers: how will you pay?
 *
 * The buyer has already decided to own the work (that was the publication page);
 * here they simply pay. The work is restated quietly for reassurance; there is
 * no cart, no upsell, no urgency. A PaymentIntent is created on Baxter's
 * platform account (funds held; D-026) and confirmed by the Payment Element.
 */
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle: rawHandle, slug: rawSlug } = await params;
  const handle = decodeURIComponent(rawHandle);
  const slug = decodeURIComponent(rawSlug);
  const workHref = `/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`${workHref}/buy`)}`);

  const { data: creator } = await supabase
    .from('users')
    .select('id, handle, display_name, stripe_charges_enabled')
    .eq('handle', handle)
    .maybeSingle();
  if (!creator) notFound();

  const { data: publication } = await supabase
    .from('publications')
    .select('id, title, subtitle, format, price_minor, currency, cover_asset_id, slug, status, creator_id')
    .eq('creator_id', creator.id)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();
  if (!publication) notFound();

  // Guards — mirror the publication page's buyability.
  if (
    !stripeConfigured() ||
    !creator.stripe_charges_enabled ||
    publication.price_minor === null ||
    publication.price_minor === undefined ||
    user.id === creator.id
  ) {
    redirect(workHref);
  }

  const currency = publication.currency ?? 'CAD';
  const amounts = computeOrderAmounts({
    unitPriceMinor: publication.price_minor,
    platformFeeBps: PLATFORM_FEE_BPS,
  });
  const collectShipping = publication.format !== 'digital';

  // Create the held-funds PaymentIntent (platform account; no transfer_data).
  const intent = await stripe().paymentIntents.create({
    amount: amounts.totalMinor,
    currency: currency.toLowerCase(),
    automatic_payment_methods: { enabled: true },
    metadata: {
      baxter_publication_id: publication.id,
      baxter_buyer_id: user.id,
      baxter_creator_id: creator.id,
      unit_price_minor: String(amounts.unitPriceMinor),
      quantity: String(amounts.quantity),
      subtotal_minor: String(amounts.subtotalMinor),
      shipping_minor: String(amounts.shippingMinor),
      tax_minor: String(amounts.taxMinor),
      total_minor: String(amounts.totalMinor),
      platform_fee_minor: String(amounts.platformFeeMinor),
      currency,
    },
  });

  let coverUrl: string | null = null;
  if (process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH && publication.cover_asset_id) {
    const { data: coverAsset } = await supabase
      .from('assets')
      .select('external_id')
      .eq('id', publication.cover_asset_id)
      .maybeSingle();
    if (coverAsset?.external_id) coverUrl = imageDeliveryUrl(coverAsset.external_id, 'grid');
  }

  return (
    <main className="min-h-screen px-gutter py-16 max-w-[40rem]">
      <p className="metadata mb-4">Checkout</p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
        How will you pay?
      </h1>

      {/* The work, restated quietly. */}
      <section className="mt-12 pt-10 border-t border-rule flex gap-6">
        {coverUrl && (
          <img
            src={coverUrl}
            alt=""
            className="w-16 h-auto self-start border border-rule shrink-0"
          />
        )}
        <div className="flex-1">
          <p className="font-serif text-body text-ink">{publication.title}</p>
          <p className="metadata text-ink-faint mt-2">
            {publication.subtitle ? `${publication.subtitle} · ` : ''}
            {creator.display_name}
          </p>
        </div>
        <p className="text-ink text-[0.95rem]">{money(amounts.totalMinor, currency)}</p>
      </section>

      <section className="mt-10">
        <CheckoutForm
          publishableKey={STRIPE_PUBLISHABLE_KEY}
          clientSecret={intent.client_secret ?? ''}
          collectShipping={collectShipping}
          returnUrl="/orders/confirm"
          totalLabel={money(amounts.totalMinor, currency)}
        />
      </section>

      <div className="mt-12">
        <Link
          href={workHref}
          className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft hover:text-ink transition-colors duration-300"
        >
          Back to the publication
        </Link>
      </div>
    </main>
  );
}
