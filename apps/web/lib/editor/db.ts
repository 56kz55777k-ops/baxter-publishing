/**
 * Typed row access for `editor_documents` over the RLS Supabase client.
 *
 * The app's data layer is Supabase-JS (the Drizzle schema is documentation —
 * see packages/db/src/schema.ts); these helpers keep the route handler and
 * the editor page reading the same shapes. RLS is defence in depth here:
 * callers still re-check ownership and the editable window explicitly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface EditorDocumentRow {
  publication_id: string;
  doc: unknown;
  schema_version: number;
  revision: number;
  updated_at: string;
  updated_by: string | null;
}

export interface EditorPublicationRow {
  id: string;
  creator_id: string;
  status: string;
  format_preset_id: string | null;
  title: string;
}

const DOC_COLUMNS = 'publication_id, doc, schema_version, revision, updated_at, updated_by';

export async function getEditorPublication(
  supabase: SupabaseClient,
  publicationId: string
): Promise<EditorPublicationRow | null> {
  const { data } = await supabase
    .from('publications')
    .select('id, creator_id, status, format_preset_id, title')
    .eq('id', publicationId)
    .maybeSingle();
  return (data as EditorPublicationRow | null) ?? null;
}

export async function getEditorDocumentRow(
  supabase: SupabaseClient,
  publicationId: string
): Promise<EditorDocumentRow | null> {
  const { data } = await supabase
    .from('editor_documents')
    .select(DOC_COLUMNS)
    .eq('publication_id', publicationId)
    .maybeSingle();
  return (data as EditorDocumentRow | null) ?? null;
}

/**
 * Insert the initial row if none exists; converge on the surviving row either
 * way. `ignoreDuplicates` maps to ON CONFLICT DO NOTHING on the primary key,
 * so two tabs racing the first open both end up reading the same document.
 */
export async function insertEditorDocumentIfAbsent(
  supabase: SupabaseClient,
  publicationId: string,
  doc: unknown,
  schemaVersion: number,
  userId: string
): Promise<{ row: EditorDocumentRow | null; insertError: string | null }> {
  const { error } = await supabase.from('editor_documents').upsert(
    {
      publication_id: publicationId,
      doc,
      schema_version: schemaVersion,
      revision: 0,
      updated_by: userId,
    },
    { onConflict: 'publication_id', ignoreDuplicates: true }
  );
  // A duplicate is not an error under ignoreDuplicates; anything else is.
  if (error) return { row: null, insertError: error.message };
  const row = await getEditorDocumentRow(supabase, publicationId);
  return { row, insertError: null };
}

/**
 * The conditional revision write. Zero rows updated means the base revision
 * is stale (another writer won) — the caller turns that into a 409 with the
 * current server revision. Never last-write-wins.
 */
export async function saveEditorDocumentConditional(
  supabase: SupabaseClient,
  args: {
    publicationId: string;
    doc: unknown;
    schemaVersion: number;
    baseRevision: number;
    userId: string;
    clientId: string;
  }
): Promise<
  | { outcome: 'saved'; revision: number }
  | { outcome: 'conflict'; serverRevision: number | null }
  | { outcome: 'missing' }
  | { outcome: 'error'; message: string }
> {
  const { data, error } = await supabase
    .from('editor_documents')
    .update({
      doc: args.doc,
      schema_version: args.schemaVersion,
      revision: args.baseRevision + 1,
      updated_by: args.userId,
      autosave_state: {
        lastClientId: args.clientId,
        lastSavedAt: new Date().toISOString(),
      },
    })
    .eq('publication_id', args.publicationId)
    .eq('revision', args.baseRevision)
    .select('revision');

  if (error) return { outcome: 'error', message: error.message };
  if (data && data.length > 0) {
    return { outcome: 'saved', revision: (data[0] as { revision: number }).revision };
  }

  // Nothing matched: stale base revision, or no row at all.
  const current = await getEditorDocumentRow(supabase, args.publicationId);
  if (!current) return { outcome: 'missing' };
  return { outcome: 'conflict', serverRevision: current.revision };
}
