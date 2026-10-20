# Requirements Document

## Introduction

This feature delivers the Buy-vs-Rent Scenario Tester, the third of three specs for the Jane Wealth Hub and the product hero feature. The user currently rents and is deciding whether to buy a home now or keep renting for 10 years. The view compares the user projected net worth at year 10 under both paths and makes the core insight of the product visible: the decision depends on the user allocation, because the money not spent on a home (the down payment, and any monthly savings) is invested at the same expected return the Long-Term Wealth Projection (Spec 2) already models.

The **Buy_Path** models a home purchase with a fixed-rate mortgage. Each monthly payment is split into interest and principal via standard amortization, so the loan balance is tracked over time and the user home equity grows. The down payment and closing costs are drawn from the user existing assets (cash first, then pro-rata across the invested buckets), which changes the user allocation and cash cushion; the view shows the post-purchase allocation and whether the remaining cash still covers roughly six months of ownership costs. Ownership carries recurring costs: property tax, homeowners insurance, maintenance (default 1% of home value per year), and HOA. The home appreciates at a rate defaulting to one derived from the Case-Shiller national home price index (CSUSHPINSA). At the year-10 sale, selling costs are deducted once.

The **Rent_Path** models continuing to rent. Rent grows at a rate defaulting to one derived from the CPI rent-of-primary-residence index (CUSR0000SEHA), and the renter pays renters insurance. The down payment the renter did not spend stays invested, and in any month where one path total housing outflow is lower than the other, the cheaper path invests the difference at the user Current_Allocation expected return. This symmetric reinvestment keeps the two paths comparable: when owning is the cheaper monthly path, the Buy_Path accumulates a side investment, and when renting is cheaper, the Rent_Path does.

Outputs are a year-by-year net-worth series for both paths across 10 years, a chart of the two paths, the Breakeven_Year if one exists, a plain-language Verdict that states the year-10 difference and the home-appreciation tipping point at which the decision flips, and base / optimistic / pessimistic ranges. A nominal-versus-todays-dollars toggle mirrors Spec 2. The view also reports the one or two assumptions the result is most sensitive to, found by perturbing each editable assumption and ranking the effect on the year-10 outcome.

This spec reuses the Spec 2 server-only market-data route, its 24-hour cache, and its snapshot fallback, extending them with three additional FRED series: MORTGAGE30US (30-year fixed mortgage rate), CSUSHPINSA (home price index), and CUSR0000SEHA (rent of primary residence). As in Spec 2, every assumption is visible, labeled with its source, and editable, and fallback or cached market data is clearly signaled.

The following are explicitly out of scope for this spec: mortgage interest and property-tax deductions and any other tax effects, private mortgage insurance (PMI), refinancing, Monte Carlo simulation, and comparing more than one home at a time. Testing scope for this spec is limited to unit tests for the Buy_Path and Rent_Path calculations, the breakeven detection, and the sensitivity and tipping-point logic; no other automated tests are in scope.

## Glossary

