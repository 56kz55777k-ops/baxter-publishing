import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '../(auth)/actions';

/**
 * Authenticated app shell — /studio, /settings/*, etc.
 *
 * Editorial Constitution applied:
 *   • Composed Warmth — the shell carries Baxter's wordmark and a quiet
 *     navigation. The sign-out is a verb, not a panic button.
 *   • Platform Humility — the chrome is restrained so the work can speak.
 *
 * Any non-signed-in request that reaches a route in this group is sent to
 * /sign-in. The middleware refreshes the session; this layout is the gate.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  // Load the user's handle so the shell can link to their profile (or, if
  // still pending, nudge them toward claiming one).
  const { data: profile } = await supabase
    .from('users')
    .select('handle, display_name')
    .eq('id', user.id)
    .single();

  const handle = profile?.handle ?? null;
  const isPending = handle?.startsWith('~pending-') ?? true;

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
        <nav className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft flex items-baseline gap-10">
          <Link href="/studio">Studio</Link>
          <Link href="/library">Library</Link>
          {!isPending && handle ? (
            <Link href={`/${encodeURIComponent(handle)}`}>Profile</Link>
          ) : (
            <Link href="/settings/profile">Profile</Link>
          )}
          <Link href="/settings/profile">Settings</Link>
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
