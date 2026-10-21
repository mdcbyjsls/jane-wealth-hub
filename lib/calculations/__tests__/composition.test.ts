import { describe, it, expect } from 'vitest';

import { computeYear10Composition } from '@/lib/calculations/composition';
import { buildBands, COMPARISON_HORIZON } from '@/lib/calculations/buyVsRent';
import type { BuyVsRentAssumptions } from '@/types/buyVsRent';
import type { ScenarioMultipliers } from '@/types/market';

/**
 * Example-based unit tests for the pure `computeYear10Composition` helper (Spec 4, Task 2.4).
 *
 * The central guarantee is CONSISTENCY with the Spec 3 path totals: the Buy components must sum to
 * the base-band year-10 Buy value and the Rent value must equal the base-band year-10 Rent value,
 * both taken from `buildBands` (the independent oracle) on the same inputs.
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

describe('computeYear10Composition — consistency with the base-band path totals', () => {
  it('buy components sum to the base-band year-10 Buy value; rent equals the base-band Rent value', () => {
    const a = assume();
    const comp = computeYear10Composition(a, STARTING, BASE_RETURN);

    const bands = buildBands(a, STARTING, BASE_RETURN, DEFAULT_MULTIPLIERS);
    const expectedBuy = bands.buy.base[COMPARISON_HORIZON];
    const expectedRent = bands.rent.base[COMPARISON_HORIZON];

    expect(comp.buy.homeEquity + comp.buy.sideInvestments).toBeCloseTo(expectedBuy, 4);
    expect(comp.buy.total).toBeCloseTo(expectedBuy, 4);
    expect(comp.rent.investments).toBeCloseTo(expectedRent, 4);
    expect(comp.rent.total).toBeCloseTo(expectedRent, 4);
  });

  it('reflects the year-10 selling cost in home equity', () => {
    const withCost = computeYear10Composition(assume({ sellingCostPercent: 6 }), STARTING, BASE_RETURN);
    const noCost = computeYear10Composition(assume({ sellingCostPercent: 0 }), STARTING, BASE_RETURN);

    // A selling cost only reduces home equity (the side investment is unaffected), so equity is
    // strictly lower when a selling cost applies.
    expect(withCost.buy.homeEquity).toBeLessThan(noCost.buy.homeEquity);

    // The 6% selling cost equals 6% of the year-10 home value; equity differs by exactly that.
    const homeValue10 = 500_000 * (1 + 3 / 100) ** COMPARISON_HORIZON;
    expect(noCost.buy.homeEquity - withCost.buy.homeEquity).toBeCloseTo(
      homeValue10 * 0.06,
      2,
    );
  });

  it('handles a zero-appreciation case (equity is price minus balance minus selling cost)', () => {
    const comp = computeYear10Composition(
      assume({ homeAppreciationRatePercent: 0, sellingCostPercent: 0 }),
      STARTING,
      BASE_RETURN,
    );
    // With no appreciation the year-10 home value is the purchase price; equity is price minus the
    // remaining loan balance, which must be positive and below the price.
    expect(comp.buy.homeEquity).toBeGreaterThan(0);
    expect(comp.buy.homeEquity).toBeLessThan(500_000);
  });
});
