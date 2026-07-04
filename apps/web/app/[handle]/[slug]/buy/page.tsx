/* eslint-disable @next/next/no-img-element -- Cloudflare Images delivery URLs. */
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { imageDeliveryUrl } from '@/lib/cloudflare/images';
import {
  stripe,
  stripeConfigured,
  STRIPE_PUBLISHABLE_KEY,
} from '@/lib/stripe/client';
import { estimateProduction } from '@baxter/domain';
import { productionMarginBps } from '@/lib/production/config';
import { shippingConfigured } from '@/lib/shipping';
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
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>;
  searchParams: Promise<{ proof?: string }>;
}) {
  const { handle: rawHandle, slug: rawSlug } = await params;
  const { proof } = await searchParams;
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
    .select(
      'id, title, subtitle, format, format_preset_id, interior, page_count, price_minor, currency, cover_asset_id, slug, status, creator_id'
    )
    .eq('creator_id', creator.id)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();
  if (!publication) notFound();

  // A proof is the creator ordering their own work (D-029): production cost
  // only, no margin, no earnings, no transfer. A purchase is anyone else.
  const isProof = proof === '1' && user.id === creator.id;
  const isPurchase = user.id !== creator.id;

  const interior =
    publication.interior === 'mono' || publication.interior === 'colour'
      ? publication.interior
      : null;

  // Guards — Stripe live, creator payout-ready, priceable, and either a
  // purchase (not your own work) or a proof (your own work).
  if (
    !stripeConfigured() ||
    !creator.stripe_charges_enabled ||
    !publication.format_preset_id ||
    !publication.page_count ||
    interior === null ||
    publication.price_minor === null ||
    publication.price_minor === undefined ||
    !(isPurchase || isProof)
  ) {
    redirect(workHref);
  }

  const currency = publication.currency ?? 'CAD';

  // Retail is built from production (D-029). A proof zeroes the margin and the
  // creator's earnings, charging production cost only. Shipping is a stub of 0
  // until the EasyPost key is set (D-030) — the live quote wires in there.
  const estimate = estimateProduction({
    formatPresetId: publication.format_preset_id,
    pageCount: publication.page_count,
    interior,
    creatorEarningsMinor: isProof ? 0 : publication.price_minor,
    marginBps: isProof ? 0 : productionMarginBps(),
  });
  const collectShipping = publication.format !== 'digital';

  // Logistics is a separate live system (D-030). A physical work cannot be
  // priced without a real carrier rate, and Baxter will not invent one: if the
  // shipping provider isn't operational, we do NOT create a PaymentIntent and do
  // NOT charge a placeholder — a wrong total is worse than a paused sale. The
  // buyer sees a calm Institutional notice. Enabling EasyPost (key + origin +
  // redeploy) restores checkout with no change here.
  if (collectShipping && !shippingConfigured()) {
    return (
      <main className="min-h-screen px-gutter py-24 max-w-[40rem]">
        <p className="metadata mb-4">Checkout</p>
        <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
          Ordering is briefly unavailable.
        </h1>
        <p className="font-serif text-lede text-ink-soft mt-8 max-w-measure">
          Baxter is completing the setup of its shipping service. Printed works
          can&rsquo;t be ordered until live delivery rates are in place, so that
          every order is charged its correct total. Please check back shortly.
        </p>
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

  // Shipping cost — the live cheapest carrier rate wires in here once EasyPost
  // is enabled (the dedicated shipping follow-up). Until then the gate above
  // prevents any physical checkout from reaching this point.
  const shippingMinor = 0;
  const subtotalMinor = estimate.retailMinor;
  const totalMinor = subtotalMinor + shippingMinor;

  // Create the held-funds PaymentIntent (platform account; no transfer_data).
  const intent = await stripe().paymentIntents.create({
    amount: totalMinor,
    currency: currency.toLowerCase(),
    automatic_payment_methods: { enabled: true },
    metadata: {
      baxter_publication_id: publication.id,
      baxter_buyer_id: user.id,
      baxter_creator_id: creator.id,
      unit_price_minor: String(subtotalMinor),
      quantity: '1',
      subtotal_minor: String(subtotalMinor),
      shipping_minor: String(shippingMinor),
      tax_minor: '0',
      total_minor: String(totalMinor),
      print_cost_minor: String(estimate.printCostMinor),
      platform_fee_minor: String(estimate.baxterMarginMinor),
      creator_earnings_minor: String(estimate.creatorEarningsMinor),
      is_test_print: isProof ? 'true' : 'false',
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
      <p className="metadata mb-4">{isProof ? 'Proof copy' : 'Checkout'}</p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
        How will you pay?
      </h1>
      {isProof && (
        <p className="metadata text-ink-faint mt-4">
          A proof of your own work, charged at production cost. No margin, no
          earnings.
        </p>
      )}

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
        <p className="text-ink text-[0.95rem]">{money(totalMinor, currency)}</p>
      </section>

      <section className="mt-10">
        <CheckoutForm
          publishableKey={STRIPE_PUBLISHABLE_KEY}
          clientSecret={intent.client_secret ?? ''}
          collectShipping={collectShipping}
          returnUrl="/orders/confirm"
          totalLabel={money(totalMinor, currency)}
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
