'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const MIN_PASSWORD_LENGTH = 12;

export type AuthState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

/**
 * Sign up with email + password.
 *
 * Supabase fires the `on_auth_user_created` trigger and inserts a row in
 * `public.users` with a `~pending-<uuid>` handle. The user is sent to
 * /settings/profile to claim a real handle before they can do anything else.
 */
export async function signUp(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !email.includes('@')) {
    return { status: 'error', message: 'A valid email is required.' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      status: 'error',
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo:
        process.env.NEXT_PUBLIC_SITE_URL
          ? `${process.env.NEXT_PUBLIC_SITE_URL}/settings/profile`
          : undefined,
    },
  });

  if (error) {
    return { status: 'error', message: phraseAuthError(error.message) };
  }

  // Supabase by default sends a confirmation email. The user lands on
  // /settings/profile only after they click the link. If email confirmation
  // is off, the session is set immediately — we redirect either way.
  redirect('/sign-up/check-email');
}

/**
 * Sign in with email + password.
 */
export async function signIn(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const nextRaw = String(formData.get('next') ?? '').trim();

  if (!email || !password) {
    return { status: 'error', message: 'Email and password are required.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { status: 'error', message: phraseAuthError(error.message) };
  }

  // After signing in, check whether the user still has a placeholder handle.
  // If so, send them to claim one. Otherwise, send them to the studio or to
  // the `next` path they were heading to before being bounced.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from('users')
      .select('handle')
      .eq('id', user.id)
      .single();

    if (profile?.handle?.startsWith('~pending-')) {
      redirect('/settings/profile');
    }
  }

  revalidatePath('/', 'layout');

  // Only honor `next` if it's a relative path on this site. This prevents
  // open-redirect abuse.
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/studio';
  redirect(next);
}

/**
 * Sign out and return to the homepage.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/');
}

/**
 * Translate Supabase error messages into Baxter's voice.
 * Composed, never apologetic, never alarming. Names the issue directly.
 */
function phraseAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('user already registered') || m.includes('already exists')) {
    return 'An account with this email already exists. Sign in instead.';
  }
  if (m.includes('invalid login') || m.includes('invalid credentials')) {
    return 'That email and password do not match.';
  }
  if (m.includes('email not confirmed')) {
    return 'This account has not been confirmed yet. Check your email for the link Baxter sent.';
  }
  if (m.includes('rate limit')) {
    return 'Too many attempts. Wait a moment and try again.';
  }
  if (m.includes('password')) {
    return 'The password Baxter received was not accepted. Try again.';
  }
  return 'Something prevented this from completing. Try again.';
}