- **Scenario_View**: The single-page view that displays the buy-vs-rent comparison, its editable assumptions, the chart, the verdict, and the sensitivity report. Implemented at `app/buy-vs-rent/page.tsx`.
- **BuyVsRent_Calculator**: The pure calculation module at `lib/calculations/buyVsRent.ts` that turns the assumptions and the user starting assets into the year-by-year Buy_Path and Rent_Path net-worth series, the breakeven, the verdict figures, and the sensitivity ranking. Pure: inputs in, numbers out; imports nothing from app, components, or FRED modules, no fetch, no localStorage, no clock.
- **Buy_Path**: The scenario in which the user purchases the home now, holds it for the Comparison_Horizon, and sells it in the final year.
- **Rent_Path**: The scenario in which the user keeps renting for the Comparison_Horizon and invests the money not spent on buying.
- **Comparison_Horizon**: The fixed comparison length of 10 whole years. Net-worth values are produced for each whole year from year 0 through year 10 inclusive (11 values).
- **Starting_Assets**: The user current investable assets at year 0, taken from Spec 1 as the per-Asset_Class dollar totals (the Spec 1 total of all non-liability balances), used both as the source of the down payment and closing costs and as the Rent_Path initial invested amount.
- **Current_Allocation**: The Actual_Allocation computed in Spec 1 (the percentage of invested value held in each Asset_Class today), used to compute the Investment_Return.
- **Asset_Class**: One of four buckets: stocks, bonds, cash, or other (as defined in Spec 1).
- **Investment_Return**: The annual expected return applied to invested money in either path, equal to the Spec 2 Blended_Expected_Return computed from the Current_Allocation and the Spec 2 Return_Model.
- **Post_Purchase_Allocation**: The user Asset_Class allocation after the down payment and closing costs are drawn from Starting_Assets (cash first, then pro-rata across stocks, bonds, and other).
- **Cash_Cushion**: The user remaining cash balance after the purchase drawdown.
- **Cushion_Threshold**: Six times the total monthly ownership cost, used as the reference a healthy Cash_Cushion is compared against. The multiple defaults to 6 and is editable.
- **Down_Payment**: The up-front equity the buyer puts into the home, equal to the Home_Price multiplied by the Down_Payment_Percent.
- **Home_Price**: The purchase price of the home. An editable assumption.
- **Down_Payment_Percent**: The percentage of Home_Price paid up front. An editable assumption.
- **Mortgage_Rate**: The fixed annual interest rate on the mortgage, defaulting to the MORTGAGE30US value. An editable assumption.
- **Loan_Amount**: Home_Price minus Down_Payment; the initial mortgage principal.
- **Mortgage_Term_Years**: The amortization term of the mortgage in years, defaulting to 30.
- **Monthly_Payment**: The fixed monthly principal-and-interest payment that fully amortizes the Loan_Amount over the Mortgage_Term_Years at the Mortgage_Rate.
- **Loan_Balance**: The remaining mortgage principal at a given month or year, tracked by amortization.
- **Home_Value**: The home market value at a given year, equal to Home_Price grown by the Home_Appreciation_Rate.
- **Home_Appreciation_Rate**: The assumed annual rate at which Home_Value grows, defaulting to a rate derived from CSUSHPINSA. An editable assumption.
- **Property_Tax_Rate**: The annual property tax as a percentage of Home_Value. An editable assumption.
- **Homeowners_Insurance**: The annual homeowners insurance cost. An editable assumption.
- **Maintenance_Rate**: The annual maintenance cost as a percentage of Home_Value, defaulting to 1%. An editable assumption.
- **HOA_Monthly**: The monthly homeowners-association fee. An editable assumption, default 0.
- **Closing_Costs**: One-time costs paid at purchase, drawn from Starting_Assets along with the down payment. An editable assumption.
- **Selling_Cost_Percent**: The percentage of the final Home_Value deducted once at the year-10 sale. An editable assumption.
- **Current_Rent_Monthly**: The user current monthly rent at year 0. An editable assumption.
- **Rent_Growth_Rate**: The assumed annual rate at which rent grows, defaulting to a rate derived from CUSR0000SEHA. An editable assumption.
- **Renters_Insurance**: The annual renter insurance cost. An editable assumption.
- **Ownership_Cost_Monthly**: The buyer total monthly housing outflow in a given month: the Monthly_Payment plus the monthly shares of property tax, homeowners insurance, maintenance, and HOA.
- **Rent_Cost_Monthly**: The renter total monthly housing outflow in a given month: rent plus the monthly share of renter insurance.
- **Monthly_Difference**: The absolute difference between Ownership_Cost_Monthly and Rent_Cost_Monthly in a given month; the cheaper path invests this amount that month.
- **Buy_Net_Worth**: The Buy_Path net worth at a given year: Home_Value minus Loan_Balance, minus selling costs in the sale year only, plus the value of any Buy_Path side investments.
- **Rent_Net_Worth**: The Rent_Path net worth at a given year: the invested value of Starting_Assets plus all reinvested Monthly_Difference amounts, grown at the Investment_Return.
- **Scenario_Band**: One of three outcomes for each path: base, optimistic, or pessimistic.
- **Scenario_Multiplier**: The Spec 2 factor applied to the Investment_Return to form a Scenario_Band. The Optimistic_Multiplier defaults to 1.5 and the Pessimistic_Multiplier defaults to 0.5; the base band uses 1.0.
- **Breakeven_Year**: The first whole year in 1..10 at which Buy_Net_Worth is greater than or equal to Rent_Net_Worth under the base band, or none if no such year exists within the horizon.
- **Verdict**: A plain-language statement of which path ends ahead at year 10 under the base band, the dollar size of that year-10 difference, and the Home_Appreciation_Rate tipping point at which the outcome flips.
- **Appreciation_Tipping_Point**: The Home_Appreciation_Rate at which Buy_Net_Worth equals Rent_Net_Worth at year 10 under the base band, holding all other assumptions fixed.
- **Sensitivity_Ranking**: The ordered list of editable assumptions ranked by how much perturbing each one changes the year-10 difference between Buy_Net_Worth and Rent_Net_Worth, from which the top one or two are reported.
- **Dollar_Basis**: The basis in which displayed values are shown. One of nominal (future dollars) or today (inflation-adjusted to present-day purchasing power), as defined in Spec 2.
- **Market_Data_Route**: The server-only Next.js API route at `app/api/market-data/route.ts` introduced in Spec 2, reused and extended here.
- **Market_Snapshot**: The bundled static fallback file at `data/fred-snapshot.json`, extended here with the three additional series.
- **Market_Series**: One FRED series. This spec adds MORTGAGE30US (30-year fixed mortgage rate), CSUSHPINSA (home price index), and CUSR0000SEHA (rent of primary residence) to the Spec 2 set.
- **Data_Source**: The origin of served market values, as defined in Spec 2: one of live, cache, or snapshot.
- **Assumption_Panel**: The portion of the Scenario_View that lists every editable assumption with its current value, its label, and its source.

