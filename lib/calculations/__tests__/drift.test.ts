import { describe, it, expect } from 'vitest';

import {
  ON_TRACK_THRESHOLD,
  classifyDrift,
  computeDrift,
  computeOnTrackStatus,
} from '@/lib/calculations/allocation';
import type {
  AllocationResult,
  AssetClass,
  ClassTotals,
  DriftResult,
  TargetAllocation,
} from '@/types/accounts';

/**
 * Unit tests for the drift and on-track-status functions (Task 9.4):
 *   - `classifyDrift(driftPoints)` → direction against the ±5 On_Track_Threshold, INCLUSIVE at both
 *     edges (R4.3–R4.5).
 *   - `computeDrift(actual, totals, target)` → per-class `driftPoints` (actual% − target%) and
 *     `driftDollars` (actual$ − target-implied$), plus `offTargetCount` and the `largest` off-target
 *     class by absolute point drift (R4.1, R4.8, R4.9).
 *   - `computeOnTrackStatus(drift)` → "On track" vs "N of 4 asset classes off target" label and the
 *     plain-language largest-drift sentence (R4.6–R4.9).
 *
 * `ON_TRACK_THRESHOLD` is imported (not hard-coded as 5) so these tests pin to the one source of
 * truth: if the band ever moves, the boundary assertions move with it.
 *
 * _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_
 */

/**
 * Builds an `AllocationResult` from the four one-decimal percentages. `classDollars` /
 * `totalAssetValue` are derived from a supplied `totalAssetValue` so `computeDrift`'s dollar math
 * has a real basis; `computeDrift` reads `percentages` and `totalAssetValue` from here and takes the
 * dollar `totals` separately, matching its signature.
 */
function allocation(
  percentages: Record<AssetClass, number>,
  totalAssetValue: number,
): AllocationResult {
  const classDollars: ClassTotals = {
    stocks: (percentages.stocks / 100) * totalAssetValue,
    bonds: (percentages.bonds / 100) * totalAssetValue,
    cash: (percentages.cash / 100) * totalAssetValue,
    other: (percentages.other / 100) * totalAssetValue,
  };
  return {
    percentages,
    classDollars,
    totalAssetValue,
    isZeroTotal: totalAssetValue === 0,
  };
}

/** Builds a `TargetAllocation` from the four integer percentages. */
function target(
  stocks: number,
  bonds: number,
  cash: number,
  other: number,
): TargetAllocation {
  return { stocks, bonds, cash, other, isExample: false };
}

describe('classifyDrift (R4.3–R4.5)', () => {
  it('treats 0 drift as on track', () => {
    expect(classifyDrift(0).direction).toBe('on track');
  });

  it('treats exactly +5 (the upper edge) as on track — inclusive band (R4.3)', () => {
    expect(classifyDrift(ON_TRACK_THRESHOLD).direction).toBe('on track');
  });

  it('treats exactly −5 (the lower edge) as on track — inclusive band (R4.3)', () => {
    expect(classifyDrift(-ON_TRACK_THRESHOLD).direction).toBe('on track');
  });

  it('classifies just over +5 as over (R4.4)', () => {
    expect(classifyDrift(ON_TRACK_THRESHOLD + 0.1).direction).toBe('over');
  });

  it('classifies just under −5 as under (R4.5)', () => {
    expect(classifyDrift(-ON_TRACK_THRESHOLD - 0.1).direction).toBe('under');
  });

  it('classifies a large positive drift as over and a large negative drift as under', () => {
    expect(classifyDrift(40).direction).toBe('over');
    expect(classifyDrift(-40).direction).toBe('under');
  });
});

