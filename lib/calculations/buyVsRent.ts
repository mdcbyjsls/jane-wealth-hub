/**
 * BuyVsRent_Calculator (pure module).
 *
 * Inputs in, numbers out. This module imports only from `@/types/accounts` (for `AssetClass` /
 * `ClassTotals`), `@/types/market` (for `MarketDataSnapshot` / `ReturnAssumptions` /
 * `ScenarioMultipliers`), the shared `@/types/buyVsRent` calculator types, and the pure Spec 2
 * `projection.ts` (for `deriveReturnModel` / `computeBlendedReturn` and the shared
 * `ASSET_CLASS_KEYS`). It imports nothing from `app/`, `components/`, or `lib/fred/`, performs no
 * data fetching, touches no `localStorage`, and never reads the clock. Every time-dependent value —
 * the current calendar year and all market and assumption values — is passed in by the caller, so
 * the same functions can run on the server (first paint) and in the client island (recompute on
 * edit) with identical, deterministic results.
 *
 * It mirrors the `projection.ts` house style: a file-level purity contract, shared constants,
 * exhaustive iteration over the four `ASSET_CLASS_KEYS`, and per-function JSDoc tagged with the
 * requirement clauses it satisfies.
 */

import type { AssetClass, ClassTotals } from '@/types/accounts';
import type {
  MarketDataSnapshot,
  ReturnAssumptions,
  ScenarioMultipliers,
} from '@/types/market';
import type {
  AmortizationMonth,
  BuyVsRentAssumptions,
  ComparisonBands,
  ComparisonInput,
  ComparisonResult,
  DrawdownResult,
  PathResult,
  SensitivityEntry,
  VerdictFigures,
} from '@/types/buyVsRent';
import {
  ASSET_CLASS_KEYS,
  computeBlendedReturn,
  deriveReturnModel,
} from '@/lib/calculations/projection';

// Re-export the shared asset-class ordering so later subtasks and tests in this module can import
// it from here without reaching back into `projection.ts`. It is the single deterministic order
// used by every per-class loop (the drawdown and allocation shift in 3.2).
export { ASSET_CLASS_KEYS };

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/**
 * The fixed comparison horizon, in whole years (R-glossary Comparison_Horizon). Both paths produce
 * one net-worth value for each whole year from year 0 through year 10 inclusive (11 values, R4.1).
 */
export const COMPARISON_HORIZON = 10;

/** Default mortgage amortization term, in years (R-glossary Mortgage_Term_Years). */
export const MORTGAGE_TERM_YEARS = 30;

/** Default annual maintenance cost, as a percentage of Home_Value (R-glossary Maintenance_Rate). */
export const MAINTENANCE_RATE = 1;

/** Default cushion multiple: months of ownership cost a healthy Cash_Cushion covers (R3.5). */
export const CUSHION_MONTHS = 6;

/**
 * The fixed relative perturbation applied to every editable assumption, one at a time, when
 * ranking sensitivity (R8.5). The same step is used for every assumption so the comparison across
 * assumptions is consistent; consumed by `rankSensitivity` in subtask 3.3.
 */
export const SENSITIVITY_STEP = 0.1;

/**
 * The plausible Home_Appreciation_Rate range, in percent per year, over which the
 * Appreciation_Tipping_Point is searched (R7.3): −20%..+20%. Consumed by `findTippingPoint` in
 * subtask 3.3.
 */
export const TIPPING_POINT_RANGE = { min: -20, max: 20 } as const;

// ---------------------------------------------------------------------------
// monthlyPayment (R1.2, R1.3)
// ---------------------------------------------------------------------------

/**
 * Computes the fixed monthly principal-and-interest payment that fully amortizes the loan over its
 * term (R1.2), with the zero-rate special case (R1.3).
 *
 * With a monthly rate `i = annualRatePercent / 100 / 12` and a payment count `n = termYears * 12`,
 * the payment is the standard amortization formula
 *   `M = P · i · (1 + i)^n / ((1 + i)^n − 1)`,
 * where `P` is the `loanAmount` (R1.2). WHERE the rate is exactly zero the formula is undefined
 * (it divides by zero), so the payment is simply `loanAmount / n` — the principal split evenly
 * across every payment (R1.3).
 *
 * `annualRatePercent` is a percent-per-year rate (e.g. `6.5` for 6.5%). Pure and deterministic:
 * numbers in, a number out — no fetch, no `localStorage`, no clock.
 */
export function monthlyPayment(
  loanAmount: number,
  annualRatePercent: number,
  termYears: number,
): number {
  const n = termYears * 12;
  const i = annualRatePercent / 100 / 12;

  // Zero-rate special case: no interest accrues, so the principal is split evenly (R1.3).
  if (i === 0) {
    return loanAmount / n;
  }

  const growth = (1 + i) ** n;
  return (loanAmount * i * growth) / (growth - 1);
}

// ---------------------------------------------------------------------------
// amortize (R1.4, R1.5)
// ---------------------------------------------------------------------------