## Requirements

### Requirement 1: Model the Buy Path With a Fixed-Rate Amortizing Mortgage

**User Story:** As a prospective buyer, I want my buy-path net worth modeled with a real mortgage and home equity, so that the comparison reflects how ownership actually builds wealth.

#### Acceptance Criteria

1. THE BuyVsRent_Calculator SHALL compute the Loan_Amount as the Home_Price minus the Down_Payment, where the Down_Payment equals the Home_Price multiplied by the Down_Payment_Percent expressed as a decimal.
2. THE BuyVsRent_Calculator SHALL compute the Monthly_Payment as the fixed payment that fully amortizes the Loan_Amount over the Mortgage_Term_Years at the Mortgage_Rate, using the standard amortization formula with a monthly rate equal to the Mortgage_Rate expressed as a decimal divided by 12 and a number of payments equal to the Mortgage_Term_Years multiplied by 12.
3. WHERE the Mortgage_Rate is exactly zero, THE BuyVsRent_Calculator SHALL compute the Monthly_Payment as the Loan_Amount divided by the total number of payments.
4. WHEN advancing the mortgage by one month, THE BuyVsRent_Calculator SHALL compute that month interest as the current Loan_Balance multiplied by the monthly rate, compute that month principal as the Monthly_Payment minus that month interest, and reduce the Loan_Balance by that month principal.
5. THE BuyVsRent_Calculator SHALL track the Loan_Balance so that it is non-increasing month over month and never falls below zero, clamping the final payment so the Loan_Balance reaches exactly zero at the end of the Mortgage_Term_Years.
6. THE BuyVsRent_Calculator SHALL compute the Home_Value at year N as the Home_Price multiplied by (1 + the Home_Appreciation_Rate expressed as a decimal) raised to the power N, for each whole year N from 0 through 10.
7. THE BuyVsRent_Calculator SHALL compute the Buy_Net_Worth at year N as the Home_Value at year N minus the Loan_Balance at year N, plus the value of any Buy_Path side investments at year N, minus selling costs equal to the Home_Value at year 10 multiplied by the Selling_Cost_Percent expressed as a decimal applied only at year 10.