describe('computeDrift (R4.1, R4.8, R4.9)', () => {
  it('computes signed point and dollar drift per class with directions (R4.1)', () => {
    // Target 60/30/5/5; actual 70/20/5/5 on a $1,000,000 portfolio.
    // Stocks: +10 pts over; bonds: −10 pts under; cash/other: 0 pts on track.
    const actual = allocation(
      { stocks: 70, bonds: 20, cash: 5, other: 5 },
      1_000_000,
    );
    const totals: ClassTotals = {
      stocks: 700_000,
      bonds: 200_000,
      cash: 50_000,
      other: 50_000,
    };

    const result = computeDrift(actual, totals, target(60, 30, 5, 5));

    // driftPoints = actual% − target%
    expect(result.byClass.stocks.driftPoints).toBe(10);
    expect(result.byClass.bonds.driftPoints).toBe(-10);
    expect(result.byClass.cash.driftPoints).toBe(0);
    expect(result.byClass.other.driftPoints).toBe(0);

    // driftDollars = actual$ − (target%/100 * totalAssetValue)
    // stocks: 700,000 − 0.60 * 1,000,000 = +100,000
    // bonds:  200,000 − 0.30 * 1,000,000 = −100,000
    expect(result.byClass.stocks.driftDollars).toBe(100_000);
    expect(result.byClass.bonds.driftDollars).toBe(-100_000);
    expect(result.byClass.cash.driftDollars).toBe(0);
    expect(result.byClass.other.driftDollars).toBe(0);

    // direction matches classifyDrift on the same point drift.
    expect(result.byClass.stocks.direction).toBe('over');
    expect(result.byClass.bonds.direction).toBe('under');
    expect(result.byClass.cash.direction).toBe('on track');
    expect(result.byClass.other.direction).toBe('on track');
    for (const key of ['stocks', 'bonds', 'cash', 'other'] as AssetClass[]) {
      expect(result.byClass[key].direction).toBe(
        classifyDrift(result.byClass[key].driftPoints).direction,
      );
    }
  });

  it('counts only over/under classes in offTargetCount (R4.8)', () => {
    // Stocks +10 (over), bonds −10 (under), cash/other on track → 2 off target.
    const actual = allocation(
      { stocks: 70, bonds: 20, cash: 5, other: 5 },
      1_000_000,
    );
    const totals: ClassTotals = {
      stocks: 700_000,
      bonds: 200_000,
      cash: 50_000,
      other: 50_000,
    };

    const result = computeDrift(actual, totals, target(60, 30, 5, 5));

    expect(result.offTargetCount).toBe(2);
  });

  it('picks the off-target class with the largest ABSOLUTE point drift as largest (R4.9)', () => {
    // Stocks +15 (over), bonds −10 (under). Bonds has smaller magnitude; stocks wins.
    const actual = allocation(
      { stocks: 75, bonds: 20, cash: 2.5, other: 2.5 },
      1_000_000,
    );
    const totals: ClassTotals = {
      stocks: 750_000,
      bonds: 200_000,
      cash: 25_000,
      other: 25_000,
    };

    const result = computeDrift(actual, totals, target(60, 30, 5, 5));

    expect(result.largest).not.toBeNull();
    expect(result.largest?.assetClass).toBe('stocks');
    expect(result.largest?.driftPoints).toBe(15);
    expect(result.largest?.direction).toBe('over');
  });

  it('a larger-magnitude UNDER class can win largest over a smaller-magnitude over class (R4.9)', () => {
    // Stocks +6 (over, magnitude 6), bonds −20 (under, magnitude 20). Bonds wins.
    const actual = allocation(
      { stocks: 66, bonds: 10, cash: 12, other: 12 },
      1_000_000,
    );
    const totals: ClassTotals = {
      stocks: 660_000,
      bonds: 100_000,
      cash: 120_000,
      other: 120_000,
    };

    const result = computeDrift(actual, totals, target(60, 30, 4, 6));

    expect(result.largest?.assetClass).toBe('bonds');
    expect(result.largest?.direction).toBe('under');
    expect(Math.abs(result.largest?.driftPoints ?? 0)).toBe(20);
  });

  it('returns largest = null and offTargetCount = 0 when every class is on track (R4.9)', () => {
    // Every class within ±5 of its target (including an exactly +5 edge on stocks).
    const actual = allocation(
      { stocks: 65, bonds: 27, cash: 4, other: 4 },
      1_000_000,
    );
    const totals: ClassTotals = {
      stocks: 650_000,
      bonds: 270_000,
      cash: 40_000,
      other: 40_000,
    };

    const result = computeDrift(actual, totals, target(60, 30, 5, 5));

    expect(result.offTargetCount).toBe(0);
    expect(result.largest).toBeNull();
    // The exactly +5 stocks edge is on track, not over (R4.3).
    expect(result.byClass.stocks.driftPoints).toBe(5);
    expect(result.byClass.stocks.direction).toBe('on track');
  });
});

