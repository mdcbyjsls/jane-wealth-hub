# Implementation Plan: Long-Term Wealth Projection

## Overview

This plan builds the Long-Term Wealth Projection view (Spec 2) on top of the completed Spec 1
(consolidated-net-worth-view). It follows the design structure exactly and the project's separation
rules: pure calculators in `lib/calculations/` import nothing from `app/`, `components/`, or
`lib/fred/` and never read the clock or `localStorage`; the FRED key stays server-side; the client
island fetches `/api/market-data` and reads the Spec 1 `Target_Store` after mount.

Work is ordered so pure logic and its unit tests land before any UI: shared types → snapshot data →
pure projection calculator (with tests) → server-only FRED client/cache/types and the route's pure
`resolveMarketData` decision function (with fallback tests) → centralized copy/formatting → UI
components → the client island and error boundary → the server page that wires it together.

Per Requirement 12 and the design's Testing Strategy, testing scope is strictly limited to two
example-based Vitest unit-test suites: (1) the projection math, and (2) the market-data fallback
resolution. The design has no Correctness Properties section, so there are no property-based tests,
no component tests, and no other automated tests in this plan. Those two test sub-tasks are marked
optional with `*`; all core implementation tasks are required.

## Tasks

- [x] 1. Add shared market types and the DTB3 steering note
  - [x] 1.1 Create `types/market.ts` with the shared market/return model types
    - Define `MarketSeriesId` (`'CPIAUCSL' | 'DGS10' | 'DTB3'`), `DataSource`
      (`'live' | 'cache' | 'snapshot'`), `MarketSeriesValue`, `MarketDataSnapshot`
      (`cpi`, `tenYear`, `threeMonth`, `dataSource`), and `MarketDataError`
      (`{ ok: false; reason: 'market-unavailable' }`)
    - Define `ReturnAssumptions` (`equityRiskPremium`, `otherReturn`), `ClassReturn`
      (`returnPercent`, `label`, `source`), `ReturnModel` as `Record<AssetClass, ClassReturn>`
      (import `AssetClass` from `@/types/accounts`), `ScenarioMultipliers`
      (`optimistic`, `pessimistic`), `ProjectedPoint` (`year`, `value`), and `ScenarioSeries`
      (`base`, `optimistic`, `pessimistic`)
    - Keep all fields serializable (ISO date strings for `asOf`) so they cross the server→client boundary
    - _Requirements: 8.6, 9.5, 2.1, 2.2, 2.3, 4.1, 4.5, 5.3_
    - _Design: Data Models → `types/market.ts`_

  - [x] 1.2 Add the DTB3 row to the `tech.md` FRED series table
    - Add a `DTB3` row ("3-month Treasury bill yield (cash anchor)") to the FRED series table in the
      `tech.md` steering file so the documented series set matches the code
    - _Design: Steering Addition Required_

- [x] 2. Add the static market-data snapshot fallback
  - [x] 2.1 Create `data/fred-snapshot.json`
    - Provide recent values and ISO `asOf` dates for `cpi` (CPIAUCSL), `tenYear` (DGS10), and
      `threeMonth` (DTB3), matching the `MarketDataSnapshot` series shape without a `dataSource` field
      (the route stamps `dataSource: "snapshot"` when serving the fallback)
    - _Requirements: 9.1, 9.2, 9.3_
    - _Design: Data Models → `data/fred-snapshot.json` shape_