### Requirement 2: Model the Rent Path With Reinvested Savings

**User Story:** As a prospective renter, I want my rent-path net worth to reflect investing the money I did not spend on a home, so that the comparison is fair.

#### Acceptance Criteria

1. THE BuyVsRent_Calculator SHALL set the Rent_Path initial invested amount at year 0 equal to the Starting_Assets total, representing that the renter does not spend the Down_Payment or Closing_Costs.
2. THE BuyVsRent_Calculator SHALL compute the Rent_Cost_Monthly in a given month as the current monthly rent plus one-twelfth of the Renters_Insurance, where the current monthly rent equals the Current_Rent_Monthly grown by the Rent_Growth_Rate once per completed year.
3. THE BuyVsRent_Calculator SHALL compute the Ownership_Cost_Monthly in a given month as the Monthly_Payment plus one-twelfth of the sum of the annual property tax (Property_Tax_Rate times the current Home_Value), the Homeowners_Insurance, the annual maintenance (Maintenance_Rate times the current Home_Value), and twelve times the HOA_Monthly.
4. WHEN the Ownership_Cost_Monthly and Rent_Cost_Monthly differ in a given month, THE BuyVsRent_Calculator SHALL add the Monthly_Difference to the invested side of whichever path has the lower monthly cost that month, so the Rent_Path invests the difference when renting costs less and the Buy_Path invests the difference when owning costs less.
5. THE BuyVsRent_Calculator SHALL grow every invested amount (the Rent_Path initial amount and each path reinvested Monthly_Difference contributions) at the Investment_Return, applying the Investment_Return once per year to the running invested balance.
6. THE BuyVsRent_Calculator SHALL compute the Rent_Net_Worth at year N as the Rent_Path invested balance at year N, with no home equity and no mortgage.
7. THE BuyVsRent_Calculator SHALL set the Investment_Return equal to the Spec 2 Blended_Expected_Return computed from the Current_Allocation fractions and the Spec 2 Return_Model derived from the current market data.

### Requirement 3: Draw the Down Payment From Existing Assets and Show the Allocation Shift

**User Story:** As a prospective buyer, I want to see how buying changes my allocation and cash cushion, so that I understand the full cost of taking money out of my portfolio.

#### Acceptance Criteria

1. THE BuyVsRent_Calculator SHALL fund the sum of the Down_Payment and the Closing_Costs by drawing first from the cash Asset_Class balance, and THEN, only if that sum exceeds the cash balance, drawing the remainder pro-rata across the stocks, bonds, and other Asset_Class balances in proportion to their dollar amounts.
2. WHEN the drawdown is complete, THE BuyVsRent_Calculator SHALL compute the Post_Purchase_Allocation as the Asset_Class percentages implied by the reduced per-class dollar balances.
3. THE Scenario_View SHALL display the Post_Purchase_Allocation alongside the Current_Allocation so the change caused by the purchase is visible.
4. THE BuyVsRent_Calculator SHALL compute the Cash_Cushion as the cash Asset_Class balance remaining after the drawdown.
5. THE Scenario_View SHALL display the Cash_Cushion, the Cushion_Threshold equal to the editable cushion-months multiple (default 6) times the first-year Ownership_Cost_Monthly, and a status cue indicating whether the Cash_Cushion is at or above the Cushion_Threshold, where the status is conveyed by text or shape in addition to any color.
6. IF the sum of the Down_Payment and the Closing_Costs exceeds the Starting_Assets total, THEN THE Scenario_View SHALL display a plain-language message that the purchase requires more than the user available assets and SHALL NOT display a negative Cash_Cushion as if it were a valid balance.

### Requirement 4: Produce Year-by-Year Net Worth for Both Paths

**User Story:** As a user weighing the decision, I want each path net worth year by year, so that I can see how the comparison evolves over the decade.

