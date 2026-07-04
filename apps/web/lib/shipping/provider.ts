/**
 * Shipping — the logistics system (D-030), separate from production and commerce.
 *
 * A provider-agnostic interface. Checkout consumes `ShippingProvider`; the
 * concrete provider (EasyPost first) is swappable and adding carriers later is a
 * provider change, not a checkout change. Postage is pass-through — Baxter earns
 * nothing on it; the quote is the carrier's actual rate.
 */

export interface ShippingAddress {
  name?: string;
  line1: string;
  line2?: string | null;
  city: string;
  /** State/province code where applicable. */
  province?: string | null;
  postalCode: string;
  /** ISO 2-letter country (e.g. 'CA', 'US'). */
  country: string;
  phone?: string | null;
}

/** A parcel, in metric — the production estimator's output (D-029/D-030). */
export interface Parcel {
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

export interface ShippingQuote {
  carrier: string;
  service: string;
  amountMinor: number;
  currency: string;
  estimatedDeliveryDays?: number | null;
}

export interface ShippingProvider {
  readonly name: string;
  /** True when the provider is configured (has credentials). */
  configured(): boolean;
  /** Return all available rates for the parcel between the two addresses.
   *  Returns [] when unconfigured or on any error (never throws). */
  quote(input: {
    from: ShippingAddress;
    to: ShippingAddress;
    parcel: Parcel;
  }): Promise<ShippingQuote[]>;
}