/**
 * Builds the month-by-month amortization schedule (R1.4, R1.5).
 *
 * Returns one `AmortizationMonth` per month for `termYears * 12` months. For each month, starting
 * from the opening `loanAmount` balance (R1.4):
 *   - `interest  = balance · i`           where `i = annualRatePercent / 100 / 12`;
 *   - `principal = monthlyPayment − interest`;
 *   - `balance  -= principal`.
 *
 * The `monthIndex` is 1-based and `balance` is the end-of-month Loan_Balance. The final month's
 * principal is clamped to the remaining balance so the schedule ends at exactly zero, the balance
 * is non-increasing month over month, and it never falls below zero (R1.5). Floating-point drift
 * can otherwise leave a tiny non-zero residual or a slightly negative balance at term end; the
 * clamp pins the last entry to exactly `0`.
 *
 * Pure and deterministic: numbers in, an array of plain objects out — no fetch, no `localStorage`,
 * no clock.
 */
export function amortize(
  loanAmount: number,
  annualRatePercent: number,
  termYears: number,
): AmortizationMonth[] {
  const n = termYears * 12;
  const i = annualRatePercent / 100 / 12;
  const payment = monthlyPayment(loanAmount, annualRatePercent, termYears);

  const schedule: AmortizationMonth[] = [];
  let balance = loanAmount;

  for (let month = 1; month <= n; month += 1) {
    const interest = balance * i;
    // On the final month, clamp principal to whatever balance remains so the loan closes at
    // exactly zero rather than leaving floating-point residue or overshooting negative (R1.5).
    let principal = month === n ? balance : payment - interest;

    // Guard against an over-payment in any month (e.g. extreme inputs): principal can never
    // exceed the outstanding balance, which keeps the balance non-increasing and ≥ 0 (R1.5).
    if (principal > balance) {
      principal = balance;
    }

    balance -= principal;

    // Pin the final balance to exactly zero: clear any residual floating-point dust (R1.5).
    if (month === n) {
      balance = 0;
    }

    schedule.push({ monthIndex: month, interest, principal, balance });
  }

  return schedule;
}

// ---------------------------------------------------------------------------
// deriveInvestmentReturn (R2.7)
// ---------------------------------------------------------------------------

/**
 * Derives the Investment_Return as the Spec 2 Blended_Expected_Return for the Current_Allocation
 * (R2.7).
 *
 * It calls the pure Spec 2 `deriveReturnModel(market, returnAssumptions)` to build the per-class
 * Expected_Return from the resolved market data, then `computeBlendedReturn(currentAllocation-
 * Fractions, returnModel)` to blend it by the user's current allocation. The return model is NOT
 * recomputed here — this is a thin composition over the Spec 2 engine so the same expected return
 * drives the projection view and this comparison.
 *
 * `currentAllocationFractions` is a per-class fraction in 0..1 (the Spec 1 allocation percentages
 * ÷ 100); the four fractions are expected to sum to approximately 1. The returned value is a
 * percent-per-year rate. Pure and deterministic: inputs in, a number out — no fetch, no
 * `localStorage`, no clock.
 */
export function deriveInvestmentReturn(
  currentAllocationFractions: Record<AssetClass, number>,
  market: MarketDataSnapshot,
  returnAssumptions: ReturnAssumptions,
): number {
  const returnModel = deriveReturnModel(market, returnAssumptions);
  return computeBlendedReturn(currentAllocationFractions, returnModel);
}

// ---------------------------------------------------------------------------
// computeDrawdown (R3.1, R3.2, R3.4, R3.6)
// ---------------------------------------------------------------------------

/**
 * Funds the Down_Payment + Closing_Costs (`fundedAmount`) out of the Starting_Assets and reports
 * the resulting allocation shift and cash cushion (R3.1, R3.2, R3.4, R3.6).
 *
 * The draw order follows R3.1 exactly: take from the `cash` Asset_Class first, and ONLY if the
 * funded sum exceeds the cash balance, draw the remainder pro-rata across `stocks`, `bonds`, and
 * `other` in proportion to their dollar amounts. Pro-rata weighting uses each non-cash class's
 * share of the non-cash dollar total, so a class holding twice as many dollars absorbs twice the
 * remainder. If the non-cash total is itself zero while a remainder is still owed (only possible
 * when the purchase exceeds Starting_Assets), there is nothing left to draw and the balances floor
 * at zero — the over-budget flag below is what surfaces that case to the view.
 *
 * Returns (all plain numbers / plain objects, R3.6 never leaks a negative cushion as valid):
 *   - `postPurchaseDollars` — the reduced per-class balances, floored at 0;
 *   - `postPurchaseAllocation` — the Post_Purchase_Allocation percentages implied by those reduced
 *     balances (R3.2): each class's dollars ÷ the reduced total × 100, or all 0 when the reduced
 *     total is 0;
 *   - `cashCushion` — the cash balance remaining after the draw (R3.4); it is 0, never negative,
 *     when cash was fully consumed;
 *   - `overBudget` — `true` when `fundedAmount` exceeds the Starting_Assets total (R3.6), so the
 *     view can show the "needs more than your assets" message instead of a bogus cushion.
 *
 * Pure and deterministic: numbers in, plain objects out — no fetch, no `localStorage`, no clock.
 */
