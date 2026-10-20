import { describe, it, expect } from 'vitest';

import { projectByClass } from '@/lib/calculations/projectByClass';
import { projectSeries, ASSET_CLASS_KEYS } from '@/lib/calculations/projection';
import type { ClassTotals } from '@/types/accounts';
import type { ReturnModel } from '@/types/market';

/**
 * Example-based unit tests for the pure `projectByClass` helper (Spec 4, Task 2.6).
 *
 * The oracle is the Spec 2 `projectSeries` applied independently per class — projectByClass must
 * equal exactly that, with no rebalancing, so the mix drifts over the horizon.
 */

const CURRENT_YEAR = 2026;

const RETURN_MODEL: ReturnModel = {
  stocks: { returnPercent: 8, label: 'Stocks', source: 'test' },
  bonds: { returnPercent: 4, label: 'Bonds', source: 'test' },
  cash: { returnPercent: 2, label: 'Cash', source: 'test' },
  other: { returnPercent: 4, label: 'Other', source: 'test' },
};

const CLASS_DOLLARS: ClassTotals = {
  stocks: 100_000,
  bonds: 50_000,
  cash: 20_000,
  other: 10_000,
};

describe('projectByClass — independent per-class growth, no rebalancing', () => {
  it('each class equals an independent projectSeries at its own rate with zero contribution', () => {
    const byClass = projectByClass(CLASS_DOLLARS, RETURN_MODEL, CURRENT_YEAR, 30);

    for (const key of ASSET_CLASS_KEYS) {
      const expected = projectSeries(
        CLASS_DOLLARS[key],
        RETURN_MODEL[key].returnPercent,
        0,
        CURRENT_YEAR,
        30,
      );
      expect(byClass[key]).toEqual(expected);
    }
  });

  it('year-0 values equal the starting per-class dollars', () => {
    const byClass = projectByClass(CLASS_DOLLARS, RETURN_MODEL, CURRENT_YEAR, 30);
    for (const key of ASSET_CLASS_KEYS) {
      expect(byClass[key][0].year).toBe(CURRENT_YEAR);
      expect(byClass[key][0].value).toBe(CLASS_DOLLARS[key]);
    }
  });

  it('the four series summed at year 0 equal the starting total', () => {
    const byClass = projectByClass(CLASS_DOLLARS, RETURN_MODEL, CURRENT_YEAR, 30);
    const sum0 = ASSET_CLASS_KEYS.reduce((s, k) => s + byClass[k][0].value, 0);
    const total = ASSET_CLASS_KEYS.reduce((s, k) => s + CLASS_DOLLARS[k], 0);
    expect(sum0).toBe(total);
  });

  it('a higher-return class grows to a larger share by year N (drift)', () => {
    const byClass = projectByClass(CLASS_DOLLARS, RETURN_MODEL, CURRENT_YEAR, 30);

    const shareAt = (year: number, key: 'stocks' | 'bonds') => {
      const total = ASSET_CLASS_KEYS.reduce((s, k) => s + byClass[k][year].value, 0);
      return byClass[key][year].value / total;
    };

    // Stocks (8%) outgrow bonds (4%), so the stocks share rises and the bonds share falls over time.
    expect(shareAt(30, 'stocks')).toBeGreaterThan(shareAt(0, 'stocks'));
    expect(shareAt(30, 'bonds')).toBeLessThan(shareAt(0, 'bonds'));
  });

  it('returns maxYears + 1 points per class and defaults the horizon to 30', () => {
    const def = projectByClass(CLASS_DOLLARS, RETURN_MODEL, CURRENT_YEAR);
    for (const key of ASSET_CLASS_KEYS) {
      expect(def[key]).toHaveLength(31);
    }
  });
});
