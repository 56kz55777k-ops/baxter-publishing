-- =============================================================================
-- 0007 — Native Publishing: editor_documents
--
-- One row per publication: the editor's scene graph (jsonb), a monotonically
-- increasing revision for optimistic concurrency, and diagnostic autosave
-- metadata. Specified by native-publishing-production-implementation-handoff.md
-- (Part 5) as amended by native-publishing-slice-a-blueprint.md (§2.1); the
-- doc shape is validated by zod in @baxter/domain (editor/document.ts) — the
-- save route re-parses before every write, so the database stores only
-- documents the domain schema accepted.
--
-- Hand-written and applied via the Supabase SQL editor, per the house
-- convention (see 0001). Drizzle does not manage this table's DDL or RLS;
-- packages/db/src/schema.ts documents the shape for reference only. Do not
-- run drizzle-kit generate against this migration; the journal is not updated.
--
-- Idempotent: safe to apply repeatedly (IF NOT EXISTS + drop-and-recreate
-- policies/trigger). ADDITIVE ONLY: creates one table and its policies;
-- no existing table, policy, or function is altered.
--
-- Rollback: DROP TABLE public.editor_documents CASCADE;
--   (removes the table, its policies and trigger; touches nothing else).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.editor_documents (
  publication_id uuid PRIMARY KEY
    REFERENCES public.publications(id) ON DELETE CASCADE,
  -- The scene graph. Self-describing: carries schemaVersion inside.
  doc            jsonb        NOT NULL,
  -- Mirror of doc->>'schemaVersion', derived server-side on every write
  -- (never accepted separately from a client). For fleet queries/migrations.
  schema_version integer      NOT NULL DEFAULT 1,
  -- Optimistic concurrency: increments on every accepted save. Writers UPDATE
  -- ... WHERE revision = <base revision>; zero rows updated = 409 conflict.
  revision       integer      NOT NULL DEFAULT 0,
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  updated_by     uuid         REFERENCES public.users(id),
  -- Diagnostics only ({ lastClientId, lastSavedAt }); never authority.
  autosave_state jsonb
);

ALTER TABLE public.editor_documents ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Policies. Deny-by-default; the editable window mirrors
-- publications_update_own_draft exactly: creators write only while their
-- publication is in draft or revisions. Admin access follows the house
-- pattern — the service-role client behind explicit in-code guards — so no
-- broad admin client policies are granted here beyond read.
--
-- RLS is defence in depth: the save route independently re-checks ownership
-- and the editable window before writing.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS editor_documents_select_owner_or_admin ON public.editor_documents;
CREATE POLICY editor_documents_select_owner_or_admin
  ON public.editor_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.publications p
      WHERE p.id = editor_documents.publication_id
        AND (p.creator_id = auth.uid() OR public.current_user_role() = 'admin')
    )
  );

DROP POLICY IF EXISTS editor_documents_insert_own_editable ON public.editor_documents;
CREATE POLICY editor_documents_insert_own_editable
  ON public.editor_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.publications p
      WHERE p.id = editor_documents.publication_id
        AND p.creator_id = auth.uid()
        AND p.status IN ('draft', 'revisions')
    )
  );

DROP POLICY IF EXISTS editor_documents_update_own_editable ON public.editor_documents;
CREATE POLICY editor_documents_update_own_editable
  ON public.editor_documents FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.publications p
      WHERE p.id = editor_documents.publication_id
        AND p.creator_id = auth.uid()
        AND p.status IN ('draft', 'revisions')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.publications p
      WHERE p.id = editor_documents.publication_id
        AND p.creator_id = auth.uid()
        AND p.status IN ('draft', 'revisions')
    )
  );

-- No client DELETE policy — the document lives and dies with its publication
-- (ON DELETE CASCADE); any other removal is a server/admin operation.

-- -----------------------------------------------------------------------------
-- updated_at is stamped by the database, not trusted from writers.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editor_documents_touch_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS editor_documents_touch_updated_at ON public.editor_documents;
CREATE TRIGGER editor_documents_touch_updated_at
  BEFORE UPDATE ON public.editor_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.editor_documents_touch_updated_at();
