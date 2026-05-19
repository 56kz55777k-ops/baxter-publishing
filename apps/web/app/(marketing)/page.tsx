import Link from 'next/link';

/**
 * Baxter — homepage.
 *
 * The opening room of the publication.
 *
 * Editorial Constitution applied:
 *   • Attention Respect — no urgency, no manipulated scarcity.
 *   • Platform Humility — Baxter sets the room. Publications, when they arrive,
 *     will overshadow it. This page is empty by design.
 *   • Composed Warmth — the room is lit, not bright. Time is named directly.
 *
 * Voice: present tense, declarative. No exclamation points. No "we".
 * No "get started". No flattery.
 */
export default function HomePage() {
  return (
    <main className="min-h-screen">
      {/* Shell — Baxter wordmark + restrained navigation. */}
      <header className="px-gutter pt-10 pb-16 flex items-baseline justify-between">
        <Link
          href="/"
          aria-label="Baxter — home"
          className="font-shell text-[0.95rem] tracking-[0.18em] uppercase text-ink"
        >
          Baxter
        </Link>
        <nav className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft flex gap-10">
          <Link href="/publications">Publications</Link>
          <Link href="/creators">Creators</Link>
          <Link href="/about">About</Link>
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </header>

      {/* Opening statement. One sentence. Held. */}
      <section className="px-gutter pt-32 pb-40">
        <p className="metadata mb-6">A publishing house, online.</p>
        <h1 className="font-serif text-h1 md:text-display max-w-[14ch] leading-[1.02]">
          Independent publishing, made carefully.
        </h1>
      </section>

      <div className="px-gutter">
        <div className="rule" />
      </div>

      {/* What Baxter is — three quiet statements. No bullets, no icons. */}
      <section className="px-gutter py-32 grid grid-cols-1 md:grid-cols-12 gap-y-16 md:gap-x-16">
        <div className="md:col-span-3">
          <p className="metadata">The premise</p>
        </div>
        <div className="md:col-span-8 md:col-start-5">
          <p className="font-serif text-lede text-ink max-w-measure">
            Baxter is a curated marketplace for independent publications —
            zines, art books, photo journals, chapbooks, monographs.
          </p>
          <p className="font-serif text-body text-ink-soft max-w-measure mt-8">
            Every publication is reviewed by an editor before it appears. Print
            files are checked against the standards a printer would expect.
            Pricing, listings, and proofs pass through the same care a small
            press would give them.
          </p>
        </div>
      </section>

      <div className="px-gutter">
        <div className="rule" />
      </div>

      {/* For creators. Plain English. Time named directly. */}
      <section className="px-gutter py-32 grid grid-cols-1 md:grid-cols-12 gap-y-16 md:gap-x-16">
        <div className="md:col-span-3">
          <p className="metadata">For creators</p>
        </div>
        <div className="md:col-span-8 md:col-start-5">
          <h2 className="font-serif text-h2 max-w-[22ch] text-ink">
            A small press, available to one person.
          </h2>
          <p className="font-serif text-body text-ink-soft max-w-measure mt-10">
            Upload a print-ready PDF or build directly in the editor. Set the
            format, price, and an edition size if there is one. Submit it for
            review. Reviewed within five business days.
          </p>
          <p className="font-serif text-body text-ink-soft max-w-measure mt-6">
            When the publication is published, it lives at its own address.
            Orders, fulfillment, and payouts run through Baxter.
          </p>
          <div className="mt-12">
            <Link
              href="/sign-up"
              className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
            >
              Begin a publication
            </Link>
          </div>
        </div>
      </section>

      <div className="px-gutter">
        <div className="rule" />
      </div>

      {/* For readers. */}
      <section className="px-gutter py-32 grid grid-cols-1 md:grid-cols-12 gap-y-16 md:gap-x-16">
        <div className="md:col-span-3">
          <p className="metadata">For readers</p>
        </div>
        <div className="md:col-span-8 md:col-start-5">
          <h2 className="font-serif text-h2 max-w-[22ch] text-ink">
            Held to a standard, before it reaches the shelf.
          </h2>
          <p className="font-serif text-body text-ink-soft max-w-measure mt-10">
            Every publication on Baxter has been reviewed. Editions are
            tracked. Reviews are written by buyers, after the publication has
            arrived.
          </p>
          <div className="mt-12">
            <Link
              href="/publications"
              className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
            >
              Browse publications
            </Link>
          </div>
        </div>
      </section>

      <div className="px-gutter">
        <div className="rule" />
      </div>

      {/* Footer. Minimal. The room is closing. */}
      <footer className="px-gutter py-20 grid grid-cols-1 md:grid-cols-12 gap-y-12 md:gap-x-16">
        <div className="md:col-span-3">
          <p className="font-shell text-[0.95rem] tracking-[0.18em] uppercase text-ink">
            Baxter
          </p>
          <p className="metadata mt-4">Toronto · est. 2026</p>
        </div>
        <div className="md:col-span-3 md:col-start-7">
          <p className="metadata mb-4">Publications</p>
          <ul className="font-shell text-[0.875rem] text-ink-soft space-y-2">
            <li><Link href="/publications">All publications</Link></li>
            <li><Link href="/creators">Creators</Link></li>
          </ul>
        </div>
        <div className="md:col-span-3 md:col-start-10">
          <p className="metadata mb-4">House</p>
          <ul className="font-shell text-[0.875rem] text-ink-soft space-y-2">
            <li><Link href="/about">About Baxter</Link></li>
            <li><Link href="/standards">Editorial standards</Link></li>
            <li><Link href="/contact">Contact</Link></li>
          </ul>
        </div>
      </footer>
    </main>
  );
}
