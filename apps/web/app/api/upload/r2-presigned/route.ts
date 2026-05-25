import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { presignedPutUrl } from '@/lib/r2/presigned';
import { QUARANTINE_BUCKET } from '@/lib/r2/client';

/**
 * Mint a presigned PUT URL for direct browser→R2 upload.
 *
 * Authenticates the caller, verifies they own the target publication and
 * that it is in an editable state, then signs a one-shot URL into the
 * quarantine bucket.
 *
 * Object key pattern: publications/<publicationId>/<timestamp>-<filename>.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ message: 'Sign in to upload.' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { publicationId?: string; filename?: string; contentType?: string }
    | null;
  if (!body?.publicationId || !body?.filename || !body?.contentType) {
    return NextResponse.json({ message: 'Missing fields.' }, { status: 400 });
  }
  if (body.contentType !== 'application/pdf') {
    return NextResponse.json(
      { message: 'Only PDF uploads are accepted.' },
      { status: 400 }
    );
  }

  const { data: publication } = await supabase
    .from('publications')
    .select('id, creator_id, status')
    .eq('id', body.publicationId)
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

  const safeFilename = body.filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 100);
  const key = `publications/${body.publicationId}/${Date.now()}-${safeFilename}`;

  const url = await presignedPutUrl({
    bucket: QUARANTINE_BUCKET,
    key,
    contentType: body.contentType,
  });

  return NextResponse.json({ url, key, bucket: QUARANTINE_BUCKET });
}
