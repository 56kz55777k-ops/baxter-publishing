import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ArtifactSection } from './artifact-section';

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
    .select('id, bucket, size_bytes, content_type, uploaded_at')
    .eq('publication_id', id)
    .order('uploaded_at', { ascending: false });

  const latestArtifact =
    artifacts && artifacts.length > 0 ? artifacts[0] : null;
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
          latestArtifact={
            latestArtifact
              ? {
                  sizeBytes: latestArtifact.size_bytes,
                  uploadedAt: latestArtifact.uploaded_at,
                }
              : null
          }
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
