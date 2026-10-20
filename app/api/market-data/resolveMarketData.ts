/**
 * Server-only pure market-data fallback resolver.
 *
 * This module decides which set of market values the route serves — live FRED values, a fresh
 * cache entry, the static snapshot fallback, or a market-unavailable error — and stamps the
 * resolved {@link DataSource} onto the returned {@link MarketDataSnapshot} (R8.6). It is imported
 * only by `app/api/market-data/route.ts` and its unit tests, never by components or pages, so the
 * FRED wire types and API key stay server-side.
 *
 * The function reads neither the network nor the clock directly: every effectful and
 * time-dependent collaborator (`readCache`, `fetchAllSeries`, `writeCache`, `readSnapshot`, and the
 * `now` timestamp) is injected. The thin `GET` handler (task 6.2) wires the real collaborators; the
 * unit tests inject fakes. This mirrors the Spec 1 pattern of passing effectful inputs in rather
 * than reading them inside the unit under test, keeping resolution deterministic and testable
 * without stubbing time or the network (Testing Strategy → 2).
 */

import type { CacheReadResult } from '@/lib/fred/cache';
import type { FredFetchResult, RawSeriesValues } from '@/lib/fred/types';
import type {
  DataSource,
  MarketDataError,
  MarketDataSnapshot,
} from '@/types/market';

/**
 * Injected collaborators for {@link resolveMarketData}. Each effectful or time-dependent dependency
 * is passed in so the resolver stays pure and unit-testable (no `process.env`, network, or clock
 * read inside).
 */
export interface ResolveMarketDataDeps {
  /** Whether a FRED API key is configured. The route reads `process.env`; the resolver never does. */
  apiKeyConfigured: boolean;
  /** Read the 24-hour cache for the given `now` (ms epoch); reports fresh hit or miss (R8.4, R8.5). */
  readCache: (now: number) => CacheReadResult;
  /** Perform the live FRED fetch, returning its discriminated result (never throws for failures). */
  fetchAllSeries: () => Promise<FredFetchResult>;
  /** Persist freshly fetched values so later reads within 24h hit the cache (R8.3). */
  writeCache: (values: RawSeriesValues, now: number) => void;
  /**
   * Read the static snapshot fallback. Returns `null` when the snapshot is unreadable or missing a
   * required series, so the resolver can surface a market-unavailable error with no partial values
   * (R9.6).
   */
  readSnapshot: () => RawSeriesValues | null;
  /** Current time in ms since the Unix epoch, supplied by the caller (never read inside). */
  now: number;
}

/** The market-unavailable error returned when no usable values can be resolved (R9.6). */
const MARKET_UNAVAILABLE_ERROR: MarketDataError = {
  ok: false,
  reason: 'market-unavailable',
};

/**
 * Build a serializable {@link MarketDataSnapshot} from server-side {@link RawSeriesValues}, stamping
 * the resolved {@link DataSource} (R8.6). `RawSeriesValue` and `MarketSeriesValue` share the same
 * `{ seriesId, value, asOf }` shape, so each series maps across directly.
 */
function toSnapshot(
  values: RawSeriesValues,
  dataSource: DataSource,
): MarketDataSnapshot {
  return {
    cpi: values.cpi,
    tenYear: values.tenYear,
    threeMonth: values.threeMonth,
    dataSource,
  };
}

/**
 * Read the snapshot fallback and return it stamped `dataSource = 'snapshot'`, or the
 * market-unavailable error when the snapshot is unreadable or incomplete (R9.6). This is the final
 * rung of the fallback cascade and never produces a partial snapshot.
 */
function resolveFromSnapshot(
  readSnapshot: ResolveMarketDataDeps['readSnapshot'],
): MarketDataSnapshot | MarketDataError {
  const snapshot = readSnapshot();
  if (snapshot === null) {
    return MARKET_UNAVAILABLE_ERROR;
  }
  return toSnapshot(snapshot, 'snapshot');
}

/**
 * Resolve the market-data set to serve, evaluated in order (R8, R9):
 *
 * 1. **No key configured** → snapshot fallback (R9.1). No cache read, no fetch.
 * 2. **Fresh cache (< 24h)** → the cached values stamped `cache`, with no FRED fetch (R8.4).
 * 3. **Fetch succeeds** → write the cache and return the live values stamped `live` (R8.2, R8.3).
 * 4. **Fetch fails** (error / non-success / missing series / timeout) → snapshot fallback (R9.2).
 *
 * The snapshot branch (reached from steps 1 and 4) returns the snapshot stamped `snapshot`, or — when
 * the snapshot is unreadable or missing a required series — the market-unavailable error carrying no
 * partial values (R9.6). The cascade never silently produces a partial {@link MarketDataSnapshot}.
 */
export async function resolveMarketData(
  deps: ResolveMarketDataDeps,
): Promise<MarketDataSnapshot | MarketDataError> {
  const {
    apiKeyConfigured,
    readCache,
    fetchAllSeries,
    writeCache,
    readSnapshot,
    now,
  } = deps;

  // 1. No key → snapshot fallback, before any cache read or fetch (R9.1).
  if (!apiKeyConfigured) {
    return resolveFromSnapshot(readSnapshot);
  }

  // 2. Fresh cache within 24h → serve it, no FRED fetch (R8.4).
  const cached = readCache(now);
  if (cached.fresh) {
    return toSnapshot(cached.entry.values, 'cache');
  }

  // 3/4. No fresh cache → attempt a live fetch.
  const fetched = await fetchAllSeries();
  if (fetched.ok) {
    // 3. Fetch succeeded → cache it (R8.3) and serve the live values (R8.2).
    writeCache(fetched.values, now);
    return toSnapshot(fetched.values, 'live');
  }

  // 4. Fetch failed (any reason) → snapshot fallback (R9.2).
  return resolveFromSnapshot(readSnapshot);
}
