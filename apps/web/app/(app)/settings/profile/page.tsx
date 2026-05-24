import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ClaimHandleForm } from './claim-handle-form';
import { UpdateProfileForm } from './update-profile-form';
import { DeleteAccountForm } from './delete-account-form';

export const metadata = {
  title: 'Profile — Baxter',
};

/**
 * Profile settings.
 *
 * Two states:
 *   1. Pending — user still carries a `~pending-<uuid>` handle. Show only the
 *      handle claim. Display name and bio are hidden until a handle exists.
 *   2. Claimed — show the display name + bio form, and a quiet line that names
 *      the handle (handles are permanent in Slice 2; changing them is deferred).
 */
export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: profile } = await supabase
    .from('users')
    .select('handle, display_name, bio')
    .eq('id', user.id)
    .single();

  const handle = profile?.handle ?? '';
  const isPending = handle.startsWith('~pending-');

  if (isPending) {
    return (
      <article className="max-w-[34rem] mx-auto pt-8">
        <p className="metadata mb-4">Profile</p>
        <h1 className="text-[2rem] leading-[1.15] tracking-tight mb-6">
          Choose how your name appears.
        </h1>
        <p className="text-ink-soft mb-10 prose-editorial">
          Your handle is the address of your profile and the prefix of every
          publication you release on Baxter. It cannot be changed after it has
          been claimed.
        </p>

        <ClaimHandleForm />

        <p className="text-[0.85rem] text-ink-faint mt-10">
          Three to twenty-four characters. Lowercase letters, numbers, and
          single hyphens.
        </p>
      </article>
    );
  }

  return (
    <article className="max-w-[34rem] mx-auto pt-8">
      <p className="metadata mb-4">Profile</p>
      <h1 className="text-[2rem] leading-[1.15] tracking-tight mb-6">
        Your profile.
      </h1>
      <p className="text-ink-soft mb-2 prose-editorial">
        How you appear on Baxter, and the page readers see when they follow you.
      </p>
      <p className="text-[0.85rem] text-ink-faint mb-10">
        Your handle is{' '}
        <Link
          href={`/${encodeURIComponent(handle)}`}
          className="text-ink underline underline-offset-4 decoration-rule hover:decoration-accent"
        >
          baxter.press/{handle}
        </Link>
        .
      </p>

      <UpdateProfileForm
        initialDisplayName={profile?.display_name ?? ''}
        initialBio={profile?.bio ?? ''}
      />

      <section className="mt-24 pt-10 border-t border-rule">
        <p className="metadata mb-4">Account</p>
        <h2 className="text-[1.5rem] leading-[1.15] tracking-tight mb-4">
          Delete your account.
        </h2>
        <p className="text-ink-soft mb-8 prose-editorial">
          Deleting your account removes your profile, handle, and follows
          from Baxter. This cannot be undone.
        </p>
        <DeleteAccountForm handle={handle} />
      </section>
    </article>
  );
}
