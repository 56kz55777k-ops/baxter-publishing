'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

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
    return {
      status: 'error',
      message: 'Something prevented the profile from being saved. Try again.',
    };
  }

  revalidatePath('/settings/profile');
  return { status: 'success' };
}