#### Acceptance Criteria

1. THE BuyVsRent_Calculator SHALL produce a Buy_Net_Worth value and a Rent_Net_Worth value for each whole year from year 0 through year 10 inclusive, yielding 11 values per path.
2. THE BuyVsRent_Calculator SHALL set each path year-0 net worth to its starting position, where the Rent_Path year-0 value equals the Starting_Assets total and the Buy_Path year-0 value equals the Home_Price minus the Loan_Amount minus the Closing_Costs plus any year-0 side investment.
3. THE Scenario_View SHALL display the Buy_Net_Worth and Rent_Net_Worth at year 10 as called-out figures, each labeled with its path.
4. THE Scenario_View SHALL format every net-worth value as United States dollars, rounded to the nearest whole dollar with no fractional cents, with a comma thousands separator and tabular numerals.
5. WHEN the market data or the Starting_Assets cannot be resolved, THE Scenario_View SHALL suppress the year-10 figures and the chart and SHALL display a plain-language message that the comparison is unavailable.

### Requirement 5: Show Base, Optimistic, and Pessimistic Ranges for Both Paths

**User Story:** As a user weighing the decision, I want a range of outcomes rather than a single number, so that I understand the comparison carries uncertainty.

#### Acceptance Criteria

1. THE BuyVsRent_Calculator SHALL produce three Scenario_Band outcomes for each path: base, optimistic, and pessimistic.
2. WHEN computing the Rent_Path bands, THE BuyVsRent_Calculator SHALL vary the Investment_Return by the Scenario_Multiplier, using the Investment_Return for base, the Investment_Return multiplied by the Optimistic_Multiplier for optimistic, and the Investment_Return multiplied by the Pessimistic_Multiplier for pessimistic.
3. WHEN computing the Buy_Path bands, THE BuyVsRent_Calculator SHALL vary both the Investment_Return applied to Buy_Path side investments by the Scenario_Multiplier AND the Home_Appreciation_Rate, using a higher Home_Appreciation_Rate for the optimistic band and a lower Home_Appreciation_Rate for the pessimistic band than the base band.
4. THE Scenario_View SHALL render each path as a band bounded by its pessimistic and optimistic series with its base series shown within the band, and SHALL distinguish the Buy_Path band from the Rent_Path band using a text label or shape cue in addition to any color difference.
5. THE Scenario_View SHALL label each path year-10 outcome as a range from the pessimistic value to the optimistic value rather than as a single point value.
6. FOR ALL years in a computed comparison, THE BuyVsRent_Calculator SHALL produce for each path an optimistic value greater than or equal to the base value and a pessimistic value less than or equal to the base value whenever the Optimistic_Multiplier is at least 1.0 and the Pessimistic_Multiplier is at most 1.0 and the optimistic Home_Appreciation_Rate is at least the base rate and the pessimistic Home_Appreciation_Rate is at most the base rate.

### Requirement 6: Detect the Breakeven Year

**User Story:** As a user weighing the decision, I want to know when buying overtakes renting, so that I can judge the decision against how long I plan to stay.

#### Acceptance Criteria

1. THE BuyVsRent_Calculator SHALL determine the Breakeven_Year as the first whole year N in 1 through 10 at which the base-band Buy_Net_Worth at year N is greater than or equal to the base-band Rent_Net_Worth at year N.
2. IF no year in 1 through 10 satisfies the breakeven condition, THEN THE BuyVsRent_Calculator SHALL report that there is no Breakeven_Year within the Comparison_Horizon.
3. WHEN a Breakeven_Year exists, THE Scenario_View SHALL display it as a plain-language statement naming the year at which buying catches up to renting.
4. WHEN no Breakeven_Year exists within the horizon, THE Scenario_View SHALL display a plain-language statement that buying does not overtake renting within 10 years.

### Requirement 7: State a Plain-Language Verdict With a Tipping Point

**User Story:** As a user weighing the decision, I want a clear verdict in plain language, so that I understand the bottom line without interpreting the chart myself.

#### Acceptance Criteria

