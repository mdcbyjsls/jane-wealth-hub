/**
 * Sample_Set — the fixed, canonical set of Sample_Accounts the app ships with (R6.3, R7.2).
 *
 * This is the Spec 1 `data/accounts.json` set upgraded to the extended `Account` shape: every
 * account gains a stable `id`, `source: 'Sample'`, and a human-readable `accountName`. The set is
 * used to seed a first-time visitor's `Account_Store` (R7.2) and to repopulate on
 * "Restore sample data" (R6.3).
 *
 * This module is PURE data plus a builder: it imports only `@/types/accounts`, performs no fetch,
 * reads no clock and no `localStorage`, and imports nothing from `app/`, `components/`, or
 * `lib/fred/`. The `id`s are hard-coded (not generated) so the canonical set is byte-stable across
 * reloads — "Restore sample data" must be idempotent (R6.4), which requires the Sample_Set's ids to
 * be fixed rather than freshly minted on each build.
 *
 * Freshness is stored as the relative `lastUpdatedDaysAgo` offset (not an absolute date) so the
 * sample data never decays into looking stale as real time passes; the absolute `lastUpdated` date
 * is derived at the boundary by the pure freshness calculator (see the `lastUpdatedDaysAgo` note on
 * `Account`).
 */

import type { Account } from '@/types/accounts';

/**
 * The stable identifier prefix for every canonical Sample_Account. Keeping a shared,
 * human-readable prefix makes a Sample_Account's origin obvious in storage and logs, and lets the
 * store recognize the canonical set when enforcing the idempotence of "Restore sample data".
 */
const SAMPLE_ID_PREFIX = 'sample-';

/**
 * The canonical Sample_Account definitions in display order. This is the single source of truth for
 * the shipped sample data; `buildSampleSet` turns it into fresh `Account` objects. Each entry
 * mirrors a Spec 1 `data/accounts.json` row, extended with a stable `id` and an `accountName`.
 *
 * The two Ally Bank rows intentionally keep the original (differently cased) institution strings
 * from Spec 1 so the case-insensitive institution grouping stays exercised by the sample data.
 */
const SAMPLE_ACCOUNT_DEFINITIONS: ReadonlyArray<Omit<Account, 'source'>> = [
  {
    id: `${SAMPLE_ID_PREFIX}fidelity-brokerage`,
    institution: 'Fidelity',
    accountName: 'Individual Brokerage',
    accountType: 'brokerage',
    balance: 320000,
    assetClassBreakdown: { stocks: 72, bonds: 10, cash: 3, other: 15 },
    lastUpdatedDaysAgo: 0,
  },
  {
    id: `${SAMPLE_ID_PREFIX}fidelity-roth-ira`,
    institution: 'Fidelity',
    accountName: 'Roth IRA',
    accountType: 'Roth IRA',
    balance: 180000,
    assetClassBreakdown: { stocks: 80, bonds: 15, cash: 5, other: 0 },
    lastUpdatedDaysAgo: 1,
  },
  {
    id: `${SAMPLE_ID_PREFIX}vanguard-401k`,
    institution: 'Vanguard',
    accountName: 'Workplace 401(k)',
    accountType: '401(k)',
    balance: 350000,
    assetClassBreakdown: { stocks: 65, bonds: 30, cash: 5, other: 0 },
    lastUpdatedDaysAgo: 2,
  },
  {
    id: `${SAMPLE_ID_PREFIX}vanguard-ira`,
    institution: 'Vanguard',
    accountName: 'Traditional IRA',
    accountType: 'IRA',
    balance: 150000,
    assetClassBreakdown: { stocks: 55, bonds: 35, cash: 10, other: 0 },
    lastUpdatedDaysAgo: 1,
  },
  {
    id: `${SAMPLE_ID_PREFIX}ally-hysa-primary`,
    institution: 'Ally Bank',
    accountName: 'High-Yield Savings',
    accountType: 'HYSA',
    balance: 60000,
    assetClassBreakdown: { stocks: 0, bonds: 0, cash: 100, other: 0 },
    lastUpdatedDaysAgo: 5,
  },
  {
    id: `${SAMPLE_ID_PREFIX}ally-hysa-emergency`,
    institution: 'ally bank',
    accountName: 'Emergency Fund',
    accountType: 'HYSA',
    balance: 40000,
    assetClassBreakdown: { stocks: 0, bonds: 0, cash: 100, other: 0 },
    lastUpdatedDaysAgo: 2,
  },
  {
    id: `${SAMPLE_ID_PREFIX}chase-checking`,
    institution: 'Chase',
    accountName: 'Everyday Checking',
    accountType: 'checking',
    balance: 25000,
    assetClassBreakdown: { stocks: 0, bonds: 0, cash: 100, other: 0 },
    lastUpdatedDaysAgo: 0,
  },
  {
    id: `${SAMPLE_ID_PREFIX}sallie-mae-student-loan`,
    institution: 'Sallie Mae',
    accountName: 'Student Loan',
    accountType: 'liability',
    balance: 32000,
    assetClassBreakdown: { stocks: 0, bonds: 0, cash: 0, other: 0 },
    lastUpdatedDaysAgo: 1,
  },
];

/**
 * Build a fresh copy of the canonical Sample_Set (R6.3, R7.2).
 *
 * Returns brand-new `Account` objects (and new nested `assetClassBreakdown` objects) on every call,
 * each stamped `source: 'Sample'`, so callers can freely mutate the result — e.g. when the user
 * edits a Sample_Account into a Manual_Account — without corrupting the shared canonical template.
 * The returned ids are the fixed, canonical ids, which is what makes "Restore sample data"
 * idempotent (R6.4).
 */
export function buildSampleSet(): Account[] {
  return SAMPLE_ACCOUNT_DEFINITIONS.map((definition) => ({
    ...definition,
    source: 'Sample',
    assetClassBreakdown: { ...definition.assetClassBreakdown },
  }));
}

/**
 * The canonical Sample_Set as a ready-to-use value. This is a one-off snapshot for read-only
 * consumers; any caller that will mutate the accounts (seeding a mutable store, converting a sample
 * to manual) MUST use `buildSampleSet()` to get its own fresh, independently mutable copy.
 */
export const SAMPLE_SET: readonly Account[] = buildSampleSet();

/** The set of canonical Sample_Account ids, useful for recognizing the shipped sample data. */
export const SAMPLE_ACCOUNT_IDS: ReadonlySet<string> = new Set(
  SAMPLE_ACCOUNT_DEFINITIONS.map((definition) => definition.id),
);
