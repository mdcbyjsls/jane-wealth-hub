/**
 * Server-only FRED integration types.
 *
 * These describe the raw shape of FRED API responses, the thin client's result union, and the
 * 24-hour cache entry shape. This module is imported only by `lib/fred/client.ts`,
 * `lib/fred/cache.ts`, and the `app/api/market-data/` route — never by components or pages. It
 * therefore exports nothing UI-facing: the resolved, serializable set the view consumes is the
 * `MarketDataSnapshot` in `@/types/market`, which the route builds from these raw values and stamps
 * with a `DataSource`. Keeping the raw FRED wire types here means the browser never sees them.
 */

import type { MarketSeriesId } from '@/types/market';

/**
 * One observation in a FRED `series/observations` response. FRED returns every numeric figure as a
 * string (and uses the sentinel "." for a missing value), so `value` is typed as a string and parsed
 * by the client, not here. Only the fields the client reads are modeled.
 */
export interface FredObservation {
  /** Observation date, `YYYY-MM-DD`. Becomes the `asOf` on the resolved MarketSeriesValue. */
  date: string;
  /** Raw value as returned by FRED; "." means no value for that date. */
  value: string;
}

/** The subset of a FRED `series/observations` response body the client depends on. */
export interface FredObservationsResponse {
  observations: FredObservation[];
}

/**
 * One raw series value resolved by the client: the parsed number and the observation date it came
 * from, tagged with which of the three series it is. This is the pre-snapshot, server-side shape —
 * it has no `DataSource` (the route stamps that) and never crosses to the browser.
 */
export interface RawSeriesValue {
  seriesId: MarketSeriesId;
  value: number;
  asOf: string; // ISO date string from the observation
}

/**
 * The three resolved series values a successful fetch produces, keyed to match `MarketDataSnapshot`:
 * `cpi` (CPIAUCSL), `tenYear` (DGS10), `threeMonth` (DTB3).
 */
export interface RawSeriesValues {
  cpi: RawSeriesValue;
  tenYear: RawSeriesValue;
  threeMonth: RawSeriesValue;
}

/**
 * Why a fetch did not yield a usable set of values. The client returns one of these instead of
 * throwing (R8.2, R9.2) so the route can decide the snapshot fallback:
 * - `fetch-error`: the request itself failed (network/DNS/etc).
 * - `non-success`: the API returned a non-success HTTP status.
 * - `missing-series`: the response was missing a required series or a usable observation for one.
 * - `timeout`: the request did not complete within the client's 10-second budget.
 */
export type FetchFailureReason =
  | 'fetch-error'
  | 'non-success'
  | 'missing-series'
  | 'timeout';

/**
 * The client's discriminated result union (mirrors Spec 1's `ValidationResult` style): a successful
 * fetch carries the resolved `RawSeriesValues`; a failure carries only a `FetchFailureReason`, never
 * partial values, so the route cannot accidentally serve an incomplete set.
 */
export type FredFetchResult =
  | { ok: true; values: RawSeriesValues }
  | { ok: false; reason: FetchFailureReason };

/**
 * One entry in the 24-hour in-memory cache: the resolved values plus the fetch timestamp used to
 * decide freshness. `fetchedAt` is milliseconds since the Unix epoch, supplied by the caller — the
 * cache module never reads the clock itself (R8.3, R8.4, R8.5).
 */
export interface CacheEntry {
  values: RawSeriesValues;
  fetchedAt: number; // ms epoch
}
