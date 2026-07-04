import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdminUser } from '@/lib/auth/admin-guard';
import { loadOrderDetail } from '@/lib/orders/detail';
import { presignedGetUrl } from '@/lib/r2/presigned';
import { CLEAN_BUCKET } from '@/lib/r2/client';
import { nextOrderStates, type OrderStatus } from '@baxter/domain';
import { FulfilmentControl } from './fulfilment-control';

export const metadata = {
  title: 'Order — Baxter',
};

function money(minor: number, currency: string): string {
  return `$${(minor / 100).toFixed(2)} ${currency}`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  paid: 'Paid',
  in_fulfillment: 'In fulfilment',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const INTERIOR_LABEL: Record<string, string> = {
  mono: 'Black & white',
  colour: 'Colour',
};

/**
 * Order detail — the production package (Slice 9). Everything the desk needs to
 * put a book into production: the specs, the print-ready file, where it ships,
 * the money, and the fulfilment control that releases the creator's earnings.
 */
export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await getAdminUser())) notFound();
  const { id } = await params;

  const db = createAdminClient();
  const detail = await loadOrderDetail(db, id);
  if (!detail) notFound();

  const { order, publication, buyer, creator, estimate, address } = detail;
  const currency = order.currency;

  // A short-lived signed link to the clean, print-ready PDF (D-020 pattern).
  let fileUrl: string | null = null;
  if (detail.fileKey) {
    try {
      fileUrl = await presignedGetUrl({
        bucket: detail.fileBucket ?? CLEAN_BUCKET,
        key: detail.fileKey,
      });
    } catch (e) {
      console.error('order detail: presign failed', { id, error: String(e) });
    }
  }

  const nextStates = nextOrderStates(order.status as OrderStatus, 'admin');
  const addr = address?.address ?? null;

  return (
    <main className="max-w-[46rem]">
      <div className="mb-8">
        <Link
          href="/admin/orders"
          className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft hover:text-ink transition-colors duration-300"
        >
          ← Orders
        </Link>
      </div>

      <p className="metadata mb-4">
        {order.isTestPrint ? 'Proof copy' : 'Order'} ·{' '}
        {STATUS_LABEL[order.status] ?? order.status}
      </p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
        {publication.title}
      </h1>
      <p className="metadata text-ink-faint mt-3">
        {buyer.name} → {creator.name} · placed {formatDate(order.createdAt)}
      </p>

      {/* Print specifications — the production package (D-029). */}
      <section className="mt-14 pt-10 border-t border-rule">
        <p className="metadata mb-6">Specifications</p>
        <div className="grid grid-cols-[10rem_1fr] gap-y-4 gap-x-8 text-[0.95rem]">
          <p className="metadata text-ink-faint">Quantity</p>
          <p className="text-ink">{order.quantity}</p>

          <p className="metadata text-ink-faint">Interior</p>
          <p className="text-ink">
            {publication.interior
              ? INTERIOR_LABEL[publication.interior]
              : '—'}
          </p>

          <p className="metadata text-ink-faint">Pages</p>
          <p className="text-ink">{publication.pageCount ?? '—'}</p>

          <p className="metadata text-ink-faint">Trim</p>
          <p className="text-ink">
            {publication.trimWidthMm && publication.trimHeightMm
              ? `${publication.trimWidthMm} × ${publication.trimHeightMm} mm`
              : '—'}
          </p>

          {estimate && (
            <>
              <p className="metadata text-ink-faint">Binding</p>
              <p className="text-ink">{estimate.binding}</p>

              <p className="metadata text-ink-faint">Paper</p>
              <p className="text-ink">{estimate.paper}</p>

              <p className="metadata text-ink-faint">Est. weight</p>
              <p className="text-ink">{estimate.estimatedWeightGrams} g</p>

              <p className="metadata text-ink-faint">Est. parcel</p>
              <p className="text-ink">
                {estimate.parcelDimensionsMm.length} ×{' '}
                {estimate.parcelDimensionsMm.width} ×{' '}
                {estimate.parcelDimensionsMm.height} mm
              </p>
            </>
          )}
        </div>

        <div className="mt-8">
          {fileUrl ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
            >
              Download print-ready PDF
            </a>
          ) : (
            <p className="metadata text-ink-faint">
              No print-ready file is attached to this publication.
            </p>
          )}
        </div>
      </section>

      {/* Delivery. */}
      <section className="mt-16 pt-10 border-t border-rule">
        <p className="metadata mb-6">Deliver to</p>
        {addr ? (
          <address className="not-italic text-ink text-[0.95rem] leading-relaxed">
            {address?.name && <div>{address.name}</div>}
            {addr.line1 && <div>{addr.line1}</div>}
            {addr.line2 && <div>{addr.line2}</div>}
            <div>
              {[addr.city, addr.state, addr.postal_code]
                .filter(Boolean)
                .join(', ')}
            </div>
            {addr.country && <div>{addr.country}</div>}
            {address?.phone && (
              <div className="metadata text-ink-faint mt-2">
                {address.phone}
              </div>
            )}
          </address>
        ) : (
          <p className="metadata text-ink-faint">
            No delivery address was captured with this order.
          </p>
        )}

        {/* Selected carrier service (D-030) — captured at checkout, shown for
            fulfilment and support. Absent until EasyPost is enabled. */}
        {order.shippingCarrier && (
          <p className="text-ink text-[0.95rem] mt-6">
            {order.shippingCarrier} · {order.shippingService}
            {order.shippingEstimatedDelivery
              ? ` · ${order.shippingEstimatedDelivery}`
              : ''}
            <span className="text-ink-soft">
              {' '}
              — {money(order.shippingMinor, currency)}
            </span>
          </p>
        )}
      </section>

      {/* Money — the built-up economics (D-029). */}
      <section className="mt-16 pt-10 border-t border-rule">
        <p className="metadata mb-6">Economics</p>
        <dl className="space-y-2.5 text-[0.95rem] max-w-[24rem]">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Printing &amp; production</dt>
            <dd className="text-ink tabular-nums">
              {money(order.printCostMinor, currency)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Baxter production margin</dt>
            <dd className="text-ink tabular-nums">
              {money(order.baxterMarginMinor, currency)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Creator earnings</dt>
            <dd className="text-ink tabular-nums">
              {money(order.creatorEarningsMinor, currency)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Shipping</dt>
            <dd className="text-ink tabular-nums">
              {money(order.shippingMinor, currency)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-rule pt-2.5 mt-1">
            <dt className="font-serif text-ink">Total charged</dt>
            <dd className="font-serif text-ink tabular-nums">
              {money(order.totalMinor, currency)}
            </dd>
          </div>
        </dl>
        {order.isTestPrint && (
          <p className="metadata text-ink-faint mt-4">
            Proof copy — production cost only. No margin, no earnings, no payout.
          </p>
        )}
        {order.stripeTransferId && (
          <p className="metadata text-ink-faint mt-4">
            Earnings released · transfer {order.stripeTransferId}
          </p>
        )}
      </section>

      {/* Fulfilment. */}
      {nextStates.length > 0 && (
        <section className="mt-16 pt-10 border-t border-rule">
          <p className="metadata mb-6">Fulfilment</p>
          {order.status === 'in_fulfillment' &&
            !order.isTestPrint &&
            order.creatorEarningsMinor > 0 && (
              <p className="text-[0.9rem] text-ink-soft mb-5 max-w-measure">
                Marking this fulfilled releases{' '}
                {money(order.creatorEarningsMinor, currency)} to {creator.name}.
              </p>
            )}
          <FulfilmentControl orderId={order.id} nextStates={nextStates} />
        </section>
      )}
    </main>
  );
}
