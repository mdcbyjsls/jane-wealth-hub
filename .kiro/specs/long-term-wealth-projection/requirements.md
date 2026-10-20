# Requirements Document

## Introduction

This feature delivers the Long-Term Wealth Projection view, the second of three specs for the
Jane Wealth Hub. Building on the Consolidated Net Worth and Allocation View (Spec 1), it projects
the user's total invested wealth forward over 10, 20, and 30 years so a mass-affluent user can see
how today's allocation shapes their long-term outcome.

Projections are driven by a per-asset-class expected-return model. Where a sensible market anchor
exists, the expected return is derived from live market data: bonds from the 10-year Treasury yield
and cash from the 3-month Treasury bill yield. Stocks have no such anchor, so the model uses an
editable default built as the bond anchor plus an equity risk premium, with the reasoning shown.
Every assumption in the model — each class return, the equity risk premium, the inflation rate, the
scenario multipliers, and any contribution — is visible, labeled with its source, and editable by
the user, honoring the product principle that no number the user did not choose is ever hidden.

This spec also introduces the market-data integration that Spec 3 will reuse. A server-only API
route fetches the latest values for three market series — CPIAUCSL (general inflation), DGS10
(10-year Treasury yield), and DTB3 (3-month Treasury bill yield) — caches them for 24 hours, and
falls back to a bundled snapshot JSON so the application runs with no API key configured. The view
shows the "as of" date of every market value and a visible banner whenever snapshot or cached
fallback data is in use.

Results are presented as a range — base, optimistic, and pessimistic — rather than a single line, to
avoid false precision. Optimistic and pessimistic outcomes are multiplicative scenarios of the base
blended expected return (optimistic multiplies the base return, pessimistic multiplies it down). A
toggle switches the displayed values between nominal dollars and today's dollars (inflation-adjusted).
The user can also compare a projection of their current allocation against a projection of their
target allocation from Spec 1, where the target projection assumes an immediate one-time rebalance to
the target weights held constant across the horizon.

The following are explicitly out of scope for this spec: monthly contributions and any contribution
schedule beyond a single optional fixed annual amount, taxes and after-tax returns, Monte Carlo
simulation, and the buy-vs-rent scenario tester (Spec 3). Testing scope for this spec is limited to
unit tests for the projection math and the market-data fallback logic; no other automated tests are
in scope.

## Glossary

- **Projection_View**: The single-page view that displays the long-term wealth projection, its
  editable assumptions, and the current-versus-target comparison. Implemented at
  `app/projection/page.tsx`.
- **Projection_Calculator**: The pure calculation module at `lib/calculations/projection.ts` that
  turns a starting value, a return model, a horizon, and an optional contribution into year-by-year
  projected values. Takes inputs and returns numbers; imports nothing from `app/`, `components/`, or
  `lib/fred/`, performs no data fetching, reads no `localStorage`, and never reads the clock.
- **Market_Data_Route**: The server-only Next.js API route at `app/api/market-data/route.ts` that
  fetches, caches, and serves market-series values, applying the snapshot fallback. Runs only on the
  server; the FRED API key is never exposed to the browser.
- **FRED_Client**: The server-side module at `lib/fred/client.ts` that fetches raw series values from
  the FRED API. Imported only by the Market_Data_Route, never by components or pages.
- **FRED_Cache**: The 24-hour cache wrapper at `lib/fred/cache.ts` used by the Market_Data_Route.
- **Market_Snapshot**: The bundled static fallback file at `data/fred-snapshot.json` carrying recent
  values for each market series and the date each value is "as of".
- **Market_Series**: One of the three FRED series used by this spec: CPIAUCSL (general inflation),
  DGS10 (10-year Treasury yield), or DTB3 (3-month Treasury bill yield).
- **Market_Data_Snapshot**: The resolved set of current Market_Series values served to the
  Projection_View, each carrying its value, its "as of" date, and the source it came from.
- **Data_Source**: The origin of a served Market_Data_Snapshot. One of: `live` (fetched fresh from
  FRED this request), `cache` (served from the FRED_Cache within the 24-hour window), or `snapshot`
  (served from the Market_Snapshot because no key is configured or the fetch failed).
