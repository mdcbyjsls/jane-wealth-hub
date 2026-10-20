/**
 * Server-only 24-hour in-memory market-data cache.
 *
 * This module holds the single most-recently-fetched set of raw FRED series values so repeated
 * page loads within a day don't hammer the FRED API (R8.3). It is imported only by the
 * `app/api/market-data/` route — never by components or pages.
 *
 * The cache reads no clock: every freshness decision uses a `now` timestamp (ms since the Unix
 * epoch) supplied by the caller, so the module is deterministic and unit-testable without stubbing
 * time. A single entry under a fixed key is sufficient because the route always resolves the same
 * three series together (R8.4, R8.5).
 */

import type { CacheEntry, RawSeriesValues } from '@/lib/fred/types';

/** Freshness window: entries older than 24 hours are treated as expired (R8.4). */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Fixed key for the market-data entry. The route resolves all three series as one unit, so a single
 * keyed slot is all the cache needs.
 */
const MARKET_DATA_KEY = 'market-data';

/** Module-level store. Keyed by a constant so the shape stays open to future keys if ever needed. */
const store = new Map<string, CacheEntry>();

/**
 * The result of a cache read: a hit only when a stored entry exists and is still within the 24-hour
 * window relative to `now`; otherwise a miss (absent or expired), signalling the route to refetch
 * (R8.5).
 */
export type CacheReadResult =
  | { fresh: true; entry: CacheEntry }
  | { fresh: false };

/**
 * Return the cached entry only when it is fresh: present and fetched less than 24 hours before
 * `now`. An expired or absent entry reports `{ fresh: false }` so the caller refetches (R8.4, R8.5).
 * `now` is passed in; this module never reads the clock.
 */
export function readCache(now: number): CacheReadResult {
  const entry = store.get(MARKET_DATA_KEY);
  if (entry === undefined) {
    return { fresh: false };
  }
  if (now - entry.fetchedAt < CACHE_TTL_MS) {
    return { fresh: true, entry };
  }
  return { fresh: false };
}

/**
 * Store the resolved series values, stamping them with `fetchedAt = now` so a later `readCache`
 * can decide freshness (R8.3). `now` is passed in; this module never reads the clock.
 */
export function writeCache(values: RawSeriesValues, now: number): void {
  store.set(MARKET_DATA_KEY, { values, fetchedAt: now });
}

/**
 * Clear the in-memory store. Exposed only so unit tests can reset module state between cases;
 * production code never calls this.
 */
export function __resetCacheForTests(): void {
  store.clear();
}
