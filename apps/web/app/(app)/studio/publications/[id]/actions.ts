'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Record the creator's acknowledgement of a passed file's warnings (D-012).
 *
 * Ownership is enforced by RLS: the user-scoped read only returns artifacts
 * the caller owns. The write itself goes through the service-role client,
 * because there is no client UPDATE policy on artifacts (preflight state is
 * server-controlled) — acknowledgement only stamps a timestamp into the
 * existing preflight jsonb; it never changes the status.
 */
export async function acknowledgeWarnings(
  artifactId: string
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { data: artifact } = await supabase
    .from('artifacts')
    .select('id, publication_id, preflight, preflight_status')
    .eq('id', artifactId)
    .maybeSingle();

  // Not found = not owned (RLS) or gone. Only passed files carry warnings.
  if (!artifact || artifact.preflight_status !== 'passed') return { ok: false };

  const preflight = {
    ...((artifact.preflight as Record<string, unknown> | null) ?? {}),
    warningsAcknowledgedAt: new Date().toISOString(),
  };

  const admin = createAdminClient();
  const { error } = await admin
    .from('artifacts')
    .update({ preflight })
    .eq('id', artifactId);
  if (error) {
    console.error('acknowledgeWarnings: update failed', {
      code: error.code,
      message: error.message,
      artifactId,
    });
    return { ok: false };
  }

  revalidatePath(`/studio/publications/${artifact.publication_id}`);
  return { ok: true };
}
