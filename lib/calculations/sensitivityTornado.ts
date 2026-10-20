/**
 * Two-sided sensitivity of the year-10 Buy − Rent gap to each editable assumption — the data behind
 * the Sensitivity_Tornado (Spec 4 Visualization_Pass, R2.3, R5.7).
 *
 * The Spec 3 `rankSensitivity` perturbs each assumption ONCE (a single up step) and records an
 * absolute magnitude. A tornado needs both a DOWN and an UP perturbation per assumption, the signed
 * year-10 gap at each end, and the actual input values used, so each bar can be labeled with the
 * range it explored. This module adds exactly that, reusing the Spec 3 `buildBands` so the gap is
 * computed identically to the rest of the view — no new comparison math.
 *
 * Pure and deterministic: numbers in, a plain array out. It imports only types and the pure Spec 3
 * calculator; no `app/`, `components/`, or `lib/fred/` imports; no fetch, no `localStorage`, no
 * clock. It changes no existing calculation result.
 */

import type { ScenarioMultipliers } from '@/types/market';
import type { BuyVsRentAssumptions, TornadoEntry } from '@/types/buyVsRent';
import { buildBands, COMPARISON_HORIZON, SENSITIVITY_STEP } from '@/lib/calculations/buyVsRent';

/**
 * The editable assumptions the tornado perturbs, in a FIXED order that doubles as the deterministic
 * tie-break (earlier wins on an exact `swing` tie), mirroring the Spec 3 `rankSensitivity` key set
 * and labels. Only scalar, path-affecting assumptions appear: the nested `multipliers` object has no
 * single relative step, and `cushionMonths` sizes only the cash-cushion threshold, not either
 * net-worth path, so neither is a tornado driver.
 */
const TORNADO_KEYS: readonly { key: keyof BuyVsRentAssumptions; label: string }[] = [
  { key: 'homePrice', label: 'Home price' },
  { key: 'downPaymentPercent', label: 'Down payment' },
  { key: 'mortgageRatePercent', label: 'Mortgage rate' },
  { key: 'mortgageTermYears', label: 'Mortgage term' },
  { key: 'propertyTaxRatePercent', label: 'Property tax rate' },
  { key: 'homeownersInsurance', label: 'Homeowners insurance' },
  { key: 'maintenanceRatePercent', label: 'Maintenance rate' },
  { key: 'hoaMonthly', label: 'HOA dues' },
  { key: 'closingCosts', label: 'Closing costs' },
  { key: 'sellingCostPercent', label: 'Selling cost' },
  { key: 'homeAppreciationRatePercent', label: 'Home appreciation rate' },
  { key: 'currentRentMonthly', label: 'Current rent' },
  { key: 'rentGrowthRatePercent', label: 'Rent growth rate' },
  { key: 'rentersInsurance', label: 'Renters insurance' },
];

/**
 * The per-assumption clamp bounds (Spec 3 R9.6): percentages that may go negative are bounded to
 * their documented ranges; every other assumption is a non-negative quantity bounded at 0. A
 * perturbation is clamped into these bounds so a down step never produces an invalid input (e.g. a
 * negative mortgage rate or a down payment over 100%). Keys absent here are simply bounded at ≥ 0.
 */
const BOUNDS: Partial<Record<keyof BuyVsRentAssumptions, { min: number; max: number }>> = {
  downPaymentPercent: { min: 0, max: 100 },
  mortgageRatePercent: { min: 0, max: 20 },
  homeAppreciationRatePercent: { min: -20, max: 20 },
  rentGrowthRatePercent: { min: -20, max: 20 },
};

/** Clamp a perturbed value into the assumption's documented bounds (default: ≥ 0). */
function clamp(key: keyof BuyVsRentAssumptions, value: number): number {
  const bound = BOUNDS[key];
  if (bound) {
    return Math.min(bound.max, Math.max(bound.min, value));
  }
  return Math.max(0, value);
}

/**
 * The year-10 base-band `Buy(10) − Rent(10)` gap for a given assumption set, computed via the Spec 3
 * `buildBands` exactly as `rankSensitivity`/`computeVerdict` define it, so the tornado is consistent
 * with the rest of the comparison.
 */
function year10Gap(
  assumptions: BuyVsRentAssumptions,
  startingAssetsTotal: number,
  baseReturnPercent: number,
  multipliers: ScenarioMultipliers,
): number {
  const bands = buildBands(assumptions, startingAssetsTotal, baseReturnPercent, multipliers);
  return bands.buy.base[COMPARISON_HORIZON] - bands.rent.base[COMPARISON_HORIZON];
}

/**
 * Computes the two-sided sensitivity of the year-10 Buy − Rent gap to each editable assumption
 * (R2.3, R5.7).
 *
 * For each assumption in the fixed `TORNADO_KEYS` order, its current value is scaled DOWN by
 * `(1 − SENSITIVITY_STEP)` and UP by `(1 + SENSITIVITY_STEP)`, each clamped to the assumption's
 * documented bounds, one assumption at a time with every other held fixed. The base-band year-10 gap
 * is recomputed at each end via `buildBands`, and the entry records the low/high input values, the
 * low/high gaps, the unperturbed `baseGap`, and `swing = |highGap − lowGap|`.
 *
 * Entries are sorted by `swing` descending, with the fixed `TORNADO_KEYS` order as the deterministic
 * tie-break (earlier assumption first), so the ranking is stable for identical inputs. The caller
 * takes the top N (the tornado shows the top 6).
 *
 * Pure and deterministic: numbers in, a plain array out — no fetch, no `localStorage`, no clock.
 */
export function computeTornado(
  assumptions: BuyVsRentAssumptions,
  startingAssetsTotal: number,
  baseReturnPercent: number,
  multipliers: ScenarioMultipliers,
): TornadoEntry[] {
  const baseGap = year10Gap(assumptions, startingAssetsTotal, baseReturnPercent, multipliers);

  const ranked: { order: number; entry: TornadoEntry }[] = TORNADO_KEYS.map(
    ({ key, label }, index) => {
      // Every TORNADO_KEYS entry is a numeric assumption (the nested `multipliers` object is
      // excluded), so the indexed value is always a number here even though the key type admits
      // the `ScenarioMultipliers` field.
      const currentValue = assumptions[key] as number;
      const lowInput = clamp(key, currentValue * (1 - SENSITIVITY_STEP));
      const highInput = clamp(key, currentValue * (1 + SENSITIVITY_STEP));

      const lowGap = year10Gap(
        { ...assumptions, [key]: lowInput },
        startingAssetsTotal,
        baseReturnPercent,
        multipliers,
      );
      const highGap = year10Gap(
        { ...assumptions, [key]: highInput },
        startingAssetsTotal,
        baseReturnPercent,
        multipliers,
      );

      return {
        order: index,
        entry: {
          key,
          label,
          lowInput,
          highInput,
          lowGap,
          highGap,
          baseGap,
          swing: Math.abs(highGap - lowGap),
        },
      };
    },
  );

  ranked.sort((a, b) => {
    const bySwing = b.entry.swing - a.entry.swing;
    if (bySwing !== 0) {
      return bySwing;
    }
    // Exact tie: preserve the fixed TORNADO_KEYS order — earlier assumption first.
    return a.order - b.order;
  });

  return ranked.map(({ entry }) => entry);
}