1. THE Scenario_View SHALL display a Verdict stating which path ends ahead at year 10 under the base band and the absolute dollar size of that year-10 difference, formatted as United States dollars with a thousands separator, no fractional cents, and tabular numerals.
2. THE BuyVsRent_Calculator SHALL compute the Appreciation_Tipping_Point as the Home_Appreciation_Rate at which the base-band Buy_Net_Worth equals the base-band Rent_Net_Worth at year 10, holding all other assumptions fixed.
3. WHEN an Appreciation_Tipping_Point exists within a plausible range of negative 20 percent to positive 20 percent per year, THE Scenario_View SHALL state the tipping point in the Verdict as the home-appreciation rate, to one decimal place, below which the other path wins.
4. IF no Appreciation_Tipping_Point exists within negative 20 percent to positive 20 percent per year, THEN THE Scenario_View SHALL state in plain language that the outcome does not flip across that range of home-appreciation rates.
5. THE Scenario_View SHALL compose the Verdict using plain language, expressing rates as percentages with a percent sign and avoiding undefined financial jargon.
6. THE Scenario_View SHALL express the Verdict dollar figure and tipping point in terms consistent with the active Dollar_Basis.

### Requirement 8: Report the Most Sensitive Assumptions

**User Story:** As a user weighing the decision, I want to know which assumptions most affect the result, so that I focus my attention on the numbers that matter.

#### Acceptance Criteria

1. THE BuyVsRent_Calculator SHALL compute a Sensitivity_Ranking by perturbing each editable assumption, one at a time, by a fixed relative step while holding all other assumptions at their current values, and measuring the resulting change in the year-10 base-band difference between Buy_Net_Worth and Rent_Net_Worth.
2. THE BuyVsRent_Calculator SHALL rank the perturbed assumptions by the absolute magnitude of the resulting change in the year-10 difference, from largest to smallest.
3. THE Scenario_View SHALL display the top one or two assumptions from the Sensitivity_Ranking in plain language, identifying each by its labeled name.
4. WHEN two assumptions produce the same magnitude of change in the year-10 difference, THE BuyVsRent_Calculator SHALL order them deterministically by a fixed assumption ordering so the Sensitivity_Ranking is stable for identical inputs.
5. THE BuyVsRent_Calculator SHALL apply the same fixed relative perturbation step to every assumption in the Sensitivity_Ranking so the comparison across assumptions is consistent.

### Requirement 9: Make Every Assumption Visible, Sourced, and Editable

**User Story:** As a user weighing the decision, I want to see and change every assumption behind the comparison, so that I can trust the numbers and test my own situation.

#### Acceptance Criteria

1. THE Assumption_Panel SHALL display each of the following assumptions with its current value and a text label: Home_Price, Down_Payment_Percent, Mortgage_Rate, Mortgage_Term_Years, Property_Tax_Rate, Homeowners_Insurance, Maintenance_Rate, HOA_Monthly, Closing_Costs, Selling_Cost_Percent, Home_Appreciation_Rate, Current_Rent_Monthly, Rent_Growth_Rate, Renters_Insurance, the cushion-months multiple, the Optimistic_Multiplier, and the Pessimistic_Multiplier.
2. THE Assumption_Panel SHALL display, for each market-derived assumption, a source label naming the Market_Series it came from and the as-of date of that value formatted as a calendar date, where the Mortgage_Rate cites MORTGAGE30US, the Home_Appreciation_Rate cites CSUSHPINSA, and the Rent_Growth_Rate cites CUSR0000SEHA.
3. WHEN the user edits an assumption to a finite numeric value within that assumption accepted range, THE Scenario_View SHALL recompute the comparison and update the displayed net-worth figures, the chart, the breakeven, the verdict, and the sensitivity report to reflect the edited assumption.
4. IF the user enters a value that is not a finite number, or a value outside an assumption accepted range, THEN THE Scenario_View SHALL display an inline validation message adjacent to that assumption stating the constraint, SHALL leave the last valid comparison displayed unchanged, and SHALL retain the previously accepted value as the active assumption.
5. WHEN the user resets the assumptions, THE Scenario_View SHALL restore every assumption to its market-derived or documented default value and SHALL clear any inline validation message currently displayed in the Assumption_Panel.
6. THE Assumption_Panel SHALL enforce that Down_Payment_Percent is within 0 to 100 percent inclusive, Mortgage_Rate is within 0 to 20 percent inclusive, Home_Appreciation_Rate and Rent_Growth_Rate are each within negative 20 to positive 20 percent inclusive, and every dollar-denominated assumption is zero or greater.

