/**
 * Supabase middleware helper — session refresh.
 *
 * Called from `apps/web/middleware.ts` on every request. Reads the user's
 * Supabase session cookies, refreshes them if they're about to expire, and
 * writes the refreshed cookies back onto the response so the browser stays
 * signed in without a hard reload.
 *
 * Slice 2 will extend this to redirect unauthenticated requests away from
 * (app) and (admin) route groups. For now it only refreshes the session.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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
  await supabase.auth.getUser();

  return response;
}
