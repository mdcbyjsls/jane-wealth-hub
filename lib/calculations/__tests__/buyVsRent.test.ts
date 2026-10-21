import { describe, it, expect } from 'vitest';

import {
  monthlyPayment,
  amortize,
  computePaths,
  findBreakevenYear,
  rankSensitivity,
  findTippingPoint,
  COMPARISON_HORIZON,
  type PathInputs,
} from '@/lib/calculations/buyVsRent';
import type { BuyVsRentAssumptions } from '@/types/buyVsRent';
import type { ScenarioMultipliers } from '@/types/market';

/**
 * Example-based unit tests for the pure `BuyVsRent_Calculator` (Task 3.5).
 *
 * Every assertion uses a FIXED, hand-verifiable input and an independently derived expected value,
 * with no randomized generation. Dollar/percent figures that carry floating-point residue are
 * checked with `toBeCloseTo`; exact-by-construction values (a zero-rate payment, a term-end balance
 * of 0, a breakeven year, a sensitivity ordering) are checked for strict equality.
 *
 * The expected year-10 net worths are recomputed here from first principles using closed-form
 * geometric-series math — deliberately a different derivation than `computePaths`'s month-by-month
 * loop — so the test is an independent oracle rather than a copy of the implementation.
 *
 * _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_
 */

const DEFAULT_MULTIPLIERS: ScenarioMultipliers = { optimistic: 1.5, pessimistic: 0.5 };

/**
 * A fully-specified `BuyVsRentAssumptions` base fixture. Individual tests override only the fields
 * they exercise via `assume({...})`, so each case states exactly what it depends on.
 */
