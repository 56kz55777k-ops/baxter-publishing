import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Studio home — the creator's starting point.
 *
 * Editorial Constitution: the door, not the funnel. A single CTA to begin,
 * a quiet list of in-progress drafts beneath. No empty-state mascot, no
 * checklist of "complete your profile to unlock features."
 */
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  revisions: 'Revisions',
  published: 'Published',
  unpublished: 'Unpublished',
  archived: 'Archived',
};

export default async function StudioHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: recentDrafts } = await supabase
    .from('publications')
    .select('id, title, status, updated_at')
    .eq('creator_id', user.id)
    .in('status', ['draft', 'revisions'])
    .order('updated_at', { ascending: false })
    .limit(3);

  return (
    <main className="px-gutter py-24 max-w-[44rem]">
      <p className="metadata mb-4">Studio</p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
        Begin a publication.
      </h1>
      <p className="font-serif text-lede text-ink-soft max-w-measure mt-8 prose-editorial">
        Pick a format, name the work, and upload a print-ready PDF.
        Baxter reviews each publication before it appears in the marketplace.
      </p>

      <div className="mt-12">
        <Link
          href="/studio/new"
          className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
        >
          Begin a publication
        </Link>
      </div>

      {recentDrafts && recentDrafts.length > 0 && (
        <section className="mt-24 pt-10 border-t border-rule">
          <p className="metadata mb-6">In progress</p>
          <ul className="space-y-6">
            {recentDrafts.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/studio/publications/${p.id}`}
                  className="block group"
                >
                  <p className="font-serif text-body text-ink group-hover:text-accent transition-colors duration-300">
                    {p.title}
                  </p>
                  <p className="metadata text-ink-faint mt-1">
                    {STATUS_LABEL[p.status] ?? p.status}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-10">
            <Link
              href="/library"
              className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft hover:text-ink transition-colors duration-300"
            >
              View library
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
