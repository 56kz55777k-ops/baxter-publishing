import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/app/(auth)/actions';

/**
 * Public site header — the thin institutional frame (D-024: the Platform's
 * voice) shared across the marketplace surfaces (homepage, about, browse,
 * publication pages). Restrained by design; the work is what fills the room.
 *
 * Auth-aware: a signed-in visitor sees Studio + Sign out; a signed-out visitor
 * sees a single quiet Sign in. No "Get started", no cart, no account theatre.
 */
export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="px-gutter pt-10 pb-16 flex items-baseline justify-between">
      <Link
        href="/"
        aria-label="Baxter — home"
        className="font-shell text-[0.95rem] tracking-[0.18em] uppercase text-ink"
      >
        Baxter
      </Link>
      <nav className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft flex items-baseline gap-10">
        <Link href="/publications">Publications</Link>
        {user ? (
          <>
            <Link href="/studio">Studio</Link>
            <form action={signOut}>
              <button
                type="submit"
                className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft hover:text-ink transition-colors duration-300"
              >
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link href="/sign-in">Sign in</Link>
        )}
      </nav>
    </header>
  );
}
