import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { composeHome } from '@/lib/marketplace/queries';
import { PublicationShelf } from '@/components/publication-shelf';
import { SiteHeader } from '@/components/site-header';

/**
 * Baxter — the front door (D-022).
 *
 * Not a marketing page, not a storefront. The opening statement establishes the
 * room (the Platform's institutional voice, D-024); the published work begins
 * beneath it. You understand where you are, then you begin looking at the work.
 *
 * The body is a *composition*, not a feed (D-025): `composeHome()` returns an
 * ordered list of editorial sections and this page renders whatever it's given.
 * Adding a seasonal selection or a featured creator later is a new section here,
 * not a rewrite of this page.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const beginHref = user ? '/studio' : '/sign-up';

  const sections = await composeHome(supabase);

  return (
    <main className="min-h-screen flex flex-col">
      <SiteHeader />

      {/* The opening statement — the room. One held line. */}
      <section className="px-gutter pt-28 pb-32">
        <p className="metadata mb-6">A publishing house, online.</p>
        <h1 className="font-serif text-h1 md:text-display max-w-[14ch] leading-[1.02]">
          Independent publishing, made carefully.
        </h1>
      </section>

      <div className="px-gutter">
        <div className="rule" />
      </div>

      {/* The work fills the room — composed sections, or a written empty state. */}
      <div className="flex-1 px-gutter py-28 space-y-32">
        {sections.length > 0 ? (
          sections.map((section) => (
            <PublicationShelf
              key={section.kind}
              title={section.title}
              href={section.href}
              cards={section.cards}
            />
          ))
        ) : (
          <section>
            <p className="font-serif text-lede text-ink-soft max-w-measure">
              The first publications are being prepared. Work appears here as it
              is published.
            </p>
          </section>
        )}
      </div>

      <div className="px-gutter">
        <div className="rule" />
      </div>

      {/* Closing band — quiet. A door for creators, a line about Baxter. */}
      <footer className="px-gutter py-20 flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-shell text-[0.95rem] tracking-[0.18em] uppercase text-ink">
            Baxter
          </p>
          <p className="metadata mt-3">Toronto · est. 2026</p>
        </div>
        <nav className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft flex items-baseline gap-10">
          <Link
            href="/about"
            className="hover:text-ink transition-colors duration-300"
          >
            About
          </Link>
          <Link
            href={beginHref}
            className="text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
          >
            Begin a publication
          </Link>
        </nav>
      </footer>
    </main>
  );
}
