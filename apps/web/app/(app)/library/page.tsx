import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const metadata = {
  title: 'Library — Baxter',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  revisions: 'Revisions',
  published: 'Published',
  unpublished: 'Unpublished',
  archived: 'Archived',
};

/**
 * The creator's library — every publication they have begun, in any state.
 *
 * Editorial Constitution: the empty state names the absence in a sentence,
 * not a card with a CTA button. The full list is a quiet vertical list, not
 * a dense grid.
 */
export default async function LibraryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: publications } = await supabase
    .from('publications')
    .select('id, title, category, status, updated_at')
    .eq('creator_id', user.id)
    .order('updated_at', { ascending: false });

  const list = publications ?? [];

  return (
    <main className="px-gutter py-24 max-w-[44rem]">
      <p className="metadata mb-4">Library</p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight mb-12">
        Your library.
      </h1>

      {list.length === 0 ? (
        <p className="font-serif text-body text-ink-faint">
          No publications yet. Begin one in the{' '}
          <Link
            href="/studio"
            className="text-ink underline underline-offset-4 decoration-rule hover:decoration-accent"
          >
            studio
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-rule">
          {list.map((p) => (
            <li key={p.id} className="py-6">
              <Link
                href={`/studio/publications/${p.id}`}
                className="block group"
              >
                <p className="font-serif text-lede text-ink group-hover:text-accent transition-colors duration-300">
                  {p.title}
                </p>
                <p className="metadata text-ink-faint mt-2">
                  {p.category} · {STATUS_LABEL[p.status] ?? p.status}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
