/**
 * Year10_Composition breakdown (pure module, Spec 4 R2.4 / R5.6).
 *
 * `computePaths` (in `buyVsRent.ts`) computes the Buy_Path's year-10 Home_Value, Loan_Balance,
 * home equity, and side investment internally, then discards the breakdown — it returns only the
 * combined net-worth series. The Composition_Bars need those pieces separately: Buy split into
 * (home equity + side investments), Rent as (investments only).
 *
 * This helper RE-DERIVES the same year-10 quantities for the base band from the same inputs
 * `computePaths` uses, WITHOUT modifying `computePaths`. It mirrors that function's month-by-month
 * engine exactly (same amortization schedule, same start-of-year Home_Value and grown rent, same
 * symmetric Monthly_Difference reinvestment, same completed-year compounding, same year-10 selling
 * cost), so the derived components reconstruct the identical totals. The invariant the test pins:
 *   buy.homeEquity + buy.sideInvestments === buildBands(...).buy.base[10]
 *   rent.investments            === buildBands(...).rent.base[10]
 * on the same inputs.
 *
 * It imports only the shared calculator types and the pure `buyVsRent.ts` primitives
 * (`amortize` / `monthlyPayment` / `COMPARISON_HORIZON`). It imports nothing from `app/`,
 * `components/`, or `lib/fred/`, performs no data fetching, touches no `localStorage`, and never
 * reads the clock — numbers in, a plain object out.
 */

import type {
  BuyVsRentAssumptions,
  Year10Composition,
} from '@/types/buyVsRent';
import {
  amortize,
  monthlyPayment,
  COMPARISON_HORIZON,
} from '@/lib/calculations/buyVsRent';

/**
 * Breaks the base-band year-10 net worth of each path into stackable components (R2.4, R5.6).
 *
 * The base band is `computePaths` run with `annualReturnPercent = baseReturnPercent` and
 * `appreciationRatePercent = assumptions.homeAppreciationRatePercent` — the exact parameters
 * `buildBands` passes for its base band. This function replays that same computation and, at the
 * Comparison_Horizon (year 10), reports:
 *   - `buy.homeEquity`      — `Home_Value(10) − Loan_Balance(10) − year-10 selling cost`, where the
 *                             selling cost is `Home_Value(10) · sellingCostPercent / 100` (R1.7);
 *   - `buy.sideInvestments` — the Buy_Path side investment accrued and compounded through year 10;
 *   - `buy.total`           — `homeEquity + sideInvestments`, equal to `buildBands(...).buy.base[10]`;
 *   - `rent.investments`    — the Rent_Path invested balance at year 10, equal to the base-band
 *                             `rent.base[10]` (R2.1, R2.6);
 *   - `rent.total`          — equal to `investments`.
 *
 * Because every step is identical to `computePaths` — the same `amortize` schedule and
 * `monthlyPayment`, the same per-year start-of-year Home_Value and grown rent, the same absolute
 * Monthly_Difference added to whichever path is cheaper, the same completed-year compounding at
 * `returnFactor`, and the same single year-10 selling-cost deduction — the components sum back to
 * the untouched `computePaths` totals exactly.
 *
 * Pure and deterministic: numbers in, a plain object out — no fetch, no `localStorage`, no clock.
 */
