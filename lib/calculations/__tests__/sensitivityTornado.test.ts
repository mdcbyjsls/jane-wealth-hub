import { describe, it, expect } from 'vitest';

import { computeTornado } from '@/lib/calculations/sensitivityTornado';
import { buildBands, COMPARISON_HORIZON } from '@/lib/calculations/buyVsRent';
import type { BuyVsRentAssumptions } from '@/types/buyVsRent';
import type { ScenarioMultipliers } from '@/types/market';

/**
 * Example-based unit tests for the pure `computeTornado` helper (Spec 4, Task 2.2).
 *
 * Every assertion uses a FIXED input and an independently derived expected value. The gap oracle is
 * `buildBands(...).buy.base[10] − ...rent.base[10]`, the same quantity the view and `rankSensitivity`
 * use — recomputed here directly from `buildBands` rather than copied from the implementation.
 */

const DEFAULT_MULTIPLIERS: ScenarioMultipliers = { optimistic: 1.5, pessimistic: 0.5 };
const STARTING = 300_000;
const BASE_RETURN = 6;

function assume(partial: Partial<BuyVsRentAssumptions> = {}): BuyVsRentAssumptions {
  return {
    homePrice: 500_000,
    downPaymentPercent: 20,
    mortgageRatePercent: 6,
    mortgageTermYears: 30,
    propertyTaxRatePercent: 1,
    homeownersInsurance: 1_200,
    maintenanceRatePercent: 1,
    hoaMonthly: 0,
    closingCosts: 10_000,
    sellingCostPercent: 6,
    homeAppreciationRatePercent: 3,
    currentRentMonthly: 2_500,
    rentGrowthRatePercent: 3,
    rentersInsurance: 240,
    cushionMonths: 6,
    multipliers: DEFAULT_MULTIPLIERS,
    ...partial,
  };
}

/** Independent year-10 base-band gap oracle from buildBands. */
function gapOf(a: BuyVsRentAssumptions): number {
  const bands = buildBands(a, STARTING, BASE_RETURN, DEFAULT_MULTIPLIERS);
  return bands.buy.base[COMPARISON_HORIZON] - bands.rent.base[COMPARISON_HORIZON];
}

describe('computeTornado — signed low/high gaps and swing', () => {
  it('computes exact lowGap/highGap/swing for a fixed assumption (home appreciation)', () => {
    const base = assume();
    const entries = computeTornado(base, STARTING, BASE_RETURN, DEFAULT_MULTIPLIERS);

    const appr = entries.find((e) => e.key === 'homeAppreciationRatePercent');
    expect(appr).toBeDefined();
    if (!appr) return;

    // The step is ±10% relative; 3% → 2.7% low, 3.3% high (within the −20..20 clamp).
    expect(appr.lowInput).toBeCloseTo(2.7, 6);
    expect(appr.highInput).toBeCloseTo(3.3, 6);

    const expectedLow = gapOf(assume({ homeAppreciationRatePercent: appr.lowInput }));
    const expectedHigh = gapOf(assume({ homeAppreciationRatePercent: appr.highInput }));
    expect(appr.lowGap).toBeCloseTo(expectedLow, 4);
    expect(appr.highGap).toBeCloseTo(expectedHigh, 4);
    expect(appr.swing).toBeCloseTo(Math.abs(expectedHigh - expectedLow), 4);

    // baseGap is the unperturbed gap and is identical across every entry.
    const expectedBase = gapOf(base);
    expect(appr.baseGap).toBeCloseTo(expectedBase, 4);
    for (const e of entries) {
      expect(e.baseGap).toBeCloseTo(expectedBase, 4);
    }
  });

  it('sorts by swing descending with the fixed-order deterministic tie-break', () => {
    const entries = computeTornado(assume(), STARTING, BASE_RETURN, DEFAULT_MULTIPLIERS);

    // Monotonic non-increasing swing.
    for (let k = 1; k < entries.length; k += 1) {
      expect(entries[k - 1].swing).toBeGreaterThanOrEqual(entries[k].swing - 1e-9);
    }

    // Zero-swing entries (assumptions a relative step cannot move, or that do not affect the gap)
    // sink to the bottom and keep the fixed key order among themselves.
    const zero = entries.filter((e) => e.swing < 1e-9).map((e) => e.key);
    const fixedOrder = [
      'homePrice', 'downPaymentPercent', 'mortgageRatePercent', 'mortgageTermYears',
      'propertyTaxRatePercent', 'homeownersInsurance', 'maintenanceRatePercent', 'hoaMonthly',
      'closingCosts', 'sellingCostPercent', 'homeAppreciationRatePercent', 'currentRentMonthly',
      'rentGrowthRatePercent', 'rentersInsurance',
    ];
    const zeroSortedByFixed = [...zero].sort(
      (a, b) => fixedOrder.indexOf(a) - fixedOrder.indexOf(b),
    );
    expect(zero).toEqual(zeroSortedByFixed);
  });

  it('respects the clamp bounds at an edge (mortgage rate near 0)', () => {
    // A tiny mortgage rate: the down step would go negative, so lowInput clamps at 0.
    const entries = computeTornado(
      assume({ mortgageRatePercent: 0.0001 }),
      STARTING,
      BASE_RETURN,
      DEFAULT_MULTIPLIERS,
    );
    const rate = entries.find((e) => e.key === 'mortgageRatePercent');
    expect(rate).toBeDefined();
    if (!rate) return;
    expect(rate.lowInput).toBeGreaterThanOrEqual(0);
  });

  it('produces an entry per editable assumption (14), no multipliers/cushion', () => {
    const entries = computeTornado(assume(), STARTING, BASE_RETURN, DEFAULT_MULTIPLIERS);
    expect(entries).toHaveLength(14);
    const keys = entries.map((e) => e.key);
    expect(keys).not.toContain('cushionMonths');
    expect(keys).not.toContain('multipliers');
  });
});