### Requirement 10: Toggle Between Nominal and Todays Dollars

**User Story:** As a user weighing the decision, I want to switch between future dollars and todays dollars, so that I can judge the comparison in terms of real purchasing power.

#### Acceptance Criteria

1. THE Scenario_View SHALL provide a keyboard-operable control that switches the Dollar_Basis between exactly two states, nominal and todays dollars, with nominal as the default state on initial load.
2. WHILE the Dollar_Basis is nominal, THE Scenario_View SHALL display each net-worth value equal to its computed nominal value with no inflation adjustment applied.
3. WHILE the Dollar_Basis is todays dollars, THE BuyVsRent_Calculator SHALL set each year displayed value for both paths to that year nominal value divided by (1 + the Inflation_Rate expressed as a decimal) raised to the power of that year integer offset from year 0, where year 0 uses a divisor of 1 and the Inflation_Rate is the Spec 2 CPIAUCSL-derived rate.
4. THE Scenario_View SHALL display the active Dollar_Basis using a persistent text label identifying the current basis, such that the basis is distinguishable without relying on color alone.
5. WHEN the user changes the Dollar_Basis, THE Scenario_View SHALL update the displayed values, chart, and verdict within the same view, completing the update within 1 second and without reloading the page.
6. IF the Inflation_Rate is unavailable when the Dollar_Basis is set to todays dollars, THEN THE Scenario_View SHALL retain the nominal values, keep the Dollar_Basis on nominal, and display a message indicating the inflation adjustment could not be applied.

### Requirement 11: Serve the Added Market Series Through the Spec 2 Route and Fallback

**User Story:** As a developer, I want the mortgage, home-price, and rent series fetched through the existing server-only route and fallback, so that the hero feature reuses the private, cached data path rather than adding a new one.

#### Acceptance Criteria

1. THE Market_Data_Route SHALL serve the MORTGAGE30US, CSUSHPINSA, and CUSR0000SEHA values alongside the Spec 2 series, applying the same 24-hour caching and the same live, cache, and snapshot Data_Source resolution defined in Spec 2, and SHALL NOT expose the FRED API key to the browser.
2. IF no FRED API key is configured, or the FRED request fails, returns a non-success response, is missing any required series, or does not complete within 10 seconds, THEN THE Market_Data_Route SHALL serve the Market_Snapshot values for all series with a Data_Source of snapshot.
3. THE Market_Snapshot SHALL include recent values and an as-of date for MORTGAGE30US, CSUSHPINSA, and CUSR0000SEHA so the Scenario_View functions with no API key configured.
4. THE BuyVsRent_Calculator SHALL derive the default Home_Appreciation_Rate from CSUSHPINSA and the default Rent_Growth_Rate from CUSR0000SEHA, and the Scenario_View SHALL set the default Mortgage_Rate to the MORTGAGE30US value.
5. WHEN the served Data_Source is snapshot, THE Scenario_View SHALL display a visible banner that states fallback market data is in use and shows the snapshot last-updated date in an unambiguous date format.
6. WHEN the served Data_Source is cache, THE Scenario_View SHALL display a plain-language note that states the market data last-updated date in an unambiguous date format and does not present the data as live.

### Requirement 12: Handle Loading and Error States in the Scenario View

**User Story:** As a user weighing the decision, I want clear feedback while data loads or when something goes wrong, so that I am never left looking at a blank or misleading screen.

