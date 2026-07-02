/**
 * Admin role guard (server-only).
 *
 * The `(admin)` layout gates the desk, but a layout is not a hard security
 * boundary on its own — server actions have no layout, and pages should not
 * trust an ancestor's check. Every admin page and every admin action calls this
 * independently (defense in depth).
 *
 * Returns the signed-in user iff their `users.role` is `admin`, else null.
 * The role read goes through the user-scoped client (a user may always read
 * their own row under RLS), so this never needs the service-role client.
 */
import { createClient } from '@/lib/supabase/server';
import type { User } from '@supabase/supabase-js';

export async function getAdminUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  return profile?.role === 'admin' ? user : null;
}
