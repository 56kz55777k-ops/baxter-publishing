/**
 * Production margin configuration (D-029). Baxter's margin is a business dial,
 * not a constant baked into the code — so it lives in the environment and is
 * resolved here. Absent/invalid → the domain default (30%). Basis points, so
 * `3000` = 30%.
 */
import { DEFAULT_PRODUCTION_MARGIN_BPS } from '@baxter/domain';

export function productionMarginBps(): number {
  const raw = process.env.PRODUCTION_MARGIN_BPS;
  if (!raw) return DEFAULT_PRODUCTION_MARGIN_BPS;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_PRODUCTION_MARGIN_BPS;
}
