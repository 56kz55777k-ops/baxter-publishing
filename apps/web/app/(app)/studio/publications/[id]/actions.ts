'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { inngest } from '@/lib/inngest/client';
import { canTransition, type PublicationStatus } from '@baxter/domain';

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

/**
 * Save the workspace marketplace fields (D-016): subtitle, description, price,
 * edition. This is *editing*, distinct from submission. Allowed only while the
 * publication is the creator's and editable (RLS permits update in
 * draft/revisions). Price is entered in major units (dollars) and stored in
 * minor units (cents). Edition left blank = open edition (null).
 */
export async function saveMarketplace(
  publicationId: string,
  values: { subtitle: string; description: string; price: string; edition: string }
): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Sign in first.' };

  let priceMinor: number | null = null;
  const priceTrim = values.price.trim();
  if (priceTrim) {
    const dollars = Number(priceTrim);
    if (!Number.isFinite(dollars) || dollars < 0) {
      return { ok: false, message: 'Enter a price as a number, or leave it blank.' };
    }
    priceMinor = Math.round(dollars * 100);
  }

  let editionSize: number | null = null;
  const editionTrim = values.edition.trim();
  if (editionTrim) {
    const n = Number(editionTrim);
    if (!Number.isInteger(n) || n <= 0) {
      return {
        ok: false,
        message: 'Edition must be a whole number, or blank for an open edition.',
      };
    }
    editionSize = n;
  }

  const { error } = await supabase
    .from('publications')
    .update({
      subtitle: values.subtitle.trim() || null,
      description: values.description.trim() || null,
      price_minor: priceMinor,
      edition_size: editionSize,
      updated_at: new Date().toISOString(),
    })
    .eq('id', publicationId)
    .eq('creator_id', user.id);

  if (error) {
    console.error('saveMarketplace: update failed', {
      code: error.code,
      message: error.message,
      publicationId,
    });
    return { ok: false, message: 'Something prevented the changes from saving.' };
  }

  revalidatePath(`/studio/publications/${publicationId}`);
  return { ok: true };
}

/**
 * Submit a publication for review (D-016) — the declaration that the work is
 * ready. A form action; reads `publicationId` from the form.
 *
 * Server-validated and gated: the canonical file must have passed preflight,
 * and price + description must be present. The transition (draft|revisions →
 * in_review) is checked against the pure state machine, then written via the
 * service-role client (status + submitted_at, and the insert-only
 * publication_events audit row, which has no client write policy). Notifies an
 * admin asynchronously via Inngest. Redirects to the "Submitted." confirmation.
 */
export async function submitForReview(formData: FormData): Promise<void> {
  const publicationId = String(formData.get('publicationId') ?? '');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: pub } = await supabase
    .from('publications')
    .select('id, creator_id, status, price_minor, description')
    .eq('id', publicationId)
    .maybeSingle();
  if (!pub || pub.creator_id !== user.id) redirect('/library');

  const from = pub.status as PublicationStatus;
  if (!canTransition({ from, to: 'in_review', by: 'creator' }).ok) {
    redirect(`/studio/publications/${publicationId}`);
  }

  // Submission gate (re-checked server-side; never trust the client).
  const { data: passed } = await supabase
    .from('artifacts')
    .select('id')
    .eq('publication_id', publicationId)
    .eq('preflight_status', 'passed')
    .limit(1);
  const eligible =
    !!passed?.length &&
    pub.price_minor !== null &&
    pub.price_minor !== undefined &&
    !!(pub.description && String(pub.description).trim());
  if (!eligible) {
    redirect(`/studio/publications/${publicationId}/review`);
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error: upErr } = await admin
    .from('publications')
    .update({ status: 'in_review', submitted_at: now, updated_at: now })
    .eq('id', publicationId);
  if (upErr) {
    console.error('submitForReview: update failed', {
      code: upErr.code,
      message: upErr.message,
      publicationId,
    });
    redirect(`/studio/publications/${publicationId}/review`);
  }
  await admin.from('publication_events').insert({
    publication_id: publicationId,
    from_status: from,
    to_status: 'in_review',
    actor_id: user.id,
    payload: { action: 'submit_for_review' },
  });

  // Async admin notification — failure here must not block the submission.
  try {
    await inngest.send({
      name: 'publication/submitted',
      data: { publicationId },
    });
  } catch (e) {
    console.error('submitForReview: inngest send failed', {
      error: String(e),
      publicationId,
    });
  }

  revalidatePath(`/studio/publications/${publicationId}`);
  redirect(`/studio/publications/${publicationId}?submitted=1`);
}
