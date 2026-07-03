-- =============================================================================
-- Slice 7 — Editor's Picks (D-023 storage, D-025 timeline)
--
-- Adds `editor_pick_at` to publications: the timestamp at which an editor
-- selected the work as a Pick. NULL means "not picked". Non-null means
-- "picked, at this time".
--
-- A timestamp, not a boolean, is deliberate (D-025): Editor's Picks is an
-- editorial *timeline*, not a flag. Ordering by `editor_pick_at desc` yields the
-- current Picks shelf today and supports future "Recently selected / Current /
-- Past picks" views with no further schema change.
--
-- Picking is an EDITORIAL act (D-024 — the Editor's voice). The column is
-- written ONLY by an admin: the existing `publications_update_admin` RLS policy
-- already permits admin updates, and the app writes it via the service-role
-- client after re-verifying the admin role (consistent with Slice 6). There is
-- deliberately no creator-writable path — a creator cannot pick their own work.
--
-- Hand-written and committed to source control, consistent with 0001–0003.
-- Apply via psql or the Supabase SQL editor.
-- =============================================================================

ALTER TABLE public.publications
  ADD COLUMN IF NOT EXISTS editor_pick_at timestamptz;

-- Partial index: the Picks shelf queries only non-null rows, ordered by the
-- pick time. Keeps that read cheap as the catalogue grows.
CREATE INDEX IF NOT EXISTS publications_editor_pick_at_idx
  ON public.publications (editor_pick_at DESC)
  WHERE editor_pick_at IS NOT NULL;