describe('computeOnTrackStatus (R4.6–R4.9)', () => {
  it('reports "On track" with no largest-drift sentence when nothing is off target (R4.7)', () => {
    const drift: DriftResult = {
      byClass: {
        stocks: { assetClass: 'stocks', driftPoints: 0, driftDollars: 0, direction: 'on track' },
        bonds: { assetClass: 'bonds', driftPoints: 0, driftDollars: 0, direction: 'on track' },
        cash: { assetClass: 'cash', driftPoints: 0, driftDollars: 0, direction: 'on track' },
        other: { assetClass: 'other', driftPoints: 0, driftDollars: 0, direction: 'on track' },
      },
      offTargetCount: 0,
      largest: null,
    };

    const status = computeOnTrackStatus(drift);

    expect(status.onTrack).toBe(true);
    expect(status.label).toBe('On track');
    expect(status.largestDriftSentence).toBeNull();
  });

  it('labels "N of 4 asset classes off target" when classes drift, with N = offTargetCount (R4.8)', () => {
    const drift: DriftResult = {
      byClass: {
        stocks: { assetClass: 'stocks', driftPoints: 10, driftDollars: 100_000, direction: 'over' },
        bonds: { assetClass: 'bonds', driftPoints: -10, driftDollars: -100_000, direction: 'under' },
        cash: { assetClass: 'cash', driftPoints: 0, driftDollars: 0, direction: 'on track' },
        other: { assetClass: 'other', driftPoints: 0, driftDollars: 0, direction: 'on track' },
      },
      offTargetCount: 2,
      largest: { assetClass: 'stocks', driftPoints: 10, driftDollars: 100_000, direction: 'over' },
    };

    const status = computeOnTrackStatus(drift);

    expect(status.onTrack).toBe(false);
    expect(status.label).toBe('2 of 4 asset classes off target');
  });

  it('builds the "above" largest-drift sentence for an OVER class, rounding points and dollars (R4.9)', () => {
    // Design example: "Stocks are 8 points above your target, about $42,000".
    const drift: DriftResult = {
      byClass: {
        stocks: { assetClass: 'stocks', driftPoints: 8, driftDollars: 42_000, direction: 'over' },
        bonds: { assetClass: 'bonds', driftPoints: 0, driftDollars: 0, direction: 'on track' },
        cash: { assetClass: 'cash', driftPoints: 0, driftDollars: 0, direction: 'on track' },
        other: { assetClass: 'other', driftPoints: 0, driftDollars: 0, direction: 'on track' },
      },
      offTargetCount: 1,
      largest: { assetClass: 'stocks', driftPoints: 8, driftDollars: 42_000, direction: 'over' },
    };

    const status = computeOnTrackStatus(drift);

    expect(status.largestDriftSentence).toBe(
      'Stocks are 8 points above your target, about $42,000',
    );
  });

  it('builds the "below" largest-drift sentence for an UNDER class (R4.9)', () => {
    const drift: DriftResult = {
      byClass: {
        stocks: { assetClass: 'stocks', driftPoints: 0, driftDollars: 0, direction: 'on track' },
        bonds: { assetClass: 'bonds', driftPoints: -12, driftDollars: -73_500, direction: 'under' },
        cash: { assetClass: 'cash', driftPoints: 0, driftDollars: 0, direction: 'on track' },
        other: { assetClass: 'other', driftPoints: 0, driftDollars: 0, direction: 'on track' },
      },
      offTargetCount: 1,
      largest: { assetClass: 'bonds', driftPoints: -12, driftDollars: -73_500, direction: 'under' },
    };

    const status = computeOnTrackStatus(drift);

    // Magnitude is Math.abs(driftPoints); dollars use formatCurrency(Math.abs(driftDollars)),
    // which rounds to the nearest whole dollar (73,500 → "$73,500").
    expect(status.largestDriftSentence).toBe(
      'Bonds are 12 points below your target, about $73,500',
    );
  });

  it('uses the singular "point" when the rounded magnitude is exactly 1 (R4.9)', () => {
    // 6.4 points rounds to 6 — not singular; use 0.6 drift that rounds to 1 to hit the singular.
    const drift: DriftResult = {
      byClass: {
        stocks: { assetClass: 'stocks', driftPoints: 0, driftDollars: 0, direction: 'on track' },
        bonds: { assetClass: 'bonds', driftPoints: 0, driftDollars: 0, direction: 'on track' },
        cash: { assetClass: 'cash', driftPoints: 0, driftDollars: 0, direction: 'on track' },
        // driftPoints magnitude 0.6 would be on track in reality, but the sentence builder reads
        // whatever `largest` carries; here we assert the pluralization branch directly with a
        // crafted largest whose rounded magnitude is 1.
        other: { assetClass: 'other', driftPoints: 0, driftDollars: 0, direction: 'on track' },
      },
      offTargetCount: 1,
      largest: { assetClass: 'other', driftPoints: 0.6, driftDollars: 1_000, direction: 'over' },
    };

    const status = computeOnTrackStatus(drift);

    expect(status.largestDriftSentence).toBe(
      'Other are 1 point above your target, about $1,000',
    );
  });

  it('end-to-end: computeDrift feeds computeOnTrackStatus to produce the banner status (R4.6–R4.9)', () => {
    // Stocks +10 over ($100,000), bonds −10 under. Stocks is the largest; expect the "above" sentence.
    const actual = allocation(
      { stocks: 70, bonds: 20, cash: 5, other: 5 },
      1_000_000,
    );
    const totals: ClassTotals = {
      stocks: 700_000,
      bonds: 200_000,
      cash: 50_000,
      other: 50_000,
    };

    const drift = computeDrift(actual, totals, target(60, 30, 5, 5));
    const status = computeOnTrackStatus(drift);

    expect(status.onTrack).toBe(false);
    expect(status.label).toBe('2 of 4 asset classes off target');
    expect(status.largestDriftSentence).toBe(
      'Stocks are 10 points above your target, about $100,000',
    );
  });
});
