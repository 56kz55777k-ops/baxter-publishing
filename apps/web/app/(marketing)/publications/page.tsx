import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getAllPublished } from '@/lib/marketplace/queries';
import { PublicationShelf } from '@/components/publication-shelf';
import { SiteHeader } from '@/components/site-header';
import { PUBLICATION_CATEGORIES, isPublicationCategory } from '@baxter/domain';

export const metadata = {
  title: 'Publications — Baxter',
};

/**
 * Browse — all published work (D-025: browse before search).
 *
 * The only concession to filtering is category, presented as a quiet inline row
 * — never a sidebar. No search field: a small catalogue invites browsing, and
 * discovery is Baxter's job as curator until the shelf grows too large to walk.
 */
export default async function PublicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category: rawCategory } = await searchParams;
  const category =
    rawCategory && isPublicationCategory(rawCategory) ? rawCategory : undefined;

  const supabase = await createClient();
  const cards = await getAllPublished(supabase, { category });

  const linkBase =
    'font-shell text-[0.75rem] tracking-[0.08em] uppercase transition-colors duration-300';

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <section className="px-gutter pt-16 pb-12">
        <p className="metadata mb-4">Browse</p>
        <h1 className="font-serif text-h1 leading-[1.04] tracking-tight">
          Publications
        </h1>

        {/* Category — the one filter, a quiet inline row, not a sidebar. */}
        <nav className="mt-12 flex flex-wrap gap-x-8 gap-y-3">
          <Link
            href="/publications"
            className={`${linkBase} ${!category ? 'text-ink' : 'text-ink-faint hover:text-ink'}`}
          >
            All
          </Link>
          {PUBLICATION_CATEGORIES.map((c) => (
            <Link
              key={c}
              href={`/publications?category=${encodeURIComponent(c)}`}
              className={`${linkBase} ${category === c ? 'text-ink' : 'text-ink-faint hover:text-ink'}`}
            >
              {c}
            </Link>
          ))}
        </nav>
      </section>

      <div className="px-gutter">
        <div className="rule" />
      </div>

      <section className="px-gutter py-20">
        {cards.length > 0 ? (
          <PublicationShelf cards={cards} />
        ) : (
          <p className="font-serif text-body text-ink-faint max-w-measure">
            {category
              ? 'No publications in this category yet.'
              : 'No publications yet. Work appears here as it is published.'}
          </p>
        )}
      </section>
    </main>
  );
}
