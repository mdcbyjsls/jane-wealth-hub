import type { AssetClass } from '@/types/accounts';

/**
 * Shared market and return-model types for the Long-Term Wealth Projection view (Spec 2).
 *
 * Every field here is serializable (primitives and plain objects, with ISO date strings
 * rather than `Date` instances) so these values can cross the server→client boundary when
 * the server-only market-data route hands a resolved snapshot to the client island.
 */

/**
 * The FRED series the app uses. Spec 2 uses CPIAUCSL, DGS10, and DTB3; Spec 3
 * (buy-vs-rent) adds MORTGAGE30US, CSUSHPINSA, and CUSR0000SEHA.
 */
export type MarketSeriesId =
  | 'CPIAUCSL'
  | 'DGS10'
  | 'DTB3'
  | 'MORTGAGE30US' // 30-year fixed mortgage rate → default Mortgage_Rate (R11.4)
  | 'CSUSHPINSA' // Case-Shiller home price index → default Home_Appreciation_Rate (R11.4)
  | 'CUSR0000SEHA'; // CPI rent of primary residence → default Rent_Growth_Rate (R11.4)

/** Where a served MarketDataSnapshot came from (R8.6, R9). */
export type DataSource = 'live' | 'cache' | 'snapshot';

/** One resolved market value: the number, its as-of date, and which series it is. */
export interface MarketSeriesValue {
  seriesId: MarketSeriesId;
  value: number; // percent per year for DGS10/DTB3; index level for CPIAUCSL
  asOf: string; // ISO date string (serializable across server→client)
}

/**
 * The resolved set served to the view (R8.6, R9.5; R11.1). The Spec 2 fields
 * (`cpi`, `tenYear`, `threeMonth`, `dataSource`) are unchanged so Spec 2 keeps
 * working; Spec 3 adds the three new resolved fields it reads.
 */
export interface MarketDataSnapshot {
  cpi: MarketSeriesValue; // CPIAUCSL (drives Inflation_Rate)
  tenYear: MarketSeriesValue; // DGS10 (bonds anchor)
  threeMonth: MarketSeriesValue; // DTB3 (cash anchor)
  mortgageRate: MarketSeriesValue; // MORTGAGE30US (percent per year)
  homePriceIndex: MarketSeriesValue; // CSUSHPINSA (index level)
  rentIndex: MarketSeriesValue; // CUSR0000SEHA (index level)
  dataSource: DataSource;
}

/** The route's error body when the snapshot is unreadable/incomplete (R9.6). Carries no values. */
export interface MarketDataError {
  ok: false;
  reason: 'market-unavailable';
}

/** Editable return assumptions not directly anchored to a series. */
export interface ReturnAssumptions {
  equityRiskPremium: number; // points added to bond anchor (default 4.0; R2.2)
  otherReturn: number; // percent/yr (default 4.0; R2.3)
}

/** One class's resolved Expected_Return plus its display metadata (R2.4, R2.5). */
export interface ClassReturn {
  returnPercent: number;
  label: string;
  source: string; // e.g. "DGS10 (10-year Treasury), as of Oct 14, 2026"
}

/** The complete per-class return model used to blend (R2). */
export type ReturnModel = Record<AssetClass, ClassReturn>;

export interface ScenarioMultipliers {
  optimistic: number; // default 1.5, range 1.0–3.0 (R4.5)
  pessimistic: number; // default 0.5, range 0.0–1.0 (R4.5)
}

/**
 * The basis in which projected values are displayed (R5.1):
 *   - `nominal` — future dollars, no inflation adjustment (the default on load)
 *   - `today`   — inflation-adjusted to present-day purchasing power
 */
export type DollarBasis = 'nominal' | 'today';

/** One projected year. */
export interface ProjectedPoint {
  year: number; // calendar year; year offset 0 = currentYear
  value: number; // nominal unless converted by toTodaysDollars
}

/** The three scenario series for one allocation (R4.1). */
export interface ScenarioSeries {
  base: ProjectedPoint[];
  optimistic: ProjectedPoint[];
  pessimistic: ProjectedPoint[];
}
