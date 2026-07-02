import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '../(auth)/actions';

/**
 * The editorial desk — Baxter's internal review surface.
 *
 * This is an editor's desk, not a moderation console (Editorial Constitution:
 * "an editorial office, not a moderation platform"). The chrome is quiet; the
 * work is what matters.
 *
 * Access is gated to `role = 'admin'`. The middleware already bounces signed-out
 * requests to /sign-in; this layout is the role gate. A non-admin who knows the
 * URL gets a 404 (notFound) rather than a redirect — the desk simply does not
 * exist for them, which reveals nothing.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role !== 'admin') notFound();

  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-gutter pt-10 pb-16 flex items-baseline justify-between">
        <Link
          href="/admin"
          aria-label="Baxter — editorial desk"
          className="font-shell text-[0.95rem] tracking-[0.18em] uppercase text-ink"
        >
          Baxter
        </Link>
        <nav className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft flex items-baseline gap-10">
          <Link href="/admin">Desk</Link>
          <Link href="/studio">Studio</Link>
          <form action={signOut}>
            <button
              type="submit"
              className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft hover:text-ink transition-colors duration-300"
            >
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <div className="flex-1 px-gutter pb-24">{children}</div>
    </main>
  );
}
