import Link from 'next/link';

/**
 * Auth route group — sign-in, sign-up, profile claim.
 *
 * The room before the room.
 * Editorial Constitution: composed warmth. Spare, lit. Not transactional.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-gutter pt-10 pb-16 flex items-baseline justify-between">
        <Link
          href="/"
          aria-label="Baxter — home"
          className="font-shell text-[0.95rem] tracking-[0.18em] uppercase text-ink"
        >
          Baxter
        </Link>
      </header>
      <div className="flex-1 px-gutter pb-24">{children}</div>
    </main>
  );
}
