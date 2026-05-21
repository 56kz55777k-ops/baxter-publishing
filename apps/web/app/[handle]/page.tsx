import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { FollowButton } from '@/components/follow-button';
import { signOut } from '../(auth)/actions';

/**
 * Public creator profile — /<handle>.
 *
 * Editorial Constitution applied:
 *   • Platform Humility — the page is the creator's room, not Baxter's.
 *     The shell is a thin frame; the body is bio, work, and a quiet follow.
 *   • Attention Respect — no pop-ups, no cross-sell, no follower count
 *     theatre. Numbers are present, not weaponized.
 *   • Composed Warmth — the empty state names the absence rather than
 *     hiding it.
 *
 * Handles starting with `~pending-` are never resolved publicly — they 404.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const decoded = decodeURIComponent(handle);
  if (decoded.startsWith('~pending-')) {
    return { title: 'Not found — Baxter' };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from('users')
    .select('display_name, bio')
    .eq('handle', decoded)
    .maybeSingle();
  if (!data) return { title: 'Not found — Baxter' };
  return {
    title: `${data.display_name} — Baxter`,
    description: data.bio ?? undefined,
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: rawHandle } = await params;
  const handle = decodeURIComponent(rawHandle);

  // Placeholder handles are never publicly resolvable.
  if (handle.startsWith('~pending-')) notFound();

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('users')
    .select('id, handle, display_name, bio, created_at')
    .eq('handle', handle)
    .maybeSingle();

  if (!profile) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If the signed-in user is viewing their own profile from the public route,
  // they get an "edit" link in place of the follow button. Reading their own
  // pending status here also lets the shell behave correctly if they arrive
  // before claiming a handle (shouldn't happen — pending handles 404 — but
  // defensive against URL hand-edits).
  const isSelf = user?.id === profile.id;

  // Follow state and count. Count is a quiet metadata line, not a badge.
  const [{ count: followersCount }, ownFollow] = await Promise.all([
    supabase
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('creator_id', profile.id),
    user && !isSelf
      ? supabase
          .from('follows')
          .select('follower_id')
          .eq('follower_id', user.id)
          .eq('creator_id', profile.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const isFollowing = Boolean(ownFollow?.data);
  const followers = followersCount ?? 0;

  const joined = new Date(profile.created_at).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
  });

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
          <Link href="/publications">Publications</Link>
          <Link href="/creators">Creators</Link>
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

      <article className="flex-1 px-gutter pb-24">
        <section className="grid grid-cols-1 md:grid-cols-12 gap-y-12 md:gap-x-16 pt-12">
          <div className="md:col-span-3">
            <p className="metadata">Creator</p>
            <p className="metadata mt-6 text-ink-faint">Joined {joined}</p>
            <p className="metadata mt-3 text-ink-faint">
              {followers} {followers === 1 ? 'follower' : 'followers'}
            </p>
          </div>

          <div className="md:col-span-8 md:col-start-5">
            <h1 className="font-serif text-h1 md:text-display max-w-[16ch] leading-[1.04]">
              {profile.display_name}
            </h1>
            <p className="font-shell text-[0.85rem] tracking-[0.08em] uppercase text-ink-faint mt-6">
              {profile.handle}
            </p>

            {profile.bio ? (
              <p className="font-serif text-lede text-ink-soft max-w-measure mt-12 whitespace-pre-line">
                {profile.bio}
              </p>
            ) : (
              <p className="font-serif text-body text-ink-faint max-w-measure mt-12">
                This creator has not written a bio.
              </p>
            )}

            <div className="mt-12">
              {isSelf ? (
                <Link
                  href="/settings/profile"
                  className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
                >
                  Edit profile
                </Link>
              ) : (
                <FollowButton
                  handle={profile.handle}
                  initialIsFollowing={isFollowing}
                  isAuthed={Boolean(user)}
                />
              )}
            </div>
          </div>
        </section>

        <div className="rule mt-32" />

        <section className="grid grid-cols-1 md:grid-cols-12 gap-y-12 md:gap-x-16 py-20">
          <div className="md:col-span-3">
            <p className="metadata">Publications</p>
          </div>
          <div className="md:col-span-8 md:col-start-5">
            <p className="font-serif text-body text-ink-faint max-w-measure">
              No publications yet. When this creator releases work, it appears
              here.
            </p>
          </div>
        </section>
      </article>
    </main>
  );
}
