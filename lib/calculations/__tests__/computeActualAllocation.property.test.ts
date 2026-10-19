import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { computeActualAllocation } from '@/lib/calculations/allocation';
import type { AssetClass, ClassTotals } from '@/types/accounts';

/**
 * Property-based test for `computeActualAllocation` (Task 8.4).
 *
 * Property 5 (design.md): "Actual allocation percentages sum to exactly 100 (or all zero). For any
 * set of accounts with a positive total asset value, the four rounded Actual_Allocation percentages
 * are each expressed to at most one decimal place and sum to exactly 100; when the total asset
 * value is zero, all four percentages are 0."
 *
 * Validates: Requirements 3.2, 3.3, 3.4, 6.5
 *
 * The arbitrary generates `ClassTotals` directly as four non-negative, finite dollar amounts in a
 * realistic range (0 .. 1e9). `minLength`-style mixing of zeros is achieved by letting the lower
 * bound be 0 and oneof-ing a pure-zero generator in, so the zero-total path (every class 0) is
 * exercised alongside the positive-total path.
 */

/** The four class keys, matching the module's own iteration order. */
const ASSET_CLASS_KEYS: readonly AssetClass[] = ['stocks', 'bonds', 'cash', 'other'];

/** One decimal place => tenths scale of 10. */
const TENTHS = 10;
/** 100.0% expressed in integer tenths. */
const TARGET_TOTAL_TENTHS = 1000;
/** Float-noise tolerance for the single divide-by-10 the implementation performs. */
const EPSILON = 1e-9;

/**
 * A single non-negative, finite dollar amount. Zero is included in the range so individual classes
 * can be empty; `noNaN` / `noDefaultInfinity` keep values finite so totals stay well-defined.
 */
const classDollarArb = fc.double({
  min: 0,
  max: 1e9,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * `ClassTotals` arbitrary. Most draws are four independent non-negative doubles; a fraction are the
 * all-zero totals, so the zero-total branch (R3.3, R6.5) is hit with meaningful frequency rather
 * than relying on four independent doubles all landing on exactly 0.
 */
const classTotalsArb: fc.Arbitrary<ClassTotals> = fc.oneof(
  { weight: 9, arbitrary: fc.record<ClassTotals>({
    stocks: classDollarArb,
    bonds: classDollarArb,
    cash: classDollarArb,
    other: classDollarArb,
  }) },
  { weight: 1, arbitrary: fc.constant<ClassTotals>({ stocks: 0, bonds: 0, cash: 0, other: 0 }) },
);

describe('computeActualAllocation — Property 5 (percentages sum to exactly 100, or all zero)', () => {
  // Feature: consolidated-net-worth-view, Property 5: Actual allocation percentages sum to exactly 100 (or all zero)
  it('rounds to one decimal and sums to exactly 100, or is all-zero when the total is zero', () => {
    fc.assert(
      fc.property(classTotalsArb, (totals) => {
        const inputSum = ASSET_CLASS_KEYS.reduce((acc, key) => acc + totals[key], 0);
        const result = computeActualAllocation(totals);

        if (inputSum === 0) {
          // Zero-total path (R3.3, R6.5): every percentage is exactly 0.
          expect(result.isZeroTotal).toBe(true);
          for (const key of ASSET_CLASS_KEYS) {
            expect(result.percentages[key]).toBe(0);
          }
          return;
        }

        // Positive-total path (R3.2, R3.4).
        expect(result.isZeroTotal).toBe(false);

        // (a) Each percentage has at most one decimal place: p * 10 is an integer. Compare in
        // tenths with a tiny epsilon to absorb any float noise from the final divide-by-10.
        let sumTenths = 0;
        let sumPercent = 0;
        for (const key of ASSET_CLASS_KEYS) {
          const p = result.percentages[key];
          const tenths = Math.round(p * TENTHS);
          expect(Math.abs(p * TENTHS - tenths)).toBeLessThan(EPSILON);
          sumTenths += tenths;
          sumPercent += p;
        }

        // (b) The four percentages sum to EXACTLY 100: exact in integer tenths (=1000), and within
        // a tiny epsilon in raw percent to double-check the float representation.
        expect(sumTenths).toBe(TARGET_TOTAL_TENTHS);
        expect(Math.abs(sumPercent - 100)).toBeLessThan(EPSILON);
      }),
      { numRuns: 100 },
    );
  });
});
