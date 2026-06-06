import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  ArtifactSection,
  type LatestArtifactView,
  type PreflightIssueView,
} from './artifact-section';

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
      'id, title, category, format, status, page_count, trim_width_mm, trim_height_mm, creator_id, created_at'
    )
    .eq('id', id)
    .maybeSingle();

  if (!publication || publication.creator_id !== user.id) notFound();

  const { data: artifacts } = await supabase
    .from('artifacts')
    .select(
      'id, size_bytes, uploaded_at, preflight, preflight_status'
    )
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

  const status = publication.status as keyof typeof STATUS_LABEL;

  return (
    <main className="px-gutter py-24 max-w-[44rem]">
      <p className="metadata mb-4">Publication</p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
        {publication.title}
      </h1>

      <section className="mt-12 grid grid-cols-[8rem_1fr] gap-y-4 gap-x-8 text-[0.95rem]">
        <p className="metadata text-ink-faint">Status</p>
        <p className="text-ink">{STATUS_LABEL[status] ?? status}</p>

        <p className="metadata text-ink-faint">Category</p>
        <p className="text-ink">{publication.category}</p>

        <p className="metadata text-ink-faint">Format</p>
        <p className="text-ink">
          {publication.trim_width_mm} × {publication.trim_height_mm} mm
        </p>

        <p className="metadata text-ink-faint">Page count</p>
        <p className="text-ink">{publication.page_count ?? '—'}</p>
      </section>

      <section className="mt-20 pt-10 border-t border-rule">
        <p className="metadata mb-4">File</p>
        <ArtifactSection
          publicationId={publication.id}
          latestArtifact={latestArtifact}
        />
      </section>

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
