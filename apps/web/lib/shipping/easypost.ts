/**
 * EasyPost shipping provider (D-030) — the first (and initially only) provider.
 *
 * One API, 100+ carriers (Canada Post, UPS, Purolator, FedEx, DHL, …). Chosen
 * over a direct carrier integration because Baxter is a platform — the same
 * reasoning as Stripe over Visa. Plain REST (no SDK dependency), env-driven, and
 * a no-op without a key so checkout builds and runs before EasyPost is set up.
 *
 * EasyPost rates in ounces/inches; we convert from the estimator's metric
 * parcel. Auth is HTTP Basic with the API key as the username.
 */
import type {
  Parcel,
  ShippingAddress,
  ShippingProvider,
  ShippingQuote,
} from './provider';

const API = 'https://api.easypost.com/v2/shipments';

function toAddress(a: ShippingAddress) {
  return {
    name: a.name ?? undefined,
    street1: a.line1,
    street2: a.line2 ?? undefined,
    city: a.city,
    state: a.province ?? undefined,
    zip: a.postalCode,
    country: a.country,
    phone: a.phone ?? undefined,
  };
}

function toParcel(p: Parcel) {
  const gToOz = (g: number) => Math.max(0.1, Math.round((g / 28.3495) * 10) / 10);
  const mmToIn = (mm: number) => Math.max(0.1, Math.round((mm / 25.4) * 10) / 10);
  return {
    length: mmToIn(p.lengthMm),
    width: mmToIn(p.widthMm),
    height: mmToIn(p.heightMm),
    weight: gToOz(p.weightGrams),
  };
}

export class EasyPostProvider implements ShippingProvider {
  readonly name = 'easypost';

  configured(): boolean {
    return Boolean(process.env.EASYPOST_API_KEY);
  }

  async quote(input: {
    from: ShippingAddress;
    to: ShippingAddress;
    parcel: Parcel;
  }): Promise<ShippingQuote[]> {
    const key = process.env.EASYPOST_API_KEY;
    if (!key) return [];

    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shipment: {
            to_address: toAddress(input.to),
            from_address: toAddress(input.from),
            parcel: toParcel(input.parcel),
          },
        }),
      });
      if (!res.ok) {
        console.error('easypost quote failed', { status: res.status });
        return [];
      }
      const data = (await res.json()) as {
        rates?: Array<{
          carrier?: string;
          service?: string;
          rate?: string;
          currency?: string;
          delivery_days?: number | null;
        }>;
      };
      return (data.rates ?? [])
        .map((r) => ({
          carrier: r.carrier ?? 'Carrier',
          service: r.service ?? 'Standard',
          amountMinor: Math.round(parseFloat(r.rate ?? '0') * 100),
          currency: (r.currency ?? 'CAD').toUpperCase(),
          estimatedDeliveryDays: r.delivery_days ?? null,
        }))
        .filter((q) => q.amountMinor > 0);
    } catch (err) {
      console.error('easypost quote error', { error: String(err) });
      return [];
    }
  }
}
