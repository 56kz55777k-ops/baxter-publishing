/* eslint-disable @next/next/no-img-element -- Cloudflare Images delivery URLs. */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdminUser } from '@/lib/auth/admin-guard';
import { imageDeliveryUrl } from '@/lib/cloudflare/images';
import { presignedGetUrl } from '@/lib/r2/presigned';
import { CLEAN_BUCKET } from '@/lib/r2/client';
import { ReviewDesk } from './review-desk';

export const metadata = {
  title: 'Review — Baxter',
};

function formatPrice(priceMinor: number | null, currency: string): string {
  if (priceMinor === null || priceMinor === undefined) return '—';
  return `$${(priceMinor / 100).toFixed(2)} ${currency}`;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

interface Issue {
  title: string;
  detail: string;
}
function asIssues(value: unknown): Issue[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map((v) => ({ title: String(v.title ?? ''), detail: String(v.detail ?? '') }))
    .filter((i) => i.title && i.detail);
}

/**
 * The review page — one composed surface holding everything an editor needs to
 * read the work and decide. The work leads (cover + previews); the metadata is
 * present but quiet; the decision desk (with the writing space) closes the page.
 *
 * Reachable only for `in_review` work. Anything already decided returns to the
 * desk. Data is read with the service-role client because a reviewer reads
 * another creator's work — but only after the admin role is re-verified here.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!(await getAdminUser())) notFound();

  const db = createAdminClient();
  const { data: pub } = await db
    .from('publications')
    .select(
      'id, title, subtitle, description, category, status, page_count, trim_width_mm, trim_height_mm, creator_id, cover_asset_id, price_minor, currency, edition_size, submitted_at'
    )
    .eq('id', id)
    .maybeSingle();

  if (!pub) notFound();
  if (pub.status !== 'in_review') redirect('/admin');

  const currency = pub.currency ?? 'CAD';

  const { data: creator } = await db
    .from('users')
    .select('handle, display_name')
    .eq('id', pub.creator_id)
    .maybeSingle();

  // The canonical, preflight-passed file — its verdict and a signed download.
  const { data: artifact } = await db
    .from('artifacts')
    .select('id, r2_key, bucket, preflight, preflight_status, is_canonical')
    .eq('publication_id', id)
    .eq('is_canonical', true)
    .maybeSingle();

  let fileUrl: string | null = null;
  if (artifact?.r2_key) {
    try {
      fileUrl = await presignedGetUrl({
        bucket: artifact.bucket ?? CLEAN_BUCKET,
        key: artifact.r2_key,
      });
    } catch (e) {
      console.error('review page: presign failed', { id, error: String(e) });
    }
  }

  const preflight =
    artifact?.preflight && typeof artifact.preflight === 'object'
      ? (artifact.preflight as Record<string, unknown>)
      : {};
  const warnings = asIssues(preflight.warnings);
  const warningsAcknowledged = Boolean(preflight.warningsAcknowledgedAt);

  // Preview imagery.
  const { data: previewAssets } = await db
    .from('assets')
    .select('id, external_id, meta')
    .eq('publication_id', id)
    .eq('provider', 'cloudflare_images')
    .eq('kind', 'preview_page');

  const hashReady = Boolean(process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH);
  const previews = hashReady
    ? (previewAssets ?? [])
        .map((a) => {
          const meta = (a.meta && typeof a.meta === 'object' ? a.meta : {}) as Record<
            string,
            unknown
          >;
          return {
            page: Number(meta.page ?? 0),
            coverUrl: imageDeliveryUrl(a.external_id, 'cover'),
            fullUrl: imageDeliveryUrl(a.external_id, 'full'),
            isCover: a.id === pub.cover_asset_id,
          };
        })
        .sort((x, y) => x.page - y.page)
    : [];
  const cover = previews.find((p) => p.isCover) ?? previews[0] ?? null;

  return (
    <main className="max-w-[44rem]">
      <div className="mb-10">
        <Link
          href="/admin"
          className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft hover:text-ink transition-colors duration-300"
        >
          Back to the desk
        </Link>
      </div>

      <p className="metadata mb-4">Under review</p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
        {pub.title}
      </h1>
      {pub.subtitle && (
        <p className="font-serif text-lede text-ink-soft mt-4">{pub.subtitle}</p>
      )}
      <p className="metadata text-ink-faint mt-6">
        {creator?.display_name ?? 'Unknown'}
        {creator?.handle ? ` · @${creator.handle}` : ''}
        {pub.submitted_at ? ` · submitted ${formatDate(pub.submitted_at)}` : ''}
      </p>

      {/* The work leads. */}
      {cover && (
        <img
          src={cover.coverUrl}
          alt={`${pub.title} — cover`}
          className="w-full max-w-[30rem] h-auto border border-rule mt-12"
        />
      )}
      {previews.some((p) => !p.isCover) && (
        <div className="mt-10 space-y-8 max-w-[24rem]">
          {previews
            .filter((p) => !p.isCover)
            .map((p) => (
              <img
                key={p.page}
                src={p.fullUrl}
                alt={`${pub.title} — page ${p.page}`}
                className="w-full h-auto border border-rule"
              />
            ))}
        </div>
      )}

      {/* Metadata — present, de-emphasised. */}
      <section className="mt-16 grid grid-cols-[8rem_1fr] gap-y-4 gap-x-8 text-[0.95rem]">
        <p className="metadata text-ink-faint">Format</p>
        <p className="text-ink">
          {pub.trim_width_mm} × {pub.trim_height_mm} mm
        </p>

        <p className="metadata text-ink-faint">Page count</p>
        <p className="text-ink">{pub.page_count ?? '—'}</p>

        <p className="metadata text-ink-faint">Category</p>
        <p className="text-ink">{pub.category}</p>

        <p className="metadata text-ink-faint">Description</p>
        <p className="text-ink whitespace-pre-line">{pub.description || '—'}</p>

        <p className="metadata text-ink-faint">Price</p>
        <p className="text-ink">{formatPrice(pub.price_minor, currency)}</p>

        <p className="metadata text-ink-faint">Edition</p>
        <p className="text-ink">{pub.edition_size ?? 'Open edition'}</p>
      </section>

      {/* The file — verdict + the print-ready original. */}
      <section className="mt-16 pt-10 border-t border-rule">
        <p className="metadata mb-6">The file</p>
        <p className="text-ink text-[0.95rem]">
          {artifact?.preflight_status === 'passed'
            ? 'Passed preflight.'
            : 'No passed file on record.'}
        </p>
        {warnings.length > 0 && (
          <div className="mt-6">
            <p className="metadata text-ink-faint mb-3">
              Notes from preflight
              {warningsAcknowledged ? ' · acknowledged by the creator' : ''}
            </p>
            <ul className="space-y-2">
              {warnings.map((w, i) => (
                <li key={i} className="text-ink-soft text-[0.9rem]">
                  {w.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
        {fileUrl && (
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-8 font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft border-b border-rule pb-1 hover:text-ink hover:border-ink transition-colors duration-300"
          >
            Open the print-ready PDF
          </a>
        )}
      </section>

      {/* The decision — writing first (D-020). */}
      <section className="mt-20 pt-10 border-t border-rule">
        <p className="metadata mb-8">Your reading</p>
        <ReviewDesk publicationId={pub.id} />
      </section>
    </main>
  );
}