- [x] 3. Implement the pure projection calculator
  - [x] 3.1 Implement `lib/calculations/projection.ts`
    - Add the file-level JSDoc stating the purity contract (inputs-in/numbers-out; imports only
      `@/types/accounts` and `@/types/market`; no `app/`/`components/`/`lib/fred/` imports; no fetch,
      no `localStorage`, no clock reads) and shared constants (`PROJECTION_MAX_YEARS = 30`, default
      multipliers, default ERP, default other-return), reusing `ASSET_CLASS_KEYS` from Spec 1
    - Implement `deriveReturnModel(market, assumptions)`: bonds = DGS10, cash = DTB3,
      stocks = bonds + Equity_Risk_Premium, other = `otherReturn`, each with `label` and `source`
      metadata including the series `asOf` date
    - Implement `computeBlendedReturn(allocationFractions, returnModel)` as the sum over the four
      `ASSET_CLASS_KEYS` of `fraction[class] * return[class]`
    - Implement `projectSeries(base, annualReturnPercent, annualContribution, currentYear, maxYears?)`
      returning `maxYears + 1` points with `v[0] = base` and
      `v[N] = v[N-1] * (1 + r/100) + contribution` (end-of-year contribution for N ≥ 1); `currentYear`
      sets the calendar year on each point
    - Implement `buildScenarios(base, blendedReturnPercent, multipliers, annualContribution,
      currentYear, maxYears?)` producing base (×1.0), optimistic (×optimistic), pessimistic
      (×pessimistic) series
    - Implement `toTodaysDollars(series, inflationRatePercent, currentYear)` dividing each point's
      value by `(1 + infl/100)^(year_i - currentYear)` so year 0 divides by 1
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.6, 4.1, 4.7, 5.3, 6.2, 6.3, 7.1, 7.2_
    - _Design: `lib/calculations/projection.ts` (pure)_

  - [ ]* 3.2 Write unit tests for the projection math in `lib/calculations/__tests__/projection.test.ts`
    - Assert exact numeric values for fixed inputs: year 0 equals Projected_Base (R12.1); year-N
      recurrence `v[N] = v[N-1] * (1 + r/100) + contribution` at a representative year (R12.1); the
      three multiplier-derived scenarios — base, optimistic = blended × optimistic multiplier,
      pessimistic = blended × pessimistic multiplier (R12.1)
    - Assert the today's-dollars conversion `nominal / (1 + infl/100)^year` for a representative year (R12.2)
    - Assert one zero-contribution (pure compounding) case and one positive-contribution case (R12.3)
    - Assert `computeBlendedReturn` equals the exact weighted sum for a fixed allocation and return model (R2.6)
    - _Requirements: 12.1, 12.2, 12.3, 12.5_
    - _Design: Testing Strategy → 1. Projection math_

- [x] 4. Checkpoint - projection math
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement the server-only FRED integration and cache
  - [x] 5.1 Implement `lib/fred/types.ts`
    - Define types for raw FRED responses (observation shape, series id union), the internal cache
      entry shape (resolved values + `fetchedAt`), and the client result union
      `{ ok: true; values: RawSeriesValues } | { ok: false; reason: FetchFailureReason }`
    - Export nothing UI-facing
    - _Requirements: 8.2, 8.3_
    - _Design: Components and Interfaces → `lib/fred/types.ts`_

  - [x] 5.2 Implement `lib/fred/client.ts`
    - Implement `fetchSeries(seriesId, apiKey, signal)` and `fetchAllSeries(apiKey, timeoutMs)`
      fetching CPIAUCSL, DGS10, and DTB3 server-side; the API key is passed in, not read here
    - Enforce the 10-second timeout via `AbortSignal.timeout(10_000)`; return the discriminated union
      and never throw for an expected failure (error / non-success / missing series / timeout)
    - _Requirements: 8.2, 9.2_
    - _Design: Components and Interfaces → `lib/fred/client.ts`_

  - [x] 5.3 Implement `lib/fred/cache.ts`
    - Implement a 24-hour in-memory cache keyed by a fixed market-data key: `readCache(now)` returns
      the entry only when `now - fetchedAt < 24h` and otherwise reports expiry; `writeCache` stores
      values with the fetch timestamp; `now` is passed in (no clock read)
    - _Requirements: 8.3, 8.4, 8.5_
    - _Design: Components and Interfaces → `lib/fred/cache.ts`_

- [x] 6. Implement the server-only market-data route with a pure resolver
  - [x] 6.1 Implement the pure `resolveMarketData` decision function
    - Implement `resolveMarketData({ apiKeyConfigured, readCache, fetchAllSeries, readSnapshot, now })`
      with injected collaborators (no network, no clock read inside), evaluating in order: no key →
      snapshot; fresh cache (< 24h) → cache (no fetch); fetch ok → write cache + live; fetch failed →
      snapshot; snapshot unreadable or missing a required series → market-unavailable error with no
      partial values
    - Stamp the resolved `dataSource` on the returned `MarketDataSnapshot`
    - Place this in a server-only module importable by the route and by tests (e.g. alongside the route)
    - _Requirements: 8.2, 8.4, 8.5, 8.6, 9.1, 9.2, 9.6_
    - _Design: `app/api/market-data/route.ts` fallback decision logic; Testing Strategy → 2_

  - [x] 6.2 Implement `app/api/market-data/route.ts` GET handler wiring the real collaborators
    - Read `process.env.FRED_API_KEY` here only; never place the key in any response body, header, or
      payload; wire the real `fetchAllSeries`, `readCache`/`writeCache`, snapshot reader for
      `data/fred-snapshot.json`, and `now = Date.now()` into `resolveMarketData`
    - On success return the `MarketDataSnapshot` JSON; on the unreadable-snapshot branch return a non-2xx
      `MarketDataError` body carrying no partial values
    - _Requirements: 8.1, 8.2, 8.6, 9.5, 9.6_
    - _Design: Components and Interfaces → `app/api/market-data/route.ts`_

  - [ ]* 6.3 Write unit tests for the market-data fallback resolver
    - Test `resolveMarketData` with injected/mocked collaborators (no real network or clock),
      asserting the exact outcome for fixed inputs: no key → `dataSource = 'snapshot'` (R12.4);
      fetch failure (error / non-success / missing series / timeout) → `dataSource = 'snapshot'`
      (R12.4); fresh cache within 24h → `dataSource = 'cache'` with no FRED fetch performed (R12.4);
      snapshot unreadable or missing a required series → market-unavailable error with no partial
      values (R12.6)
    - _Requirements: 12.4, 12.5, 12.6_
    - _Design: Testing Strategy → 2. Market-data fallback logic_

