# Implementation Plan: Buy-vs-Rent Scenario Tester

## Overview

This plan builds the Buy-vs-Rent Scenario Tester (Spec 3), the product hero feature, on top of the
completed Spec 1 (consolidated-net-worth-view) and Spec 2 (long-term-wealth-projection). It follows the
design structure exactly and the project's separation rules: pure calculators in `lib/calculations/`
import nothing from `app/`, `components/`, or `lib/fred/` and never read the clock or `localStorage`; the
FRED key stays server-side; the client island fetches `/api/market-data` after mount and calls the pure
calculator on every edit.

The spec reuses, rather than reimplements, both prior specs. Spec 1's `validateAccounts`,
`computeClassTotals`, and `computeActualAllocation` supply the Starting_Assets and Current_Allocation.
Spec 2's `deriveReturnModel` + `computeBlendedReturn` supply the Investment_Return, `toTodaysDollars`
supplies the today's-dollars discounting, and the `DollarBasisToggle`, `MarketDataBanner`, and
`DashboardErrorBoundary` patterns are carried over. None of that code is recreated here.

Work is ordered so pure logic and its unit tests land before any UI: shared type/assumption extensions →
snapshot data extension → the pure `lib/calculations/buyVsRent.ts` calculator (with its unit tests) →
the three-series extension of the shared server-only FRED modules → centralized copy → UI components →
the client island and error boundary → the server page that wires it together. The shared FRED modules
(`types/market.ts`, `lib/fred/types.ts`, `lib/fred/client.ts`, `app/api/market-data/route.ts`,
`app/api/market-data/resolveMarketData.ts`, `data/fred-snapshot.json`) are **extended, not replaced**, so
Spec 2 keeps working with the same five-becomes-six series set everywhere consistently.

Per Requirement 14 and the design's Testing Strategy, testing scope is strictly limited to example-based
Vitest unit tests for the `BuyVsRent_Calculator`: the amortization and loan-balance math, the year-10
Buy and Rent net worths, the symmetric reinvestment, the breakeven detection, and the sensitivity +
tipping-point logic. The design has no Correctness Properties section, so there are no property-based
tests, no component tests, and no other automated tests in this plan. Those test sub-tasks are marked
optional with `*`; all core implementation tasks are required.

## Tasks

- [x] 1. Add shared types and the assumption model
  - [x] 1.1 Extend `types/market.ts` with the three new series and snapshot fields
    - Add `'MORTGAGE30US' | 'CSUSHPINSA' | 'CUSR0000SEHA'` to the `MarketSeriesId` union
    - Add `mortgageRate`, `homePriceIndex`, and `rentIndex` (`MarketSeriesValue`) to
      `MarketDataSnapshot`, leaving the Spec 2 fields (`cpi`, `tenYear`, `threeMonth`, `dataSource`)
      unchanged so Spec 2 keeps working
    - Keep all fields serializable (ISO date strings for `asOf`) so they cross the server→client boundary
    - _Requirements: 11.1, 11.3, 11.4_
    - _Design: Data Models → `types/market.ts` (extended)_

  - [x] 1.2 Add the buy-vs-rent calculator types
    - Define the serializable calculator types alongside the shared market types (`types/market.ts` or a
      focused `types/buyVsRent.ts`): `COMPARISON_HORIZON = 10`, `BuyVsRentAssumptions`,
      `AmortizationMonth`, `DrawdownResult`, `PathResult`, `PathBands`, `ComparisonBands`,
      `VerdictFigures`, `SensitivityEntry`, `ComparisonInput`, and `ComparisonResult`
    - Reuse `AssetClass`/`ClassTotals` from `@/types/accounts` and `ReturnAssumptions`/`ReturnModel`/
      `ScenarioMultipliers`/`DollarBasis` from the Spec 2 market types; keep every field a primitive or
      plain object so the types are safe as island props and test fixtures
    - _Requirements: 9.1, 3.1, 3.2, 3.4, 3.6, 4.1, 5.1, 7.1, 8.1_
    - _Design: Data Models → `types/market.ts` additions for the calculator_

