import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdminUser } from '@/lib/auth/admin-guard';

export const metadata = {
  title: 'Orders — Baxter',
};

function money(minor: number, currency: string): string {
  return `$${(minor / 100).toFixed(2)} ${currency}`;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
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

/**
 * Orders — a quiet ledger for the desk (Slice 8). Just enough to confirm an
 * order exists and see its state; the order detail page with clickable
 * transitions and fulfilment is Slice 9's OMS.
 */
export default async function AdminOrdersPage() {
  if (!(await getAdminUser())) notFound();

  const db = createAdminClient();
  const { data: orders } = await db
    .from('orders')
    .select('id, status, total_minor, currency, created_at, buyer_id, creator_id, publication_id')
    .order('created_at', { ascending: false });

  const rows = orders ?? [];
  const userIds = [...new Set(rows.flatMap((o) => [o.buyer_id, o.creator_id]))];
  const pubIds = [...new Set(rows.map((o) => o.publication_id))];

  const nameById = new Map<string, string>();
  if (userIds.length) {
    const { data } = await db.from('users').select('id, display_name').in('id', userIds);
    for (const u of data ?? []) nameById.set(u.id, u.display_name);
  }
  const titleById = new Map<string, string>();
  if (pubIds.length) {
    const { data } = await db.from('publications').select('id, title').in('id', pubIds);
    for (const p of data ?? []) titleById.set(p.id, p.title);
  }

  return (
    <main className="max-w-[52rem]">
      <p className="metadata mb-4">Editorial desk</p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">Orders</h1>

      {rows.length === 0 ? (
        <p className="font-serif text-lede text-ink-soft mt-10 max-w-measure">
          No orders yet. They appear here as work sells.
        </p>
      ) : (
        <ul className="mt-14 space-y-px">
          {rows.map((o) => (
            <li key={o.id} className="border-t border-rule">
              <Link
                href={`/admin/orders/${o.id}`}
                className="grid grid-cols-[1fr_auto_auto] items-baseline gap-6 py-5 group"
              >
                <span>
                  <span className="font-serif text-body text-ink block group-hover:text-accent transition-colors duration-300">
                    {titleById.get(o.publication_id) ?? 'Untitled'}
                  </span>
                  <span className="metadata text-ink-faint mt-1 block">
                    {nameById.get(o.buyer_id) ?? 'Buyer'} → {nameById.get(o.creator_id) ?? 'Creator'}
                  </span>
                </span>
                <span className="metadata text-ink-faint">{STATUS_LABEL[o.status] ?? o.status}</span>
                <span className="text-ink text-[0.9rem] tabular-nums text-right">
                  {money(o.total_minor, o.currency ?? 'CAD')}
                  <span className="metadata text-ink-faint block mt-1">
                    {formatDate(o.created_at)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
