import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { PDFDocument } from 'pdf-lib';
import { createClient } from '@/lib/supabase/server';
import { r2Client, QUARANTINE_BUCKET } from '@/lib/r2/client';

/**
 * Fetch the uploaded PDF back from R2 and count its pages.
 *
 * Graceful failure: a corrupt or encrypted PDF returns null and the
 * caller leaves page_count unset. Slice 3b's preflight worker handles
 * the harder cases (malformed structure, password-protected, etc.).
 */
async function countPdfPages(key: string): Promise<number | null> {
  try {
    const client = r2Client();
    const res = await client.send(
      new GetObjectCommand({ Bucket: QUARANTINE_BUCKET, Key: key })
    );
    if (!res.Body) return null;
    const bytes = await res.Body.transformToByteArray();
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return pdf.getPageCount();
  } catch (err) {
    console.error('countPdfPages failed', { key, error: String(err) });
    return null;
  }
}

/**
 * Record an uploaded artifact in the database.
 *
 * Called by the upload form after the direct R2 PUT completes. We do not
 * trust the client's claim about the file's existence in R2; a future
 * (Slice 3b) Inngest preflight worker will independently inspect the
 * object before promoting it out of quarantine. For Slice 3a, registration
 * is the end of the synchronous flow.
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

  // Count pages now so the creator does not have to guess at creation time.
  // Failure is non-fatal: the artifact still registers; page_count stays null.
  const pageCount = await countPdfPages(body.key);

  const { error } = await supabase.from('artifacts').insert({
    publication_id: publicationId,
    r2_key: body.key,
    bucket: QUARANTINE_BUCKET,
    size_bytes: body.sizeBytes,
    content_type: body.contentType,
    preflight: pageCount !== null ? { pageCount } : null,
    is_canonical: false,
  });

  if (error) {
    console.error('register artifact: insert failed', {
      code: error.code,
      message: error.message,
      publicationId,
      userId: user.id,
    });
    return NextResponse.json(
      { message: 'Something prevented the file from being recorded.' },
      { status: 500 }
    );
  }

  if (pageCount !== null) {
    const { error: updateError } = await supabase
      .from('publications')
      .update({ page_count: pageCount, updated_at: new Date().toISOString() })
      .eq('id', publicationId);
    if (updateError) {
      // Non-fatal: the artifact row carries the count in preflight either way.
      console.error('register artifact: page_count update failed', {
        code: updateError.code,
        message: updateError.message,
        publicationId,
      });
    }
  }

  return NextResponse.json({ ok: true, pageCount });
}