- [x] 2. Extend the static market-data snapshot fallback
  - [x] 2.1 Add the three new series to `data/fred-snapshot.json`
    - Add `mortgageRate` (`MORTGAGE30US`), `homePriceIndex` (`CSUSHPINSA`), and `rentIndex`
      (`CUSR0000SEHA`) entries with recent values and ISO `asOf` dates, matching the existing per-series
      shape (no `dataSource` field; the route stamps `dataSource: "snapshot"` when serving the fallback)
      so the view functions with no API key configured
    - _Requirements: 11.2, 11.3_
    - _Design: Data Models → `data/fred-snapshot.json` (extended)_

- [x] 3. Implement the pure buy-vs-rent calculator
  - [x] 3.1 Implement amortization and the investment return in `lib/calculations/buyVsRent.ts`
    - Add the file-level JSDoc stating the purity contract (inputs-in/numbers-out; imports only
      `@/types/accounts`, `@/types/market`, and the pure Spec 2 `projection.ts`; no `app/`/`components/`/
      `lib/fred/` imports; no fetch, no `localStorage`, no clock reads) and the shared constants
      (`COMPARISON_HORIZON = 10`, `MORTGAGE_TERM_YEARS = 30`, `MAINTENANCE_RATE = 1`, `CUSHION_MONTHS = 6`,
      `SENSITIVITY_STEP`, `TIPPING_POINT_RANGE = ±20`, reusing `ASSET_CLASS_KEYS`)
    - Implement `monthlyPayment(loanAmount, annualRatePercent, termYears)` using
      `M = P·i·(1+i)^n / ((1+i)^n − 1)` with `i = rate/100/12`, `n = termYears*12`, and the zero-rate
      special case `M = loanAmount / n`
    - Implement `amortize(loanAmount, annualRatePercent, termYears)` returning one `AmortizationMonth`
      per month: `interest = balance·i`, `principal = M − interest`, `balance -= principal`, with the
      final month's principal clamped so the balance is non-increasing, never negative, and exactly zero
      at term end
    - Implement `deriveInvestmentReturn(currentAllocationFractions, market, returnAssumptions)` by calling
      the Spec 2 `deriveReturnModel` then `computeBlendedReturn` (do not recompute the return model here)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.7_
    - _Design: `lib/calculations/buyVsRent.ts` → amortization + Investment_Return; Reused Spec 2 modules_

  - [x] 3.2 Implement the drawdown and single-band path computation
    - Implement `computeDrawdown(startingAssets, fundedAmount)` funding Down_Payment + Closing_Costs from
      cash first, then pro-rata across stocks/bonds/other by dollar weight; return the reduced per-class
      balances, the Post_Purchase_Allocation percentages, the Cash_Cushion, and an `overBudget` flag when
      the funded sum exceeds the Starting_Assets total
    - Implement `computePaths(inputs)` producing 11 year-0..10 values for both paths: advance the
      amortization and the two monthly cost streams month by month, compute `Ownership_Cost_Monthly`
      (payment + monthly shares of property tax `rate·HomeValue`, homeowners insurance, maintenance
      `rate·HomeValue`, and HOA) and `Rent_Cost_Monthly` (current rent grown once per completed year +
      1/12 renters insurance), add the Monthly_Difference to the cheaper path's side investment, grow
      every invested balance by `annualReturnPercent` once per completed year, and book Buy_Net_Worth as
      `Home_Value(N) − Loan_Balance(N) + side investment` with the year-10 selling cost applied only at
      N = 10; set year-0 values to the documented starting positions
    - _Requirements: 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.4, 3.6, 4.1, 4.2_
    - _Design: `lib/calculations/buyVsRent.ts` → `computeDrawdown` / `computePaths`; Key math decisions_

  - [x] 3.3 Implement the scenario bands, breakeven, verdict, tipping point, and sensitivity
    - Implement `buildBands(assumptions, startingAssetsTotal, baseReturnPercent, multipliers)` building
      base/optimistic/pessimistic bands for both paths: the Rent_Path varies the Investment_Return by the
      Scenario_Multiplier; the Buy_Path varies both the side-investment return by the multiplier and the
      Home_Appreciation_Rate up (optimistic) / down (pessimistic) from base, so optimistic ≥ base ≥
      pessimistic holds per year under the stated bounds
    - Implement `findBreakevenYear(baseBuy, baseRent)` returning the first year N in 1..10 with
      base-band Buy ≥ Rent, or `null` when none in the horizon
    - Implement `computeVerdict(baseBuy, baseRent)` returning the leading path at year 10 and the absolute
      dollar size of the gap
    - Implement `findTippingPoint(assumptions, startingAssetsTotal, baseReturnPercent)` locating the
      Home_Appreciation_Rate at which base-band Buy equals base-band Rent at year 10 by bisection over
      −20%..+20% after a sign-change scan, holding all else fixed, returning `null` when the outcome does
      not flip across the range
    - Implement `rankSensitivity(assumptions, startingAssetsTotal, baseReturnPercent)` perturbing each
      editable assumption by the same fixed relative `SENSITIVITY_STEP`, one at a time, recomputing the
      year-10 base-band difference, and ranking by `|Δ difference|` descending with a fixed-order
      deterministic tie-break
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 6.1, 6.2, 7.1, 7.2, 8.1, 8.2, 8.4, 8.5_
    - _Design: `lib/calculations/buyVsRent.ts` → `buildBands` / `findBreakevenYear` / `computeVerdict` /
      `findTippingPoint` / `rankSensitivity`; Key math decisions_

  - [x] 3.4 Implement the `computeComparison` orchestrator
    - Implement `computeComparison(input)` composing the full nominal comparison from the resolved inputs:
      `deriveInvestmentReturn` for the base return, `buildBands` for the three bands per path,
      `computeDrawdown` plus the Cushion_Threshold (`cushionMonths × first-year Ownership_Cost_Monthly`),
      `findBreakevenYear`, `computeVerdict` + `findTippingPoint`, and `rankSensitivity`; return the
      `ComparisonResult` in nominal dollars so the caller applies `toTodaysDollars` for display
    - _Requirements: 4.1, 2.7, 3.4, 3.5, 6.1, 7.1, 7.2, 8.1_
    - _Design: `lib/calculations/buyVsRent.ts` → `computeComparison` orchestrator_

  - [x]* 3.5 Write unit tests for the calculator in `lib/calculations/__tests__/buyVsRent.test.ts`
    - Assert the exact `monthlyPayment` for a fixed Loan_Amount, Mortgage_Rate, and term, plus the
      zero-interest case `loanAmount / (termYears*12)` (R14.1)
    - Assert a fixed `amortize` schedule ends at `balance === 0` and is non-increasing month over month,
      never negative (R14.2)
    - Assert the exact year-10 Buy_Net_Worth (appreciation + remaining loan balance + year-10 selling
      cost) and year-10 Rent_Net_Worth (initial invested + reinvested Monthly_Difference grown at the
      Investment_Return) for a fixed input set (R14.3)
    - Assert the symmetric reinvestment: one fixed owning-cheaper case where the Buy_Path accrues a side
      investment and the Rent_Path does not, and one fixed renting-cheaper case showing the reverse (R14.4)
    - Assert `findBreakevenYear` for one fixed in-horizon case (exact year) and one fixed none case
      (`null`) (R14.5)
    - Assert the exact `rankSensitivity` ordering for a fixed input including the deterministic tie-break,
      and the exact `findTippingPoint` rate for a fixed input plus `null` for a fixed non-flipping input
      (R14.6)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_
    - _Design: Testing Strategy → `lib/calculations/__tests__/buyVsRent.test.ts`_

