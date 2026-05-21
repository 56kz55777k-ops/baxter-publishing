/**
 * Supabase middleware helper — session refresh + auth-aware redirects.
 *
 * Called from `apps/web/middleware.ts` on every matched request.
 *
 * Responsibilities:
 *   1. Refresh the Supabase session cookies if they're nearing expiry.
 *   2. Gate (app) and (admin) routes: unauthenticated → /sign-in.
 *   3. Force pending-handle users into /settings/profile until they claim
 *      a real handle.
 *
 * The route protection is intentionally minimal: most pages are public.
 * The list of authed-only path prefixes is small and explicit.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const AUTHED_PREFIXES = ['/studio', '/settings', '/admin'];

function isAuthedPath(pathname: string): boolean {
  return AUTHED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(items: Array<{ name: string; value: string; options: CookieOptions }>) {
          for (const { name, value } of items) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: request.headers } });
          for (const { name, value, options } of items) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // IMPORTANT: do not run any code between createServerClient and getUser.
  // A simple mistake here could make it difficult to debug issues with users
  // being randomly signed out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  // 1. Authed-route protection — bounce signed-out users to /sign-in.
  if (isAuthedPath(pathname) && !user) {
    const next = `${pathname}${search}`;
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = `?next=${encodeURIComponent(next)}`;
    return NextResponse.redirect(url);
  }

  // 2. Pending-handle gate — a signed-in user whose handle is still the
  //    auth-trigger placeholder must claim a real handle before doing
  //    anything else. We allow:
  //      - /settings/profile (the claim page itself)
  //      - /api/* (server actions and API routes need to function)
  //      - sign-out and auth callbacks
  //      - /sign-in and /sign-up (in case they hit those signed-in)
  //    Everything else under (app)/(admin) bounces back to the claim page.
  if (user && isAuthedPath(pathname) && pathname !== '/settings/profile') {
    // Cheap check — read just the handle column. If RLS or a missing row
    // returns null, we fail open (don't trap the user in a redirect loop).
    const { data: profile } = await supabase
      .from('users')
      .select('handle')
      .eq('id', user.id)
      .maybeSingle();
    if (profile?.handle?.startsWith('~pending-')) {
      const url = request.nextUrl.clone();
      url.pathname = '/settings/profile';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  return response;
}
