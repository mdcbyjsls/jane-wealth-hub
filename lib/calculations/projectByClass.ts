/**
 * Per-class year-by-year growth with NO rebalancing — the data behind the Growth_By_Class_Area
 * (Spec 4 Visualization_Pass, R2.2, R2.5, R6.3).
 *
 * The Spec 2 projection blends the four classes into a single Blended_Expected_Return before
 * projecting, so a per-class series never exists. This module projects each Asset_Class
 * independently at its own Expected_Return, each starting from its own dollar basis, with zero
 * contribution — so the mix drifts apart over time as higher-return classes outgrow lower-return
 * ones. That drift is exactly the point of the chart.
 *
 * By design the sum across the four series is NOT equal to the blended base projection (which
 * assumes the mix stays constant); the view states this explicitly. The stacked area shows the
 * base scenario only — there are no per-band variants here.
 *
 * Pure and deterministic: dollars, a return model, and the current year in; a per-class map of
 * points out. It reuses the existing pure `projectSeries` and imports only types and that
 * calculator — nothing from `app/`, `components/`, or `lib/fred/`; no fetch, no `localStorage`, and
 * no clock (the caller supplies `currentYear`). It changes no existing calculation result.
 */

import type { AssetClass, ClassTotals } from '@/types/accounts';
import type { ProjectedPoint, ReturnModel } from '@/types/market';
import {
  ASSET_CLASS_KEYS,
  PROJECTION_MAX_YEARS,
  projectSeries,
} from '@/lib/calculations/projection';

/**
 * Projects each Asset_Class independently from its starting dollars at its own
 * `returnModel[class].returnPercent`, with zero annual contribution, over years 0..maxYears
 * (R2.5). Returns a `Record<AssetClass, ProjectedPoint[]>` whose every series has `maxYears + 1`
 * points (31 for the default 30-year horizon).
 *
 * Iterating via `ASSET_CLASS_KEYS` keeps the map exhaustive and the four series deterministic.
 * Each series is produced by the shared `projectSeries` with contribution 0, so year 0 equals that
 * class's starting dollars and each later year is the prior year grown by that class's rate — pure
 * compounding, no rebalancing between classes.
 *
 * Pure and deterministic: inputs in, numbers out — no fetch, no `localStorage`, no clock (the
 * caller supplies `currentYear`).
 */
export function projectByClass(
  classDollars: ClassTotals,
  returnModel: ReturnModel,
  currentYear: number,
  maxYears: number = PROJECTION_MAX_YEARS,
): Record<AssetClass, ProjectedPoint[]> {
  const series = {} as Record<AssetClass, ProjectedPoint[]>;

  for (const key of ASSET_CLASS_KEYS) {
    series[key] = projectSeries(
      classDollars[key],
      returnModel[key].returnPercent,
      0,
      currentYear,
      maxYears,
    );
  }

  return series;
}