- [x] 4. Checkpoint - calculator math
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Extend the server-only FRED integration for the three new series
  - [x] 5.1 Extend `lib/fred/types.ts` with the three new raw series values
    - Widen `RawSeriesValues` with `mortgageRate` (`MORTGAGE30US`), `homePriceIndex` (`CSUSHPINSA`), and
      `rentIndex` (`CUSR0000SEHA`), keyed to match `MarketDataSnapshot`; `FredObservation`,
      `RawSeriesValue`, `FetchFailureReason`, `FredFetchResult`, and `CacheEntry` are unchanged in shape
      so widening `RawSeriesValues` carries the new series through the 24-hour cache automatically
    - _Requirements: 11.1, 11.2_
    - _Design: Data Models → `lib/fred/types.ts` (extended); Extended shared FRED modules_

  - [x] 5.2 Extend `lib/fred/client.ts` to fetch six series
    - Extend `fetchAllSeries` from three to six `fetchSeries` calls (`CPIAUCSL`, `DGS10`, `DTB3`,
      `MORTGAGE30US`, `CSUSHPINSA`, `CUSR0000SEHA`) sharing the one `AbortSignal.timeout` budget, add the
      three new `ok` guards so a missing new series maps to `missing-series` with no partial values, and
      include the three new values in the returned `RawSeriesValues`; leave `fetchSeries` unchanged (it is
      already series-id-generic) and keep the API key passed in by the route, never read here
    - _Requirements: 11.1, 11.2_
    - _Design: Extended shared FRED modules → `lib/fred/client.ts`_

  - [x] 5.3 Extend the route and resolver to carry the three new series
    - In `app/api/market-data/route.ts`, extend `readSnapshot()` to `parseSeries` the three new snapshot
      entries (`mortgageRate` → `MORTGAGE30US`, `homePriceIndex` → `CSUSHPINSA`, `rentIndex` →
      `CUSR0000SEHA`) and require all six series (any gap → `null` → market-unavailable); `parseSeries` is
      unchanged, and the handler still reads the key only here and never writes it into a response
    - In `app/api/market-data/resolveMarketData.ts`, extend only `toSnapshot` to map the three new raw
      values onto the three new `MarketDataSnapshot` fields; the live → cache → snapshot → error cascade,
      the 24-hour caching, and the "never serve a partial set" rule are unchanged and now cover all six
      series
    - _Requirements: 11.1, 11.2, 11.3_
    - _Design: Extended shared FRED modules → `route.ts` / `resolveMarketData.ts`_

