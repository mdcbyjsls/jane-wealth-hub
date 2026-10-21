/**
 * Source_Mix_Summary helper (pure module).
 *
 * Inputs in, numbers out. Like the rest of `lib/calculations/`, this module imports nothing from
 * `app/`, `components/`, or `lib/fred/`, performs no data fetching, touches no `localStorage`, and
 * never reads the clock.
 *
 * It derives the Source_Mix_Summary shown on the Net_Worth_Card (R1.4): for each `AccountSource`
 * present among the accounts, how many accounts carry that Source and that Source's share of total
 * assets as a percentage. Liabilities are excluded from the share basis, consistent with how
 * `computeClassTotals` / `computeActualAllocation` build the allocation — a Source that holds only
 * liabilities still appears (with its real `count`) but contributes 0 to the asset basis.
 */

import {
  LIABILITY_TYPES,
  type Account,
  type AccountSource,
  type SourceMixSummary,
} from '@/types/accounts';

/**
 * Source iteration order. Entries are emitted in this fixed order for the Sources that are present,
 * so the summary is deterministic regardless of account input order. This matches the natural
 * Sample → Manual → Connected lifecycle of an account.
 */
const SOURCE_ORDER: readonly AccountSource[] = ['Sample', 'Manual', 'Connected'];

/** One decimal place for every share percentage, consistent with allocation (R3.4 analogue). */
const SHARE_DECIMALS = 1;

/**
 * Integer-tenths scale. All percentage rounding is done in whole "tenths of a percent" so the
 * emitted shares are exact one-decimal numbers that sum to exactly 100.0 (never 99.9/100.1 from
 * float drift), mirroring `computeActualAllocation`.
 */
const TENTHS_PER_PERCENT = 10 ** SHARE_DECIMALS; // 10 -> one decimal place

/** Target sum of the shares, expressed in integer tenths (100.0% -> 1000 tenths). */
const TARGET_TOTAL_TENTHS = 100 * TENTHS_PER_PERCENT; // 1000

/** True when the account is a Liability_Account, using the single source of truth (R12). */
function isLiability(account: Account): boolean {
  return LIABILITY_TYPES.includes(account.accountType);
}

/**
 * Derives the Source_Mix_Summary from a set of (already-validated) accounts (R1.4).
 *
 * For every Source present in `accounts`, the result carries:
 *   - `count`         — how many accounts of that Source there are (liabilities included in the
 *                       count; R1.4 counts accounts, not dollars);
 *   - `assetSharePct` — that Source's share of total ASSETS, one decimal, with liabilities excluded
 *                       from the share basis (consistent with allocation).
 *
 * Entries are ordered Sample → Manual → Connected, and only Sources that actually appear among the
 * accounts are emitted (one entry per Source present). An empty account set yields an empty
 * summary.
 *
 * Share basis: a Source's asset total is the sum of its non-liability account balances. The overall
 * basis is the sum across all Sources of those asset totals. When that basis is 0 (no accounts, or
 * only liabilities), every present Source reports `assetSharePct: 0` — there is no division, so the
 * zero-denominator case cannot arise.
 *
 * Non-zero basis — LARGEST-REMAINDER METHOD (Hamilton's method), identical in spirit to
 * `computeActualAllocation`: each present Source's ideal share is computed in integer tenths and
 * floored, then the leftover tenths are handed to the Sources with the largest dropped remainder
 * (ties broken by `SOURCE_ORDER`). The emitted shares therefore sum to exactly 100.0.
 *
 * Pure and deterministic: inputs in, numbers out — no fetch, no `localStorage`, no clock. Assumes
 * its input has already passed `validateAccounts`.
 */
export function computeSourceMix(accounts: Account[]): SourceMixSummary {
  // Accumulate per-Source account counts and asset totals in a single pass, remembering which
  // Sources were seen (and in what order they appear in SOURCE_ORDER).
  const counts = new Map<AccountSource, number>();
  const assetTotals = new Map<AccountSource, number>();

  for (const account of accounts) {
    const { source } = account;
    counts.set(source, (counts.get(source) ?? 0) + 1);

    const prior = assetTotals.get(source) ?? 0;
    // Liabilities are excluded from the share basis entirely (consistent with allocation), but the
    // Source is still recorded via `counts` above so it appears in the summary.
    assetTotals.set(source, prior + (isLiability(account) ? 0 : account.balance));
  }

  // The present Sources, in the fixed Sample -> Manual -> Connected order.
  const presentSources = SOURCE_ORDER.filter((source) => counts.has(source));

  const basis = presentSources.reduce(
    (sum, source) => sum + (assetTotals.get(source) ?? 0),
    0,
  );

  // Zero-basis path: no assets to divide, so every present Source has a 0.0% share. No division.
  if (basis === 0) {
    return presentSources.map((source) => ({
      source,
      count: counts.get(source) ?? 0,
      assetSharePct: 0,
    }));
  }

  // Largest-remainder rounding in integer tenths so the shares sum to exactly 100.0.
  const flooredTenths = new Map<AccountSource, number>();
  const remainders = new Map<AccountSource, number>();
  let assignedTenths = 0;

  for (const source of presentSources) {
    const idealTenths = ((assetTotals.get(source) ?? 0) / basis) * TARGET_TOTAL_TENTHS;
    const floor = Math.floor(idealTenths);
    flooredTenths.set(source, floor);
    remainders.set(source, idealTenths - floor); // dropped fractional part, in [0, 1)
    assignedTenths += floor;
  }

  // Distribute the leftover tenths to the Sources with the largest dropped remainder, breaking ties
  // by SOURCE_ORDER for determinism. `residual` is a small non-negative integer.
  const residual = TARGET_TOTAL_TENTHS - assignedTenths;
  const rankedByRemainder = [...presentSources].sort((a, b) => {
    const ra = remainders.get(a) ?? 0;
    const rb = remainders.get(b) ?? 0;
    if (rb !== ra) {
      return rb - ra; // larger dropped remainder first
    }
    return SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b);
  });

  for (let i = 0; i < residual; i += 1) {
    const source = rankedByRemainder[i];
    flooredTenths.set(source, (flooredTenths.get(source) ?? 0) + 1);
  }

  return presentSources.map((source) => ({
    source,
    count: counts.get(source) ?? 0,
    assetSharePct: (flooredTenths.get(source) ?? 0) / TENTHS_PER_PERCENT,
  }));
}
