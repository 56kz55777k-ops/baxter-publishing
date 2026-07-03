/* eslint-disable @next/next/no-img-element -- Cloudflare Images delivery URLs. */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { imageDeliveryUrl } from '@/lib/cloudflare/images';
import { getAdminUser } from '@/lib/auth/admin-guard';
import { stripeConfigured } from '@/lib/stripe/client';
import { SiteHeader } from '@/components/site-header';
import { EditorPickToggle } from './editor-pick-toggle';

const FORMAT_LABEL: Record<string, string> = {
  print: 'Print',
  digital: 'Digital',
  print_digital: 'Print and digital',
};

function formatPrice(minor: number | null, currency: string): string | null {
  if (minor === null || minor === undefined) return null;
  return `$${(minor / 100).toFixed(2)} ${currency}`;
}

async function loadPublication(handle: string, slug: string) {
  const supabase = await createClient();
  const { data: creator } = await supabase
    .from('users')
    .select('id, handle, display_name, stripe_charges_enabled')
    .eq('handle', handle)
    .maybeSingle();
  if (!creator) return null;

  const { data: publication } = await supabase
    .from('publications')
    .select(
      'id, title, subtitle, description, category, format, page_count, edition_size, price_minor, currency, cover_asset_id, slug, status, editor_pick_at'
    )
    .eq('creator_id', creator.id)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();
  if (!publication) return null;

  return { supabase, creator, publication };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  const loaded = await loadPublication(
    decodeURIComponent(handle),
    decodeURIComponent(slug)
  );
  if (!loaded) return { title: 'Not found — Baxter' };
  return {
    title: `${loaded.publication.title} — ${loaded.creator.display_name} — Baxter`,
    description: loaded.publication.description ?? undefined,
  };
}

/**
 * Public publication page — /[handle]/[slug] (D-022).
 *
 * A museum bookstore catalogue page. The work is the subject: the cover gets
 * disproportionate space; specs and price are present but quiet; the transaction
 * is incidental (and, until Slice 8, absent — one honest line, no cart theatre).
 * The page belongs to the creator (D-024) — their name is the byline and links
 * to their room.
 */
export default async function PublicationPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle: rawHandle, slug: rawSlug } = await params;
  const handle = decodeURIComponent(rawHandle);
  const slug = decodeURIComponent(rawSlug);

  if (handle.startsWith('~pending-')) notFound();

  const loaded = await loadPublication(handle, slug);
  if (!loaded) notFound();
  const { supabase, creator, publication } = loaded;

  const currency = publication.currency ?? 'CAD';
  const price = formatPrice(publication.price_minor, currency);
  const formatLabel = FORMAT_LABEL[publication.format] ?? publication.format;

  // Imagery — cover + preview pages (public Cloudflare Images).
  const hashReady = Boolean(process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH);
  const { data: previewAssets } = await supabase
    .from('assets')
    .select('id, external_id, meta')
    .eq('publication_id', publication.id)
    .eq('provider', 'cloudflare_images')
    .eq('kind', 'preview_page');

  const previews = hashReady
    ? (previewAssets ?? [])
        .map((a) => {
          const meta = (a.meta && typeof a.meta === 'object' ? a.meta : {}) as Record<
            string,
            unknown
          >;
          return {
            page: Number(meta.page ?? 0),
            url: imageDeliveryUrl(a.external_id, 'full'),
            isCover: a.id === publication.cover_asset_id,
          };
        })
        .sort((x, y) => x.page - y.page)
    : [];
  const cover = previews.find((p) => p.isCover) ?? previews[0] ?? null;
  const leaves = previews.filter((p) => !p.isCover);

  // Admin sees a quiet Editor's Pick control; the public never does.
  const admin = await getAdminUser();

  // Buyable when Stripe is live, the creator can receive payouts, there's a
  // price, and the viewer isn't the creator (you can't buy your own work).
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const buyable =
    stripeConfigured() &&
    Boolean(creator.stripe_charges_enabled) &&
    publication.price_minor !== null &&
    publication.price_minor !== undefined &&
    viewer?.id !== creator.id;
  const buyHref = `/${encodeURIComponent(creator.handle)}/${encodeURIComponent(publication.slug)}/buy`;

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <article className="px-gutter pb-28 max-w-[46rem]">
        {/* The work leads — the cover gets the space. */}
        {cover && (
          <img
            src={cover.url}
            alt={`${publication.title} — cover`}
            className="w-full max-w-[34rem] h-auto border border-rule"
          />
        )}

        <h1 className="font-serif text-h1 leading-[1.04] tracking-tight mt-14">
          {publication.title}
        </h1>
        {publication.subtitle && (
          <p className="font-serif text-lede text-ink-soft mt-4">
            {publication.subtitle}
          </p>
        )}

        {/* The creator is the author — the byline links to their room. */}
        <p className="font-serif text-body text-ink mt-6">
          <span className="text-ink-soft">by </span>
          <Link
            href={`/${encodeURIComponent(creator.handle)}`}
            className="border-b border-rule hover:border-ink transition-colors duration-300"
          >
            {creator.display_name}
          </Link>
        </p>

        {publication.description && (
          <p className="font-serif text-body text-ink leading-relaxed whitespace-pre-line max-w-measure mt-12">
            {publication.description}
          </p>
        )}

        {/* Specs — present, de-emphasized. Price sits here, plainly. */}
        <section className="mt-16 grid grid-cols-[8rem_1fr] gap-y-4 gap-x-8 text-[0.95rem]">
          <p className="metadata text-ink-faint">Format</p>
          <p className="text-ink">{formatLabel}</p>

          <p className="metadata text-ink-faint">Pages</p>
          <p className="text-ink">{publication.page_count ?? '—'}</p>

          <p className="metadata text-ink-faint">Edition</p>
          <p className="text-ink">{publication.edition_size ?? 'Open edition'}</p>

          <p className="metadata text-ink-faint">Category</p>
          <p className="text-ink">{publication.category}</p>

          {price && (
            <>
              <p className="metadata text-ink-faint">Price</p>
              <p className="text-ink">{price}</p>
            </>
          )}
        </section>

        {/* Purchase — one decisive action, or the honest boundary if the work
            isn't yet buyable. No cart, no urgency (D-023). */}
        {buyable ? (
          <div className="mt-12">
            <Link
              href={buyHref}
              className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
            >
              Own this publication
            </Link>
          </div>
        ) : (
          <p className="metadata text-ink-faint mt-12">Ordering opens soon.</p>
        )}

        {/* Previews — a quiet leafing column, low on the page. */}
        {leaves.length > 0 && (
          <section className="mt-20 pt-10 border-t border-rule">
            <p className="metadata mb-8">Inside</p>
            <div className="space-y-8 max-w-[26rem]">
              {leaves.map((p) => (
                <img
                  key={p.page}
                  src={p.url}
                  alt={`${publication.title} — page ${p.page}`}
                  className="w-full h-auto border border-rule"
                />
              ))}
            </div>
          </section>
        )}

        {/* Admin-only editorial control. */}
        {admin && (
          <section className="mt-20 pt-10 border-t border-rule">
            <EditorPickToggle
              publicationId={publication.id}
              handle={creator.handle}
              slug={publication.slug}
              isPicked={Boolean(publication.editor_pick_at)}
            />
          </section>
        )}
      </article>
    </main>
  );
}
