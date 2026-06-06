-- =============================================================================
-- Slice 3b — preflight status + format identity
--
-- Adds the preflight lifecycle status as a first-class, typed column on
-- artifacts (Decision D-012 / D-000): a file is `pending`, `passed`, or
-- `failed`. The detailed check output (blockers, warnings, measurements)
-- continues to live in the `preflight` jsonb; only the lifecycle status is
-- promoted to a column, because it gates promotion now and will gate the
-- admin/review queue later, and must be queryable and typed.
--
-- Also records which format preset a publication was created against, so the
-- preflight worker can resolve page-count bounds and the multiple-of-four
-- rule without inferring them from trim dimensions.
--
-- Hand-written and committed to source control, consistent with 0001/0002.
-- Apply via psql or the Supabase SQL editor.
--
-- IMPORTANT: artifacts.preflight_status is written ONLY by the server
-- (the Inngest preflight worker, via the service-role client). There is no
-- client RLS UPDATE policy on artifacts by design — a creator must not be
-- able to set their own file to `passed` and bypass the check.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- preflight_status enum
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'preflight_status') THEN
    CREATE TYPE preflight_status AS ENUM ('pending', 'passed', 'failed');
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- artifacts.preflight_status — defaults to 'pending' for new uploads and any
-- existing rows (which predate preflight and have not been checked).
-- -----------------------------------------------------------------------------
ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS preflight_status preflight_status NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS artifacts_preflight_status_idx
  ON public.artifacts (preflight_status);

-- -----------------------------------------------------------------------------
-- publications.format_preset_id — the @baxter/domain preset id the work was
-- created against (e.g. 'zine_a5'). Nullable: older rows are backfilled below
-- by matching trim dimensions; rows that match nothing stay null and the
-- worker falls back to generic rules.
-- -----------------------------------------------------------------------------
ALTER TABLE public.publications
  ADD COLUMN IF NOT EXISTS format_preset_id text;

-- Best-effort backfill of existing rows from their stored trim dimensions.
UPDATE public.publications
  SET format_preset_id = 'zine_a5'
  WHERE format_preset_id IS NULL AND trim_width_mm = 148 AND trim_height_mm = 210;

UPDATE public.publications
  SET format_preset_id = 'magazine_a4'
  WHERE format_preset_id IS NULL AND trim_width_mm = 210 AND trim_height_mm = 297;

UPDATE public.publications
  SET format_preset_id = 'photobook_square_210'
  WHERE format_preset_id IS NULL AND trim_width_mm = 210 AND trim_height_mm = 210;