- [x] 7. Checkpoint - market-data fallback
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Add centralized projection copy
  - [x] 8.1 Implement `lib/projectionMessages.ts`
    - Centralize all user-facing copy in plain language (no data-format names, route/endpoint names,
      status codes, or file names): loading, cache "last updated" note, snapshot fallback banner,
      route-error, account-error, zero-base note, inflation-unavailable message, assumption validation
      messages, example-target labeling, and source-label/reasoning strings — mirroring `lib/messages.ts`
    - _Requirements: 1.6, 1.7, 2.4, 2.5, 3.4, 3.5, 4.6, 5.7, 6.5, 7.6, 9.3, 9.4, 10.1, 10.2, 10.3, 10.5_
    - _Design: Error Handling_

- [x] 9. Implement the projection UI components
  - [x] 9.1 Implement `components/charts/ProjectionChart.tsx`
    - `'use client'` Recharts band chart: an `Area` between the pessimistic and optimistic series with
      the base series as a line inside the band; support rendering both the current and target bands
      distinguished by a text/shape cue (solid vs dashed base line + labeled legend), never color alone
    - Add a programmatically associated `sr-only` text alternative (`<figure aria-labelledby>` +
      `sr-only` `<dl>`) listing base/optimistic/pessimistic values at years 10/20/30 with tabular
      numerals; mark the SVG `aria-hidden`
    - Show tooltips on hover and keyboard focus within 200 ms with the year, the focused scenario's
      dollar value, and the percent change from the Projected_Base to one decimal; dismiss on blur/leave
    - Render no chart graphic when projection data is unavailable
    - _Requirements: 4.3, 7.4, 11.1, 11.2, 11.3, 11.5, 11.6_
    - _Design: UI components → `ProjectionChart.tsx`_

  - [x] 9.2 Implement `components/ui/AssumptionPanel.tsx`
    - `'use client'` panel listing every editable assumption with value, label, and source: the four
      class Expected_Return values, Equity_Risk_Premium, Inflation_Rate, Optimistic_/Pessimistic_
      Multiplier, and Annual_Contribution
    - Show `Market_Series` source labels + `asOf` dates for market-derived assumptions and the
      "bond anchor + equity risk premium" reasoning for stocks; use `lib/format.ts` for money/percent
    - Render inline validation adjacent to the offending input; invalid edits keep the last valid
      projection and retain the previously accepted value; provide a reset control that restores
      defaults and clears messages; enforce documented ranges (ERP 0–15, other 0–20, optimistic 1.0–3.0,
      pessimistic 0.0–1.0, contribution 0–10,000,000)
    - _Requirements: 2.4, 2.5, 3.1, 3.2, 3.4, 3.5, 3.6, 4.5, 4.6, 6.1, 6.4, 6.5_
    - _Design: UI components → `AssumptionPanel.tsx`_

  - [x] 9.3 Implement `components/ui/DollarBasisToggle.tsx`
    - `'use client'` keyboard-operable two-state control (nominal default / today's dollars) with a
      persistent text label so the active basis is distinguishable without color
    - _Requirements: 5.1, 5.4_
    - _Design: UI components → `DollarBasisToggle.tsx`_

  - [x] 9.4 Implement `components/ui/MarketDataBanner.tsx`
    - `role="note"` banner reusing the Spec 1 `StaleDataBanner` idea with a text + symbol cue (never
      color alone): fallback banner with the snapshot last-updated date when `dataSource` is `snapshot`,
      a plain "last updated" note that does not present data as live when `cache`, hidden when `live`
    - _Requirements: 9.3, 9.4_
    - _Design: UI components → `MarketDataBanner.tsx`_

  - [x] 9.5 Implement `components/ui/ComparisonSummary.tsx`
    - Render the signed year-10/20/30 difference (target base − current base) in the active
      Dollar_Basis, whole-dollar tabular numerals, with a text/shape sign cue rather than color alone
    - When the target is the Spec 1 example default (`isExample: true`), label both the target range and
      the differences "based on an example target"
    - _Requirements: 7.5, 7.6_
    - _Design: UI components → `ComparisonSummary.tsx`_

  - [x] 9.6 Implement `components/ui/ProjectionEmptyState.tsx` and `components/ui/ProjectionErrorState.tsx`
    - Plain-language zero-base empty state (R1.6) and unavailable/error state (R1.7, R10), mirroring
      Spec 1's `EmptyState` / `ErrorState`; expose the unavailable message to assistive tech with no
      chart graphic
    - _Requirements: 1.6, 1.7, 10.2, 10.3, 11.6_
    - _Design: UI components → `ProjectionEmptyState.tsx` / `ProjectionErrorState.tsx`_

- [x] 10. Implement the client island and error boundary
  - [x] 10.1 Implement `components/layout/ProjectionClient.tsx`
    - `'use client'` island owning: fetching `/api/market-data`; the market/projection state machine
      (Loading → Ready_live/Ready_cache/Ready_snapshot | RouteError, with retry); the editable
      assumptions; the Dollar_Basis toggle (today's-dollars → nominal fallback with message when
      Inflation_Rate is unavailable); reading the Spec 1 `Target_Store` after mount (seeding from
      `DEFAULT_TARGET` for SSR consistency); and recomputing via the pure `projection.ts` functions on
      every change
    - Display horizon call-outs for years 10/20/30 as labeled ranges (pessimistic→optimistic with base
      within), render current and target bands, and wire the comparison summary and banners
    - _Requirements: 1.4, 1.5, 2.1, 2.7, 3.3, 4.2, 4.4, 5.2, 5.5, 5.6, 5.7, 7.1, 7.3, 9.4, 9.5, 10.1, 10.4, 11.4_
    - _Design: View and island → `ProjectionClient.tsx`; state machine_

  - [x] 10.2 Implement `components/layout/ProjectionErrorBoundary.tsx`
    - Mirror `DashboardErrorBoundary`: catch unexpected faults in the island and render the route-error
      copy from `lib/projectionMessages.ts`, never a stack trace or blank screen
    - _Requirements: 10.2, 10.5_
    - _Design: View and island; Error Handling_

- [x] 11. Wire the projection page
  - [x] 11.1 Implement `app/projection/page.tsx` (server component)
    - Load and validate `data/accounts.json` with Spec 1's `validateAccounts`; compute `totals` and
      `allocation` via `computeClassTotals` / `computeActualAllocation`; derive `currentYear` from
      `new Date()` at the boundary
    - On account load/validation failure route to the account-unavailable state (which also wins when
      market data later fails); otherwise render the shell plus `ProjectionErrorBoundary` wrapping
      `ProjectionClient`, passing serializable props (`allocation`, `totals`, `currentYear`); do not
      fetch market data here — the island does
    - _Requirements: 1.1, 10.3, 10.6_
    - _Design: View and island → `app/projection/page.tsx`_

- [x] 12. Final checkpoint - full view
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP. Per
  Requirement 12 and the design's Testing Strategy, the only tests in scope are the projection-math
  unit tests (3.2) and the market-data fallback unit tests (6.3). There are no property-based tests,
  component tests, or other automated tests in this plan — the design has no Correctness Properties
  section because PBT is out of scope for this spec.
- Each test task asserts exact expected numeric values (math) or exact `DataSource`/error outcomes
  (fallback) for fixed inputs (R12.5).
- Pure calculators (`lib/calculations/projection.ts`) import nothing from `app/`, `components/`, or
  `lib/fred/` and never read the clock or `localStorage`; `currentYear` and all assumptions are passed
  in.
- The FRED key is read only in `app/api/market-data/route.ts` and never sent to the client; the client
  island fetches `/api/market-data` and reads the `Target_Store` after mount.
- Each task references the requirement clauses and design sections it implements for traceability.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["3.1", "5.1"] },
    { "id": 2, "tasks": ["3.2", "5.2", "5.3", "8.1", "9.1", "9.3", "9.4", "9.6"] },
    { "id": 3, "tasks": ["6.1", "9.2", "9.5"] },
    { "id": 4, "tasks": ["6.2", "6.3", "10.2"] },
    { "id": 5, "tasks": ["10.1"] },
    { "id": 6, "tasks": ["11.1"] }
  ]
}
```
