'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Follow / unfollow toggle for a public profile.
 *
 * Optimistic local state with a router refresh on success so the follower
 * count in metadata updates without a hard reload. If the request fails,
 * the local state reverts.
 */
export function FollowButton({
  handle,
  initialIsFollowing,
  isAuthed,
}: {
  handle: string;
  initialIsFollowing: boolean;
  isAuthed: boolean;
}) {
  const router = useRouter();
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isAuthed) {
    return (
      <a
        href={`/sign-in?next=${encodeURIComponent(`/${handle}`)}`}
        className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
      >
        Sign in to follow
      </a>
    );
  }

  async function toggle() {
    setError(null);
    const next = !isFollowing;
    setIsFollowing(next);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/follow/${encodeURIComponent(handle)}`, {
          method: next ? 'POST' : 'DELETE',
        });
        if (!res.ok) {
          // Revert.
          setIsFollowing(!next);
          const body = await res.json().catch(() => ({}));
          setError(body.message ?? 'Something prevented this from completing.');
          return;
        }
        router.refresh();
      } catch {
        setIsFollowing(!next);
        setError('Something prevented this from completing.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 items-start">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={
          isFollowing
            ? 'font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink-soft border-b border-rule pb-1 hover:text-ink hover:border-ink transition-colors duration-400 ease-gentle disabled:opacity-50'
            : 'font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle disabled:opacity-50'
        }
      >
        {isFollowing ? 'Following' : 'Follow'}
      </button>
      {error && (
        <p role="alert" className="text-[0.85rem] text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
