'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Profile actions — claim handle, update display name and bio.
 *
 * Handle rules:
 *   • 3–24 characters
 *   • lowercase letters, numbers, hyphens; must start with a letter
 *   • no leading/trailing hyphens, no consecutive hyphens
 *   • reserved words rejected
 *
 * Slur and impersonation moderation is deferred to a pre-launch pass; the
 * reserved list below is the minimum guard.
 */

const HANDLE_RE = /^[a-z][a-z0-9-]{1,22}[a-z0-9]$/;
const RESERVED = new Set([
  'admin', 'administrator', 'baxter', 'staff', 'support', 'help',
  'about', 'contact', 'standards', 'publications', 'creators',
  'studio', 'settings', 'sign-in', 'sign-up', 'sign-out',
  'api', 'auth', 'login', 'logout', 'profile', 'follow',
  'home', 'index', 'root', 'system', 'editor', 'editorial',
  'press', 'house', 'shop', 'cart', 'checkout', 'orders',
]);

export type ProfileState =
  | { status: 'idle' }
  | { status: 'error'; message: string; field?: 'handle' | 'display_name' | 'bio' }
  | { status: 'success'; redirectTo?: string };

function validateHandle(raw: string): { ok: true; handle: string } | { ok: false; message: string } {
  const handle = raw.trim().toLowerCase();
  if (!handle) return { ok: false, message: 'A handle is required.' };
  if (handle.length < 3) return { ok: false, message: 'Handles need at least three characters.' };
  if (handle.length > 24) return { ok: false, message: 'Handles cannot exceed twenty-four characters.' };
  if (!HANDLE_RE.test(handle)) {
    return {
      ok: false,
      message:
        'Handles use lowercase letters, numbers, and hyphens. They must start with a letter and cannot end with a hyphen.',
    };
  }
  if (handle.includes('--')) {
    return { ok: false, message: 'Handles cannot contain consecutive hyphens.' };
  }
  if (RESERVED.has(handle) || handle.startsWith('~')) {
    return { ok: false, message: 'That handle is reserved. Try another.' };
  }
  return { ok: true, handle };
}

/**
 * Claim a permanent handle. Replaces the `~pending-<uuid>` placeholder
 * inserted by the auth trigger. Uniqueness is enforced by the unique index;
 * this action returns a composed error if it collides.
 */
export async function claimHandle(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const result = validateHandle(String(formData.get('handle') ?? ''));
  if (!result.ok) {
    return { status: 'error', message: result.message, field: 'handle' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: 'error', message: 'Sign in first.', field: 'handle' };
  }

  const { error } = await supabase
    .from('users')
    .update({ handle: result.handle, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  if (error) {
    // 23505 is Postgres's unique-violation code.
    if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
      return {
        status: 'error',
        message: 'That handle is already in use. Try another.',
        field: 'handle',
      };
    }
    console.error('claimHandle: update failed', {
      code: error.code,
      message: error.message,
      userId: user.id,
    });
    return {
      status: 'error',
      message: 'Something prevented the handle from being saved. Try again.',
      field: 'handle',
    };
  }

  revalidatePath('/', 'layout');
  redirect(`/${result.handle}`);
}

/**
 * Update display name and bio. Available only after a handle has been claimed.
 */
export async function updateProfile(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const displayName = String(formData.get('display_name') ?? '').trim();
  const bio = String(formData.get('bio') ?? '').trim();

  if (!displayName) {
    return {
      status: 'error',
      message: 'A display name is required.',
      field: 'display_name',
    };
  }
  if (displayName.length > 64) {
    return {
      status: 'error',
      message: 'Display names cannot exceed sixty-four characters.',
      field: 'display_name',
    };
  }
  if (bio.length > 600) {
    return {
      status: 'error',
      message: 'Bios cannot exceed six hundred characters.',
      field: 'bio',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: 'error', message: 'Sign in first.' };
  }

  const { error } = await supabase
    .from('users')
    .update({
      display_name: displayName,
      bio: bio || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (error) {
    console.error('updateProfile: update failed', {
      code: error.code,
      message: error.message,
      userId: user.id,
    });
    return {
      status: 'error',
      message: 'Something prevented the profile from being saved. Try again.',
    };
  }

  revalidatePath('/settings/profile');
  return { status: 'success' };
}

export type DeleteAccountState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

/**
 * Delete the signed-in user's account.
 *
 * Confirmation: the user must type their current handle. This guards
 * against misfires without staging a modal. Available only after a handle
 * has been claimed — pending-handle users cannot type a `~pending-` token,
 * so they must claim first. (Pending-state delete UX is a future polish.)
 *
 * Order of operations:
 *   1. Delete public.users — cascades follows + assets, nulls audit-log
 *      actor_ids. Service role bypasses RLS (no DELETE policy exists).
 *   2. Delete auth.users via admin API. Invalidates all sessions.
 *   3. Best-effort local signOut to clear the browser cookie.
 *   4. Redirect to /. The user leaves Baxter cleanly.
 */
export async function deleteAccount(
  _prev: DeleteAccountState,
  formData: FormData
): Promise<DeleteAccountState> {
  const typed = String(formData.get('handle') ?? '').trim().toLowerCase();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: 'error', message: 'Sign in first.' };
  }

  const { data: profile } = await supabase
    .from('users')
    .select('handle')
    .eq('id', user.id)
    .single();

  if (!profile?.handle || profile.handle.startsWith('~pending-')) {
    return {
      status: 'error',
      message: 'Claim a handle before deleting the account.',
    };
  }
  if (typed !== profile.handle) {
    return {
      status: 'error',
      message: 'The handle did not match. Try again.',
    };
  }

  const admin = createAdminClient();

  const { error: rowError } = await admin
    .from('users')
    .delete()
    .eq('id', user.id);
  if (rowError) {
    console.error('deleteAccount: users delete failed', {
      code: rowError.code,
      message: rowError.message,
      userId: user.id,
    });
    return {
      status: 'error',
      message: 'Something prevented the account from being removed. Try again.',
    };
  }

  const { error: authError } = await admin.auth.admin.deleteUser(user.id);
  if (authError) {
    console.error('deleteAccount: admin.deleteUser failed', {
      message: authError.message,
      userId: user.id,
    });
    return {
      status: 'error',
      message: 'Something prevented the account from being removed. Try again.',
    };
  }

  try {
    await supabase.auth.signOut();
  } catch {
    // Session is already invalid server-side; the local cookie clear is
    // best-effort and will resolve on the next request regardless.
  }

  revalidatePath('/', 'layout');
  redirect('/');
}
