/**
 * Shipping entry point (D-030). One place to get the active provider and to ask
 * for the cheapest live rate. Swapping providers (or adding an aggregator's
 * extra carriers) never touches checkout.
 */
import type { Parcel, ShippingAddress, ShippingQuote } from './provider';
import { EasyPostProvider } from './easypost';

export type { Parcel, ShippingAddress, ShippingQuote } from './provider';

/** The active provider. Swap here to change carriers/aggregators. */
export function getShippingProvider() {
  return new EasyPostProvider();
}

export function shippingConfigured(): boolean {
  return getShippingProvider().configured();
}

/**
 * Ship-from origin — the printer's location (MGS Marketing, Toronto). Env-
 * overridable; the placeholder stands until the MGS address is confirmed. Only
 * the postal code + country materially affect a rate, so this is enough to quote.
 */
export const SHIP_FROM: ShippingAddress = {
  name: process.env.SHIP_FROM_NAME ?? 'MGS Marketing',
  line1: process.env.SHIP_FROM_LINE1 ?? '1 Yonge Street',
  city: process.env.SHIP_FROM_CITY ?? 'Toronto',
  province: process.env.SHIP_FROM_PROVINCE ?? 'ON',
  postalCode: process.env.SHIP_FROM_POSTAL ?? 'M5E 1E5',
  country: process.env.SHIP_FROM_COUNTRY ?? 'CA',
};

/**
 * Quote shipping and return the **cheapest** live rate (v1 default; buyer
 * service selection is deferred — D-030). Returns null when shipping is
 * unconfigured or no rate is available, so checkout can proceed (shipping is
 * finalised once EasyPost is live).
 */
export async function quoteCheapestShipping(
  to: ShippingAddress,
  parcel: Parcel
): Promise<ShippingQuote | null> {
  const provider = getShippingProvider();
  if (!provider.configured()) return null;
  const rates = await provider.quote({ from: SHIP_FROM, to, parcel });
  if (rates.length === 0) return null;
  return rates.reduce((cheapest, r) =>
    r.amountMinor < cheapest.amountMinor ? r : cheapest
  );
}
