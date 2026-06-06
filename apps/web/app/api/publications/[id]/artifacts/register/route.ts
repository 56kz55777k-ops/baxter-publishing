import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { QUARANTINE_BUCKET } from '@/lib/r2/client';
import { inngest } from '@/lib/inngest/client';

/**
 * Record an uploaded artifact, then hand off to preflight.
 *
 * Called by the upload form after the direct R2 PUT completes. We do not trust
 * the client's claim about the file; the artifact row is created at
 * `preflight_status = pending` and an Inngest worker independently downloads
 * the object, runs the checks, sets the status, and (on pass) promotes the
 * file out of quarantine. All PDF inspection — including page count — lives in
 * that worker now, so this route does no parsing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: publicationId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ message: 'Sign in first.' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { key?: string; contentType?: string; sizeBytes?: number }
    | null;
  if (!body?.key || !body?.contentType || typeof body.sizeBytes !== 'number') {
    return NextResponse.json({ message: 'Missing fields.' }, { status: 400 });
  }

  const { data: publication } = await supabase
    .from('publications')
    .select('id, creator_id, status')
    .eq('id', publicationId)
    .maybeSingle();
  if (!publication || publication.creator_id !== user.id) {
    return NextResponse.json({ message: 'Publication not found.' }, { status: 404 });
  }
  if (publication.status !== 'draft' && publication.status !== 'revisions') {
    return NextResponse.json(
      {
        message:
          'Uploads are only accepted while the publication is in draft or revisions.',
      },
      { status: 400 }
    );
  }

  const { data: artifact, error } = await supabase
    .from('artifacts')
    .insert({
      publication_id: publicationId,
      r2_key: body.key,
      bucket: QUARANTINE_BUCKET,
      size_bytes: body.sizeBytes,
      content_type: body.contentType,
      is_canonical: false,
      // preflight + preflight_status default to null / 'pending'.
    })
    .select('id')
    .single();

  if (error || !artifact) {
    console.error('register artifact: insert failed', {
      code: error?.code,
      message: error?.message,
      publicationId,
      userId: user.id,
    });
    return NextResponse.json(
      { message: 'Something prevented the file from being recorded.' },
      { status: 500 }
    );
  }

  // Hand off to the preflight worker. A failure to enqueue should not fail the
  // upload — log it; the file is recorded and can be re-checked.
  try {
    await inngest.send({
      name: 'publication/artifact.uploaded',
      data: { artifactId: artifact.id, publicationId, key: body.key },
    });
  } catch (sendErr) {
    console.error('register artifact: inngest send failed', {
      error: String(sendErr),
      artifactId: artifact.id,
      publicationId,
    });
  }

  return NextResponse.json({ ok: true });
}
