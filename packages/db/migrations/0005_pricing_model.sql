-- =============================================================================
-- Slice 9 — pricing model + order economics (D-028 / D-029 / D-030)
--
-- Baxter earns by manufacturing, not commission. Retail is built up from
-- production: print cost + Baxter margin + creator earnings. Shipping is a
-- separate live system (D-030) and stays in the existing `shipping_minor`.
--
-- Additive and idempotent, consistent with 0001–0004. Apply via psql or the
-- Supabase SQL editor.
-- =============================================================================

-- Interior (Black & White / Colour) is an EXPLICIT publication property (D-029),
-- never inferred from format. Authoritative for both the estimator and the
-- printer. Backfill existing rows to 'colour' — the fail-safe default: worst
-- case overprices a mono book (recoverable, creator-correctable), whereas
-- guessing mono could underprice a colour book below its production cost.
ALTER TABLE public.publications
  ADD COLUMN IF NOT EXISTS interior text;

UPDATE public.publications
  SET interior = 'colour'
  WHERE interior IS NULL;

-- Order economics snapshot (immutable at purchase; rate cards change over time).
--   print_cost_minor      — Baxter's production cost (paid to the printer)
--   creator_earnings_minor — the creator's take, transferred at fulfilment
--   is_test_print         — a creator's own proof: cost-only, no margin, no transfer
-- NOTE: platform_fee_minor is REPURPOSED as the Baxter production margin
-- (semantic change, no column change). subtotal_minor/total_minor now carry the
-- built-up retail (+ shipping for total).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS print_cost_minor integer NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS creator_earnings_minor integer NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_test_print boolean NOT NULL DEFAULT false;
