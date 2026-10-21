/**
 * Source-aware account freshness (R5.1, R5.4).
 *
 * Pure in, data out. This module imports nothing from `app/`, `components/`, or `lib/fred/`,
 * performs no data fetching, touches no `localStorage`, and never reads the clock. Every
 * time-dependent value (the freshness `now`) is passed in by the caller, mirroring the contract of
 * `computeFreshness` in `allocation.ts`. Given the same account and the same `now`, the output is
 * always identical.
 *
 * Why a separate per-account rule alongside `computeFreshness`:
 *   - `computeFreshness` reports per-INSTITUTION freshness for the Net_Worth_Card's institution
 *     groups and is Source-agnostic (Spec 1). It still applies the plain 3-day Stale_Rule to every
 *     member and knows nothing about Sources.
 *   - This spec adds a per-ACCOUNT, Source-aware rule (R5): a Manual_Account is NEVER stale and
 *     shows "Updated by you on [date]" instead of a staleness flag, while Sample_Accounts and
 *     Connected_Accounts keep the Spec 1 Stale_Rule. That decision is per account and depends on
 *     `source`, so it lives here rather than muddying the institution-level, Source-agnostic
 *     calculator.
 */

import type { Account, AccountFreshnessStatus } from '@/types/accounts';

/** Freshness_Threshold in days: an account is stale when strictly more than this many days old. */
const FRESHNESS_THRESHOLD_DAYS = 3;

/** Milliseconds in one day, used to derive each account's absolute `lastUpdated` from `now`. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parses an optional ISO `updatedByYouDate` into a `Date`, returning `null` for a missing or
 * unparseable value. A Manual_Account is exempt from the Stale_Rule regardless of whether this date
 * is present, so a bad/absent date never flips it to stale — the caller just loses the exact "on
 * [date]" text and can fall back gracefully.
 */
function parseUpdatedByYouDate(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Computes the Source-aware freshness status for a single account (R5.1, R5.4).
 *
 * `lastUpdated` is derived INTERNALLY as `now − lastUpdatedDaysAgo days` for every Source, so the
 * sample data never decays into looking stale as real time passes (see the `lastUpdatedDaysAgo`
 * design note). `lastUpdatedDaysAgo` is a non-negative integer, guaranteed by `validateAccounts`.
 *
 * Rule by Source:
 *   - `Manual` — EXEMPT from the Stale_Rule (R5.1). `isStale` is always `false`, and `basis` is
 *     `{ kind: 'updatedByYou', date }` where `date` is the parsed `updatedByYouDate` (or `null`),
 *     so the UI shows "Updated by you on [date]" in place of a staleness flag (R5.2).
 *   - `Sample` / `Connected` — the Spec 1 Stale_Rule applies (R5.4): stale IFF the derived date is
 *     strictly MORE than the 3-day Freshness_Threshold before `now`, i.e. `lastUpdatedDaysAgo > 3`.
 *     Exactly 3 days is NOT stale; only 4 or more is. `basis` is `{ kind: 'staleness' }`.
 *
 * Connected_Accounts carry freshness information via the same relative `lastUpdatedDaysAgo` offset
 * every account uses, so "where freshness information is available" (R5.4) is satisfied by the
 * model itself; no Connected-only branch is needed.
 *
 * Pure and deterministic: inputs in, status out — no fetch, no `localStorage`, no clock read.
 */
export function computeAccountFreshness(account: Account, now: Date): AccountFreshnessStatus {
  const lastUpdated = new Date(now.getTime() - account.lastUpdatedDaysAgo * MS_PER_DAY);

  if (account.source === 'Manual') {
    // R5.1: Manual_Accounts are never stale, whatever the offset. R5.2: expose the edit date.
    return {
      isStale: false,
      lastUpdated,
      basis: { kind: 'updatedByYou', date: parseUpdatedByYouDate(account.updatedByYouDate) },
    };
  }

  // R5.4: Sample and Connected keep the Spec 1 Stale_Rule — strictly more than 3 days is stale.
  return {
    isStale: account.lastUpdatedDaysAgo > FRESHNESS_THRESHOLD_DAYS,
    lastUpdated,
    basis: { kind: 'staleness' },
  };
}
