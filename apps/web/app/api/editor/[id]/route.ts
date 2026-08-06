import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  EditorDocParseError,
  UnsupportedEditorSchemaVersionError,
  getFormatPreset,
  newEditorDoc,
  parseEditorDoc,
} from '@baxter/domain';
import {
  getEditorPublication,
  insertEditorDocumentIfAbsent,
  saveEditorDocumentConditional,
  type EditorPublicationRow,
} from '@/lib/editor/db';

/**
 * Editor document persistence (Native Publishing, Slice A).
 *
 * POST — create-if-absent initialization. Explicitly not a side effect of the
 *   page's GET: the island calls this once when it loads a publication that
 *   has no document yet. Race-safe: ON CONFLICT DO NOTHING + re-select, so
 *   two tabs opening the same first-time publication converge on one row.
 *
 * PUT — the autosave write. Conditional on the base revision (optimistic
 *   concurrency): a stale base gets 409 + the server revision, never
 *   last-write-wins. The document is re-validated with zod before the write,
 *   and schema_version is derived from the validated document — a client
 *   cannot claim a version separately from the bytes.
 *
 * Status contract: 401 signed out · 404 not found / not owner · 423 the
 * publication left the editable window (draft/revisions) · 400 malformed or
 * unsupported document · 409 revision conflict. RLS enforces the same
 * boundaries underneath; these checks make the answers explicit and typed.
 */

const SaveBody = z.object({
  doc: z.unknown(),
  baseRevision: z.number().int().min(0),
  clientId: z.string().uuid(),
});

/**
 * Bounded body read (hardening item 3). The limit is enforced on the bytes
 * actually consumed from the stream — a Content-Length header is honoured as
 * a fast-path reject when truthfully large, but its absence or dishonesty
 * (chunked delivery) cannot bypass the cap: reading stops and the request is
 * refused the moment the running total crosses MAX_BODY_BYTES. Oversized
 * input (413) is distinguished from malformed JSON (400).
 */
const MAX_BODY_BYTES = 1_000_000;

type BoundedRead =
  | { ok: true; json: unknown }
  | { ok: false; reason: 'too-large' | 'malformed' };

async function readBoundedJson(req: NextRequest): Promise<BoundedRead> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, reason: 'too-large' };
  }
  const body = req.body;
  if (!body) return { ok: false, reason: 'malformed' };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, reason: 'too-large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  try {
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
    return { ok: true, json: JSON.parse(new TextDecoder().decode(buf)) };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

type AuthedContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  publication: EditorPublicationRow;
};

async function authorize(
  publicationId: string
): Promise<AuthedContext | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ message: 'Sign in first.' }, { status: 401 });
  }

  const publication = await getEditorPublication(supabase, publicationId);
  if (!publication || publication.creator_id !== user.id) {
    return NextResponse.json({ message: 'Publication not found.' }, { status: 404 });
  }

  if (publication.status !== 'draft' && publication.status !== 'revisions') {
    return NextResponse.json(
      {
        message:
          'This publication is out of your hands right now — editing reopens if Baxter returns it.',
      },
      { status: 423 }
    );
  }

  return { supabase, userId: user.id, publication };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: publicationId } = await params;
  const ctx = await authorize(publicationId);
  if (ctx instanceof NextResponse) return ctx;

  const preset = ctx.publication.format_preset_id
    ? getFormatPreset(ctx.publication.format_preset_id)
    : undefined;
  if (!preset) {
    return NextResponse.json(
      {
        message:
          'This publication has no format preset, so the editor cannot lay out its pages.',
      },
      { status: 400 }
    );
  }

  const doc = newEditorDoc(preset);
  const { row, insertError } = await insertEditorDocumentIfAbsent(
    ctx.supabase,
    publicationId,
    doc,
    doc.schemaVersion,
    ctx.userId
  );
  if (insertError || !row) {
    console.error('editor init: insert failed', {
      publicationId,
      error: insertError,
    });
    return NextResponse.json(
      { message: 'Something prevented the document from being created.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ doc: row.doc, revision: row.revision });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: publicationId } = await params;
  const ctx = await authorize(publicationId);
  if (ctx instanceof NextResponse) return ctx;

  const read = await readBoundedJson(req);
  if (!read.ok) {
    if (read.reason === 'too-large') {
      return NextResponse.json(
        { message: 'That save is too large for a single request.' },
        { status: 413 }
      );
    }
    return NextResponse.json({ message: 'The request could not be read.' }, { status: 400 });
  }
  const body = SaveBody.safeParse(read.json);
  if (!body.success) {
    return NextResponse.json({ message: 'Missing fields.' }, { status: 400 });
  }

  let doc;
  try {
    doc = parseEditorDoc(body.data.doc);
  } catch (err) {
    if (err instanceof UnsupportedEditorSchemaVersionError) {
      return NextResponse.json(
        { message: 'This document was written by a newer editor.' },
        { status: 400 }
      );
    }
    if (err instanceof EditorDocParseError) {
      return NextResponse.json(
        { message: 'The document did not validate.' },
        { status: 400 }
      );
    }
    throw err;
  }

  const result = await saveEditorDocumentConditional(ctx.supabase, {
    publicationId,
    doc,
    schemaVersion: doc.schemaVersion,
    baseRevision: body.data.baseRevision,
    userId: ctx.userId,
    clientId: body.data.clientId,
  });

  switch (result.outcome) {
    case 'saved':
      return NextResponse.json({ revision: result.revision });
    case 'conflict':
      return NextResponse.json(
        {
          message: 'This publication was edited somewhere else.',
          serverRevision: result.serverRevision,
        },
        { status: 409 }
      );
    case 'missing':
      return NextResponse.json(
        { message: 'The document has not been created yet.' },
        { status: 404 }
      );
    case 'error':
      console.error('editor save: update failed', {
        publicationId,
        error: result.message,
      });
      return NextResponse.json(
        { message: 'Something prevented the document from being saved.' },
        { status: 500 }
      );
  }
}