- [x] 6. Checkpoint - market-data extension
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add centralized buy-vs-rent copy
  - [x] 7.1 Implement `lib/buyVsRentMessages.ts`
    - Centralize all user-facing copy in plain language (no data-format names, route/endpoint names,
      status codes, or file names): loading, cache "last updated" note, snapshot fallback banner,
      route-error, account-error, over-budget-purchase message, inflation-unavailable message, assumption
      validation messages, breakeven present/absent statements, verdict and tipping-point phrasing, and
      market source-label strings — mirroring `lib/projectionMessages.ts`
    - _Requirements: 3.6, 4.5, 6.3, 6.4, 7.5, 9.4, 10.6, 11.5, 11.6, 12.1, 12.2, 12.3, 12.5_
    - _Design: Error Handling; Market-data + comparison state table_

- [x] 8. Implement the buy-vs-rent UI components
  - [x] 8.1 Implement `components/charts/ComparisonChart.tsx`
    - `'use client'` Recharts band chart drawing both the Buy_Path and Rent_Path bands (each bounded by
      its pessimistic/optimistic series with its base series as a line inside), distinguished by a
      text label or shape cue (e.g. solid vs dashed base line plus a labeled legend), never color alone
    - Add a programmatically associated `sr-only` text alternative (`<figure aria-labelledby>` +
      `sr-only` `<dl>`) listing the year-10 Buy and Rent values for base/optimistic/pessimistic plus the
      Breakeven_Year with tabular numerals, using the `AllocationPie` / `ProjectionChart` pattern; mark
      the SVG `aria-hidden`
    - Show tooltips on hover and keyboard focus within 200 ms with the year, the path, and the net-worth
      dollar value for the focused point; dismiss on blur/leave
    - Render no chart graphic when the comparison is unavailable and expose the unavailable message to
      assistive tech
    - _Requirements: 5.4, 13.1, 13.2, 13.3, 13.5, 13.6_
    - _Design: UI components → `ComparisonChart.tsx`_

  - [x] 8.2 Implement the buy-vs-rent `components/ui/AssumptionPanel.tsx`
    - `'use client'` panel listing every editable assumption with value and text label: Home_Price,
      Down_Payment_Percent, Mortgage_Rate, Mortgage_Term_Years, Property_Tax_Rate, Homeowners_Insurance,
      Maintenance_Rate, HOA_Monthly, Closing_Costs, Selling_Cost_Percent, Home_Appreciation_Rate,
      Current_Rent_Monthly, Rent_Growth_Rate, Renters_Insurance, the cushion-months multiple, the
      Optimistic_Multiplier, and the Pessimistic_Multiplier
    - Show `Market_Series` source labels + as-of dates for the market-derived assumptions (Mortgage_Rate
      cites `MORTGAGE30US`, Home_Appreciation_Rate cites `CSUSHPINSA`, Rent_Growth_Rate cites
      `CUSR0000SEHA`); use `lib/format.ts` for money/percent
    - Render inline validation adjacent to the offending input; invalid edits keep the last valid
      comparison and retain the previously accepted value; provide a reset control restoring
      market-derived/documented defaults and clearing messages; enforce the R9.6 bounds
      (Down_Payment_Percent 0–100, Mortgage_Rate 0–20, Home_Appreciation_Rate and Rent_Growth_Rate
      −20..+20, every dollar assumption ≥ 0)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
    - _Design: UI components → `AssumptionPanel.tsx`_

  - [x] 8.3 Implement `components/ui/ComparisonSummary.tsx`
    - Render the year-10 Buy and Rent call-out figures, each labeled with its path, as whole-dollar
      tabular numerals, and each path's year-10 outcome as a pessimistic-to-optimistic range rather than
      a single point value, consistent with the active Dollar_Basis
    - _Requirements: 4.3, 4.4, 5.5_
    - _Design: UI components → `ComparisonSummary.tsx`_

  - [x] 8.4 Implement `VerdictCard` and `SensitivityCard`
    - `components/ui/VerdictCard.tsx`: the plain-language Verdict stating which path ends ahead at year 10
      and the absolute dollar gap (whole-dollar tabular numerals), the breakeven present/absent statement,
      and the tipping-point sentence (one-decimal rate, or the "does not flip" statement), all in the
      active Dollar_Basis and plain language
    - `components/ui/SensitivityCard.tsx`: the top one or two assumptions from the Sensitivity_Ranking by
      labeled name, in plain language
    - _Requirements: 6.3, 6.4, 7.1, 7.3, 7.4, 7.5, 7.6, 8.3_
    - _Design: UI components → `VerdictCard` / `SensitivityCard`_

  - [x] 8.5 Implement `AllocationShiftCard` and `CushionCard`
    - `components/ui/AllocationShiftCard.tsx`: the Current_Allocation and Post_Purchase_Allocation side by
      side so the change caused by the purchase is visible
    - `components/ui/CushionCard.tsx`: the Cash_Cushion, the Cushion_Threshold, and a text/shape status
      cue indicating whether the cushion is at or above the threshold (never color alone), plus the
      over-budget message in place of a negative cushion when the purchase exceeds available assets
    - _Requirements: 3.3, 3.5, 3.6_
    - _Design: UI components → `AllocationShiftCard` / `CushionCard`_

  - [x] 8.6 Implement `components/ui/BuyVsRentEmptyState.tsx` and `components/ui/BuyVsRentErrorState.tsx`
    - Plain-language unavailable states mirroring Spec 1's `EmptyState` / `ErrorState` and Spec 2's
      projection states; expose the unavailable message to assistive tech with no chart graphic
    - _Requirements: 4.5, 12.2, 12.3, 13.6_
    - _Design: UI components → `BuyVsRentEmptyState.tsx` / `BuyVsRentErrorState.tsx`_

