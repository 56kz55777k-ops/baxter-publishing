/**
 * Production estimator — the single source of truth for print economics (D-029).
 *
 * Pure: no I/O, no Stripe, no carriers. Everything that needs to know what a
 * publication costs to make, what it retails for, or how much it weighs asks
 * *this one function*. There is no duplicated pricing math anywhere.
 *
 * Money model (D-028): retail is built up from production, not skimmed from the
 * creator — `retail = printCost + baxterMargin + creatorEarnings`, where the
 * margin is a configurable share of the print cost (Baxter's only revenue) and
 * `creatorEarnings` is what the creator sets ("your earnings per copy"). A test
 * print passes `marginBps: 0` and `creatorEarningsMinor: 0` — production cost
 * only (D-028: Baxter earns when creators sell, not when they proof).
 *
 * Shipping is NOT here (D-030): logistics is a separate system. But production
 * *owns the parcel* — this returns the estimated weight + dimensions that the
 * shipping provider consumes.
 *
 * All money is integer minor units (cents). Estimates only — the printer's
 * invoice is the source of truth; surfaces must say "Estimated production cost".
 */
import { getFormatPreset } from './formats';

/** Default Baxter production margin (basis points). Configurable via the app
 *  layer (env) and passed in; this is only the fallback. */
export const DEFAULT_PRODUCTION_MARGIN_BPS = 3000; // 30%

export type Interior = 'mono' | 'colour';

/**
 * Placeholder short-run / on-demand print rates (CAD minor units), keyed by
 * format preset. Calibrate to MGS Marketing (Toronto) — swapping these is a
 * one-place change; no consumer is affected.
 *
 * `printCost = base + pageCount × perPage(interior)`. Physical fields drive the
 * parcel estimate (weight from paper gsm; thickness from sheet caliper).
 */
interface ProductionRate {
  base: number;            // setup + binding + cover, per copy
  perPageMono: number;
  perPageColour: number;
  binding: string;         // human-readable, for the printer package
  paper: string;           // human-readable default stock
  textGsm: number;         // interior paper weight
  coverGsm: number;        // cover stock weight
  caliperMm: number;       // thickness of one interior sheet
}

const PRODUCTION_RATES: Record<string, ProductionRate> = {
  zine_a5: {
    base: 250,
    perPageMono: 4,
    perPageColour: 20,
    binding: 'Saddle-stitch',
    paper: '80lb uncoated text · 100lb cover',
    textGsm: 118,
    coverGsm: 270,
    caliperMm: 0.12,
  },
  magazine_a4: {
    base: 300,
    perPageMono: 6,
    perPageColour: 22,
    binding: 'Saddle-stitch',
    paper: '100lb coated text · 120lb cover',
    textGsm: 148,
    coverGsm: 324,
    caliperMm: 0.1,
  },
  photobook_square_210: {
    base: 550,
    perPageMono: 10,
    perPageColour: 42,
    binding: 'Perfect-bound',
    paper: '100lb coated art · 12pt cover',
    textGsm: 148,
    coverGsm: 324,
    caliperMm: 0.13,
  },
};

// Generic fallback when a preset has no explicit rate (keeps the estimator safe).
const FALLBACK_RATE: ProductionRate = {
  base: 300,
  perPageMono: 6,
  perPageColour: 25,
  binding: 'Perfect-bound',
  paper: 'Standard text · cover',
  textGsm: 148,
  coverGsm: 300,
  caliperMm: 0.12,
};

const PACKAGING_WEIGHT_G = 30;
const PACKAGING_THICKNESS_MM = 4;

export interface ProductionSpec {
  formatPresetId: string;
  pageCount: number;
  interior: Interior;
  /** Creator's earnings per copy (minor units). 0 for a test print. */
  creatorEarningsMinor: number;
  /** Baxter margin in basis points. Defaults to DEFAULT_PRODUCTION_MARGIN_BPS.
   *  Pass 0 for a test print (production cost only). */
  marginBps?: number;
  quantity?: number;
}

export interface ParcelDimensionsMm {
  length: number;
  width: number;
  height: number;
}

export interface ProductionEstimate {
  quantity: number;
  interior: Interior;
  binding: string;
  paper: string;
  /** Per-copy amounts. */
  printCostMinor: number;
  baxterMarginMinor: number;
  creatorEarningsMinor: number;
  retailMinor: number;
  /** Physical parcel for one copy — consumed by the shipping provider (D-030). */
  estimatedWeightGrams: number;
  parcelDimensionsMm: ParcelDimensionsMm;
}

/**
 * Estimate everything about producing one copy of a publication: cost, the
 * built-up retail price, and the physical parcel. Per-copy (quantity is carried
 * through for callers but pricing is per copy in v1).
 */
export function estimateProduction(spec: ProductionSpec): ProductionEstimate {
  const quantity = spec.quantity ?? 1;
  const pageCount = Math.max(1, Math.trunc(spec.pageCount || 0));
  const marginBps = spec.marginBps ?? DEFAULT_PRODUCTION_MARGIN_BPS;
  const rate = PRODUCTION_RATES[spec.formatPresetId] ?? FALLBACK_RATE;

  const perPage = spec.interior === 'colour' ? rate.perPageColour : rate.perPageMono;
  const printCostMinor = Math.round(rate.base + pageCount * perPage);
  const baxterMarginMinor = Math.round((printCostMinor * marginBps) / 10000);
  const creatorEarningsMinor = Math.max(0, Math.trunc(spec.creatorEarningsMinor || 0));
  const retailMinor = printCostMinor + baxterMarginMinor + creatorEarningsMinor;

  // Parcel — from the same spec inputs (production owns the physical object).
  const preset = getFormatPreset(spec.formatPresetId);
  const widthMm = preset ? preset.trimWidthMm : 148;
  const heightMm = preset ? preset.trimHeightMm : 210;
  const trimAreaM2 = (widthMm / 1000) * (heightMm / 1000);
  const sheets = Math.ceil(pageCount / 2);
  const textWeight = sheets * trimAreaM2 * rate.textGsm;
  const coverWeight = 2 * trimAreaM2 * rate.coverGsm; // front + back wrap
  const estimatedWeightGrams = Math.round(textWeight + coverWeight + PACKAGING_WEIGHT_G);

  const spineMm = sheets * rate.caliperMm;
  const parcelDimensionsMm: ParcelDimensionsMm = {
    length: Math.round(Math.max(widthMm, heightMm)),
    width: Math.round(Math.min(widthMm, heightMm)),
    height: Math.max(3, Math.round(spineMm + PACKAGING_THICKNESS_MM)),
  };

  return {
    quantity,
    interior: spec.interior,
    binding: rate.binding,
    paper: rate.paper,
    printCostMinor,
    baxterMarginMinor,
    creatorEarningsMinor,
    retailMinor,
    estimatedWeightGrams,
    parcelDimensionsMm,
  };
}
