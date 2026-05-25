-- =============================================================================
-- Slice 3a — every user is a creator by default.
--
-- The original plan (docs/implementation-plan.md §4) intended users to default
-- to creator+buyer. The 0001 auth trigger diverged and inserted 'reader'. This
-- migration restores the original intent: 'creator' is the default, existing
-- 'reader' rows are backfilled, and the trigger is rewritten to match. Admin
-- remains the only meaningful elevated role; the role check in
-- publications_insert_own becomes a redundant guard, kept for defence in depth.
-- =============================================================================

UPDATE public.users SET role = 'creator' WHERE role = 'reader';

ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'creator';

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, handle, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    '~pending-' || replace(NEW.id::text, '-', ''),
    coalesce(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'creator'
  );
  RETURN NEW;
END;
$$;
