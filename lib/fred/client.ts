/**
 * Server-only thin FRED fetch wrapper.
 *
 * This module performs the raw HTTP fetch of the six market series this spec uses — CPIAUCSL (general
 * inflation), DGS10 (10-year Treasury yield), DTB3 (3-month Treasury bill yield), MORTGAGE30US (30-year
 * fixed mortgage rate), CSUSHPINSA (Case-Shiller home price index), and CUSR0000SEHA (CPI for rent of
 * primary residence) — from the FRED `series/observations` endpoint and parses the latest observation
 * of each. It is imported
 * only by `lib/fred/cache.ts` and the `app/api/market-data/` route, never by components or pages, so
 * the FRED wire format and the API key never reach the browser.
 *
 * The API key is **passed in** by the route, not read from `process.env` here (R8.2) — this keeps the
 * client a thin, testable fetch wrapper. The client never throws for an expected failure: a failed
 * request, a non-success status, a missing/sentinel observation, or a timeout all map to
 * `{ ok: false; reason }` (R8.2, R9.2) so the route alone decides the snapshot fallback.
 */

import type {
  FetchFailureReason,
  FredFetchResult,
  FredObservationsResponse,
  RawSeriesValue,
} from '@/lib/fred/types';
import type { MarketSeriesId } from '@/types/market';

/** FRED `series/observations` base endpoint. */
const FRED_OBSERVATIONS_URL =
  'https://api.stlouisfed.org/fred/series/observations';

/** Default per-request timeout budget in milliseconds (R9.2). */
const DEFAULT_TIMEOUT_MS = 10_000;

/** FRED's sentinel for an observation with no value for that date. */
const MISSING_VALUE_SENTINEL = '.';

/**
 * The result of fetching and parsing a single series: either the resolved latest value or a
 * failure reason. Mirrors the top-level {@link FredFetchResult} shape but for one series, so
 * {@link fetchAllSeries} can short-circuit on the first failure without inventing partial values.
 */
type SeriesFetchResult =
  | { ok: true; value: RawSeriesValue }
  | { ok: false; reason: FetchFailureReason };

/**
 * Build the observations URL for one series. We request the single most-recent observation
 * (`sort_order=desc&limit=1`) as JSON.
 */
function buildUrl(seriesId: MarketSeriesId, apiKey: string): string {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: '1',
  });
  return `${FRED_OBSERVATIONS_URL}?${params.toString()}`;
}

/**
 * Fetch the latest observation for a single FRED series and parse it into a {@link RawSeriesValue}.
 *
 * Never throws for an expected failure — the `signal` (typically from `AbortSignal.timeout`) turns a
 * timeout into an `AbortError`, which is mapped to `'timeout'`; any other thrown error maps to
 * `'fetch-error'`; a non-success HTTP status maps to `'non-success'`; and a response missing a usable
 * observation (no observations, or the "." sentinel, or an unparseable number) maps to
 * `'missing-series'`.
 */
export async function fetchSeries(
  seriesId: MarketSeriesId,
  apiKey: string,
  signal: AbortSignal,
): Promise<SeriesFetchResult> {
  let response: Response;
  try {
    response = await fetch(buildUrl(seriesId, apiKey), {
      signal,
      // FRED responses are server-fetched; no browser cache semantics apply here.
      cache: 'no-store',
    });
  } catch (error: unknown) {
    // An AbortSignal.timeout firing rejects the fetch with an AbortError.
    const reason: FetchFailureReason =
      error instanceof Error && error.name === 'AbortError'
        ? 'timeout'
        : 'fetch-error';
    return { ok: false, reason };
  }

  if (!response.ok) {
    return { ok: false, reason: 'non-success' };
  }

  let body: FredObservationsResponse;
  try {
    body = (await response.json()) as FredObservationsResponse;
  } catch (error: unknown) {
    // A body that aborts mid-read still surfaces as a timeout; otherwise it's a fetch error.
    const reason: FetchFailureReason =
      error instanceof Error && error.name === 'AbortError'
        ? 'timeout'
        : 'fetch-error';
    return { ok: false, reason };
  }

  const latest = body.observations?.[0];
  if (
    latest === undefined ||
    latest.value === MISSING_VALUE_SENTINEL ||
    latest.value.trim() === ''
  ) {
    return { ok: false, reason: 'missing-series' };
  }

  const parsed = Number(latest.value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, reason: 'missing-series' };
  }

  return {
    ok: true,
    value: { seriesId, value: parsed, asOf: latest.date },
  };
}

/**
 * Fetch all six series the views need and return the resolved {@link FredFetchResult}.
 *
 * Enforces a single shared timeout budget across the six requests via `AbortSignal.timeout`
 * (default 10 s; R9.2). Returns `{ ok: true; values }` only when every required series resolves; the
 * first failure is returned as `{ ok: false; reason }` with no partial values, so the route can never
 * serve an incomplete set (R11.1, R11.2).
 */
export async function fetchAllSeries(
  apiKey: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<FredFetchResult> {
  const signal = AbortSignal.timeout(timeoutMs);

  const [cpi, tenYear, threeMonth, mortgageRate, homePriceIndex, rentIndex] =
    await Promise.all([
      fetchSeries('CPIAUCSL', apiKey, signal),
      fetchSeries('DGS10', apiKey, signal),
      fetchSeries('DTB3', apiKey, signal),
      fetchSeries('MORTGAGE30US', apiKey, signal),
      fetchSeries('CSUSHPINSA', apiKey, signal),
      fetchSeries('CUSR0000SEHA', apiKey, signal),
    ]);

  if (!cpi.ok) {
    return { ok: false, reason: cpi.reason };
  }
  if (!tenYear.ok) {
    return { ok: false, reason: tenYear.reason };
  }
  if (!threeMonth.ok) {
    return { ok: false, reason: threeMonth.reason };
  }
  if (!mortgageRate.ok) {
    return { ok: false, reason: mortgageRate.reason };
  }
  if (!homePriceIndex.ok) {
    return { ok: false, reason: homePriceIndex.reason };
  }
  if (!rentIndex.ok) {
    return { ok: false, reason: rentIndex.reason };
  }

  return {
    ok: true,
    values: {
      cpi: cpi.value,
      tenYear: tenYear.value,
      threeMonth: threeMonth.value,
      mortgageRate: mortgageRate.value,
      homePriceIndex: homePriceIndex.value,
      rentIndex: rentIndex.value,
    },
  };
}
