import { describe, it, expect } from 'vitest';

import { computeFreshness } from '@/lib/calculations/allocation';
import type { Account } from '@/types/accounts';

/**
 * Unit tests for `computeFreshness` (Task 10.2).
 *
 * `computeFreshness(accounts, now)` returns `{ byInstitution: InstitutionFreshness[] }` where each
 * entry carries:
 *   - `institution`: the first-seen original casing for a case-insensitive group,
 *   - `asOf`: the MOST RECENT derived `lastUpdated` among the group's accounts — equivalently the
 *     member with the SMALLEST `lastUpdatedDaysAgo`, derived as `now − lastUpdatedDaysAgo days`
 *     (R8.1, R8.2),
 *   - `isStale`: true IFF any member account is stale, where an account is stale IFF
 *     `lastUpdatedDaysAgo > 3` — strictly more than the 3-day Freshness_Threshold (R8.3).
 *
 * An empty account set yields `{ byInstitution: [] }`.
 *
 * All tests use a FIXED `now` so derived dates are fully deterministic.
 *
 * _Requirements: 8.1, 8.2, 8.3 (Properties 18, 19)_
 */

/** Milliseconds in one day — mirrors the derivation inside `computeFreshness`. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A fixed reference "now" so every derived `now − daysAgo` date is deterministic. */
const NOW = new Date('2026-10-14T12:00:00.000Z');

/**
 * Builds a complete `Account` from a partial override so each test states only the fields it cares
 * about (institution / lastUpdatedDaysAgo). Defaults are a well-formed non-liability brokerage
 * account whose breakdown sums to 100; `computeFreshness` only reads `institution` and
 * `lastUpdatedDaysAgo`, but keeping the rest valid keeps the fixtures honest.
 */
function acct(partial: Partial<Account>): Account {
  return {
    institution: 'Test',
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

describe('computeFreshness', () => {
  it('yields an empty byInstitution array for an empty account set', () => {
    expect(computeFreshness([], NOW)).toEqual({ byInstitution: [] });
  });

  it('treats lastUpdatedDaysAgo === 3 as NOT stale (exactly the 3-day threshold) (R8.3, Property 19)', () => {
    const result = computeFreshness([acct({ institution: 'Fidelity', lastUpdatedDaysAgo: 3 })], NOW);

    expect(result.byInstitution).toHaveLength(1);
    expect(result.byInstitution[0].isStale).toBe(false);
  });

  it('treats lastUpdatedDaysAgo === 4 as STALE (strictly more than 3 days) (R8.3, Property 19)', () => {
    const result = computeFreshness([acct({ institution: 'Fidelity', lastUpdatedDaysAgo: 4 })], NOW);

    expect(result.byInstitution).toHaveLength(1);
    expect(result.byInstitution[0].isStale).toBe(true);
  });

  it('resolves asOf to the MOST RECENT (smallest days-ago) member within one institution (R8.1, R8.2, Property 18)', () => {
    // Three members of the same institution at differing offsets; the smallest offset (1 day ago)
    // is the most recent derived date and must win regardless of input order.
    const result = computeFreshness(
      [
        acct({ institution: 'Vanguard', lastUpdatedDaysAgo: 10 }),
        acct({ institution: 'Vanguard', lastUpdatedDaysAgo: 1 }),
        acct({ institution: 'Vanguard', lastUpdatedDaysAgo: 5 }),
      ],
      NOW,
    );

    expect(result.byInstitution).toHaveLength(1);
    // asOf is now minus the SMALLEST offset (1 day), not the first-seen or largest.
    expect(result.byInstitution[0].asOf).toEqual(derivedDate(1));
  });

  it('derives asOf as EXACTLY now minus the smallest lastUpdatedDaysAgo for that institution', () => {
    const result = computeFreshness(
      [
        acct({ institution: 'Chase', lastUpdatedDaysAgo: 7 }),
        acct({ institution: 'Chase', lastUpdatedDaysAgo: 2 }),
      ],
      NOW,
    );

    const expectedAsOf = new Date(NOW.getTime() - 2 * MS_PER_DAY);
    expect(result.byInstitution[0].asOf.getTime()).toBe(expectedAsOf.getTime());
  });

  it('marks an institution stale IFF at least one member account is stale (R8.3, Property 19)', () => {
    // One fresh member (2 days) and one stale member (6 days): the institution is stale because at
    // least one member crosses the threshold, even though the most recent member is fresh.
    const result = computeFreshness(
      [
        acct({ institution: 'Ally Bank', lastUpdatedDaysAgo: 2 }),
        acct({ institution: 'Ally Bank', lastUpdatedDaysAgo: 6 }),
      ],
      NOW,
    );

    expect(result.byInstitution).toHaveLength(1);
    expect(result.byInstitution[0].isStale).toBe(true);
    // asOf still tracks the most recent member (2 days ago), independent of staleness.
    expect(result.byInstitution[0].asOf).toEqual(derivedDate(2));
  });

  it('keeps an institution NOT stale when every member is within the 3-day threshold (R8.3)', () => {
    const result = computeFreshness(
      [
        acct({ institution: 'Schwab', lastUpdatedDaysAgo: 0 }),
        acct({ institution: 'Schwab', lastUpdatedDaysAgo: 3 }),
      ],
      NOW,
    );

    expect(result.byInstitution).toHaveLength(1);
    expect(result.byInstitution[0].isStale).toBe(false);
    expect(result.byInstitution[0].asOf).toEqual(derivedDate(0));
  });

  it('reports one entry per institution with independent asOf and staleness', () => {
    const result = computeFreshness(
      [
        acct({ institution: 'Fidelity', lastUpdatedDaysAgo: 1 }),
        acct({ institution: 'Vanguard', lastUpdatedDaysAgo: 8 }),
      ],
      NOW,
    );

    expect(result.byInstitution).toHaveLength(2);

    const fidelity = result.byInstitution.find((f) => f.institution === 'Fidelity');
    const vanguard = result.byInstitution.find((f) => f.institution === 'Vanguard');

    expect(fidelity).toBeDefined();
    expect(vanguard).toBeDefined();
    expect(fidelity?.isStale).toBe(false);
    expect(fidelity?.asOf).toEqual(derivedDate(1));
    expect(vanguard?.isStale).toBe(true);
    expect(vanguard?.asOf).toEqual(derivedDate(8));
  });
});
