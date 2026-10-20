/**
 * Projection_Calculator (pure module).
 *
 * Inputs in, numbers out. This module imports only from `@/types/accounts` (for `AssetClass`)
 * and `@/types/market` (for the market/return-model types). It imports nothing from `app/`,
 * `components/`, or `lib/fred/`, performs no data fetching, touches no `localStorage`, and never
 * reads the clock. Every time-dependent value — the current calendar year and all market and
 * assumption values — is passed in by the caller, so the same functions can run on the server
 * (first paint) and in the client island (recompute on edit) with identical, deterministic results.
 *
 * The module turns a starting invested value (the Projected_Base) plus a per-asset-class return
 * model into year-by-year scenario series. It mirrors the `allocation.ts` house style: a
 * file-level purity contract, shared constants, exhaustive iteration over the four
 * `ASSET_CLASS_KEYS`, and per-function JSDoc tagged with the requirement clauses it satisfies.
 */

import type { AssetClass } from '@/types/accounts';
import type {
  ClassReturn,
  MarketDataSnapshot,
  ProjectedPoint,
  ReturnAssumptions,
  ReturnModel,
  ScenarioMultipliers,
  ScenarioSeries,
} from '@/types/market';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/**
 * The longest Horizon the calculator projects, in whole years. `projectSeries` returns
 * `maxYears + 1` points (years 0..maxYears inclusive), so the default run yields 31 values
 * covering year 0 through year 30 (R1.1). The called-out horizons (10, 20, 30) all fall within it.
 */
export const PROJECTION_MAX_YEARS = 30;

/**
 * The four asset-class keys, iterated everywhere a per-class loop is needed so the blend stays
 * exhaustive and ordering is deterministic. Mirrors the `ASSET_CLASS_KEYS` in `allocation.ts`;
 * typed against `AssetClass` so the compiler flags any class added without being handled here.
 */
export const ASSET_CLASS_KEYS: readonly AssetClass[] = ['stocks', 'bonds', 'cash', 'other'];

/**
 * Default Equity_Risk_Premium, in percentage points, added to the bond anchor to form the stocks
 * Expected_Return (R2.2). The editable UI range is 0–15 points; this is the documented default.
 */
export const DEFAULT_EQUITY_RISK_PREMIUM = 4.0;

/**
 * Default other-class Expected_Return, in percent per year (R2.3). "Other" has no market anchor,
 * so it uses this documented default; the editable UI range is 0–20 percent per year.
 */
export const DEFAULT_OTHER_RETURN = 4.0;

/**
 * Default Scenario_Multipliers (R4.5). The optimistic multiplier (≥ 1.0) scales the
 * Blended_Expected_Return up; the pessimistic multiplier (≤ 1.0) scales it down; the base
 * Scenario always uses an implicit 1.0. Defaults are optimistic 1.5 and pessimistic 0.5.
 */
export const DEFAULT_SCENARIO_MULTIPLIERS: ScenarioMultipliers = {
  optimistic: 1.5,
  pessimistic: 0.5,
};

// ---------------------------------------------------------------------------
// Source-label helper (date formatting only — no clock read)
// ---------------------------------------------------------------------------

/**
 * Formats an ISO date string (e.g. "2026-10-14") into an unambiguous calendar date such as
 * "Oct 14, 2026" for a return model's `source` metadata. This reformats a value the caller
 * passed in via the Market_Data_Snapshot; it reads no clock and performs no I/O, so the module
 * stays pure. The ISO string is parsed as a UTC calendar date and rendered in UTC so the day
 * never shifts across time zones.
 */