export function computeDrawdown(
  startingAssets: ClassTotals,
  fundedAmount: number,
): DrawdownResult {
  const startingTotal = ASSET_CLASS_KEYS.reduce(
    (sum, key) => sum + startingAssets[key],
    0,
  );

  // Start from a copy so the caller's ClassTotals is never mutated (purity).
  const postPurchaseDollars: ClassTotals = {
    stocks: startingAssets.stocks,
    bonds: startingAssets.bonds,
    cash: startingAssets.cash,
    other: startingAssets.other,
  };

  // Step 1: draw from cash first (R3.1). The cash draw is capped at the available cash, so the
  // cash balance floors at 0 and never goes negative (R3.4).
  const cashDraw = Math.min(fundedAmount, startingAssets.cash);
  postPurchaseDollars.cash = startingAssets.cash - cashDraw;

  // Step 2: any remainder beyond cash is drawn pro-rata across stocks/bonds/other by dollar weight
  // (R3.1). When cash covered the whole purchase the remainder is 0 and this loop is a no-op.
  const remainder = fundedAmount - cashDraw;
  if (remainder > 0) {
    const nonCashKeys: readonly AssetClass[] = ['stocks', 'bonds', 'other'];
    const nonCashTotal = nonCashKeys.reduce(
      (sum, key) => sum + startingAssets[key],
      0,
    );

    if (nonCashTotal > 0) {
      for (const key of nonCashKeys) {
        const share = startingAssets[key] / nonCashTotal;
        const draw = remainder * share;
        // Floor at 0 so floating-point drift on the final class can't push a balance negative.
        postPurchaseDollars[key] = Math.max(0, startingAssets[key] - draw);
      }
    }
    // If nonCashTotal is 0 the purchase has exhausted every bucket; balances stay at 0 and
    // `overBudget` below reports the shortfall. There is nothing left to draw.
  }

  // Post_Purchase_Allocation percentages implied by the reduced balances (R3.2).
  const reducedTotal = ASSET_CLASS_KEYS.reduce(
    (sum, key) => sum + postPurchaseDollars[key],
    0,
  );
  const postPurchaseAllocation: Record<AssetClass, number> = {
    stocks: 0,
    bonds: 0,
    cash: 0,
    other: 0,
  };
  if (reducedTotal > 0) {
    for (const key of ASSET_CLASS_KEYS) {
      postPurchaseAllocation[key] = (postPurchaseDollars[key] / reducedTotal) * 100;
    }
  }

  return {
    postPurchaseDollars,
    postPurchaseAllocation,
    cashCushion: postPurchaseDollars.cash,
    overBudget: fundedAmount > startingTotal,
  };
}

// ---------------------------------------------------------------------------
// computePaths (R1.6, R1.7, R2.1–R2.6, R4.1, R4.2)
// ---------------------------------------------------------------------------

/**
 * The internal inputs one single-band path computation needs (R5.2, R5.3). This shape is assembled
 * by `buildBands` (subtask 3.3) from a `BuyVsRentAssumptions` plus the per-band return and
 * appreciation rate, so the band logic can vary `annualReturnPercent` and `appreciationRatePercent`
 * while holding everything else fixed. Exported so `buildBands` and the calculator tests can build
 * it without reaching into this module's internals.
 */
export interface PathInputs {
  /** The Starting_Assets total — the Rent_Path year-0 invested balance (R2.1, R4.2). */
  startingAssetsTotal: number;
  /** Every editable assumption (home price, costs, rent, term, etc.). */
  assumptions: BuyVsRentAssumptions;
  /** The Investment_Return applied to invested balances this band, percent per year (R2.5, R5.2). */
  annualReturnPercent: number;
  /** The Home_Appreciation_Rate this band, percent per year (R1.6, R5.3). */
  appreciationRatePercent: number;
}

/**
 * Computes one band's Buy_Path and Rent_Path net-worth series — 11 whole-year values each, years 0
 * through 10 inclusive (R4.1).
 *
 * The month-by-month engine runs the 120 months of the Comparison_Horizon once. For each month it:
 *   1. derives the current Home_Value from the START-of-year appreciation level — Home_Value grows
 *      once per completed year, `Home_Price · (1 + appreciation/100)^yearsElapsed` (R1.6);
 *   2. computes `Ownership_Cost_Monthly` = Monthly_Payment + 1/12 of (property tax `rate·HomeValue`
 *      + homeowners insurance + maintenance `rate·HomeValue` + 12·HOA_Monthly) (R2.3);
 *   3. computes `Rent_Cost_Monthly` = current monthly rent (Current_Rent_Monthly grown once per
 *      completed year by Rent_Growth_Rate) + 1/12 renters insurance (R2.2);
 *   4. adds the `Monthly_Difference` (the absolute gap) to the invested side of whichever path is
 *      cheaper that month — the Buy_Path side investment when owning is cheaper, the Rent_Path when
 *      renting is cheaper (R2.4);
 *   5. at each completed year boundary (every 12th month), grows every invested balance — the
 *      Rent_Path balance and both side investments — by `annualReturnPercent` once, matching the
 *      Spec 2 annual-compounding convention (R2.5), then records that year's net worths.
 *
 * Net worth per year N:
 *   - Buy (R1.7, R4.2): `Home_Value(N) − Loan_Balance(N) + buySideInvestment(N)`, minus the
 *     year-10 selling cost `Home_Value(10)·sellingCostPercent/100` applied ONLY at N = 10. Year 0 is
 *     `Home_Price − Loan_Amount − Closing_Costs + 0` = `Down_Payment − Closing_Costs` (no side
 *     investment has accrued yet, R4.2).
 *   - Rent (R2.1, R2.6, R4.2): the single invested balance, seeded at `startingAssetsTotal` at year
 *     0 (R2.1) and grown with reinvested Monthly_Difference; no home equity, no mortgage (R2.6).
 *
 * `annualReturnPercent` and `appreciationRatePercent` are passed per band so `buildBands` can vary
 * them (R5.2, R5.3). Pure and deterministic: numbers in, two 11-number arrays out — no fetch, no
 * `localStorage`, no clock.
 */
