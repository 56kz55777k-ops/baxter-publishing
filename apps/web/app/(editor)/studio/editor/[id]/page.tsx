import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getEditorDocumentRow, getEditorPublication } from '@/lib/editor/db';
import { EditorGate } from './editor-gate';

/**
 * The editor route (Native Publishing, Slice A).
 *
 * Server component: authenticates through the house Supabase pattern,
 * verifies ownership, loads the publication and any existing editor document,
 * and hands both to the client gate as props (amendment A2 — no GET
 * endpoint, and no database writes on a GET: first-time initialization is an
 * explicit POST from the island).
 *
 * Outside the editable window the island is never loaded — the situation
 * screen renders server-side with zero editor JavaScript.
 *
 * Discovery is feature-flagged (the workspace link); ACCESS is gated by
 * ownership + status here, flag or no flag (DoD F9).
 */

export const metadata = {
  title: 'Editor — Baxter',
};

const STATUS_LINE: Record<string, string> = {
  in_review: 'Baxter is reviewing this publication. Editing reopens if it returns with notes.',
  published: 'This publication is published. It is out of the editing window.',
  unpublished: 'This publication is unpublished and out of the editing window.',
  archived: 'This publication is archived.',
};

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const publication = await getEditorPublication(supabase, id);
  if (!publication || publication.creator_id !== user.id) notFound();

  const editable = publication.status === 'draft' || publication.status === 'revisions';
  if (!editable) {
    return (
      <main className="flex h-dvh items-center justify-center bg-canvas px-8">
        <div className="max-w-measure">
          <p className="metadata text-ink-faint mb-4">Editor</p>
          <h1 className="font-serif text-h2 leading-tight">Editing is closed for now.</h1>
          <p className="font-serif text-body text-ink-soft mt-6">
            {STATUS_LINE[publication.status] ?? 'This publication is out of the editing window.'}
          </p>
          <p className="mt-8">
            <Link
              href={`/studio/publications/${publication.id}`}
              className="metadata text-accent underline underline-offset-4 hover:text-ink transition-colors duration-400 ease-gentle"
            >
              Back to the workspace
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const docRow = await getEditorDocumentRow(supabase, id);

  return (
    <EditorGate
      publicationId={publication.id}
      title={publication.title}
      docRow={docRow ? { doc: docRow.doc, revision: docRow.revision } : null}
    />
  );
}
