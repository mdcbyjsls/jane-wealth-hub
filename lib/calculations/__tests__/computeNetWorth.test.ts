import { describe, it, expect } from 'vitest';

import { computeNetWorth } from '@/lib/calculations/allocation';
import type { Account } from '@/types/accounts';

/**
 * Unit tests for `computeNetWorth` (Task 5.2).
 *
 * `computeNetWorth(accounts)` returns `{ totalAssets, totalLiabilities, netWorth }` where:
 *   - totalAssets = sum of every non-liability account balance,
 *   - totalLiabilities = sum of every `liability` account balance (stored POSITIVE),
 *   - netWorth = totalAssets - totalLiabilities (may be negative, R1.4).
 * An empty account set yields zeros for all three (R1.1 / R6.4).
 *
 * _Requirements: 1.1, 1.4, 6.4_
 */

/**
 * Builds a complete `Account` from a partial override so each test states only the fields it
 * cares about (balance / accountType). Defaults are a well-formed non-liability brokerage account
 * whose breakdown sums to 100; computeNetWorth ignores the breakdown and freshness, but keeping
 * them valid keeps the fixtures honest.
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

describe('computeNetWorth', () => {
  it('returns all zeros for an empty account set (R1.1, R6.4)', () => {
    expect(computeNetWorth([])).toEqual({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
    });
  });

  it('sums asset balances with no liabilities; netWorth equals totalAssets (R1.1)', () => {
    const accounts: Account[] = [
      acct({ accountType: 'brokerage', balance: 500_000 }),
      acct({ accountType: 'IRA', balance: 250_000 }),
      acct({ accountType: 'checking', balance: 25_000 }),
    ];

    const result = computeNetWorth(accounts);

    expect(result.totalAssets).toBe(775_000);
    expect(result.totalLiabilities).toBe(0);
    expect(result.netWorth).toBe(775_000);
    expect(result.netWorth).toBe(result.totalAssets);
  });

  it('subtracts a liability from mixed assets (assets 1,125,000 − liability 32,000 = 1,093,000)', () => {
    const accounts: Account[] = [
      acct({ accountType: 'brokerage', balance: 600_000 }),
      acct({ accountType: '401(k)', balance: 400_000 }),
      acct({ accountType: 'HYSA', balance: 125_000 }),
      acct({
        accountType: 'liability',
        balance: 32_000,
        assetClassBreakdown: { stocks: 0, bonds: 0, cash: 0, other: 0 },
      }),
    ];

    const result = computeNetWorth(accounts);

    expect(result.totalAssets).toBe(1_125_000);
    expect(result.totalLiabilities).toBe(32_000);
    expect(result.netWorth).toBe(1_093_000);
  });

  it('produces a NEGATIVE net worth when liabilities exceed assets (assets 10,000, liability 25,000 → -15,000) (R1.4)', () => {
    const accounts: Account[] = [
      acct({ accountType: 'checking', balance: 10_000 }),
      acct({
        accountType: 'liability',
        balance: 25_000,
        assetClassBreakdown: { stocks: 0, bonds: 0, cash: 0, other: 0 },
      }),
    ];

    const result = computeNetWorth(accounts);

    expect(result.totalAssets).toBe(10_000);
    expect(result.totalLiabilities).toBe(25_000);
    expect(result.netWorth).toBe(-15_000);
    expect(result.netWorth).toBeLessThan(0);
  });

  it('returns all zeros when every balance is zero across multiple accounts', () => {
    const accounts: Account[] = [
      acct({ accountType: 'brokerage', balance: 0 }),
      acct({ accountType: 'checking', balance: 0 }),
      acct({
        accountType: 'liability',
        balance: 0,
        assetClassBreakdown: { stocks: 0, bonds: 0, cash: 0, other: 0 },
      }),
    ];

    expect(computeNetWorth(accounts)).toEqual({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
    });
  });

  it('treats liability balances as POSITIVE sums that are SUBTRACTED, not added (R1.1)', () => {
    const accounts: Account[] = [
      acct({ accountType: 'brokerage', balance: 100_000 }),
      acct({
        accountType: 'liability',
        balance: 15_000,
        assetClassBreakdown: { stocks: 0, bonds: 0, cash: 0, other: 0 },
      }),
      acct({
        accountType: 'liability',
        balance: 5_000,
        assetClassBreakdown: { stocks: 0, bonds: 0, cash: 0, other: 0 },
      }),
    ];

    const result = computeNetWorth(accounts);

    // totalLiabilities is the POSITIVE sum (20,000), never negated.
    expect(result.totalLiabilities).toBe(20_000);
    expect(result.totalLiabilities).toBeGreaterThan(0);
    // ...and it is subtracted from assets: 100,000 − 20,000 = 80,000 (not 120,000).
    expect(result.totalAssets).toBe(100_000);
    expect(result.netWorth).toBe(80_000);
  });
});
