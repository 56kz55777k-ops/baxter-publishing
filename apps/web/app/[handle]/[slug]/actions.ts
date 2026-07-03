'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdminUser } from '@/lib/auth/admin-guard';

/**
 * Select or unselect a publication as an Editor's Pick (D-023/D-024).
 *
 * Picking is the Editor's voice — an editorial act, admin-only. Re-verifies the
 * admin role (a server action has no layout guard), then sets or clears
 * `editor_pick_at` via the service-role client. A timestamp, not a flag: on
 * select we stamp now; on unselect we null it. Only published work can be
 * picked.
 */
export async function toggleEditorPick(
  publicationId: string,
  handle: string,
  slug: string
): Promise<{ ok: boolean; message?: string }> {
  const admin = await getAdminUser();
  if (!admin) return { ok: false, message: 'Not permitted.' };

  const db = createAdminClient();
  const { data: pub } = await db
    .from('publications')
    .select('id, status, editor_pick_at')
    .eq('id', publicationId)
    .maybeSingle();
  if (!pub) return { ok: false, message: 'This publication could not be found.' };
  if (pub.status !== 'published') {
    return { ok: false, message: 'Only published work can be selected.' };
  }

  const nextValue = pub.editor_pick_at ? null : new Date().toISOString();
  const { error } = await db
    .from('publications')
    .update({ editor_pick_at: nextValue })
    .eq('id', publicationId);
  if (error) {
    console.error('toggleEditorPick: update failed', {
      code: error.code,
      message: error.message,
      publicationId,
    });
    return { ok: false, message: 'Something prevented the change from saving.' };
  }

  revalidatePath('/');
  revalidatePath('/publications');
  revalidatePath(`/${handle}/${slug}`);
  return { ok: true };
}