export function computeYear10Composition(
  assumptions: BuyVsRentAssumptions,
  startingAssetsTotal: number,
  baseReturnPercent: number,
): Year10Composition {
  const {
    homePrice,
    downPaymentPercent,
    mortgageRatePercent,
    mortgageTermYears,
    propertyTaxRatePercent,
    homeownersInsurance,
    maintenanceRatePercent,
    hoaMonthly,
    sellingCostPercent,
    currentRentMonthly,
    rentGrowthRatePercent,
    rentersInsurance,
    homeAppreciationRatePercent,
  } = assumptions;

  const downPayment = homePrice * (downPaymentPercent / 100);
  const loanAmount = homePrice - downPayment;

  // The full amortization schedule; month M's end-of-month balance is schedule[M-1].balance.
  const schedule = amortize(loanAmount, mortgageRatePercent, mortgageTermYears);
  const payment = monthlyPayment(loanAmount, mortgageRatePercent, mortgageTermYears);

  const appreciationFactor = 1 + homeAppreciationRatePercent / 100;
  const rentGrowthFactor = 1 + rentGrowthRatePercent / 100;
  const returnFactor = 1 + baseReturnPercent / 100;

  // Home_Value grows once per completed year (R1.6): homeValueByYear[N] = price·factor^N.
  const homeValueByYear: number[] = [];
  for (let year = 0; year <= COMPARISON_HORIZON; year += 1) {
    homeValueByYear.push(homePrice * appreciationFactor ** year);
  }

  // Year-0 Loan_Balance is the opening principal; year-N balance (N ≥ 1) is the end-of-month
  // balance at month N·12, or 0 once the schedule is exhausted (loan paid off before the horizon).
  const loanBalanceByYear: number[] = [loanAmount];
  for (let year = 1; year <= COMPARISON_HORIZON; year += 1) {
    const monthIndex = year * 12;
    const entry = schedule[monthIndex - 1];
    loanBalanceByYear.push(entry ? entry.balance : 0);
  }

  // Running invested balances advanced month by month across the horizon, exactly as computePaths.
  let rentBalance = startingAssetsTotal; // Rent_Path invested balance (R2.1)
  let buySideInvestment = 0; // Buy_Path side investment (R2.4)

  for (let year = 1; year <= COMPARISON_HORIZON; year += 1) {
    // Costs within a year use that year's start-of-year Home_Value and grown rent (R1.6, R2.2):
    // during year `year`, `year - 1` whole years have elapsed.
    const yearsElapsed = year - 1;
    const homeValue = homeValueByYear[yearsElapsed];
    const currentRent = currentRentMonthly * rentGrowthFactor ** yearsElapsed;

    // Ownership_Cost_Monthly (R2.3).
    const annualPropertyTax = (propertyTaxRatePercent / 100) * homeValue;
    const annualMaintenance = (maintenanceRatePercent / 100) * homeValue;
    const ownershipCostMonthly =
      payment +
      (annualPropertyTax + homeownersInsurance + annualMaintenance + 12 * hoaMonthly) / 12;

    // Rent_Cost_Monthly (R2.2).
    const rentCostMonthly = currentRent + rentersInsurance / 12;

    // Symmetric Monthly_Difference reinvestment (R2.4): the cheaper path invests the gap each month.
    const monthlyDifference = Math.abs(ownershipCostMonthly - rentCostMonthly);
    const owningIsCheaper = ownershipCostMonthly < rentCostMonthly;

    for (let m = 0; m < 12; m += 1) {
      if (owningIsCheaper) {
        buySideInvestment += monthlyDifference;
      } else {
        rentBalance += monthlyDifference;
      }
    }

    // Grow every invested balance once at the completed-year boundary (R2.5).
    rentBalance *= returnFactor;
    buySideInvestment *= returnFactor;
  }

  // Year-10 Buy components (R1.7): home equity is Home_Value(10) − Loan_Balance(10) minus the
  // single year-10 selling cost; side investments are the compounded Buy_Path balance.
  const sellingCost = homeValueByYear[COMPARISON_HORIZON] * (sellingCostPercent / 100);
  const homeEquity =
    homeValueByYear[COMPARISON_HORIZON] - loanBalanceByYear[COMPARISON_HORIZON] - sellingCost;
  const sideInvestments = buySideInvestment;

  // Year-10 Rent net worth is just the invested balance — no home equity, no mortgage (R2.6).
  const investments = rentBalance;

  return {
    buy: {
      homeEquity,
      sideInvestments,
      total: homeEquity + sideInvestments,
    },
    rent: {
      investments,
      total: investments,
    },
  };
}