export function computePaths(inputs: PathInputs): PathResult {
  const { startingAssetsTotal, assumptions, annualReturnPercent, appreciationRatePercent } = inputs;
  const {
    homePrice,
    downPaymentPercent,
    mortgageRatePercent,
    mortgageTermYears,
    propertyTaxRatePercent,
    homeownersInsurance,
    maintenanceRatePercent,
    hoaMonthly,
    closingCosts,
    sellingCostPercent,
    currentRentMonthly,
    rentGrowthRatePercent,
    rentersInsurance,
  } = assumptions;

  const downPayment = homePrice * (downPaymentPercent / 100);
  const loanAmount = homePrice - downPayment;

  // The full amortization schedule; month M's end-of-month balance is schedule[M-1].balance.
  const schedule = amortize(loanAmount, mortgageRatePercent, mortgageTermYears);
  const payment = monthlyPayment(loanAmount, mortgageRatePercent, mortgageTermYears);

  const appreciationFactor = 1 + appreciationRatePercent / 100;
  const rentGrowthFactor = 1 + rentGrowthRatePercent / 100;
  const returnFactor = 1 + annualReturnPercent / 100;

  // Home_Value grows once per completed year (R1.6): homeValueByYear[N] = price·factor^N.
  const homeValueByYear: number[] = [];
  for (let year = 0; year <= COMPARISON_HORIZON; year += 1) {
    homeValueByYear.push(homePrice * appreciationFactor ** year);
  }

  // The year-0 Loan_Balance is the opening principal; the year-N balance (N ≥ 1) is the end-of-month
  // balance at month N·12. A term shorter than the horizon leaves the schedule exhausted, so a
  // missing month means the loan is already paid off → balance 0.
  const loanBalanceByYear: number[] = [loanAmount];
  for (let year = 1; year <= COMPARISON_HORIZON; year += 1) {
    const monthIndex = year * 12; // 1-based month number at this year boundary
    const entry = schedule[monthIndex - 1];
    loanBalanceByYear.push(entry ? entry.balance : 0);
  }

  const buy: number[] = [];
  const rent: number[] = [];

  // Year-0 starting positions (R4.2). No side investment has accrued yet.
  // Buy: Home_Price − Loan_Amount − Closing_Costs = Down_Payment − Closing_Costs.
  buy.push(homePrice - loanAmount - closingCosts);
  // Rent: the full Starting_Assets total (renter spends neither down payment nor closing costs).
  rent.push(startingAssetsTotal);

  // Running invested balances advanced month by month across the horizon.
  let rentBalance = startingAssetsTotal; // Rent_Path invested balance (R2.1)
  let buySideInvestment = 0; // Buy_Path side investment (R2.4)

  for (let year = 1; year <= COMPARISON_HORIZON; year += 1) {
    // Costs within a year use that year's start-of-year Home_Value and grown rent (R1.6, R2.2):
    // during year `year` (months 1..12 of that year), `year - 1` whole years have elapsed.
    const yearsElapsed = year - 1;
    const homeValue = homeValueByYear[yearsElapsed];
    const currentRent = currentRentMonthly * rentGrowthFactor ** yearsElapsed;

    // Ownership_Cost_Monthly (R2.3): payment + 1/12 of annual property tax, insurance, maintenance,
    // and the annualized HOA (12·HOA_Monthly ÷ 12 == HOA_Monthly).
    const annualPropertyTax = (propertyTaxRatePercent / 100) * homeValue;
    const annualMaintenance = (maintenanceRatePercent / 100) * homeValue;
    const ownershipCostMonthly =
      payment +
      (annualPropertyTax + homeownersInsurance + annualMaintenance + 12 * hoaMonthly) / 12;

    // Rent_Cost_Monthly (R2.2): current monthly rent + 1/12 renters insurance.
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

    // Record this year's net worths.
    // Rent_Net_Worth: the invested balance, no equity, no mortgage (R2.6).
    rent.push(rentBalance);

    // Buy_Net_Worth: Home_Value(N) − Loan_Balance(N) + side investment, with the year-10 selling
    // cost applied once at N = 10 (R1.7).
    let buyNetWorth =
      homeValueByYear[year] - loanBalanceByYear[year] + buySideInvestment;
    if (year === COMPARISON_HORIZON) {
      buyNetWorth -= homeValueByYear[COMPARISON_HORIZON] * (sellingCostPercent / 100);
    }
    buy.push(buyNetWorth);
  }

  return { buy, rent };
}

