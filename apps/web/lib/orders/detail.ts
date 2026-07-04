/**
 * Order detail loader — the shared "production package" (Slice 9).
 *
 * Both the admin order page and the admin production-package email need the same
 * bundle: the order economics, the work's print specs, who it's for, where it
 * ships, and the print-ready file. Assembling it once here keeps those two
 * surfaces in agreement. The estimator (D-029) is the single source of truth for
 * the specs (binding, paper, weight, dimensions) — recomputed, never guessed.
 *
 * Callers mint their own signed file URL from `fileKey`/`fileBucket` with a TTL
 * suited to the surface (a short one for a page view, a longer one for an email).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  estimateProduction,
  type Interior,
  type ProductionEstimate,
} from '@baxter/domain';
import { productionMarginBps } from '@/lib/production/config';

export interface OrderAddress {
  name?: string | null;
  phone?: string | null;
  address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
}

export interface OrderDetail {
  order: {
    id: string;
    status: string;
    quantity: number;
    subtotalMinor: number;
    shippingMinor: number;
    totalMinor: number;
    printCostMinor: number;
    baxterMarginMinor: number;
    creatorEarningsMinor: number;
    isTestPrint: boolean;
    currency: string;
    createdAt: string;
    fulfilledAt: string | null;
    stripeTransferId: string | null;
    /** Selected live carrier service (D-030); null until EasyPost is enabled. */
    shippingCarrier: string | null;
    shippingService: string | null;
    shippingEstimatedDelivery: string | null;
  };
  publication: {
    id: string;
    title: string;
    slug: string;
    interior: Interior | null;
    pageCount: number | null;
    trimWidthMm: number | null;
    trimHeightMm: number | null;
  };
  buyer: { id: string; name: string; email: string | null };
  creator: { id: string; name: string; handle: string; email: string | null };
  /** Print specs (binding, paper, weight, parcel) — null if not yet priceable. */
  estimate: ProductionEstimate | null;
  address: OrderAddress | null;
  fileKey: string | null;
  fileBucket: string | null;
}

export async function loadOrderDetail(
  db: SupabaseClient,
  orderId: string
): Promise<OrderDetail | null> {
  const { data: o } = await db
    .from('orders')
    .select(
      'id, status, quantity, subtotal_minor, shipping_minor, total_minor, print_cost_minor, platform_fee_minor, creator_earnings_minor, is_test_print, currency, created_at, fulfilled_at, stripe_transfer_id, shipping_carrier, shipping_service, shipping_estimated_delivery, buyer_id, creator_id, publication_id, shipping_address'
    )
    .eq('id', orderId)
    .maybeSingle();
  if (!o) return null;

  const { data: pub } = await db
    .from('publications')
    .select(
      'id, title, slug, format_preset_id, interior, page_count, trim_width_mm, trim_height_mm'
    )
    .eq('id', o.publication_id)
    .maybeSingle();
  if (!pub) return null;

  const { data: people } = await db
    .from('users')
    .select('id, display_name, handle, email')
    .in('id', [o.buyer_id, o.creator_id]);
  const byId = new Map((people ?? []).map((u) => [u.id, u]));
  const buyerRow = byId.get(o.buyer_id);
  const creatorRow = byId.get(o.creator_id);

  const { data: artifact } = await db
    .from('artifacts')
    .select('r2_key, bucket')
    .eq('publication_id', pub.id)
    .eq('is_canonical', true)
    .maybeSingle();

  const interior: Interior | null =
    pub.interior === 'mono' || pub.interior === 'colour' ? pub.interior : null;

  const estimate =
    pub.format_preset_id && pub.page_count && interior
      ? estimateProduction({
          formatPresetId: pub.format_preset_id,
          pageCount: pub.page_count,
          interior,
          creatorEarningsMinor: o.creator_earnings_minor ?? 0,
          marginBps: o.is_test_print ? 0 : productionMarginBps(),
          quantity: o.quantity ?? 1,
        })
      : null;

  return {
    order: {
      id: o.id,
      status: o.status,
      quantity: o.quantity ?? 1,
      subtotalMinor: o.subtotal_minor ?? 0,
      shippingMinor: o.shipping_minor ?? 0,
      totalMinor: o.total_minor ?? 0,
      printCostMinor: o.print_cost_minor ?? 0,
      baxterMarginMinor: o.platform_fee_minor ?? 0,
      creatorEarningsMinor: o.creator_earnings_minor ?? 0,
      isTestPrint: Boolean(o.is_test_print),
      currency: o.currency ?? 'CAD',
      createdAt: o.created_at,
      fulfilledAt: o.fulfilled_at ?? null,
      stripeTransferId: o.stripe_transfer_id ?? null,
      shippingCarrier: o.shipping_carrier ?? null,
      shippingService: o.shipping_service ?? null,
      shippingEstimatedDelivery: o.shipping_estimated_delivery ?? null,
    },
    publication: {
      id: pub.id,
      title: pub.title,
      slug: pub.slug,
      interior,
      pageCount: pub.page_count ?? null,
      trimWidthMm: pub.trim_width_mm ?? null,
      trimHeightMm: pub.trim_height_mm ?? null,
    },
    buyer: {
      id: o.buyer_id,
      name: buyerRow?.display_name ?? 'Buyer',
      email: buyerRow?.email ?? null,
    },
    creator: {
      id: o.creator_id,
      name: creatorRow?.display_name ?? 'Creator',
      handle: creatorRow?.handle ?? '',
      email: creatorRow?.email ?? null,
    },
    estimate,
    address: (o.shipping_address as OrderAddress | null) ?? null,
    fileKey: artifact?.r2_key ?? null,
    fileBucket: artifact?.bucket ?? null,
  };
}
