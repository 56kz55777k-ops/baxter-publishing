-- =============================================================================
-- Slice 9 — shipping details on orders (D-030)
--
-- Logistics is a separate system from Commerce. When a live carrier rate is
-- selected at checkout, the chosen service is captured ON THE ORDER so it is
-- available forever for reconciliation, support, fulfilment, and future
-- tracking — independent of any later provider call. The postage cost itself
-- already lives in `shipping_minor` (pass-through; Baxter earns nothing on it).
--
-- Null until EasyPost is enabled (D-030): every surface omits shipping detail
-- when absent rather than inventing one. Additive and idempotent.
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_carrier text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_service text;

-- Human-readable estimate, e.g. '3 business days'. Text (not an int) so a
-- provider that returns a date range fits without another migration.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_estimated_delivery text;