// ---------------------------------------------------------------------------
// buildBands (R5.1, R5.2, R5.3, R5.6)
// ---------------------------------------------------------------------------

/**
 * Builds the base/optimistic/pessimistic bands for BOTH paths (R5.1).
 *
 * Each band re-runs `computePaths` with the same assumptions and Starting_Assets, varying only the
 * two scenario-sensitive rates, exactly mirroring the Spec 2 `buildScenarios` convention of scaling
 * the return by the Scenario_Multiplier:
 *   - base        — the blended `baseReturnPercent` (implicit multiplier 1.0) and the base
 *                   Home_Appreciation_Rate;
 *   - optimistic  — `baseReturnPercent · multipliers.optimistic` and the base appreciation rate
 *                   scaled by the same optimistic multiplier (appreciation up, R5.3);
 *   - pessimistic — `baseReturnPercent · multipliers.pessimistic` and the base appreciation rate
 *                   scaled by the same pessimistic multiplier (appreciation down, R5.3).
 *
 * The Rent_Path has no home, so its only scenario lever is the Investment_Return applied to its
 * invested balance (R5.2); the Buy_Path varies BOTH its side-investment return AND its
 * Home_Appreciation_Rate (R5.3). Scaling both levers by the same multiplier keeps optimistic ≥ base
 * ≥ pessimistic for every year and both paths, because each path's per-year net worth is monotonic
 * non-decreasing in both the return and the appreciation rate under the stated bounds — optimistic
 * multiplier ≥ 1.0, pessimistic ≤ 1.0, so optimistic appreciation ≥ base ≥ pessimistic appreciation
 * (R5.6).
 *
 * `computePaths` applies the band's `annualReturnPercent` to both the Rent_Path balance and the
 * Buy_Path side investment, so passing one return per band drives both paths' investment legs at
 * once; the `appreciationRatePercent` only touches the Buy_Path Home_Value. Pure and deterministic:
 * numbers in, plain arrays out — no fetch, no `localStorage`, no clock.
 */
export function buildBands(
  assumptions: BuyVsRentAssumptions,
  startingAssetsTotal: number,
  baseReturnPercent: number,
  multipliers: ScenarioMultipliers,
): ComparisonBands {
  const baseAppreciation = assumptions.homeAppreciationRatePercent;

  const base = computePaths({
    startingAssetsTotal,
    assumptions,
    annualReturnPercent: baseReturnPercent,
    appreciationRatePercent: baseAppreciation,
  });

  const optimistic = computePaths({
    startingAssetsTotal,
    assumptions,
    annualReturnPercent: baseReturnPercent * multipliers.optimistic,
    appreciationRatePercent: baseAppreciation * multipliers.optimistic,
  });

  const pessimistic = computePaths({
    startingAssetsTotal,
    assumptions,
    annualReturnPercent: baseReturnPercent * multipliers.pessimistic,
    appreciationRatePercent: baseAppreciation * multipliers.pessimistic,
  });

  return {
    buy: {
      base: base.buy,
      optimistic: optimistic.buy,
      pessimistic: pessimistic.buy,
    },
    rent: {
      base: base.rent,
      optimistic: optimistic.rent,
      pessimistic: pessimistic.rent,
    },
  };
}

// ---------------------------------------------------------------------------
// findBreakevenYear (R6.1, R6.2)
// ---------------------------------------------------------------------------

/**
 * Returns the Breakeven_Year: the first whole year N in 1..10 at which the base-band Buy_Net_Worth
 * meets or exceeds the base-band Rent_Net_Worth (R6.1), or `null` when the Buy_Path never catches
 * up within the Comparison_Horizon (R6.2).
 *
 * Year 0 is excluded deliberately: the comparison is about where the two paths stand over time, and
 * year 0 is the fixed starting position (the buyer has just spent the down payment and closing
 * costs), not a meaningful crossover. The scan walks years 1..10 in order and returns the first year
 * whose Buy value is ≥ the Rent value; equality counts as breakeven (R6.1).
 *
 * `baseBuy` and `baseRent` are the length-11 base-band series (years 0..10) from `buildBands`. Pure
 * and deterministic: arrays in, a number or null out — no fetch, no `localStorage`, no clock.
 */
