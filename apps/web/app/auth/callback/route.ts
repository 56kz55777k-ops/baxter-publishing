import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Supabase auth callback.
 *
 * Email-confirmation links and OAuth flows land here with `?code=...` (PKCE).
 * Exchange the code for a session, then forward to `next` (defaulting to
 * /settings/profile so newly-confirmed users land on the handle claim, not
 * the sign-in page). Without this route, the middleware sees no session on
 * the target page and bounces to /sign-in.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextRaw = searchParams.get('next') ?? '/settings/profile';
  // Only honour `next` if it's a relative path on this site (open-redirect guard).
  const next =
    nextRaw.startsWith('/') && !nextRaw.startsWith('//')
      ? nextRaw
      : '/settings/profile';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Code missing or exchange failed — drop the user on /sign-in so they can
  // authenticate by hand. A composed error surface can land later.
  const fallback = new URL('/sign-in', origin);
  fallback.searchParams.set('next', next);
  return NextResponse.redirect(fallback);
}