- [x] 9. Implement the client island and error boundary
  - [x] 9.1 Implement `components/layout/BuyVsRentClient.tsx`
    - `'use client'` island owning: fetching `/api/market-data`; the market/comparison state machine
      (Loading → Ready_live/Ready_cache/Ready_snapshot | RouteError, with retry); the editable
      assumptions seeded with market-derived defaults once the snapshot resolves (Mortgage_Rate from
      `MORTGAGE30US`, Home_Appreciation_Rate from `CSUSHPINSA`, Rent_Growth_Rate from `CUSR0000SEHA`);
      the reused `DollarBasisToggle` (today's-dollars → nominal fallback with message when the
      Inflation_Rate is unavailable); and calling the pure `computeComparison` on every change, then
      `toTodaysDollars` for display when the basis is `today`
    - Render the comparison area (chart, year-10 call-outs as labeled ranges, verdict, sensitivity,
      allocation-shift, and cushion cards) plus the reused `MarketDataBanner`; the over-budget purchase
      and inflation-unavailable cases render as Ready sub-states, not machine errors
    - _Requirements: 3.3, 3.5, 3.6, 4.2, 4.3, 4.4, 4.5, 5.4, 5.5, 6.3, 6.4, 7.1, 7.3, 7.6, 8.3, 9.3, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11.4, 11.5, 11.6, 12.1, 12.2, 12.4, 13.4_
    - _Design: View and island → `BuyVsRentClient.tsx`; Market-data + comparison state machine_

  - [x] 9.2 Implement `components/layout/BuyVsRentErrorBoundary.tsx`
    - Mirror `DashboardErrorBoundary` / `ProjectionErrorBoundary`: catch unexpected faults in the island
      and render the route-error copy from `lib/buyVsRentMessages.ts`, never a stack trace or blank screen
    - _Requirements: 12.2, 12.5_
    - _Design: View and island; Error Handling_

