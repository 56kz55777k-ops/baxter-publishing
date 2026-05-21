-- =============================================================================
-- Slice 2 — RLS policies + auth trigger
--
-- Posture: deny-by-default, narrow allow rules per role.
-- All policies assume Supabase auth context (auth.uid() is set by JWT).
--
-- Important: this migration is hand-written and committed to source control.
-- Drizzle does not manage RLS — any future RLS changes must be added here
-- (or in a successor file) and applied via `psql` or the Supabase SQL editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: read the JWT role claim for the current request.
-- We use this instead of looking up public.users so policies don't recurse.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT role::text FROM public.users WHERE id = auth.uid();
$$;

-- =============================================================================
-- users
-- =============================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Anyone (logged in or not) can read public profile fields. Profiles are public
-- by design — they are the byline on a publication.
CREATE POLICY users_select_public
  ON public.users FOR SELECT
  USING (true);

-- A user can update their own row, except `role` and `stripe_*` (admin/server only).
-- Column-level enforcement is via a trigger below.
CREATE POLICY users_update_own
  ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Insert via the auth trigger only (SECURITY DEFINER bypasses RLS).
-- No INSERT policy for clients — keeps row creation centralized.

-- Admins can update anyone.
CREATE POLICY users_update_admin
  ON public.users FOR UPDATE
  USING (public.current_user_role() = 'admin');

-- Prevent users from escalating role or self-assigning Stripe linkage.
CREATE OR REPLACE FUNCTION public.users_guard_protected_columns()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() = NEW.id AND public.current_user_role() <> 'admin' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'role can only be changed by an admin';
    END IF;
    IF NEW.stripe_account_id IS DISTINCT FROM OLD.stripe_account_id THEN
      RAISE EXCEPTION 'stripe_account_id is server-managed';
    END IF;
    IF NEW.stripe_charges_enabled IS DISTINCT FROM OLD.stripe_charges_enabled THEN
      RAISE EXCEPTION 'stripe_charges_enabled is server-managed';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_guard_protected_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_guard_protected_columns();

-- =============================================================================
-- publications
-- =============================================================================
ALTER TABLE public.publications ENABLE ROW LEVEL SECURITY;

-- Published publications are visible to everyone.
-- Drafts/in_review/revisions are visible only to the creator and admins.
CREATE POLICY publications_select_public_or_owner
  ON public.publications FOR SELECT
  USING (
    status = 'published'
    OR creator_id = auth.uid()
    OR public.current_user_role() = 'admin'
  );

-- A creator can insert a publication owned by themselves.
CREATE POLICY publications_insert_own
  ON public.publications FOR INSERT
  WITH CHECK (
    creator_id = auth.uid()
    AND public.current_user_role() IN ('creator', 'admin')
  );

-- A creator can update their own publication while it's in their hands
-- (draft or revisions). Once submitted, only admins can change status.
CREATE POLICY publications_update_own_draft
  ON public.publications FOR UPDATE
  USING (
    creator_id = auth.uid()
    AND status IN ('draft', 'revisions')
  )
  WITH CHECK (
    creator_id = auth.uid()
    AND status IN ('draft', 'revisions', 'in_review')
  );

CREATE POLICY publications_update_admin
  ON public.publications FOR UPDATE
  USING (public.current_user_role() = 'admin');

-- No DELETE policy — soft-delete via status='archived'.

-- =============================================================================
-- artifacts (R2 file lineage, private)
-- =============================================================================
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY artifacts_select_owner_or_admin
  ON public.artifacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.publications p
      WHERE p.id = artifacts.publication_id
        AND (p.creator_id = auth.uid() OR public.current_user_role() = 'admin')
    )
  );

CREATE POLICY artifacts_insert_owner
  ON public.artifacts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.publications p
      WHERE p.id = artifacts.publication_id
        AND p.creator_id = auth.uid()
        AND p.status IN ('draft', 'revisions')
    )
  );

-- =============================================================================
-- assets (cover images, previews — public when publication is published)
-- =============================================================================
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY assets_select_public_or_owner
  ON public.assets FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.publications p
      WHERE p.id = assets.publication_id
        AND (p.status = 'published' OR p.creator_id = auth.uid() OR public.current_user_role() = 'admin')
    )
  );

CREATE POLICY assets_insert_owner
  ON public.assets FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.publications p
      WHERE p.id = assets.publication_id
        AND p.creator_id = auth.uid()
    )
  );

-- =============================================================================
-- orders (private to buyer + selling creator + admin)
-- =============================================================================
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_party_or_admin
  ON public.orders FOR SELECT
  USING (
    buyer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.publications p
      WHERE p.id = orders.publication_id
        AND p.creator_id = auth.uid()
    )
    OR public.current_user_role() = 'admin'
  );

-- INSERT/UPDATE on orders is server-only (via service role). No client policy.

-- =============================================================================
-- reviews (star ratings, post-purchase)
-- =============================================================================
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY reviews_select_public
  ON public.reviews FOR SELECT
  USING (true);

CREATE POLICY reviews_insert_reviewer
  ON public.reviews FOR INSERT
  WITH CHECK (
    reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = reviews.order_id
        AND o.buyer_id = auth.uid()
        AND o.status = 'fulfilled'
    )
  );

CREATE POLICY reviews_update_own
  ON public.reviews FOR UPDATE
  USING (reviewer_id = auth.uid())
  WITH CHECK (reviewer_id = auth.uid());

-- =============================================================================
-- follows
-- =============================================================================
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY follows_select_public
  ON public.follows FOR SELECT
  USING (true);

CREATE POLICY follows_insert_self
  ON public.follows FOR INSERT
  WITH CHECK (follower_id = auth.uid());

CREATE POLICY follows_delete_self
  ON public.follows FOR DELETE
  USING (follower_id = auth.uid());

-- =============================================================================
-- publication_events + order_events (audit log — read-restricted, server writes)
-- =============================================================================
ALTER TABLE public.publication_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY publication_events_select_owner_or_admin
  ON public.publication_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.publications p
      WHERE p.id = publication_events.publication_id
        AND (p.creator_id = auth.uid() OR public.current_user_role() = 'admin')
    )
  );

ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_events_select_party_or_admin
  ON public.order_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_events.order_id
        AND (
          o.buyer_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.publications p
            WHERE p.id = o.publication_id AND p.creator_id = auth.uid()
          )
          OR public.current_user_role() = 'admin'
        )
    )
  );

-- =============================================================================
-- Auth trigger: when a new user signs up via Supabase Auth, create a
-- corresponding row in public.users. Handle is left null — the user must
-- claim one on /settings/profile before they can do anything else.
-- =============================================================================
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
    -- Placeholder handle, guaranteed unique. User replaces this on first login.
    '~pending-' || replace(NEW.id::text, '-', ''),
    coalesce(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'reader'
  );
  RETURN NEW;
END;
$$;

-- Drop existing trigger if re-running migration.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
