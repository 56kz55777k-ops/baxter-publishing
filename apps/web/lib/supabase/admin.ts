import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client.
 *
 * Bypasses RLS. Use ONLY in server actions or API routes for admin
 * operations (e.g. deleting an auth user). Never import this from a
 * Client Component or anywhere reachable from the browser bundle — the
 * service role key must stay server-only.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