function formatAsOf(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    // Fall back to the raw string rather than throwing: the source label is display metadata,
    // not a computed number, so a malformed date should never break a projection.
    return isoDate;
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

// ---------------------------------------------------------------------------
// deriveReturnModel (R2.1–R2.5)
// ---------------------------------------------------------------------------

/**
 * Builds the Return_Model — the per-class Expected_Return plus its display metadata — from the
 * resolved market values and the editable return assumptions (R2.1–R2.5).
 *
 * Per class:
 *   - bonds  = the DGS10 (10-year Treasury) percent-per-year value (R2.1);
 *   - cash   = the DTB3 (3-month Treasury bill) percent-per-year value (R2.1);
 *   - stocks = the bonds anchor + the Equity_Risk_Premium (R2.2); the `source` states this
 *     reasoning so the view can surface it (R2.5);
 *   - other  = the editable `otherReturn` default, which has no market anchor (R2.3).
 *
 * Each class carries a plain-language `label` and a `source` string naming the Market_Series (or
 * default) the return came from, including the value's "as of" date for the market-anchored
 * classes (R2.4). The returned model is reused unchanged for both the current- and target-
 * allocation blends (R7.1), so the same Expected_Return drives every projection in a view.
 *
 * Pure and deterministic: all market and assumption values are passed in; no clock, no fetch.
 */
export function deriveReturnModel(
  market: MarketDataSnapshot,
  assumptions: ReturnAssumptions,
): ReturnModel {
  const bondsReturn = market.tenYear.value;
  const cashReturn = market.threeMonth.value;
  const stocksReturn = bondsReturn + assumptions.equityRiskPremium;

  const bondsAsOf = formatAsOf(market.tenYear.asOf);
  const cashAsOf = formatAsOf(market.threeMonth.asOf);

  const stocks: ClassReturn = {
    returnPercent: stocksReturn,
    label: 'Stocks',
    source: `Bond anchor (DGS10, as of ${bondsAsOf}) + a ${assumptions.equityRiskPremium}-point equity risk premium`,
  };
  const bonds: ClassReturn = {
    returnPercent: bondsReturn,
    label: 'Bonds',
    source: `DGS10 (10-year Treasury yield), as of ${bondsAsOf}`,
  };
  const cash: ClassReturn = {
    returnPercent: cashReturn,
    label: 'Cash',
    source: `DTB3 (3-month Treasury bill yield), as of ${cashAsOf}`,
  };
  const other: ClassReturn = {
    returnPercent: assumptions.otherReturn,
    label: 'Other',
    source: `Default assumption of ${assumptions.otherReturn}% per year (no market anchor)`,
  };

  return { stocks, bonds, cash, other };
}

// ---------------------------------------------------------------------------
// computeBlendedReturn (R2.6)
// ---------------------------------------------------------------------------

/**
 * Computes the Blended_Expected_Return as the sum over the four `ASSET_CLASS_KEYS` of each class's
 * allocation fraction multiplied by that class's Expected_Return (R2.6).
 *
 * `allocationFractions` is a per-class fraction in the range 0..1 (the Spec 1 allocation
 * percentages ÷ 100 for the current projection, or the Target_Allocation weights ÷ 100 for the
 * target projection, R7.1); the four fractions are expected to sum to approximately 1. The
 * returned value is a percent-per-year rate on the same scale as each `returnPercent`.
 *
 * Iterating via `ASSET_CLASS_KEYS` keeps the blend exhaustive and deterministic. Pure: numbers in,
 * a number out — no fetch, no `localStorage`, no clock.
 */
export function computeBlendedReturn(
  allocationFractions: Record<AssetClass, number>,
  returnModel: ReturnModel,
): number {
  let blended = 0;
  for (const key of ASSET_CLASS_KEYS) {
    blended += allocationFractions[key] * returnModel[key].returnPercent;
  }
  return blended;
}

// ---------------------------------------------------------------------------
// projectSeries (R1.1, R1.2, R1.3, R6.2, R6.3)
// ---------------------------------------------------------------------------

/**
 * Projects a single scenario's year-by-year values from the Projected_Base using annual
 * compounding plus an optional end-of-year contribution (R1.1–R1.3, R6.2, R6.3).
 *
 * Returns `maxYears + 1` points covering years 0..maxYears inclusive (31 points for the default
 * 30-year horizon, R1.1). Each point carries the calendar `year` (`currentYear + offset`, so the
 * module never reads the clock — the caller supplies `currentYear`) and the projected `value`:
 *   - `v[0] = base` — the year-0 value equals the Projected_Base (R1.2);
 *   - `v[N] = v[N-1] * (1 + annualReturnPercent / 100) + annualContribution` for N ≥ 1 — the prior
 *     year grows by the scenario's annual rate, then the contribution is added at the END of the
 *     year (R1.3, R6.2). When `annualContribution` is 0 this reduces to pure compounding (R6.3).
 *
 * `annualReturnPercent` is a percent-per-year rate (R converted to a decimal as R ÷ 100).
 * `annualContribution` is expected to be ≥ 0 (validation lives in the UI layer). Pure and
 * deterministic: inputs in, numbers out — no fetch, no `localStorage`, no clock.
 */
export function projectSeries(
  base: number,
  annualReturnPercent: number,
  annualContribution: number,
  currentYear: number,
  maxYears: number = PROJECTION_MAX_YEARS,
): ProjectedPoint[] {
  const growthFactor = 1 + annualReturnPercent / 100;
  const points: ProjectedPoint[] = [{ year: currentYear, value: base }];

  for (let offset = 1; offset <= maxYears; offset += 1) {
    const previousValue = points[offset - 1].value;
    const value = previousValue * growthFactor + annualContribution;
    points.push({ year: currentYear + offset, value });
  }

  return points;
}

// ---------------------------------------------------------------------------
// buildScenarios (R4.1, R4.7)
// ---------------------------------------------------------------------------

/**
 * Builds the three Scenario series — base, optimistic, pessimistic — for one allocation from the
 * Blended_Expected_Return and the Scenario_Multipliers (R4.1).
 *
 * Each scenario runs `projectSeries` with the same base, contribution, current year, and horizon,
 * differing only in the annual rate:
 *   - base        uses the blended return (implicit multiplier 1.0);
 *   - optimistic  uses `blendedReturnPercent * multipliers.optimistic`;
 *   - pessimistic uses `blendedReturnPercent * multipliers.pessimistic`.
 *
 * Because the recurrence is monotonic in the rate for a non-negative base and non-negative
 * contribution, optimistic ≥ base ≥ pessimistic holds for every year whenever the optimistic
 * multiplier is ≥ 1.0 and the pessimistic multiplier is ≤ 1.0 (R4.7).
 *
 * Pure and deterministic: inputs in, numbers out — no fetch, no `localStorage`, no clock.
 */
export function buildScenarios(
  base: number,
  blendedReturnPercent: number,
  multipliers: ScenarioMultipliers,
  annualContribution: number,
  currentYear: number,
  maxYears: number = PROJECTION_MAX_YEARS,
): ScenarioSeries {
  return {
    base: projectSeries(base, blendedReturnPercent, annualContribution, currentYear, maxYears),
    optimistic: projectSeries(
      base,
      blendedReturnPercent * multipliers.optimistic,
      annualContribution,
      currentYear,
      maxYears,
    ),
    pessimistic: projectSeries(
      base,
      blendedReturnPercent * multipliers.pessimistic,
      annualContribution,
      currentYear,
      maxYears,
    ),
  };
}

// ---------------------------------------------------------------------------
// toTodaysDollars (R5.3)
// ---------------------------------------------------------------------------

/**
 * Converts a nominal projected series into today's dollars by discounting each year's value for
 * inflation (R5.3).
 *
 * For each point, the displayed value becomes `value / (1 + inflationRatePercent / 100) ^ offset`,
 * where `offset = year − currentYear` is the point's integer number of years past the current
 * year. Year 0 (the current year) has an offset of 0, so its divisor is `(1 + i) ^ 0 = 1` and its
 * value is unchanged; later years are divided by progressively larger factors. The `year` on each
 * point is preserved; only the `value` is adjusted.
 *
 * `inflationRatePercent` is a percent-per-year rate (converted to a decimal as R ÷ 100). Pure and
 * deterministic: the series and current year are passed in — no fetch, no `localStorage`, no clock.
 */
export function toTodaysDollars(
  series: ProjectedPoint[],
  inflationRatePercent: number,
  currentYear: number,
): ProjectedPoint[] {
  const inflationFactor = 1 + inflationRatePercent / 100;

  return series.map((point) => {
    const offset = point.year - currentYear;
    return {
      year: point.year,
      value: point.value / inflationFactor ** offset,
    };
  });
}
