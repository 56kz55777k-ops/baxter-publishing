/* eslint-disable @next/next/no-img-element -- preview imagery is delivered by
   Cloudflare Images variants (already CDN-optimized); next/image would only add
   a redundant optimization hop. */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { imageDeliveryUrl } from '@/lib/cloudflare/images';
import {
  ArtifactSection,
  type LatestArtifactView,
  type PreflightIssueView,
} from './artifact-section';
import { MarketplaceSection } from './marketplace-section';
import { productionMarginBps } from '@/lib/production/config';

/** Defensive readers for the loosely-typed preflight jsonb. */
function asIssues(value: unknown): PreflightIssueView[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map((v) => ({
      code: String(v.code ?? ''),
      title: String(v.title ?? ''),
      detail: String(v.detail ?? ''),
    }))
    .filter((i) => i.title && i.detail);
}

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

export const metadata = {
  title: 'Publication — Baxter',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  revisions: 'Revisions requested',
  published: 'Published',
  unpublished: 'Unpublished',
  archived: 'Archived',
};

export default async function PublicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const { id } = await params;
  const { submitted } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: publication } = await supabase
    .from('publications')
    .select(
      'id, title, subtitle, description, category, format, format_preset_id, interior, status, page_count, trim_width_mm, trim_height_mm, creator_id, cover_asset_id, price_minor, currency, edition_size, submitted_at, published_at'
    )
    .eq('id', id)
    .maybeSingle();

  if (!publication || publication.creator_id !== user.id) notFound();

  const status = publication.status as keyof typeof STATUS_LABEL;
  const editable = status === 'draft' || status === 'revisions';
  const currency = publication.currency ?? 'CAD';

  // The editor's note (D-020/D-021) — read from the decision event for the
  // current state. The creator may read events on their own publications (RLS).
  let editorNote: string | null = null;
  if (status === 'revisions' || status === 'published') {
    const { data: ev } = await supabase
      .from('publication_events')
      .select('payload')
      .eq('publication_id', id)
      .eq('to_status', status)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const payload =
      ev?.payload && typeof ev.payload === 'object'
        ? (ev.payload as Record<string, unknown>)
        : {};
    const n = typeof payload.note === 'string' ? payload.note.trim() : '';
    editorNote = n || null;
  }

  // --- The "Submitted." poster (D-016) — the moment right after submitting ---
  if (status === 'in_review' && submitted) {
    return (
      <main className="px-gutter py-40 max-w-[44rem]">
        <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
          Submitted.
        </h1>
        <p className="font-serif text-lede text-ink-soft mt-8 max-w-measure">
          Baxter will review this publication within five business days.
        </p>
      </main>
    );
  }

  const { data: artifacts } = await supabase
    .from('artifacts')
    .select('id, size_bytes, uploaded_at, preflight, preflight_status')
    .eq('publication_id', id)
    .order('uploaded_at', { ascending: false });

  const latest = artifacts && artifacts.length > 0 ? artifacts[0] : null;
  const preflight =
    latest && latest.preflight && typeof latest.preflight === 'object'
      ? (latest.preflight as Record<string, unknown>)
      : {};

  const latestArtifact: LatestArtifactView | null = latest
    ? {
        id: latest.id,
        sizeBytes: latest.size_bytes,
        uploadedAt: latest.uploaded_at,
        status:
          (latest.preflight_status as LatestArtifactView['status']) ??
          'pending',
        blockers: asIssues(preflight.blockers),
        warnings: asIssues(preflight.warnings),
        warningsAcknowledged: Boolean(preflight.warningsAcknowledgedAt),
      }
    : null;

  // Preview imagery (Slice 4).
  const { data: previewAssets } = await supabase
    .from('assets')
    .select('id, external_id, meta')
    .eq('publication_id', id)
    .eq('provider', 'cloudflare_images')
    .eq('kind', 'preview_page');

  const hashReady = Boolean(process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH);
  const previews = hashReady
    ? (previewAssets ?? [])
        .map((a) => {
          const meta = (a.meta && typeof a.meta === 'object'
            ? a.meta
            : {}) as Record<string, unknown>;
          return {
            page: Number(meta.page ?? 0),
            coverUrl: imageDeliveryUrl(a.external_id, 'cover'),
            fullUrl: imageDeliveryUrl(a.external_id, 'full'),
            isCover: a.id === publication.cover_asset_id,
          };
        })
        .sort((x, y) => x.page - y.page)
    : [];
  const cover = previews.find((p) => p.isCover) ?? previews[0] ?? null;

  const previewSection = cover ? (
    <section className="mt-20 pt-10 border-t border-rule">
      <p className="metadata mb-6">Preview</p>
      <img
        src={cover.coverUrl}
        alt={`${publication.title} — cover`}
        className="w-full max-w-[30rem] h-auto border border-rule"
      />
      {previews.some((p) => !p.isCover) && (
        <div className="mt-12 space-y-8 max-w-[24rem]">
          {previews
            .filter((p) => !p.isCover)
            .map((p) => (
              <img
                key={p.page}
                src={p.fullUrl}
                alt={`${publication.title} — page ${p.page}`}
                className="w-full h-auto border border-rule"
              />
            ))}
        </div>
      )}
    </section>
  ) : null;

  return (
    <main className="px-gutter py-24 max-w-[44rem]">
      <p className="metadata mb-4">Publication</p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
        {publication.title}
      </h1>

      {/* Under review (D-016) — read-only, dignified, not anxious. */}
      {status === 'in_review' && (
        <section className="mt-12 pt-10 border-t border-rule">
          <p className="font-serif text-body text-ink">Under review</p>
          <p className="metadata text-ink-faint mt-3">
            Baxter is reviewing this publication.
          </p>
          {publication.submitted_at && (
            <p className="metadata text-ink-faint mt-1">
              Submitted {formatDate(publication.submitted_at)}
            </p>
          )}
        </section>
      )}

      {/* Returned with a note (D-019/D-021). The editor's own words, set as a
          letter — Editorial Voice, not a status banner. The work stays editable
          below so the creator can revise and resubmit. */}
      {status === 'revisions' && editorNote && (
        <section className="mt-12 pt-10 border-t border-rule">
          <p className="metadata text-ink-faint mb-5">From the editor</p>
          <p className="font-serif text-lede text-ink leading-relaxed whitespace-pre-line max-w-measure">
            {editorNote}
          </p>
        </section>
      )}

      {/* Published (D-021, Institutional Voice) — a plain statement of fact. */}
      {status === 'published' && (
        <section className="mt-12 pt-10 border-t border-rule">
          <p className="font-serif text-body text-ink">Published</p>
          {publication.published_at && (
            <p className="metadata text-ink-faint mt-3">
              Published {formatDate(publication.published_at)}
            </p>
          )}
          {editorNote && (
            <p className="font-serif text-body text-ink-soft leading-relaxed whitespace-pre-line max-w-measure mt-6">
              {editorNote}
            </p>
          )}
        </section>
      )}

      <section className="mt-12 grid grid-cols-[8rem_1fr] gap-y-4 gap-x-8 text-[0.95rem]">
        <p className="metadata text-ink-faint">Status</p>
        <p className="text-ink">{STATUS_LABEL[status] ?? status}</p>

        <p className="metadata text-ink-faint">Category</p>
        <p className="text-ink">{publication.category}</p>

        <p className="metadata text-ink-faint">Format</p>
        <p className="text-ink">
          {publication.trim_width_mm} × {publication.trim_height_mm} mm
        </p>

        <p className="metadata text-ink-faint">Interior</p>
        <p className="text-ink">
          {publication.interior === 'mono'
            ? 'Black & white'
            : publication.interior === 'colour'
              ? 'Colour'
              : '—'}
        </p>

        <p className="metadata text-ink-faint">Page count</p>
        <p className="text-ink">{publication.page_count ?? '—'}</p>
      </section>

      {/* Marketplace — editable in the workspace; read-only otherwise. */}
      <section className="mt-20 pt-10 border-t border-rule">
        <p className="metadata mb-6">Marketplace</p>
        {editable ? (
          <MarketplaceSection
            publicationId={publication.id}
            currency={currency}
            estimatorInput={{
              formatPresetId: publication.format_preset_id ?? '',
              pageCount: publication.page_count ?? null,
              interior:
                publication.interior === 'mono' ||
                publication.interior === 'colour'
                  ? publication.interior
                  : null,
              marginBps: productionMarginBps(),
            }}
            initial={{
              subtitle: publication.subtitle ?? '',
              description: publication.description ?? '',
              price:
                publication.price_minor !== null &&
                publication.price_minor !== undefined
                  ? String(publication.price_minor / 100)
                  : '',
              edition:
                publication.edition_size !== null &&
                publication.edition_size !== undefined
                  ? String(publication.edition_size)
                  : '',
            }}
          />
        ) : (
          <div className="grid grid-cols-[8rem_1fr] gap-y-4 gap-x-8 text-[0.95rem]">
            <p className="metadata text-ink-faint">Description</p>
            <p className="text-ink whitespace-pre-line">
              {publication.description || '—'}
            </p>
            <p className="metadata text-ink-faint">Price</p>
            <p className="text-ink">
              {formatPrice(publication.price_minor, currency)}
            </p>
            <p className="metadata text-ink-faint">Edition</p>
            <p className="text-ink">
              {publication.edition_size ?? 'Open edition'}
            </p>
          </div>
        )}
      </section>

      {previewSection}

      {/* File — editable only in the workspace. */}
      {editable && (
        <section className="mt-20 pt-10 border-t border-rule">
          <p className="metadata mb-4">File</p>
          <ArtifactSection
            publicationId={publication.id}
            latestArtifact={latestArtifact}
          />
        </section>
      )}

      {/* Review & submit — the declaration lives on its own page (D-016). */}
      {editable && (
        <div className="mt-20 pt-10 border-t border-rule">
          <Link
            href={`/studio/publications/${publication.id}/review`}
            className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
          >
            Review submission
          </Link>
        </div>
      )}

      <div className="mt-16">
        <Link
          href="/library"
          className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft hover:text-ink transition-colors duration-300"
        >
          Return to library
        </Link>
      </div>
    </main>
  );
}
