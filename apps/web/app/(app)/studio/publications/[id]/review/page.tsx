/* eslint-disable @next/next/no-img-element -- Cloudflare Images delivery URLs. */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { imageDeliveryUrl } from '@/lib/cloudflare/images';
import { submitForReview } from '../actions';

export const metadata = {
  title: 'Review — Baxter',
};

/**
 * High-risk categories that warrant an extra-review notice (D-016). None of the
 * current format-style categories match; this is the hook for a future
 * content-risk taxonomy.
 */
const SENSITIVE_CATEGORIES = new Set<string>([
  'Political campaigning',
  'Extremist advocacy',
  'Explicit sexual content',
  'Graphic violence',
  'Hate',
  'Unlawful',
]);

function formatPrice(priceMinor: number | null, currency: string): string {
  if (priceMinor === null || priceMinor === undefined) return '—';
  return `$${(priceMinor / 100).toFixed(2)} ${currency}`;
}

export default async function ReviewSubmissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: publication } = await supabase
    .from('publications')
    .select(
      'id, title, subtitle, description, category, status, page_count, trim_width_mm, trim_height_mm, creator_id, cover_asset_id, price_minor, currency, edition_size'
    )
    .eq('id', id)
    .maybeSingle();

  if (!publication || publication.creator_id !== user.id) notFound();

  // Review is for work still in the creator's hands. Anything else → workspace.
  if (publication.status !== 'draft' && publication.status !== 'revisions') {
    redirect(`/studio/publications/${id}`);
  }

  const workspaceHref = `/studio/publications/${id}`;
  const currency = publication.currency ?? 'CAD';

  // Eligibility (mirrors the server-side gate in submitForReview).
  const { data: passed } = await supabase
    .from('artifacts')
    .select('id')
    .eq('publication_id', id)
    .eq('preflight_status', 'passed')
    .limit(1);
  const hasPassed = !!passed?.length;
  const hasPrice =
    publication.price_minor !== null && publication.price_minor !== undefined;
  const hasDescription = !!(
    publication.description && publication.description.trim()
  );
  const eligible = hasPassed && hasPrice && hasDescription;

  // Cover (Slice 4 imagery).
  let coverUrl: string | null = null;
  if (process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH && publication.cover_asset_id) {
    const { data: coverAsset } = await supabase
      .from('assets')
      .select('external_id')
      .eq('id', publication.cover_asset_id)
      .maybeSingle();
    if (coverAsset?.external_id) {
      coverUrl = imageDeliveryUrl(coverAsset.external_id, 'cover');
    }
  }

  const isSensitive = SENSITIVE_CATEGORIES.has(publication.category);

  return (
    <main className="px-gutter py-24 max-w-[44rem]">
      <p className="metadata mb-4">Review</p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
        {publication.title}
      </h1>
      {publication.subtitle && (
        <p className="font-serif text-lede text-ink-soft mt-4">
          {publication.subtitle}
        </p>
      )}

      {coverUrl && (
        <img
          src={coverUrl}
          alt={`${publication.title} — cover`}
          className="w-full max-w-[26rem] h-auto border border-rule mt-12"
        />
      )}

      <section className="mt-16 grid grid-cols-[8rem_1fr] gap-y-4 gap-x-8 text-[0.95rem]">
        <p className="metadata text-ink-faint">Format</p>
        <p className="text-ink">
          {publication.trim_width_mm} × {publication.trim_height_mm} mm
        </p>

        <p className="metadata text-ink-faint">Page count</p>
        <p className="text-ink">{publication.page_count ?? '—'}</p>

        <p className="metadata text-ink-faint">Category</p>
        <p className="text-ink">{publication.category}</p>

        <p className="metadata text-ink-faint">Description</p>
        <p className="text-ink whitespace-pre-line">
          {publication.description || '—'}
        </p>

        <p className="metadata text-ink-faint">Price</p>
        <p className="text-ink">
          {formatPrice(publication.price_minor, currency)}
        </p>

        <p className="metadata text-ink-faint">Edition</p>
        <p className="text-ink">{publication.edition_size ?? 'Open edition'}</p>

        <p className="metadata text-ink-faint">File</p>
        <p className="text-ink">
          {hasPassed ? 'The file passed preflight.' : 'The file has not passed preflight.'}
        </p>
      </section>

      {isSensitive && (
        <p className="font-serif text-body text-ink-soft mt-12 max-w-measure">
          Some categories require additional review. Submission does not
          guarantee publication.
        </p>
      )}

      <section className="mt-20 pt-10 border-t border-rule">
        {eligible ? (
          <>
            <p className="font-serif text-body text-ink max-w-measure">
              Baxter will review this publication within five business days.
            </p>
            <form action={submitForReview} className="mt-10">
              <input type="hidden" name="publicationId" value={publication.id} />
              <button
                type="submit"
                className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
              >
                Submit for review
              </button>
            </form>
          </>
        ) : (
          <div>
            <p className="font-serif text-body text-ink">
              This publication is not ready to submit.
            </p>
            <ul className="mt-6 space-y-2">
              {!hasPassed && (
                <li className="text-ink-soft text-[0.95rem]">
                  The file needs to pass preflight.
                </li>
              )}
              {!hasDescription && (
                <li className="text-ink-soft text-[0.95rem]">
                  A description is needed.
                </li>
              )}
              {!hasPrice && (
                <li className="text-ink-soft text-[0.95rem]">A price is needed.</li>
              )}
            </ul>
          </div>
        )}
      </section>

      <div className="mt-16">
        <Link
          href={workspaceHref}
          className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft hover:text-ink transition-colors duration-300"
        >
          Edit publication
        </Link>
      </div>
    </main>
  );
}
