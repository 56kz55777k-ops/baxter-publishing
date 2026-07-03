import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SiteHeader } from '@/components/site-header';

export const metadata = {
  title: 'About — Baxter',
};

/**
 * About — the room described in full.
 *
 * The homepage front door (D-022) is work-led; the longer statement of what
 * Baxter is (premise, for creators, for readers) lives here, one deliberate
 * step in. Institutional voice throughout — plain, present tense, no flattery.
 */
export default async function AboutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const beginHref = user ? '/studio' : '/sign-up';

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <section className="px-gutter pt-20 pb-16">
        <p className="metadata mb-6">About</p>
        <h1 className="font-serif text-h1 md:text-display max-w-[16ch] leading-[1.04]">
          A publishing house, online.
        </h1>
      </section>

      <div className="px-gutter">
        <div className="rule" />
      </div>

      <section className="px-gutter py-28 grid grid-cols-1 md:grid-cols-12 gap-y-16 md:gap-x-16">
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

      <section className="px-gutter py-28 grid grid-cols-1 md:grid-cols-12 gap-y-16 md:gap-x-16">
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
              href={beginHref}
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

      <section className="px-gutter py-28 grid grid-cols-1 md:grid-cols-12 gap-y-16 md:gap-x-16">
        <div className="md:col-span-3">
          <p className="metadata">For readers</p>
        </div>
        <div className="md:col-span-8 md:col-start-5">
          <h2 className="font-serif text-h2 max-w-[22ch] text-ink">
            Held to a standard, before it reaches the shelf.
          </h2>
          <p className="font-serif text-body text-ink-soft max-w-measure mt-10">
            Every publication on Baxter has been reviewed. Editions are tracked.
            Reviews are written by buyers, after the publication has arrived.
          </p>
        </div>
      </section>

      <div className="px-gutter">
        <div className="rule" />
      </div>

      <footer className="px-gutter py-20">
        <p className="font-shell text-[0.95rem] tracking-[0.18em] uppercase text-ink">
          Baxter
        </p>
        <p className="metadata mt-3">Toronto · est. 2026</p>
      </footer>
    </main>
  );
}