#### Acceptance Criteria

1. WHILE the market-data request is in flight, THE Scenario_View SHALL display a loading indication in place of the net-worth figures and chart, and SHALL NOT display any net-worth figures or chart until the request resolves.
2. IF the Market_Data_Route returns an error response, THEN THE Scenario_View SHALL display a plain-language error indication that the comparison is unavailable, SHALL display no net-worth figures or chart, and SHALL retain any user-entered assumption inputs.
3. IF the Spec 1 account data fails to load, THEN THE Scenario_View SHALL display a plain-language error indication that the starting assets are unavailable, and SHALL display no net-worth figures or chart.
4. WHEN a previously failed market-data request succeeds on retry, THE Scenario_View SHALL replace the error indication with the net-worth figures and chart.
5. THE Scenario_View SHALL compose every loading and error indication using plain language only, excluding technical terms such as data-interchange format names, interface or endpoint names, numeric response-status codes, and internal file names.

### Requirement 13: Provide an Accessible Comparison Chart

**User Story:** As a user relying on assistive technology or a keyboard, I want the comparison chart to convey the same information available to a mouse user, so that I can understand the comparison fully.

#### Acceptance Criteria

1. THE Scenario_View SHALL provide a programmatically associated text alternative for the comparison chart that conveys, using tabular numerals, the Buy_Net_Worth and Rent_Net_Worth at year 10 for the base, optimistic, and pessimistic bands, and the Breakeven_Year.
2. WHEN a chart data point receives keyboard focus or pointer hover, THE Scenario_View SHALL display, within 200 milliseconds, a tooltip showing the year, the path, and the net-worth dollar value for the focused point.
3. WHEN a chart data point loses keyboard focus or pointer hover, THE Scenario_View SHALL dismiss the tooltip for that data point.
4. THE Scenario_View SHALL make every interactive control, including the Dollar_Basis toggle and each assumption input, reachable and operable by keyboard with a focus indicator meeting a contrast ratio of at least 3 to 1 against adjacent colors.
5. THE Scenario_View SHALL render the decorative comparison chart graphic as hidden from assistive technology while exposing the text alternative to assistive technology.
6. IF the comparison data is unavailable, THEN THE Scenario_View SHALL not render a chart graphic and SHALL expose the plain-language unavailable message to assistive technology.

### Requirement 14: Unit-Test the Calculations, Breakeven, and Sensitivity Logic

**User Story:** As a developer, I want the buy and rent calculations, breakeven, and sensitivity logic covered by unit tests, so that the source-of-truth calculations behind the hero feature are verified.

#### Acceptance Criteria

1. THE BuyVsRent_Calculator SHALL have Vitest unit tests under `lib/calculations/__tests__/` covering the Monthly_Payment amortization formula, including the zero-interest special case, and asserting the exact expected payment for a fixed Loan_Amount, Mortgage_Rate, and term.
2. THE BuyVsRent_Calculator unit tests SHALL cover the Loan_Balance reaching exactly zero at the end of the Mortgage_Term_Years and being non-increasing month over month.
3. THE BuyVsRent_Calculator unit tests SHALL cover the Buy_Net_Worth at year 10 including appreciation, remaining loan balance, and the year-10 selling cost, and the Rent_Net_Worth at year 10 including the reinvested Monthly_Difference, asserting exact expected values for fixed inputs.
4. THE BuyVsRent_Calculator unit tests SHALL cover the symmetric reinvestment rule, asserting that the Buy_Path accumulates a side investment in a fixed case where owning is cheaper and the Rent_Path accumulates one in a fixed case where renting is cheaper.
5. THE BuyVsRent_Calculator unit tests SHALL cover the Breakeven_Year detection for both a case with a breakeven within the horizon and a case with none, asserting the exact year or the no-breakeven result.
6. THE BuyVsRent_Calculator unit tests SHALL cover the Sensitivity_Ranking ordering and the Appreciation_Tipping_Point, asserting the ranked order for a fixed input and the tipping-point rate, including the deterministic tie-break.
