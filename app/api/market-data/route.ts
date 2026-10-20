/**
 * Server-only market-data route (`Market_Data_Route`, App Router `GET`).
 *
 * This thin handler is the only place `process.env.FRED_API_KEY` is read, and the key is never
 * placed in any response body, header, or payload (R8.1): it is closed over by the injected
 * `fetchAllSeries` and never leaves the server. The handler wires the real effectful collaborators
 * — the FRED client, the 24-hour cache, the static snapshot reader, and `Date.now()` — into the
 * pure {@link resolveMarketData} decision function, which owns the live → cache → snapshot → error
 * cascade (R8, R9). Keeping the orchestration here and the decision logic in the pure resolver lets
 * the fallback cascade be unit-tested with fakes while this module stays a trivial adapter.
 *
 * On a resolved {@link MarketDataSnapshot} the route returns it as JSON with a 200 (R8.6, R9.5). On
 * the market-unavailable branch (snapshot unreadable or missing a required series) it returns the
 * {@link MarketDataError} body with a non-2xx status and no partial values (R9.6).
 */

import snapshot from '@/data/fred-snapshot.json';
import { fetchAllSeries } from '@/lib/fred/client';
import { readCache, writeCache } from '@/lib/fred/cache';
import type { RawSeriesValue, RawSeriesValues } from '@/lib/fred/types';
import type { MarketSeriesId } from '@/types/market';
import { resolveMarketData } from './resolveMarketData';

/**
 * The route resolves data per-request (key check, cache freshness, live fetch), so it must never be
 * statically cached; the 24-hour caching lives in `lib/fred/cache.ts`, not in Next's route cache.
 */
export const dynamic = 'force-dynamic';

/** HTTP status for the market-unavailable fallback error (service temporarily unavailable). */
const MARKET_UNAVAILABLE_STATUS = 503;

/**
 * Narrow one entry of the imported snapshot JSON to a {@link RawSeriesValue}. Returns `null` unless
 * the entry is an object carrying a string `seriesId` matching the expected series, a finite numeric
 * `value`, and a string `asOf` — so a malformed or partial entry can never produce a usable value
 * (R9.6).
 */
function parseSeries(
  raw: unknown,
  expectedSeriesId: MarketSeriesId,
): RawSeriesValue | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { seriesId, value, asOf } = raw as {
    seriesId?: unknown;
    value?: unknown;
    asOf?: unknown;
  };
  if (
    seriesId !== expectedSeriesId ||
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    typeof asOf !== 'string' ||
    asOf.trim() === ''
  ) {
    return null;
  }
  return { seriesId: expectedSeriesId, value, asOf };
}

/**
 * Read and validate the static snapshot fallback (`data/fred-snapshot.json`), mapping it to
 * {@link RawSeriesValues}. Returns `null` when any required series (`cpi`/`tenYear`/`threeMonth`) is
 * missing or malformed, so the resolver surfaces a market-unavailable error rather than a partial set
 * (R9.6). The JSON is imported (statically bundled) rather than read from disk.
 */
function readSnapshot(): RawSeriesValues | null {
  const source = snapshot as {
    cpi?: unknown;
    tenYear?: unknown;
    threeMonth?: unknown;
  };

  const cpi = parseSeries(source.cpi, 'CPIAUCSL');
  const tenYear = parseSeries(source.tenYear, 'DGS10');
  const threeMonth = parseSeries(source.threeMonth, 'DTB3');

  // Every required series must resolve; any gap means no usable snapshot (R9.6).
  if (cpi === null || tenYear === null || threeMonth === null) {
    return null;
  }

  return { cpi, tenYear, threeMonth };
}

/**
 * `GET /api/market-data`. Reads the FRED key (only here), wires the real collaborators into the pure
 * resolver, and serializes the outcome. The key is passed to `fetchAllSeries` via a closure and never
 * written into any response.
 */
export async function GET(): Promise<Response> {
  const apiKey = process.env.FRED_API_KEY;
  const apiKeyConfigured =
    typeof apiKey === 'string' && apiKey.trim() !== '';

  // Narrowed to a non-empty string; the resolver only invokes the injected fetch when
  // `apiKeyConfigured` is true, so the fallback empty string is never actually used for a fetch.
  const resolvedKey = apiKeyConfigured ? (apiKey as string) : '';

  const result = await resolveMarketData({
    apiKeyConfigured,
    readCache,
    // The key is closed over here and never appears in the resolver's output or the response.
    fetchAllSeries: () => fetchAllSeries(resolvedKey),
    writeCache,
    readSnapshot,
    now: Date.now(),
  });

  if ('ok' in result && result.ok === false) {
    // Market-unavailable: a non-2xx error body carrying no partial values (R9.6).
    return Response.json(result, { status: MARKET_UNAVAILABLE_STATUS });
  }

  // Resolved snapshot (live / cache / snapshot) → 200 JSON (R8.6, R9.5).
  return Response.json(result);
}