- **Expected_Return**: The assumed annual rate of return for a single Asset_Class, expressed as a
  percentage per year.
- **Equity_Risk_Premium**: The editable number of percentage points added to the bond anchor to form
  the stocks Expected_Return, defaulting to 4.0 points.
- **Return_Model**: The complete set of per-Asset_Class Expected_Return values plus the metadata
  (label and source) for each, used to compute the blended portfolio return.
- **Blended_Expected_Return**: The portfolio-level base annual return, computed as the sum over the
  four Asset_Class buckets of (allocation fraction for that class × that class's Expected_Return).
- **Scenario**: One of three projection outcomes: `base`, `optimistic`, or `pessimistic`.
- **Scenario_Multiplier**: The factor applied to the Blended_Expected_Return to produce a Scenario's
  return. The Optimistic_Multiplier defaults to 1.5 and the Pessimistic_Multiplier defaults to 0.5;
  the base Scenario uses a multiplier of 1.0.
- **Inflation_Rate**: The assumed annual inflation rate, defaulting to the latest year-over-year
  change in CPIAUCSL, used to convert nominal values into today's dollars.
- **Dollar_Basis**: The basis in which projected values are displayed. One of: `nominal` (future
  dollars) or `today` (inflation-adjusted to present-day purchasing power).
- **Annual_Contribution**: An optional fixed dollar amount added to the invested base at the end of
  each projected year before that year's compounding closes. Defaults to 0.
- **Projected_Base**: The starting invested value projected forward, equal to the Spec 1 total of all
  non-liability account balances (total assets). Liabilities are excluded.
- **Horizon**: A projection end point in whole years. The called-out horizons are 10, 20, and 30
  years.
- **Current_Allocation**: The Actual_Allocation computed in Spec 1 — the percentage of invested value
  held in each Asset_Class today.
- **Target_Allocation**: The user's target percentage for each Asset_Class, read from the Spec 1
  Target_Store.
- **Asset_Class**: One of four buckets: stocks, bonds, cash, or other (as defined in Spec 1).
- **Assumption_Panel**: The portion of the Projection_View that lists every editable assumption with
  its current value, its label, and its source.

## Requirements

### Requirement 1: Project Invested Wealth Over 10, 20, and 30 Years

**User Story:** As a mass-affluent user, I want to project my invested wealth over the long term, so that I can see how today's allocation shapes my future outcome.

#### Acceptance Criteria

1. WHEN the Projection_View has resolved the Projected_Base and the Return_Model, THE Projection_Calculator SHALL compute one projected value for each whole year from year 0 through year 30 inclusive (31 values) using annual compounding, where the Projected_Base equals the Spec 1 total of all non-liability account balances.
2. THE Projection_Calculator SHALL set the year-0 projected value equal to the Projected_Base.
3. WHEN computing the projected value for year N (1 ≤ N ≤ 30), THE Projection_Calculator SHALL multiply the year N-1 value by (1 + the Scenario's annual return expressed as a decimal, where a percentage rate R is converted as R ÷ 100) and then add the Annual_Contribution.
4. WHEN the Projection_Calculator has produced the year-by-year values, THE Projection_View SHALL display the projected values at year 10, year 20, and year 30 as called-out figures, each labeled with its horizon year.
5. THE Projection_View SHALL format every projected dollar value as United States dollars, rounded to the nearest whole dollar with no fractional cents, with a comma thousands separator and tabular numerals.
6. WHERE the Projected_Base is zero, THE Projection_View SHALL display a projected value of exactly zero dollars at the year-10, year-20, and year-30 horizons and SHALL display a plain-language note stating that there are no invested assets to project.
7. IF the Projection_Calculator cannot resolve the Projected_Base or the Return_Model, THEN THE Projection_View SHALL suppress the year-10, year-20, and year-30 figures and SHALL display a plain-language message indicating that the projection is unavailable.

### Requirement 2: Derive Per-Class Expected Returns From Market Anchors

**User Story:** As a mass-affluent user, I want my expected returns grounded in real market data, so that the projection reflects current conditions rather than arbitrary guesses.

#### Acceptance Criteria

1. WHEN a Market_Data_Snapshot is available, THE Projection_View SHALL set the bonds Expected_Return equal to the DGS10 percent-per-year value and the cash Expected_Return equal to the DTB3 percent-per-year value, where DGS10 and DTB3 are expressed as percent per year.
2. WHEN a Market_Data_Snapshot is available, THE Projection_View SHALL set the stocks Expected_Return equal to the bonds Expected_Return plus the Equity_Risk_Premium, where the Equity_Risk_Premium is an editable default of 4.0 percentage points editable within the range 0 to 15 percentage points inclusive.
3. THE Projection_View SHALL set the other-class Expected_Return to an editable default of 4.0 percent per year, editable within the range 0 to 20 percent per year inclusive.
4. THE Projection_View SHALL display, for each Asset_Class Expected_Return, a source label stating which Market_Series or default value the return was derived from.
5. WHERE the stocks Expected_Return is displayed, THE Projection_View SHALL display plain-language reasoning that the stocks return equals the bond anchor plus the Equity_Risk_Premium.
6. WHEN the Blended_Expected_Return is computed, THE Projection_Calculator SHALL compute it as the sum over the four Asset_Class buckets of the allocation fraction for that class multiplied by that class's Expected_Return.
7. IF no Market_Data_Snapshot is available, THEN THE Projection_View SHALL use the Market_Snapshot fallback values to derive the bonds and cash Expected_Return rather than failing.

### Requirement 3: Make Every Assumption Visible, Sourced, and Editable

**User Story:** As a mass-affluent user, I want to see and change every assumption behind the projection, so that I can trust the numbers and test my own expectations.

#### Acceptance Criteria

1. THE Assumption_Panel SHALL display each of the following assumptions with its current value and a text label: the stocks, bonds, cash, and other Expected_Return values, the Equity_Risk_Premium, the Inflation_Rate, the Optimistic_Multiplier, the Pessimistic_Multiplier, and the Annual_Contribution.
2. THE Assumption_Panel SHALL display, for each market-derived assumption, a source label naming the Market_Series it came from and the "as of" date of that value formatted as a calendar date.
3. WHEN the user edits an assumption to a finite numeric value within that assumption's accepted range, THE Projection_View SHALL recompute the projection and update the displayed projected values and the chart to reflect the edited assumption.
4. IF the user enters a value that is not a finite number for an assumption, THEN THE Projection_View SHALL display an inline validation message adjacent to that assumption indicating the value must be a finite number, SHALL leave the last valid projection displayed unchanged, and SHALL retain the previously accepted value as the active assumption.
5. IF the user enters an Annual_Contribution below zero, THEN THE Projection_View SHALL display an inline validation message adjacent to the Annual_Contribution indicating the value must be zero or greater, SHALL leave the last valid projection displayed unchanged, and SHALL retain the previously accepted value as the active assumption.
6. WHEN the user resets the assumptions, THE Projection_View SHALL restore every assumption to its market-derived or documented default value and SHALL clear any inline validation message currently displayed in the Assumption_Panel.

### Requirement 4: Show Base, Optimistic, and Pessimistic Scenarios as a Range

**User Story:** As a mass-affluent user, I want to see a range of outcomes instead of a single number, so that I understand the projection carries uncertainty.

#### Acceptance Criteria

1. WHEN the projection is computed, THE Projection_Calculator SHALL produce three Scenario series: base using the Blended_Expected_Return, optimistic using the Blended_Expected_Return multiplied by the Optimistic_Multiplier, and pessimistic using the Blended_Expected_Return multiplied by the Pessimistic_Multiplier.
2. THE Projection_View SHALL display the base, optimistic, and pessimistic projected values at year 10, year 20, and year 30, each formatted as a whole-dollar figure (rounded to the nearest dollar, no decimal places) using tabular numerals.
3. THE Projection_View SHALL render the projection as a band bounded by the pessimistic and optimistic series with the base series shown within the band.
4. THE Projection_View SHALL label the displayed outcome at each Horizon as a range from the pessimistic value to the optimistic value rather than as a single point value.
5. THE Assumption_Panel SHALL display the Optimistic_Multiplier and Pessimistic_Multiplier as editable values with a label explaining that each scales the base expected return, where the Optimistic_Multiplier defaults to 1.5 and is editable within the range 1.0 to 3.0 inclusive, and the Pessimistic_Multiplier defaults to 0.5 and is editable within the range 0.0 to 1.0 inclusive.
6. IF an edited Optimistic_Multiplier or Pessimistic_Multiplier value is non-numeric or falls outside its permitted range, THEN THE Projection_View SHALL retain and continue displaying the most recent valid projection, SHALL NOT recompute the projection with the invalid value, and SHALL display a message indicating that the entered multiplier is invalid and stating the permitted range.
7. FOR ALL years in a computed projection, THE Projection_Calculator SHALL produce an optimistic value greater than or equal to the base value and a pessimistic value less than or equal to the base value whenever the Optimistic_Multiplier is at least 1.0 and the Pessimistic_Multiplier is at most 1.0.

### Requirement 5: Toggle Between Nominal and Today's Dollars

**User Story:** As a mass-affluent user, I want to switch between future dollars and today's dollars, so that I can judge my projection in terms of real purchasing power.

#### Acceptance Criteria

1. THE Projection_View SHALL provide a keyboard-operable control that switches the Dollar_Basis between exactly two states, nominal and today's dollars, with nominal as the default state on initial load.
2. WHILE the Dollar_Basis is nominal, THE Projection_View SHALL display each projected value equal to its computed nominal value with no inflation adjustment applied.
3. WHILE the Dollar_Basis is today's dollars, THE Projection_Calculator SHALL set each year's displayed value to that year's nominal projected value divided by (1 + the Inflation_Rate expressed as a decimal) raised to the power of that year's integer offset from the current year, where year 0 equals the current year and uses a divisor of 1.
4. THE Projection_View SHALL display the active Dollar_Basis using a persistent text label identifying the current basis, such that the basis is distinguishable without relying on color alone.
5. WHEN the user changes the Dollar_Basis, THE Projection_View SHALL update the displayed values and chart within the same view, completing the update within 1 second and without reloading the page.
6. WHILE the Dollar_Basis is today's dollars, THE Projection_View SHALL display the numeric Inflation_Rate value and a visible CPIAUCSL source label adjacent to the today's-dollars values.
7. IF the Inflation_Rate is unavailable when the Dollar_Basis is set to today's dollars, THEN THE Projection_View SHALL retain the nominal values, keep the Dollar_Basis on nominal, and display a message indicating the inflation adjustment could not be applied.

### Requirement 6: Apply an Optional Fixed Annual Contribution

**User Story:** As a mass-affluent user, I want to add a yearly contribution to the projection, so that I can see how regular saving changes my long-term outcome.

#### Acceptance Criteria

1. THE Assumption_Panel SHALL provide an editable Annual_Contribution value that defaults to zero dollars and accepts any value from zero dollars to 10,000,000 dollars inclusive.
2. WHEN the Annual_Contribution is greater than zero, THE Projection_Calculator SHALL add the Annual_Contribution to each projected year's value from year 1 through year 30 at the end of that year, after applying that year's growth, while leaving the year-0 value equal to the Projected_Base.
3. WHERE the Annual_Contribution is zero, THE Projection_Calculator SHALL produce a projection in which every year's value from year 1 through year 30 equals the prior year's value multiplied by (1 + the Scenario's annual return expressed as a decimal), with the year-0 value equal to the Projected_Base.
4. THE Projection_View SHALL display the Annual_Contribution as a labeled United States dollar value with a thousands separator, no fractional cents, and tabular numerals.
5. IF the user enters an Annual_Contribution greater than 10,000,000 dollars, THEN THE Projection_View SHALL display an inline validation message for the Annual_Contribution and SHALL leave the last valid projection displayed.

### Requirement 7: Compare Current Allocation Against Target Allocation

**User Story:** As a mass-affluent user, I want to compare projecting my current allocation against my target allocation, so that I can see whether rebalancing changes my long-term outcome.

#### Acceptance Criteria

1. WHEN a Target_Allocation is available from the Spec 1 Target_Store, THE Projection_Calculator SHALL compute a second projection using a target Blended_Expected_Return equal to the sum over the four Asset_Class buckets of the Target_Allocation fraction for that class multiplied by that class's Expected_Return from the same Return_Model.
2. WHEN computing the target-allocation projection, THE Projection_Calculator SHALL model an immediate one-time rebalance to the Target_Allocation weights and SHALL hold those weights constant across every year from year 0 through year 30.
3. WHILE a Target_Allocation is available, THE Projection_View SHALL display the current-allocation projection range and the target-allocation projection range together for comparison, where each range is the band from the pessimistic value to the optimistic value with the base value shown within the band.
4. THE Projection_View SHALL distinguish the current-allocation series and the target-allocation series using a text label or shape cue in addition to any color difference, so the two series are identified without relying on color alone.
5. WHILE a Target_Allocation is available, THE Projection_View SHALL display at year 10, year 20, and year 30 the difference computed as the target-allocation base projected value minus the current-allocation base projected value, expressed in the active Dollar_Basis, formatted as United States dollars with a thousands separator, no fractional cents, and tabular numerals, and SHALL indicate the sign of that difference with a text or shape cue rather than color alone.
6. WHERE no user-configured Target_Allocation exists and the Spec 1 example default is in use, THE Projection_View SHALL label both the target-allocation projection range and the difference figures as based on an example target.

### Requirement 8: Serve Market Data From a Server-Only Route With Caching

**User Story:** As a developer, I want market data fetched only on the server and cached, so that the FRED API key stays private and the API is not called on every page load.

#### Acceptance Criteria

1. THE Market_Data_Route SHALL execute only on the server and SHALL NOT include the FRED API key in any response body, header, or client-delivered payload.
2. WHEN the Market_Data_Route receives a request, a FRED API key is configured, and no cached values exist within the 24-hour window, THE FRED_Client SHALL fetch the current CPIAUCSL, DGS10, and DTB3 values from the FRED API, and THE Market_Data_Route SHALL serve those values with a Data_Source of live.
3. WHEN the Market_Data_Route has fetched fresh values, THE FRED_Cache SHALL store those values together with the fetch timestamp.
4. WHILE the stored values are within 24 hours of their fetch timestamp, THE Market_Data_Route SHALL serve the stored values with a Data_Source of cache and SHALL NOT call the FRED API.
5. WHEN the Market_Data_Route receives a request and the stored values are more than 24 hours past their fetch timestamp, THE Market_Data_Route SHALL trigger a fresh FRED_Client fetch rather than serve the expired values.
6. WHEN the Market_Data_Route serves a Market_Data_Snapshot, THE Market_Data_Route SHALL include the "as of" date and the Data_Source for each Market_Series value.

### Requirement 9: Fall Back to the Snapshot and Signal Fallback Data

**User Story:** As a mass-affluent user, I want the projection to work without a live data feed, so that I can use the app even when no key is configured or the data feed is down, and know when I am seeing fallback data.

#### Acceptance Criteria

1. IF no FRED API key is configured, THEN THE Market_Data_Route SHALL serve the Market_Snapshot values with a Data_Source of snapshot.
2. IF the FRED API request fails, returns a non-success response, returns a response missing any required market series, or does not complete within 10 seconds, THEN THE Market_Data_Route SHALL serve the Market_Snapshot values with a Data_Source of snapshot.
3. WHEN the served Data_Source is snapshot, THE Projection_View SHALL display a visible banner that states fallback market data is in use and shows the snapshot last-updated date in an unambiguous date format (e.g., "Oct 14, 2026").
4. WHEN the served Data_Source is cache, THE Projection_View SHALL display a plain-language note that states the market data last-updated date in an unambiguous date format and does not present the data as live.
5. THE Projection_View SHALL display the "as of" date, in an unambiguous date format, adjacent to every market-derived value for all three Data_Source values (live, cache, snapshot).
6. IF the Market_Snapshot cannot be read or is missing any required market series, THEN THE Market_Data_Route SHALL return an error response indicating that market data is unavailable and SHALL NOT return any partial or placeholder market values.

### Requirement 10: Handle Loading and Error States in the Projection View

**User Story:** As a mass-affluent user, I want clear feedback while data loads or when something goes wrong, so that I am never left looking at a blank or misleading screen.

#### Acceptance Criteria

1. WHILE the Market_Data_Snapshot request is in flight, THE Projection_View SHALL display a loading indication in place of the projected values and chart, and SHALL NOT display any projected values or chart until the request resolves.
2. IF the Market_Data_Route returns an error response, THEN THE Projection_View SHALL display a plain-language error indication that the projection is unavailable, SHALL display no projected values or chart, and SHALL retain any user-entered assumption inputs.
3. IF the Spec 1 account data fails to load, THEN THE Projection_View SHALL display a plain-language error indication that the Projected_Base is unavailable, and SHALL display no projected values or chart.
4. WHEN a previously failed market-data request succeeds on retry, THE Projection_View SHALL replace the error indication with the projected values and chart.
5. THE Projection_View SHALL compose every loading and error indication using plain language only, excluding technical terms such as data-interchange format names, interface or endpoint names, numeric response-status codes, and internal file names.
6. IF both the Market_Data_Snapshot request and the Spec 1 account data fail to load, THEN THE Projection_View SHALL display the plain-language error indication that the Projected_Base is unavailable and SHALL display no projected values or chart.

### Requirement 11: Provide an Accessible Projection Chart

**User Story:** As a user relying on assistive technology or a keyboard, I want the projection chart to convey the same information available to a mouse user, so that I can understand my projection fully.

#### Acceptance Criteria

1. THE Projection_View SHALL provide a programmatically associated text alternative for the projection chart that conveys the projected values, using tabular numerals, at year 10, year 20, and year 30 for the base, optimistic, and pessimistic Scenarios.
2. WHEN a chart data point receives keyboard focus or pointer hover, THE Projection_View SHALL display, within 200 milliseconds, a tooltip showing the year and the projected dollar value for the focused Scenario, and the percent change from the Projected_Base to one decimal place where a percent is shown.
3. WHEN a chart data point loses keyboard focus or pointer hover, THE Projection_View SHALL dismiss the tooltip for that data point.
4. THE Projection_View SHALL make every interactive control, including the Dollar_Basis toggle and each assumption input, reachable and operable by keyboard with a focus indicator meeting a contrast ratio of at least 3 to 1 against adjacent colors.
5. THE Projection_View SHALL render the decorative projection chart graphic as hidden from assistive technology while exposing the text alternative to assistive technology.
6. IF the projection data is unavailable, THEN THE Projection_View SHALL not render a chart graphic and SHALL expose the plain-language unavailable message to assistive technology.

### Requirement 12: Unit-Test the Projection Math and the Fallback Logic

**User Story:** As a developer, I want the projection math and the market-data fallback logic covered by unit tests, so that the source-of-truth calculations and the fallback behavior are verified.

#### Acceptance Criteria

1. THE Projection_Calculator SHALL have Vitest unit tests under `lib/calculations/__tests__/` covering the year-0 value equal to the Projected_Base, the year-N recurrence value equal to the prior year's value multiplied by (1 + the return decimal) plus the Annual_Contribution, and the three multiplier-derived Scenario series (base; optimistic equal to the base return multiplied by the Optimistic_Multiplier; pessimistic equal to the base return multiplied by the Pessimistic_Multiplier).
2. THE Projection_Calculator unit tests SHALL cover the today's-dollars conversion computed as the nominal value divided by (1 + the Inflation_Rate) raised to the power of the year for a representative year.
3. THE Projection_Calculator unit tests SHALL cover both the zero Annual_Contribution path and a positive Annual_Contribution path.
4. THE market-data fallback logic SHALL have Vitest unit tests covering the no-key path resolving to a Data_Source of snapshot, the fetch-failure path resolving to a Data_Source of snapshot, and the cache-within-24-hours path resolving to a Data_Source of cache.
5. WHERE a calculation or fallback branch is covered by a unit test, THE test SHALL assert the exact expected numeric value for a calculation branch, or the exact Data_Source for a fallback branch, for a fixed input.
6. THE market-data fallback logic unit tests SHALL cover the snapshot-unreadable branch in which the Market_Data_Route returns an error indicating that market data is unavailable.
