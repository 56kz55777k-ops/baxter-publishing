import Link from 'next/link';

/**
 * Global 404.
 * Editorial Constitution: name the absence, do not perform it.
 * No "Oops!", no balloons. Simply: the page is not here, and where to go next.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen px-gutter pt-16 pb-24">
      <header className="pb-16">
        <Link
          href="/"
          aria-label="Baxter — home"
          className="font-shell text-[0.95rem] tracking-[0.18em] uppercase text-ink"
        >
          Baxter
        </Link>
      </header>
      <article className="max-w-[34rem] pt-12">
        <p className="metadata mb-4">Not found</p>
        <h1 className="font-serif text-h1 leading-[1.1] tracking-tight">
          This page is not on the shelf.
        </h1>
        <p className="text-ink-soft mt-8 prose-editorial">
          The address you followed leads somewhere Baxter does not currently
          hold. The publication may have been moved, the handle may be wrong,
          or the page may not exist yet.
        </p>
        <div className="mt-12">
          <Link
            href="/"
            className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
          >
            Return home
          </Link>
        </div>
      </article>
    </main>
  );
}
