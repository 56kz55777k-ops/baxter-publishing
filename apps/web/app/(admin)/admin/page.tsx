/* eslint-disable @next/next/no-img-element -- Cloudflare Images delivery URLs. */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { imageDeliveryUrl } from '@/lib/cloudflare/images';
import { getAdminUser } from '@/lib/auth/admin-guard';

export const metadata = {
  title: 'Editorial desk — Baxter',
};

function formatDate(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * The editorial desk — the queue of work awaiting a reading.
 *
 * Ordered oldest-submitted-first: this is a queue, not a feed. Work waits its
 * turn and is read in the order it arrived. Only `in_review` publications appear
 * here; decided work leaves the desk.
 */
export default async function EditorialDesk() {
  if (!(await getAdminUser())) notFound();

  const db = createAdminClient();
  const { data: pubs } = await db
    .from('publications')
    .select('id, title, category, submitted_at, creator_id, cover_asset_id')
    .eq('status', 'in_review')
    .order('submitted_at', { ascending: true });

  const rows = pubs ?? [];

  // Bulk-resolve creators and cover images to avoid per-row round trips.
  const creatorIds = [...new Set(rows.map((p) => p.creator_id))];
  const coverIds = rows
    .map((p) => p.cover_asset_id)
    .filter((v): v is string => !!v);

  const creatorById = new Map<string, { handle: string; displayName: string }>();
  if (creatorIds.length) {
    const { data: creators } = await db
      .from('users')
      .select('id, handle, display_name')
      .in('id', creatorIds);
    for (const c of creators ?? []) {
      creatorById.set(c.id, { handle: c.handle, displayName: c.display_name });
    }
  }

  const coverExternalById = new Map<string, string>();
  const hashReady = Boolean(process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH);
  if (coverIds.length && hashReady) {
    const { data: assets } = await db
      .from('assets')
      .select('id, external_id')
      .in('id', coverIds);
    for (const a of assets ?? []) {
      if (a.external_id) coverExternalById.set(a.id, a.external_id);
    }
  }

  return (
    <main className="max-w-[48rem]">
      <p className="metadata mb-4">Editorial desk</p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
        Awaiting review
      </h1>

      {rows.length === 0 ? (
        <p className="font-serif text-lede text-ink-soft mt-10 max-w-measure">
          Nothing is waiting. Submissions appear here in the order they arrive.
        </p>
      ) : (
        <ul className="mt-14 space-y-px">
          {rows.map((p) => {
            const creator = creatorById.get(p.creator_id);
            const coverExternal = p.cover_asset_id
              ? coverExternalById.get(p.cover_asset_id)
              : undefined;
            return (
              <li key={p.id}>
                <Link
                  href={`/admin/${p.id}`}
                  className="group flex items-baseline gap-6 py-6 border-t border-rule hover:text-accent transition-colors duration-300"
                >
                  {coverExternal ? (
                    <img
                      src={imageDeliveryUrl(coverExternal, 'grid')}
                      alt=""
                      className="w-12 h-16 object-cover border border-rule self-start shrink-0"
                    />
                  ) : (
                    <span className="w-12 h-16 border border-rule self-start shrink-0" />
                  )}
                  <span className="flex-1">
                    <span className="font-serif text-body text-ink group-hover:text-accent block">
                      {p.title}
                    </span>
                    <span className="metadata text-ink-faint mt-2 block">
                      {creator?.displayName ?? 'Unknown'}
                      {creator?.handle ? ` · @${creator.handle}` : ''} · {p.category}
                    </span>
                  </span>
                  <span className="metadata text-ink-faint shrink-0">
                    {formatDate(p.submitted_at)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
