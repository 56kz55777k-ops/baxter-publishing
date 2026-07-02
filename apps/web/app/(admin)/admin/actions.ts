'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdminUser } from '@/lib/auth/admin-guard';
import { inngest } from '@/lib/inngest/client';
import {
  canTransition,
  validReasonCodeIds,
  type PublicationStatus,
} from '@baxter/domain';

export type Decision = 'publish' | 'revise';

/**
 * Record an editorial decision on an `in_review` publication (D-019).
 *
 * Two decisions, matching the state machine exactly: Publish
 * (`in_review → published`) and Request revisions (`in_review → revisions`).
 * There is no "reject" — declining an edition is expressed as revisions plus a
 * written note (the editor explains why Baxter isn't publishing this edition).
 *
 * The editor writes; the software records (D-020). The written note is the
 * message the creator reads. Reason codes are internal-only metadata recorded
 * alongside it in `publication_events.payload` — never surfaced to the creator,
 * never turned into copy.
 *
 * Admin identity is re-verified here (a server action has no layout guard). The
 * transition is checked against the pure state machine, written via the
 * service-role client, and audited. The creator is notified asynchronously via
 * Inngest — a notification failure never blocks the decision.
 */
export async function decidePublication(input: {
  publicationId: string;
  decision: Decision;
  note: string;
  reasonCodes: string[];
}): Promise<{ ok: boolean; message?: string }> {
  const admin = await getAdminUser();
  if (!admin) return { ok: false, message: 'Not permitted.' };

  const { publicationId, decision } = input;
  const note = (input.note ?? '').trim();
  const reasonCodes = validReasonCodeIds(input.reasonCodes ?? []);

  // A returned publication must carry the editor's note (D-020). Publishing may
  // carry a note, but doesn't require one.
  if (decision === 'revise' && !note) {
    return {
      ok: false,
      message: 'A note is needed to return this to the creator.',
    };
  }

  const db = createAdminClient();
  const { data: pub } = await db
    .from('publications')
    .select('id, status')
    .eq('id', publicationId)
    .maybeSingle();
  if (!pub) return { ok: false, message: 'This publication could not be found.' };

  const from = pub.status as PublicationStatus;
  const to: PublicationStatus =
    decision === 'publish' ? 'published' : 'revisions';
  if (!canTransition({ from, to, by: 'admin' }).ok) {
    return {
      ok: false,
      message: 'This publication is no longer awaiting review.',
    };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: to, updated_at: now };
  if (decision === 'publish') patch.published_at = now;

  const { error: upErr } = await db
    .from('publications')
    .update(patch)
    .eq('id', publicationId);
  if (upErr) {
    console.error('decidePublication: update failed', {
      code: upErr.code,
      message: upErr.message,
      publicationId,
    });
    return { ok: false, message: 'Something prevented the decision from saving.' };
  }

  await db.from('publication_events').insert({
    publication_id: publicationId,
    from_status: from,
    to_status: to,
    actor_id: admin.id,
    payload: {
      action: decision === 'publish' ? 'publish' : 'request_revisions',
      reasonCodes,
      note: note || null,
    },
  });

  // Async creator notification — failure here must not block the decision.
  try {
    await inngest.send({
      name: 'publication/decided',
      data: { publicationId, decision, note: note || null },
    });
  } catch (e) {
    console.error('decidePublication: inngest send failed', {
      error: String(e),
      publicationId,
    });
  }

  revalidatePath('/admin');
  revalidatePath(`/admin/${publicationId}`);
  revalidatePath(`/studio/publications/${publicationId}`);
  return { ok: true };
}