- [x] 10. Wire the buy-vs-rent page
  - [x] 10.1 Implement `app/buy-vs-rent/page.tsx` (server component)
    - Load and validate `data/accounts.json` with Spec 1's `validateAccounts`; compute `totals`
      (Starting_Assets) and `allocation` (Current_Allocation) via `computeClassTotals` /
      `computeActualAllocation`; derive `currentYear` from `new Date()` at the boundary
    - On account load/validation failure route to the account-unavailable state (which also wins when
      market data later fails); otherwise render the shell plus `BuyVsRentErrorBoundary` wrapping
      `BuyVsRentClient`, passing serializable props (`allocation`, `totals`, `currentYear`); do not fetch
      market data here — the island does
    - _Requirements: 4.5, 12.3_
    - _Design: View and island → `app/buy-vs-rent/page.tsx`_

- [x] 11. Final checkpoint - full view
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP. Per Requirement
  14 and the design's Testing Strategy, the only tests in scope are the calculator unit tests (3.5)
  covering amortization and loan balance, the year-10 Buy and Rent net worths, the symmetric
  reinvestment, the breakeven detection, and the sensitivity + tipping-point logic. There are no
  property-based tests, component tests, or other automated tests in this plan — the design has no
  Correctness Properties section because PBT is out of scope for this spec.
- Each assertion in the test task checks an exact expected numeric value or outcome for a fixed input,
  with no randomized generation. The three-series market-data extension is exercised through the
  calculator tests via a fixed `MarketDataSnapshot` fixture carrying all six series (R14 scope).
- The pure calculator (`lib/calculations/buyVsRent.ts`) imports only `@/types/accounts`, `@/types/market`,
  and the pure Spec 2 `projection.ts`; it reads no clock, no `localStorage`, and no network, so the
  current year, market snapshot, Starting_Assets, Current_Allocation, and all assumptions are passed in.
- The shared FRED modules are extended, not replaced: the same six-series set is kept consistent across
  `types/market.ts`, `lib/fred/types.ts`, `lib/fred/client.ts`, `route.ts`, `resolveMarketData.ts`, and
  `data/fred-snapshot.json`, so Spec 2 keeps working.
- Spec 1 (`validateAccounts` / `computeClassTotals` / `computeActualAllocation`) and Spec 2
  (`deriveReturnModel` / `computeBlendedReturn` / `toTodaysDollars`, `DollarBasisToggle`,
  `MarketDataBanner`, the error-boundary pattern) are reused, not recreated.
- The FRED key is read only in `app/api/market-data/route.ts` and never sent to the client; the island
  fetches `/api/market-data` after mount.
- Each task references the requirement clauses and design sections it implements for traceability.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "5.1"] },
    { "id": 2, "tasks": ["3.1", "5.2"] },
    { "id": 3, "tasks": ["3.2", "5.3"] },
    { "id": 4, "tasks": ["3.3"] },
    { "id": 5, "tasks": ["3.4"] },
    { "id": 6, "tasks": ["3.5", "7.1", "8.1", "8.3", "8.6"] },
    { "id": 7, "tasks": ["8.2", "8.4", "8.5", "9.2"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["10.1"] }
  ]
}
```