export function findBreakevenYear(
  baseBuy: number[],
  baseRent: number[],
): number | null {
  for (let year = 1; year <= COMPARISON_HORIZON; year += 1) {
    if (baseBuy[year] >= baseRent[year]) {
      return year;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// computeVerdict (R7.1)
// ---------------------------------------------------------------------------

/**
 * Computes the Verdict figures at the Comparison_Horizon (year 10) from the base bands (R7.1):
 * which path ends ahead and the absolute dollar size of the gap.
 *
 * The `leader` is `'buy'` when the year-10 base-band Buy_Net_Worth exceeds Rent, `'rent'` when Rent
 * exceeds Buy, and `'tie'` when they are exactly equal. `year10Difference` is the absolute value of
 * the gap, so the view can state the dollar size independent of which path won. Pure and
 * deterministic: arrays in, a plain object out — no fetch, no `localStorage`, no clock.
 */
export function computeVerdict(
  baseBuy: number[],
  baseRent: number[],
): VerdictFigures {
  const buy10 = baseBuy[COMPARISON_HORIZON];
  const rent10 = baseRent[COMPARISON_HORIZON];
  const gap = buy10 - rent10;

  let leader: VerdictFigures['leader'];
  if (gap > 0) {
    leader = 'buy';
  } else if (gap < 0) {
    leader = 'rent';
  } else {
    leader = 'tie';
  }

  return { leader, year10Difference: Math.abs(gap) };
}

// ---------------------------------------------------------------------------
// findTippingPoint (R7.2, R7.3, R7.4)
// ---------------------------------------------------------------------------

/**
 * The year-10 base-band gap `Buy(10) − Rent(10)` as a function of the Home_Appreciation_Rate, with
 * everything else held fixed. This is the objective whose root is the Appreciation_Tipping_Point —
 * the appreciation rate at which the two paths finish level (R7.2). Only the appreciation rate is
 * varied (R7.3); the Rent_Path is independent of it, so its year-10 value is constant across the
 * search and the whole gap moves with the Buy_Path alone.
 */
function year10GapAtAppreciation(
  assumptions: BuyVsRentAssumptions,
  startingAssetsTotal: number,
  baseReturnPercent: number,
  appreciationRatePercent: number,
): number {
  const { buy, rent } = computePaths({
    startingAssetsTotal,
    assumptions,
    annualReturnPercent: baseReturnPercent,
    appreciationRatePercent,
  });
  return buy[COMPARISON_HORIZON] - rent[COMPARISON_HORIZON];
}

/**
 * Locates the Appreciation_Tipping_Point: the Home_Appreciation_Rate at which the base-band
 * Buy_Net_Worth equals the base-band Rent_Net_Worth at year 10, holding all other assumptions fixed
 * (R7.2), searched across the plausible `TIPPING_POINT_RANGE` of −20%..+20% (R7.3). Returns `null`
 * when the verdict never flips across that range (R7.4).
 *
 * The year-10 gap `Buy(10) − Rent(10)` is monotonic non-decreasing in the appreciation rate (a
 * higher rate only ever raises the Buy_Path's Home_Value; the Rent_Path is unaffected), so the
 * method is a coarse sign-change scan followed by bisection:
 *   1. Scan the range in fixed steps looking for an adjacent pair of sample rates whose gaps have
 *      opposite signs (one side favors Buy, the other Rent). A sample landing exactly on zero is the
 *      tipping point outright.
 *   2. If no sign change exists — the same path wins across the entire range — return `null` (R7.4).
 *   3. Otherwise bisect the bracketing interval until it is narrow enough, and return the midpoint
 *      rate rounded to the one-decimal precision the view reports (R7.3).
 *
 * Pure and deterministic: numbers in, a number or null out — no fetch, no `localStorage`, no clock.
 */
export function findTippingPoint(
  assumptions: BuyVsRentAssumptions,
  startingAssetsTotal: number,
  baseReturnPercent: number,
): number | null {
  const gapAt = (rate: number): number =>
    year10GapAtAppreciation(assumptions, startingAssetsTotal, baseReturnPercent, rate);

  const { min, max } = TIPPING_POINT_RANGE;
  const scanStep = 0.5; // percent; fine enough to bracket the single crossing of a monotonic gap

  // Annotated as `number` (not the `-20` literal `TIPPING_POINT_RANGE.min` carries via `as const`)
  // because `lo` advances across the scan.
  let lo: number = min;
  let loGap = gapAt(lo);
  if (loGap === 0) {
    return lo;
  }

  // Step 1 + 2: scan for the first adjacent pair that brackets a sign change (R7.4 when none found).
  let bracketLo: number | null = null;
  let bracketHi: number | null = null;
  for (let hi = min + scanStep; hi <= max + 1e-9; hi += scanStep) {
    const clampedHi = Math.min(hi, max);
    const hiGap = gapAt(clampedHi);

    if (hiGap === 0) {
      return Number(clampedHi.toFixed(1));
    }
    if (Math.sign(hiGap) !== Math.sign(loGap)) {
      bracketLo = lo;
      bracketHi = clampedHi;
      break;
    }

    lo = clampedHi;
    loGap = hiGap;
  }

  if (bracketLo === null || bracketHi === null) {
    // The same path wins across the whole −20%..+20% range: the outcome never flips (R7.4).
    return null;
  }

  // Step 3: bisect the bracketing interval to the reported one-decimal precision (R7.3).
  let a = bracketLo;
  let b = bracketHi;
  let aGap = gapAt(a);
  const tolerance = 1e-4; // percent; well below the one-decimal reporting precision
  while (b - a > tolerance) {
    const mid = (a + b) / 2;
    const midGap = gapAt(mid);
    if (midGap === 0) {
      a = mid;
      b = mid;
      break;
    }
    if (Math.sign(midGap) === Math.sign(aGap)) {
      a = mid;
      aGap = midGap;
    } else {
      b = mid;
    }
  }

  return Number(((a + b) / 2).toFixed(1));
}

// ---------------------------------------------------------------------------
// rankSensitivity (R8.1, R8.2, R8.4, R8.5)
// ---------------------------------------------------------------------------

/**
 * The editable assumptions ranked by `rankSensitivity`, in a FIXED order (R8.4). The order is the
 * deterministic tie-break: when two assumptions produce the same |Δ year-10 difference|, the one
 * earlier in this list wins, so the ranking is stable for identical inputs. Each entry pairs the
 * assumption key with the plain-language label the view shows.
 *
 * Only the scalar, path-affecting assumptions are perturbed. `multipliers` is a nested object rather
 * than a single number (no single relative step applies), and `cushionMonths` only sizes the
 * Cash_Cushion threshold, not either net-worth path, so neither belongs in the year-10-difference
 * ranking.
 */
const SENSITIVITY_KEYS: readonly { key: keyof BuyVsRentAssumptions; label: string }[] = [
  { key: 'homePrice', label: 'Home price' },
  { key: 'downPaymentPercent', label: 'Down payment' },
  { key: 'mortgageRatePercent', label: 'Mortgage rate' },
  { key: 'mortgageTermYears', label: 'Mortgage term' },
  { key: 'propertyTaxRatePercent', label: 'Property tax rate' },
  { key: 'homeownersInsurance', label: 'Homeowners insurance' },
  { key: 'maintenanceRatePercent', label: 'Maintenance rate' },
  { key: 'hoaMonthly', label: 'HOA dues' },
  { key: 'closingCosts', label: 'Closing costs' },
  { key: 'sellingCostPercent', label: 'Selling cost' },
  { key: 'homeAppreciationRatePercent', label: 'Home appreciation rate' },
  { key: 'currentRentMonthly', label: 'Current rent' },
  { key: 'rentGrowthRatePercent', label: 'Rent growth rate' },
  { key: 'rentersInsurance', label: 'Renters insurance' },
];

/**
 * Ranks the editable assumptions by how much each one moves the year-10 base-band outcome (R8.1,
 * R8.2). For each assumption in the fixed `SENSITIVITY_KEYS` order, its current value is scaled by
 * the SAME relative `SENSITIVITY_STEP` — `value · (1 + SENSITIVITY_STEP)` — one assumption at a time
 * with every other held at its current value (R8.5), the base-band year-10 difference
 * `Buy(10) − Rent(10)` is recomputed, and the entry records `|perturbed difference − current
 * difference|` (R8.2).
 *
 * Entries are sorted by that delta descending (R8.1). Ties are broken by the fixed
 * `SENSITIVITY_KEYS` order — the earlier assumption ranks first — so the ranking is deterministic
 * for identical inputs (R8.4). A perturbation that leaves the year-10 difference unchanged (e.g. an
 * assumption at value 0, which the relative step cannot move) yields a delta of 0 and naturally
 * sorts to the bottom.
 *
 * The full ranked list is returned; the view decides how many of the top entries to surface (R8.3).
 * Pure and deterministic: numbers in, a plain array out — no fetch, no `localStorage`, no clock.
 */
export function rankSensitivity(
  assumptions: BuyVsRentAssumptions,
  startingAssetsTotal: number,
  baseReturnPercent: number,
): SensitivityEntry[] {
  const baseGap = year10GapAtAppreciation(
    assumptions,
    startingAssetsTotal,
    baseReturnPercent,
    assumptions.homeAppreciationRatePercent,
  );

  // Pair each computed entry with its fixed-order index so the tie-break below is stable without
  // relying on Array.prototype.sort being stable for the full comparator.
  const ranked: { order: number; entry: SensitivityEntry }[] = SENSITIVITY_KEYS.map(
    ({ key, label }, index) => {
      // Every entry in SENSITIVITY_KEYS is a numeric-valued assumption (the nested `multipliers`
      // object is deliberately excluded), so the indexed value is always a number here even though
      // the key type alone admits the `ScenarioMultipliers` field.
      const currentValue = assumptions[key] as number;
      const perturbed: BuyVsRentAssumptions = {
        ...assumptions,
        [key]: currentValue * (1 + SENSITIVITY_STEP),
      };
      const perturbedGap = year10GapAtAppreciation(
        perturbed,
        startingAssetsTotal,
        baseReturnPercent,
        perturbed.homeAppreciationRatePercent,
      );

      return {
        order: index,
        entry: {
          key,
          label,
          year10DifferenceDelta: Math.abs(perturbedGap - baseGap),
        },
      };
    },
  );

  ranked.sort((a, b) => {
    const delta = b.entry.year10DifferenceDelta - a.entry.year10DifferenceDelta;
    if (delta !== 0) {
      return delta;
    }
    // Exact tie: preserve the fixed SENSITIVITY_KEYS order — earlier assumption first (R8.4).
    return a.order - b.order;
  });

  return ranked.map(({ entry }) => entry);
}

// ---------------------------------------------------------------------------
// computeComparison (R4.1, R2.7, R3.4, R3.5, R6.1, R7.1, R7.2, R8.1)
// ---------------------------------------------------------------------------

/**
 * The first-year Ownership_Cost_Monthly for the Cushion_Threshold (R3.5).
 *
 * This mirrors the year-1 branch of `computePaths` exactly (`yearsElapsed = 0`, so Home_Value is the
 * un-appreciated Home_Price): the fixed Monthly_Payment plus one-twelfth of the first year's property
 * tax (`rate·Home_Price`), homeowners insurance, maintenance (`rate·Home_Price`), and annualized HOA
 * (`12·HOA_Monthly`). It is recomputed here rather than threaded out of `computePaths` so the
 * orchestrator stays a thin composition and `computePaths` keeps returning only the two net-worth
 * series; both derivations share the identical formula, so the threshold matches the cost the Buy_Path
 * actually incurs in year one (R2.3, R3.5).
 */
function firstYearOwnershipCostMonthly(assumptions: BuyVsRentAssumptions): number {
  const {
    homePrice,
    downPaymentPercent,
    mortgageRatePercent,
    mortgageTermYears,
    propertyTaxRatePercent,
    homeownersInsurance,
    maintenanceRatePercent,
    hoaMonthly,
  } = assumptions;

  const loanAmount = homePrice - homePrice * (downPaymentPercent / 100);
  const payment = monthlyPayment(loanAmount, mortgageRatePercent, mortgageTermYears);

  // Year-one Home_Value is the un-appreciated Home_Price (yearsElapsed = 0 in computePaths).
  const annualPropertyTax = (propertyTaxRatePercent / 100) * homePrice;
  const annualMaintenance = (maintenanceRatePercent / 100) * homePrice;

  return (
    payment +
    (annualPropertyTax + homeownersInsurance + annualMaintenance + 12 * hoaMonthly) / 12
  );
}

/**
 * Composes the full nominal Buy-vs-Rent comparison from the resolved inputs (R4.1) — the single entry
 * point the island and tests call. It is a thin orchestration over the pure helpers above; it adds no
 * new math beyond wiring their outputs together and computing the Cushion_Threshold.
 *
 * Steps:
 *   1. Derive the base Investment_Return as the Spec 2 Blended_Expected_Return for the
 *      Current_Allocation via `deriveInvestmentReturn` (R2.7).
 *   2. Reduce Starting_Assets to a single total and build the three bands per path with `buildBands`,
 *      driven by that base return and the Scenario_Multipliers (R5.1).
 *   3. Fund Down_Payment + Closing_Costs out of Starting_Assets with `computeDrawdown` (R3), and size
 *      the Cushion_Threshold as `cushionMonths × first-year Ownership_Cost_Monthly` (R3.5).
 *   4. Derive the Breakeven_Year (R6), the Verdict and Appreciation_Tipping_Point (R7), and the
 *      Sensitivity_Ranking (R8) from the base band / assumptions.
 *
 * Every figure is nominal (future dollars). The caller applies `toTodaysDollars` for display when the
 * Dollar_Basis is `today` (R10), so this stays a pure function: `ComparisonInput` in, `ComparisonResult`
 * out — no fetch, no `localStorage`, no clock.
 */
export function computeComparison(input: ComparisonInput): ComparisonResult {
  const {
    startingAssets,
    currentAllocationFractions,
    market,
    returnAssumptions,
    assumptions,
  } = input;

  // 1. Base Investment_Return = Spec 2 Blended_Expected_Return for the Current_Allocation (R2.7).
  const investmentReturnPercent = deriveInvestmentReturn(
    currentAllocationFractions,
    market,
    returnAssumptions,
  );

  const startingAssetsTotal = ASSET_CLASS_KEYS.reduce(
    (sum, key) => sum + startingAssets[key],
    0,
  );

  // 2. The three bands per path, driven by the base return and the Scenario_Multipliers (R5.1).
  const bands = buildBands(
    assumptions,
    startingAssetsTotal,
    investmentReturnPercent,
    assumptions.multipliers,
  );

  // 3. Drawdown of Down_Payment + Closing_Costs from Starting_Assets (R3), and the Cushion_Threshold
  // as cushionMonths × first-year Ownership_Cost_Monthly (R3.5).
  const downPayment = assumptions.homePrice * (assumptions.downPaymentPercent / 100);
  const fundedAmount = downPayment + assumptions.closingCosts;
  const drawdown = computeDrawdown(startingAssets, fundedAmount);
  const cushionThreshold =
    assumptions.cushionMonths * firstYearOwnershipCostMonthly(assumptions);

  // 4. Breakeven (R6), Verdict + tipping point (R7), and Sensitivity (R8) from the base band.
  const breakevenYear = findBreakevenYear(bands.buy.base, bands.rent.base);
  const verdict = computeVerdict(bands.buy.base, bands.rent.base);
  const tippingPointPercent = findTippingPoint(
    assumptions,
    startingAssetsTotal,
    investmentReturnPercent,
  );
  const sensitivity = rankSensitivity(
    assumptions,
    startingAssetsTotal,
    investmentReturnPercent,
  );

  return {
    bands,
    drawdown,
    cushionThreshold,
    breakevenYear,
    verdict,
    tippingPointPercent,
    sensitivity,
    investmentReturnPercent,
  };
}
