import { describe, it, expect } from 'vitest';

import { computeAccountFreshness } from '@/lib/calculations/freshness';
import type { Account } from '@/types/accounts';

/**
 * Unit tests for `computeAccountFreshness` (Task 5.1).
 *
 * `computeAccountFreshness(account, now)` returns a Source-aware `AccountFreshnessStatus`:
 *   - Manual_Accounts are EXEMPT from the Stale_Rule — `isStale` is always false regardless of
 *     `lastUpdatedDaysAgo`, and the status exposes the "Updated by you on [date]" basis drawn from
 *     `updatedByYouDate` (R5.1, R5.2).
 *   - Sample_Accounts and Connected_Accounts keep the Spec 1 three-day Stale_Rule: stale IFF
 *     `lastUpdatedDaysAgo > 3` (R5.4).
 *   - `lastUpdated` is derived for every Source as `now − lastUpdatedDaysAgo days`.
 *
 * All tests use a FIXED `now` so derived dates are fully deterministic.
 *
 * _Requirements: 5.1, 5.4_
 */

/** Milliseconds in one day — mirrors the derivation inside `computeAccountFreshness`. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A fixed reference "now" so every derived `now − daysAgo` date is deterministic. */
const NOW = new Date('2026-10-14T12:00:00.000Z');

/**
 * Builds a complete `Account` from a partial override so each test states only the fields it cares
 * about. Defaults are a well-formed non-liability Sample brokerage account whose breakdown sums to
 * 100.
 */
function acct(partial: Partial<Account>): Account {
  return {
    id: 'acct-test',
    source: 'Sample',
    institution: 'Test',
    accountName: 'Test Account',
    accountType: 'brokerage',
    balance: 0,
    assetClassBreakdown: { stocks: 100, bonds: 0, cash: 0, other: 0 },
    lastUpdatedDaysAgo: 0,
    ...partial,
  };
}

/** The derived absolute `lastUpdated` date for a given days-ago offset against the fixed NOW. */
function derivedDate(daysAgo: number): Date {
  return new Date(NOW.getTime() - daysAgo * MS_PER_DAY);
}

describe('computeAccountFreshness', () => {
  describe('Manual_Accounts (R5.1, R5.2)', () => {
    it('is never stale, even far beyond the three-day threshold', () => {
      const status = computeAccountFreshness(
        acct({ source: 'Manual', lastUpdatedDaysAgo: 365, updatedByYouDate: '2025-10-14' }),
        NOW,
      );

      expect(status.isStale).toBe(false);
    });

    it('is never stale at the exact threshold or one day past it', () => {
      const atThreshold = computeAccountFreshness(
        acct({ source: 'Manual', lastUpdatedDaysAgo: 3, updatedByYouDate: '2026-10-11' }),
        NOW,
      );
      const pastThreshold = computeAccountFreshness(
        acct({ source: 'Manual', lastUpdatedDaysAgo: 4, updatedByYouDate: '2026-10-10' }),
        NOW,
      );

      expect(atThreshold.isStale).toBe(false);
      expect(pastThreshold.isStale).toBe(false);
    });

    it('exposes the "Updated by you" basis with the parsed updatedByYouDate', () => {
      const status = computeAccountFreshness(
        acct({ source: 'Manual', lastUpdatedDaysAgo: 2, updatedByYouDate: '2026-10-12' }),
        NOW,
      );

      expect(status.basis).toEqual({ kind: 'updatedByYou', date: new Date('2026-10-12') });
    });

    it('falls back to a null date (never stale) when updatedByYouDate is missing', () => {
      const status = computeAccountFreshness(
        acct({ source: 'Manual', lastUpdatedDaysAgo: 10, updatedByYouDate: undefined }),
        NOW,
      );

      expect(status.isStale).toBe(false);
      expect(status.basis).toEqual({ kind: 'updatedByYou', date: null });
    });

    it('falls back to a null date when updatedByYouDate is unparseable', () => {
      const status = computeAccountFreshness(
        acct({ source: 'Manual', lastUpdatedDaysAgo: 1, updatedByYouDate: 'not-a-date' }),
        NOW,
      );

      expect(status.isStale).toBe(false);
      expect(status.basis).toEqual({ kind: 'updatedByYou', date: null });
    });

    it('still derives lastUpdated from now minus lastUpdatedDaysAgo', () => {
      const status = computeAccountFreshness(
        acct({ source: 'Manual', lastUpdatedDaysAgo: 5, updatedByYouDate: '2026-10-09' }),
        NOW,
      );

      expect(status.lastUpdated).toEqual(derivedDate(5));
    });
  });

  describe('Sample_Accounts and Connected_Accounts follow the three-day Stale_Rule (R5.4)', () => {
    it('treats lastUpdatedDaysAgo === 3 as NOT stale for a Sample_Account', () => {
      const status = computeAccountFreshness(acct({ source: 'Sample', lastUpdatedDaysAgo: 3 }), NOW);

      expect(status.isStale).toBe(false);
      expect(status.basis).toEqual({ kind: 'staleness' });
    });

    it('treats lastUpdatedDaysAgo === 4 as STALE for a Sample_Account', () => {
      const status = computeAccountFreshness(acct({ source: 'Sample', lastUpdatedDaysAgo: 4 }), NOW);

      expect(status.isStale).toBe(true);
      expect(status.basis).toEqual({ kind: 'staleness' });
    });

    it('treats lastUpdatedDaysAgo === 3 as NOT stale for a Connected_Account', () => {
      const status = computeAccountFreshness(
        acct({ source: 'Connected', lastUpdatedDaysAgo: 3 }),
        NOW,
      );

      expect(status.isStale).toBe(false);
      expect(status.basis).toEqual({ kind: 'staleness' });
    });

    it('treats lastUpdatedDaysAgo === 4 as STALE for a Connected_Account', () => {
      const status = computeAccountFreshness(
        acct({ source: 'Connected', lastUpdatedDaysAgo: 4 }),
        NOW,
      );

      expect(status.isStale).toBe(true);
      expect(status.basis).toEqual({ kind: 'staleness' });
    });

    it('derives lastUpdated from now minus lastUpdatedDaysAgo', () => {
      const status = computeAccountFreshness(
        acct({ source: 'Connected', lastUpdatedDaysAgo: 7 }),
        NOW,
      );

      expect(status.lastUpdated).toEqual(derivedDate(7));
    });
  });
});
