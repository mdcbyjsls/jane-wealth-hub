import { describe, it, expect } from 'vitest';

import { computeActualAllocation } from '@/lib/calculations/allocation';
import type { AssetClass, ClassTotals } from '@/types/accounts';

/**
 * Unit tests for `computeActualAllocation` (Task 8.3).
 *
 * `computeActualAllocation(totals)` converts dollar-per-class totals into display percentages that
 * always sum to exactly 100.0 with one decimal place (R3.2, R3.4), or all 0 when the four class
 * dollars sum to 0 (R3.3, R6.5). The non-zero path uses the largest-remainder method so the four
 * one-decimal percentages sum to exactly 100 even when naive independent rounding would land on
 * 99.9 or 100.1.
 *
 * These example-based tests complement the Property 5 test in
 * `computeActualAllocation.property.test.ts` (which is NOT overwritten here).
 *
 * _Requirements: 3.3, 3.4_
 */

/** The four class keys, matching the module's own iteration/tie-break order. */
const ASSET_CLASS_KEYS: readonly AssetClass[] = ['stocks', 'bonds', 'cash', 'other'];

/** Builds a `ClassTotals` from a partial, defaulting unspecified classes to 0 dollars. */
function totals(partial: Partial<ClassTotals>): ClassTotals {
  return { stocks: 0, bonds: 0, cash: 0, other: 0, ...partial };
}

/** True when `value` carries at most one decimal place (value * 10 is an integer). */
function hasAtMostOneDecimal(value: number): boolean {
  const tenths = value * 10;
  return Math.abs(tenths - Math.round(tenths)) < 1e-9;
}

/** Sum of the four displayed percentages for a result. */
function sumPercentages(percentages: Record<AssetClass, number>): number {
  return ASSET_CLASS_KEYS.reduce((acc, key) => acc + percentages[key], 0);
}

describe('computeActualAllocation', () => {
  it('zero-total path: all four class dollars 0 → all percentages 0, isZeroTotal true, totalAssetValue 0 (R3.3, R6.5)', () => {
    const result = computeActualAllocation(totals({}));

    expect(result.isZeroTotal).toBe(true);
    expect(result.totalAssetValue).toBe(0);
    expect(result.percentages).toEqual({ stocks: 0, bonds: 0, cash: 0, other: 0 });
    // classDollars echoes the (zero) input totals.
    expect(result.classDollars).toEqual({ stocks: 0, bonds: 0, cash: 0, other: 0 });
  });

  it('assigns the largest-remainder residual so a naive-99.9 split sums to exactly 100 (R3.4)', () => {
    // Three classes at a third each. Each ideal share is 1000/3 = 333.33 tenths; flooring to 333
    // tenths leaves the four flooring to 999 tenths, one tenth short. Naive independent rounding
    // would give 33.3 + 33.3 + 33.3 + 0 = 99.9. The leftover tenth is handed to the largest
    // dropped remainder; all three tie at ~0.33, so ASSET_CLASS_KEYS order breaks the tie toward
    // `stocks`, which becomes 33.4.
    const result = computeActualAllocation(
      totals({ stocks: 100_000, bonds: 100_000, cash: 100_000 }),
    );

    expect(result.isZeroTotal).toBe(false);
    expect(result.totalAssetValue).toBe(300_000);
    expect(result.percentages).toEqual({
      stocks: 33.4,
      bonds: 33.3,
      cash: 33.3,
      other: 0,
    });
    expect(sumPercentages(result.percentages)).toBeCloseTo(100, 9);
  });

  it('assigns the largest-remainder residual so a naive-100.1 split sums to exactly 100 (R3.4)', () => {
    // Shares of 1/6, 1/6, 1/6, 1/2 → ideal tenths 166.66, 166.66, 166.66, 500.0. Flooring the three
    // sixths to 166 tenths each and the half to 500 sums to 998 tenths, two short. Naive rounding
    // of 16.666… up to 16.7 for all three sixths would give 16.7 * 3 + 50 = 100.1. Here the two
    // leftover tenths go to the two largest dropped remainders (the sixths, ~0.66), broken toward
    // the earlier ASSET_CLASS_KEYS, so stocks and bonds become 16.7 and cash stays 16.6.
    const result = computeActualAllocation(
      totals({ stocks: 100_000, bonds: 100_000, cash: 100_000, other: 300_000 }),
    );

    expect(result.isZeroTotal).toBe(false);
    expect(result.totalAssetValue).toBe(600_000);
    expect(result.percentages).toEqual({
      stocks: 16.7,
      bonds: 16.7,
      cash: 16.6,
      other: 50,
    });
    expect(sumPercentages(result.percentages)).toBeCloseTo(100, 9);
  });

  it('clean even split: 25/25/25/25 passes through untouched and sums to 100 (R3.2, R3.4)', () => {
    const result = computeActualAllocation(
      totals({ stocks: 250_000, bonds: 250_000, cash: 250_000, other: 250_000 }),
    );

    expect(result.isZeroTotal).toBe(false);
    expect(result.totalAssetValue).toBe(1_000_000);
    expect(result.percentages).toEqual({
      stocks: 25,
      bonds: 25,
      cash: 25,
      other: 25,
    });
    expect(sumPercentages(result.percentages)).toBe(100);
  });

  it('on the non-zero path every percentage has at most one decimal place and the four sum to exactly 100', () => {
    // A deliberately uneven, non-round split that exercises the rounding+residual machinery.
    const cases: ClassTotals[] = [
      totals({ stocks: 100_000, bonds: 100_000, cash: 100_000 }),
      totals({ stocks: 100_000, bonds: 100_000, cash: 100_000, other: 300_000 }),
      totals({ stocks: 333, bonds: 333, cash: 333, other: 1 }),
      totals({ stocks: 1, bonds: 2, cash: 3, other: 4 }),
      totals({ stocks: 987_654, bonds: 12_345, cash: 6_789, other: 54_321 }),
    ];

    for (const input of cases) {
      const result = computeActualAllocation(input);

      expect(result.isZeroTotal).toBe(false);
      for (const key of ASSET_CLASS_KEYS) {
        expect(hasAtMostOneDecimal(result.percentages[key])).toBe(true);
      }
      // Sum to exactly 100: compare in integer tenths so float noise from the divide-by-10 can't
      // turn a true 100.0 into 99.99999999.
      const sumTenths = ASSET_CLASS_KEYS.reduce(
        (acc, key) => acc + Math.round(result.percentages[key] * 10),
        0,
      );
      expect(sumTenths).toBe(1000);
    }
  });
});