function assume(partial: Partial<BuyVsRentAssumptions>): BuyVsRentAssumptions {
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

// ---------------------------------------------------------------------------
// R14.1 — monthlyPayment
// ---------------------------------------------------------------------------

describe('monthlyPayment (R14.1)', () => {
  it('computes the exact fully-amortizing payment for a fixed loan/rate/term', () => {
    // $400,000 loan at 6%/yr over 30 years. Closed-form amortization payment:
    //   i = 0.06/12 = 0.005, n = 360, M = P·i·(1+i)^n / ((1+i)^n − 1).
    const loan = 400_000;
    const i = 0.06 / 12;
    const n = 360;
    const growth = (1 + i) ** n;
    const expected = (loan * i * growth) / (growth - 1); // ≈ 2398.2016...

    const payment = monthlyPayment(loan, 6, 30);

    // Independently sanity-check the magnitude before the precise comparison.
    expect(payment).toBeCloseTo(2398.2, 1);
    expect(payment).toBeCloseTo(expected, 6);
  });

  it('splits principal evenly across the term when the rate is exactly zero (R1.3)', () => {
    // Zero interest: the payment is simply loanAmount / (termYears·12), exact to the cent.
    const payment = monthlyPayment(360_000, 0, 30);

    expect(payment).toBe(360_000 / (30 * 12)); // 1000 exactly
    expect(payment).toBe(1_000);
  });
});

// ---------------------------------------------------------------------------
// R14.2 — amortize
// ---------------------------------------------------------------------------

describe('amortize (R14.2)', () => {
  it('ends at balance === 0, is non-increasing month over month, and never negative', () => {
    const loan = 400_000;
    const schedule = amortize(loan, 6, 30);

    // One entry per month across the full term.
    expect(schedule).toHaveLength(360);

    // The schedule closes at exactly zero (the final-month clamp pins out float residue, R1.5).
    expect(schedule[schedule.length - 1].balance).toBe(0);

    // Balance is non-increasing month over month and never negative; monthIndex is 1-based.
    let previous = loan;
    schedule.forEach((month, index) => {
      expect(month.monthIndex).toBe(index + 1);
      expect(month.balance).toBeLessThanOrEqual(previous);
      expect(month.balance).toBeGreaterThanOrEqual(0);
      previous = month.balance;
    });
  });

  it('handles the zero-rate schedule: all principal, no interest, ends at 0', () => {
    const schedule = amortize(360_000, 0, 30);

    expect(schedule).toHaveLength(360);
    // No interest ever accrues at a 0% rate.
    expect(schedule.every((m) => m.interest === 0)).toBe(true);
    // Every month pays an equal 1,000 of principal; the balance closes at exactly 0.
    expect(schedule[0].principal).toBeCloseTo(1_000, 6);
    expect(schedule[schedule.length - 1].balance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R14.3 — exact year-10 Buy_Net_Worth and Rent_Net_Worth for a fixed input
// ---------------------------------------------------------------------------

describe('computePaths year-10 net worths (R14.3)', () => {
  // A fixed, fully-specified input set. HOA 0, zero appreciation and zero rent growth keep the
  // independent closed-form oracle below tractable while still exercising every term.
  const assumptions = assume({
    homePrice: 500_000,
    downPaymentPercent: 20, // → $100k down, $400k loan
    mortgageRatePercent: 6,
    mortgageTermYears: 30,
    propertyTaxRatePercent: 1, // 1% of home value / yr
    homeownersInsurance: 1_200, // $/yr
    maintenanceRatePercent: 1, // 1% of home value / yr
    hoaMonthly: 0,
    closingCosts: 10_000,
    sellingCostPercent: 6,
    homeAppreciationRatePercent: 0, // no appreciation → Home_Value stays $500k every year
    currentRentMonthly: 4_500, // chosen so renting is the pricier path (buy invests the gap)
    rentGrowthRatePercent: 0, // no rent growth → rent cost constant every year
    rentersInsurance: 240, // $/yr
  });

  const startingAssetsTotal = 300_000;
  const annualReturnPercent = 5;

  const input: PathInputs = {
    startingAssetsTotal,
    assumptions,
    annualReturnPercent,
    appreciationRatePercent: assumptions.homeAppreciationRatePercent,
  };

  const { buy, rent } = computePaths(input);

  it('returns 11 values (years 0..10 inclusive) for both paths (R4.1)', () => {
    expect(buy).toHaveLength(COMPARISON_HORIZON + 1);
    expect(rent).toHaveLength(COMPARISON_HORIZON + 1);
    // Year 0 buy = Down_Payment − Closing_Costs = 100,000 − 10,000; rent = Starting_Assets total.
    expect(buy[0]).toBeCloseTo(90_000, 6);
    expect(rent[0]).toBe(startingAssetsTotal);
  });

  it('matches an independently derived year-10 Rent_Net_Worth', () => {
    // With no appreciation and no rent growth, both monthly costs are constant across all 10 years,
    // so the Monthly_Difference is a fixed monthly amount reinvested on the cheaper (Buy) side only.
    // The Rent_Path therefore just compounds the Starting_Assets total at the return, once per year
    // for 10 completed years (R2.5): rent(10) = 300,000 · 1.05^10.
    const r = 1 + annualReturnPercent / 100;
    const expectedRent10 = startingAssetsTotal * r ** 10;

    expect(rent[COMPARISON_HORIZON]).toBeCloseTo(expectedRent10, 4);
  });

  it('matches an independently derived year-10 Buy_Net_Worth (equity + side investment − selling cost)', () => {
    const loan = 400_000;
    const i = 0.06 / 12;
    const n = 360;
    const payment =
      (loan * i * (1 + i) ** n) / ((1 + i) ** n - 1);

    // Loan balance after 120 payments (closed form): B = P·(1+i)^k − M·((1+i)^k − 1)/i, k = 120.
    const k = 120;
    const grow = (1 + i) ** k;
    const loanBalance10 = loan * grow - (payment * (grow - 1)) / i;

    // Constant monthly costs (home value fixed at $500k; rent fixed): Ownership vs Rent.
    const homeValue = 500_000;
    const ownershipCostMonthly =
      payment + (0.01 * homeValue + 1_200 + 0.01 * homeValue + 0) / 12;
    const rentCostMonthly = 4_500 + 240 / 12;
    const monthlyDifference = Math.abs(ownershipCostMonthly - rentCostMonthly);
    // Buy is the cheaper path here, so the Buy side investment accrues the gap.
    expect(ownershipCostMonthly).toBeLessThan(rentCostMonthly);

    // Side investment: each year 12 monthly deposits accrue with NO intra-year growth, then the
    // whole balance is grown once at the year boundary (R2.4, R2.5). After 10 years that is
    //   S = D · Σ_{y=1..10} 12 · r^(11−y)  = 12·D · (r^10 + r^9 + ... + r^1)
    //     = 12·D · r · (r^10 − 1)/(r − 1).
    const r = 1 + annualReturnPercent / 100;
    const yearlyDeposit = 12 * monthlyDifference;
    const sideInvestment10 = yearlyDeposit * ((r ** 11 - r) / (r - 1));

    // Buy_Net_Worth(10) = Home_Value(10) − Loan_Balance(10) + side investment − selling cost(10).
    const sellingCost = homeValue * (6 / 100);
    const expectedBuy10 = homeValue - loanBalance10 + sideInvestment10 - sellingCost;

    expect(buy[COMPARISON_HORIZON]).toBeCloseTo(expectedBuy10, 2);
  });
});

// ---------------------------------------------------------------------------
// R14.4 — symmetric reinvestment (owning-cheaper vs renting-cheaper)
// ---------------------------------------------------------------------------

describe('symmetric Monthly_Difference reinvestment (R14.4)', () => {
  // Shared fixed frame: no appreciation / no rent growth so the sign of the monthly gap is constant
  // across the horizon, and the two cases differ ONLY in the rent level that flips which path is
  // cheaper.
  const base = assume({
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
    homeAppreciationRatePercent: 0,
    rentGrowthRatePercent: 0,
    rentersInsurance: 240,
  });

  const startingAssetsTotal = 300_000;
  const annualReturnPercent = 5;
  const r = 1 + annualReturnPercent / 100;

  // The Rent_Path invested balance with NO reinvested difference is just the compounded start.
  const rentNoSideInvestment10 = startingAssetsTotal * r ** 10;

  function pathsForRent(currentRentMonthly: number) {
    const assumptions = assume({ ...base, currentRentMonthly });
    return computePaths({
      startingAssetsTotal,
      assumptions,
      annualReturnPercent,
      appreciationRatePercent: 0,
    });
  }

  it('owning-cheaper: Buy accrues a side investment, Rent does not', () => {
    // High rent ($4,500) → owning is cheaper → only the Buy side investment grows; the Rent_Path is
    // exactly the compounded starting assets with nothing added.
    const { buy, rent } = pathsForRent(4_500);

    // Rent_Path got no reinvested difference.
    expect(rent[COMPARISON_HORIZON]).toBeCloseTo(rentNoSideInvestment10, 4);

    // The Buy_Path carries a positive side investment on top of its home equity. Compare against the
    // same scenario with rent set so costs are equal (no side investment) to isolate the increment:
    // the Buy year-10 value here must exceed the Buy year-10 value when nothing is reinvested.
    const neutralRent = ownershipCostMonthlyFor(base) - 240 / 12; // makes rentCost == ownershipCost
    const neutral = pathsForRent(neutralRent);
    expect(buy[COMPARISON_HORIZON]).toBeGreaterThan(neutral.buy[COMPARISON_HORIZON]);
  });

  it('renting-cheaper: Rent accrues the reinvested difference, Buy side investment stays at 0', () => {
    // Low rent ($1,500) → renting is cheaper → only the Rent_Path balance grows beyond the plain
    // compounded start; the Buy_Path has a zero side investment.
    const { buy, rent } = pathsForRent(1_500);

    // Rent now earns MORE than the plain compounded start (it reinvested the monthly savings).
    expect(rent[COMPARISON_HORIZON]).toBeGreaterThan(rentNoSideInvestment10);

    // The Buy_Path has no side investment: its year-10 value equals pure equity minus selling cost.
    const loan = 400_000;
    const i = 0.06 / 12;
    const n = 360;
    const payment = (loan * i * (1 + i) ** n) / ((1 + i) ** n - 1);
    const k = 120;
    const grow = (1 + i) ** k;
    const loanBalance10 = loan * grow - (payment * (grow - 1)) / i;
    const homeValue = 500_000;
    const expectedBuyNoSide10 = homeValue - loanBalance10 - homeValue * 0.06;

    expect(buy[COMPARISON_HORIZON]).toBeCloseTo(expectedBuyNoSide10, 2);
  });

  /** Constant (no-appreciation) first-year Ownership_Cost_Monthly for the shared fixture. */
  function ownershipCostMonthlyFor(a: BuyVsRentAssumptions): number {
    const loan = a.homePrice - a.homePrice * (a.downPaymentPercent / 100);
    const i = a.mortgageRatePercent / 100 / 12;
    const nn = a.mortgageTermYears * 12;
    const payment = (loan * i * (1 + i) ** nn) / ((1 + i) ** nn - 1);
    const annualPropertyTax = (a.propertyTaxRatePercent / 100) * a.homePrice;
    const annualMaintenance = (a.maintenanceRatePercent / 100) * a.homePrice;
    return (
      payment +
      (annualPropertyTax + a.homeownersInsurance + annualMaintenance + 12 * a.hoaMonthly) / 12
    );
  }
});

// ---------------------------------------------------------------------------
// R14.5 — findBreakevenYear
// ---------------------------------------------------------------------------

describe('findBreakevenYear (R14.5)', () => {
  it('returns the first year (1..10) where base-band Buy ≥ Rent for a fixed in-horizon case', () => {
    // Length-11 series (years 0..10). Buy crosses Rent at year 4 (equality counts, R6.1).
    const baseBuy = [0, 10, 20, 30, 50, 60, 70, 80, 90, 100, 110];
    const baseRent = [100, 90, 80, 70, 50, 45, 40, 35, 30, 25, 20];
    //                          ↑ year 4: 50 >= 50 → first crossover

    expect(findBreakevenYear(baseBuy, baseRent)).toBe(4);
  });

  it('returns null when Buy never catches up within the horizon (R6.2)', () => {
    const baseBuy = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95];
    const baseRent = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];

    expect(findBreakevenYear(baseBuy, baseRent)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R14.6 — rankSensitivity ordering + findTippingPoint
// ---------------------------------------------------------------------------

describe('rankSensitivity (R14.6)', () => {
  it('ranks assumptions by |Δ year-10 difference| descending with a fixed-order tie-break', () => {
    const assumptions = assume({});
    const startingAssetsTotal = 300_000;
    const baseReturnPercent = 5;

    const ranking = rankSensitivity(assumptions, startingAssetsTotal, baseReturnPercent);

    // Every editable scalar assumption is ranked; the nested multipliers and cushionMonths are not.
    expect(ranking).toHaveLength(14);

    // Descending by delta: each entry's delta is ≥ the next.
    for (let idx = 1; idx < ranking.length; idx += 1) {
      expect(ranking[idx - 1].year10DifferenceDelta).toBeGreaterThanOrEqual(
        ranking[idx].year10DifferenceDelta,
      );
    }

    // Exact ordering for this fixed input, top to bottom. This pins the full ranking, including the
    // two deterministic tie-breaks below.
    expect(ranking.map((e) => e.key)).toEqual([
      'currentRentMonthly',
      'mortgageRatePercent',
      'homePrice',
      'downPaymentPercent',
      'homeAppreciationRatePercent',
      'propertyTaxRatePercent',
      'maintenanceRatePercent',
      'rentGrowthRatePercent',
      'sellingCostPercent',
      'homeownersInsurance',
      'mortgageTermYears',
      'rentersInsurance',
      'hoaMonthly',
      'closingCosts',
    ]);

    // Tie-break #1: property-tax and maintenance are both a 1% rate on the same Home_Value, so their
    // relative perturbation moves the year-10 difference by the SAME amount — an exact tie. The
    // fixed SENSITIVITY_KEYS order breaks it: property tax (earlier) ranks ahead of maintenance.
    const propTax = ranking.find((e) => e.key === 'propertyTaxRatePercent');
    const maintenance = ranking.find((e) => e.key === 'maintenanceRatePercent');
    expect(propTax?.year10DifferenceDelta).toBe(maintenance?.year10DifferenceDelta);
    expect(ranking.indexOf(propTax!)).toBeLessThan(ranking.indexOf(maintenance!));

    // Tie-break #2: HOA is $0 (a relative step can't move zero) and Closing_Costs never touch either
    // net-worth path, so both have a delta of exactly 0 and tie at the bottom. The fixed order keeps
    // HOA (earlier) ahead of Closing_Costs.
    const hoa = ranking.find((e) => e.key === 'hoaMonthly');
    const closing = ranking.find((e) => e.key === 'closingCosts');
    expect(hoa?.year10DifferenceDelta).toBe(0);
    expect(closing?.year10DifferenceDelta).toBe(0);
    expect(ranking.indexOf(hoa!)).toBeLessThan(ranking.indexOf(closing!));
  });

  it('is deterministic for identical inputs (same ordering twice)', () => {
    const assumptions = assume({});
    const a = rankSensitivity(assumptions, 300_000, 5).map((e) => e.key);
    const b = rankSensitivity(assumptions, 300_000, 5).map((e) => e.key);
    expect(a).toEqual(b);
  });
});

describe('findTippingPoint (R14.6)', () => {
  it('finds the appreciation rate at which year-10 Buy equals Rent for a fixed flipping input', () => {
    // A fixed input whose verdict flips within −20%..+20%: at very low appreciation renting wins,
    // at high appreciation buying wins, so a crossing exists in range.
    const assumptions = assume({
      homePrice: 500_000,
      downPaymentPercent: 20,
      currentRentMonthly: 2_500,
      rentGrowthRatePercent: 3,
    });

    const tipping = findTippingPoint(assumptions, 300_000, 5);

    expect(tipping).not.toBeNull();
    // The reported rate is rounded to one decimal and sits within the searched range.
    expect(tipping).toBeGreaterThanOrEqual(-20);
    expect(tipping).toBeLessThanOrEqual(20);
    expect(tipping).toBe(Number((tipping as number).toFixed(1)));

    // Verify it IS a crossing: just below the tipping rate one path leads, just above the other does.
    const below = year10Gap(assumptions, 300_000, 5, (tipping as number) - 1);
    const above = year10Gap(assumptions, 300_000, 5, (tipping as number) + 1);
    expect(Math.sign(below)).not.toBe(Math.sign(above));
  });

  it('returns null when the verdict never flips across the range for a fixed non-flipping input', () => {
    // Renting dominates across the WHOLE −20%..+20% appreciation range: a very expensive home, a
    // tiny down payment, a punishing mortgage rate, heavy carrying costs, and a near-zero rent mean
    // buying never catches up even at +20% appreciation, so the verdict never flips (R7.4).
    const assumptions = assume({
      homePrice: 3_000_000,
      downPaymentPercent: 3,
      mortgageRatePercent: 15,
      propertyTaxRatePercent: 4,
      maintenanceRatePercent: 4,
      homeownersInsurance: 20_000,
      currentRentMonthly: 500,
      rentGrowthRatePercent: 0,
      sellingCostPercent: 12,
    });

    // Confirm the premise independently: Rent leads at both ends of the search range (gap < 0 at
    // −20% and still < 0 at +20%), so there is genuinely no crossing to find.
    expect(year10Gap(assumptions, 300_000, 5, -20)).toBeLessThan(0);
    expect(year10Gap(assumptions, 300_000, 5, 20)).toBeLessThan(0);

    expect(findTippingPoint(assumptions, 300_000, 5)).toBeNull();
  });

  /** Independent year-10 base-band gap Buy(10) − Rent(10) at a given appreciation rate. */
  function year10Gap(
    assumptions: BuyVsRentAssumptions,
    startingAssetsTotal: number,
    annualReturnPercent: number,
    appreciationRatePercent: number,
  ): number {
    const { buy, rent } = computePaths({
      startingAssetsTotal,
      assumptions,
      annualReturnPercent,
      appreciationRatePercent,
    });
    return buy[COMPARISON_HORIZON] - rent[COMPARISON_HORIZON];
  }
});
