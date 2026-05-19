/**
 * Server-side Supabase client (App Router).
 * Bound to the request cookie store; respects RLS for the signed-in user.
 *
 * Slice 2 wires this up. Stub kept in tree so import paths exist.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(items: Array<{ name: string; value: string; options: CookieOptions }>) {
          try {
            for (const { name, value, options } of items) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies; safe to ignore here.
          }
        },
      },
    }
  );
}
