# Requirements Document

## Introduction

This feature delivers the Consolidated Net Worth and Allocation View, the first of three specs
for the Jane Wealth Hub. A mass-affluent user holds accounts across three to four institutions
(for example, checking and savings at one bank, a brokerage account, a 401(k), and a high-yield
savings account elsewhere) and today has no single view of what they own or how it is allocated.

This view reads simulated account data from a static JSON file and presents, on one dashboard:
total net worth, a breakdown by account and institution, and asset allocation across stocks,
bonds, cash, and other assets. The user can set a simple target allocation and compare it side by
side with their actual allocation.

Net worth is computed as total assets minus total liabilities. Liabilities are represented as
account entries so the data shape stays uniform. Liability balances are stored as positive
numbers and are subtracted from total assets in the Net_Worth calculation. Each account carries a
total balance and a pre-tagged asset-class breakdown; the view derives all totals and percentages
from those fields.

The following are explicitly out of scope for this spec: long-term projections (Spec 2), the
buy-vs-rent scenario tester (Spec 3), real bank or brokerage linking, editing individual
holdings, and a drill-down into "other" asset sub-items (showing named sub-items such as real
estate or crypto within the "other" bucket), which would add a sub-item data model for little
user value in v1.

## Glossary

- **Dashboard**: The single-page view that displays net worth, account breakdown, and asset
  allocation. Implemented at `app/page.tsx`.
- **Allocation_Calculator**: The pure calculation module at `lib/calculations/allocation.ts` that
  aggregates net worth and computes allocation breakdowns from account data. Takes inputs and
  returns numbers; performs no data fetching and no UI rendering.
- **Account_Store**: The static JSON source of simulated account data at `data/accounts.json`.
- **Target_Store**: The browser `localStorage`-backed store that persists the user's target
  allocation across page reloads.
- **Account**: A single simulated financial account with an institution name, an account type, a
  total balance, and an asset-class breakdown.
- **Account_Type**: The category of an account. One of: brokerage, IRA, Roth IRA, 401(k), HYSA,
  checking, or liability.
- **Asset_Class**: One of four buckets: stocks, bonds, cash, or other.
- **Asset_Class_Breakdown**: The portion of a single account's balance assigned to each
  Asset_Class, expressed as percentages that sum to 100.
- **Net_Worth**: Total asset balances minus total liability balances across all accounts, where
  liability balances are stored as positive numbers and subtracted from total assets.
- **Target_Allocation**: The user-chosen percentage for each Asset_Class, representing the
  allocation the user is aiming for.
- **Actual_Allocation**: The computed percentage of total asset value held in each Asset_Class.
- **Drift**: For a single Asset_Class, the difference of Actual_Allocation minus Target_Allocation,
  expressed both as percentage points (actual allocation percentage minus target percentage) and
  as dollars (actual class dollar value minus the target's implied dollar value).
- **On_Track_Threshold**: The absolute percentage-point boundary of plus or minus 5 percentage
  points used to classify an Asset_Class as on track, over, or under its target.
- **On_Track_Status**: The overall status summarizing whether all four Asset_Class buckets are
  within the On_Track_Threshold of their targets.
- **Empty_State**: The condition in which the Account_Store contains zero accounts, or in which all
  account balances are zero.
- **lastUpdated**: A per-account date indicating when that account's data was last refreshed.
- **Freshness_Threshold**: The age boundary of 3 days beyond which an account's lastUpdated date is
  considered potentially out of date.

## Requirements

### Requirement 1: Display Total Net Worth

**User Story:** As a mass-affluent user, I want to see my total net worth in one place, so that I understand what I own across all institutions without logging into each account separately.

#### Acceptance Criteria

1. WHEN the Dashboard loads account data successfully, THE Allocation_Calculator SHALL compute Net_Worth as the sum of all asset account balances minus the sum of all liability account balances, where liability balances are stored as positive values that are subtracted, treating an empty account set as a Net_Worth of zero.
2. WHEN Net_Worth has been computed, THE Dashboard SHALL display the Net_Worth value formatted as United States dollars with a thousands separator and no fractional cents, rounding the value to the nearest whole dollar.
3. WHERE one or more accounts have the Account_Type of liability, THE Dashboard SHALL display total assets, total liabilities, and Net_Worth as three distinct labeled values.
4. IF the sum of liability balances exceeds the sum of asset balances, THEN THE Dashboard SHALL display the resulting negative Net_Worth with an explicit minus sign.
5. IF account data fails to load, THEN THE Dashboard SHALL display an error indication that Net_Worth is unavailable and SHALL display no Net_Worth value.

### Requirement 2: Break Down Holdings by Account and Institution

**User Story:** As a mass-affluent user, I want to see each account grouped by institution, so that I can tell at a glance where my money is held.

#### Acceptance Criteria

1. WHEN the Dashboard loads account data successfully, THE Dashboard SHALL display each Account with its institution name, Account_Type, and balance.
2. WHEN the Dashboard loads account data successfully, THE Dashboard SHALL group all accounts sharing the same institution name into a single institution group and display one subtotal balance per institution group equal to the sum of its member account balances.
3. WHEN two or more institution groups are present, THE Dashboard SHALL order the institution groups by descending subtotal balance, and WHEN two or more institution groups have equal subtotal balances, THE Dashboard SHALL order those tied groups alphabetically (A to Z, case-insensitive) by institution name.
4. WHILE exactly one institution group is present, THE Dashboard SHALL display that single group with its subtotal balance.
5. THE Allocation_Calculator SHALL return an institution subtotal equal to the arithmetic sum of the balances of all accounts belonging to that institution.
6. IF the loaded account data contains zero accounts, THEN THE Dashboard SHALL display an empty-state indication that no accounts are present and SHALL display no institution groups.

### Requirement 3: Display Asset Allocation Across Four Classes

**User Story:** As a mass-affluent user, I want to see how my assets are divided across stocks, bonds, cash, and other, so that I understand my overall allocation.

#### Acceptance Criteria

1. WHEN the Dashboard loads account data successfully, THE Allocation_Calculator SHALL compute the total asset value held in each of the four Asset_Class buckets (stocks, bonds, cash, and other) by summing each account's balance multiplied by that account's Asset_Class_Breakdown percentage for that class.
2. WHILE the sum of all four Asset_Class totals is greater than 0, THE Allocation_Calculator SHALL compute Actual_Allocation for each Asset_Class as that class total divided by the sum of all four class totals, expressed as a percentage.
3. IF the sum of all four Asset_Class totals is equal to 0, THEN THE Allocation_Calculator SHALL set the Actual_Allocation for each of the four Asset_Class buckets to 0 percent.
4. THE Allocation_Calculator SHALL round each Actual_Allocation percentage to one decimal place and, when the rounded percentages do not sum to exactly 100, assign the leftover residual to the Asset_Class with the largest unrounded percentage so the displayed percentages sum to exactly 100.
5. THE Dashboard SHALL display the Actual_Allocation as a pie chart and as labeled percentage values for each of the four Asset_Class buckets.
6. WHEN computing Actual_Allocation, THE Allocation_Calculator SHALL exclude liability accounts from all Asset_Class totals.
7. IF the Dashboard fails to load account data, THEN THE Dashboard SHALL display an error indication identifying that account data could not be loaded and SHALL display no partial allocation values.

### Requirement 4: Allocation Drift and On-Track Status

**User Story:** As a mass-affluent user, I want to see how far each asset class is from my target and an overall on-track status, so that I don't have to do the math myself.

#### Acceptance Criteria

1. WHEN a valid Target_Allocation and a computed Actual_Allocation are available, THE Allocation_Calculator SHALL compute, for each of the four Asset_Class buckets, the Drift as both percentage points (Actual_Allocation percentage minus Target_Allocation percentage) and dollars (actual class dollar value minus the target's implied dollar value).
2. WHEN the Drift for each Asset_Class has been computed, THE Dashboard SHALL display, for each of the four Asset_Class buckets, the Drift as both percentage points and dollars.
3. WHERE an Asset_Class has an absolute percentage-point Drift within the On_Track_Threshold of 5 percentage points inclusive, THE Allocation_Calculator SHALL classify that Asset_Class as "on track".
4. WHERE an Asset_Class has a percentage-point Drift greater than positive 5 percentage points, THE Allocation_Calculator SHALL classify that Asset_Class as "over".
5. WHERE an Asset_Class has a percentage-point Drift less than negative 5 percentage points, THE Allocation_Calculator SHALL classify that Asset_Class as "under".
6. THE Dashboard SHALL display one On_Track_Status at the top of the allocation section.
7. WHEN all four Asset_Class buckets are classified as "on track", THE Dashboard SHALL display an On_Track_Status of "On track".
8. WHEN one or more Asset_Class buckets are classified as "over" or "under", THE Dashboard SHALL display an On_Track_Status of "N of 4 asset classes off target", where N is the count of Asset_Class buckets classified as "over" or "under".
9. WHEN one or more Asset_Class buckets are off target, THE Allocation_Calculator SHALL identify the Asset_Class with the largest absolute percentage-point Drift, and THE Dashboard SHALL name that Asset_Class in plain language, including the direction, the percentage-point magnitude, and the approximate dollar amount (for example, "Stocks are 8 points above your target, about $42,000").

### Requirement 5: Set and Compare a Target Allocation

**User Story:** As a mass-affluent user, I want to set a target allocation and compare it with my actual allocation, so that I can see how my current mix differs from my goal.

#### Acceptance Criteria

1. THE Dashboard SHALL allow the user to set a Target_Allocation percentage, as an integer from 0 to 100 inclusive, for each of the four Asset_Class buckets (stocks, bonds, cash, other).
2. IF the user submits a Target_Allocation whose four percentages do not sum to exactly 100, THEN THE Dashboard SHALL display a validation message indicating that the four percentages must sum to 100 percent, SHALL reject the submission, and SHALL retain the user's entered values without persisting them.
3. IF the user submits a Target_Allocation in which any Asset_Class percentage is non-integer, negative, or greater than 100, THEN THE Dashboard SHALL display a validation message indicating the invalid field, SHALL reject the submission, and SHALL retain the previously persisted Target_Allocation unchanged.
4. WHEN the user submits a Target_Allocation whose four percentages each fall within 0 to 100 inclusive and sum to exactly 100, THE Dashboard SHALL display the Target_Allocation and the Actual_Allocation side by side for each of the four Asset_Class buckets.
5. WHEN the user submits a valid Target_Allocation, THE Target_Store SHALL persist the Target_Allocation in browser localStorage.
6. WHEN the Dashboard loads AND a valid Target_Allocation exists in the Target_Store, THE Dashboard SHALL restore and display the persisted Target_Allocation.
7. IF no Target_Allocation exists in the Target_Store when the Dashboard loads, THEN THE Dashboard SHALL display a default Target_Allocation of 60 percent stocks, 20 percent bonds, 10 percent cash, and 10 percent other, labeled "Example target, set your own" rather than presented as a recommendation.

### Requirement 6: Handle Loading, Error, and Empty States

**User Story:** As a mass-affluent user, I want clear feedback while data loads or when something goes wrong, so that I am never left looking at a blank or misleading screen.

#### Acceptance Criteria

1. WHILE account data is loading, THE Dashboard SHALL display a loading skeleton in place of the net worth, account breakdown, and allocation sections, and SHALL suppress any net worth or allocation values until loading completes.
2. IF the Account_Store is missing or cannot be read, THEN THE Dashboard SHALL display an error message stating that account data could not be loaded, and SHALL suppress all net worth, account breakdown, and allocation values.
3. IF the Account_Store contains malformed data that fails validation, THEN THE Dashboard SHALL display an error message stating that account data is invalid and SHALL suppress all net worth, account breakdown, and allocation values until valid data is loaded.
4. IF the Account_Store contains zero accounts, THEN THE Dashboard SHALL display an Empty_State message stating that no accounts are available and SHALL display a Net_Worth of zero dollars.
5. IF every account balance is zero across one or more accounts, THEN THE Dashboard SHALL display a Net_Worth of zero dollars and an Empty_State message for the allocation section in place of the allocation chart.
6. WHEN an error message or Empty_State message is displayed, THE Dashboard SHALL state the condition without technical terms such as JSON, validation, localStorage, or file names, and SHALL tell the user what action to take next, while the headline term "net worth" remains permitted.

### Requirement 7: Validate Account Data Shape

**User Story:** As a developer, I want account data validated against a known shape, so that malformed simulated data surfaces as a clear error rather than a wrong number.

#### Acceptance Criteria

1. WHEN account data is loaded, THE Allocation_Calculator SHALL verify that each Account includes a non-empty institution name (1 to 120 characters), an Account_Type drawn from the known set of account types, a balance that is a finite number, and an Asset_Class_Breakdown, and SHALL complete this verification before computing any allocation or net-worth value.
2. IF any non-liability account's Asset_Class_Breakdown percentages do not sum to 100 within a tolerance of 0.01 percentage points, THEN THE Allocation_Calculator SHALL signal a validation error identifying the offending account and SHALL produce no allocation result.
3. IF any account's balance is not a finite number (including NaN, positive or negative infinity, or a non-numeric value), THEN THE Allocation_Calculator SHALL signal a validation error identifying the offending account and SHALL produce no allocation result.
4. WHERE an account's Account_Type is liability, THE Allocation_Calculator SHALL accept the account without requiring a nonzero Asset_Class_Breakdown and without requiring its Asset_Class_Breakdown to sum to 100.
5. IF any required field (institution name, Account_Type, balance, or Asset_Class_Breakdown) is missing or has an invalid type, THEN THE Allocation_Calculator SHALL signal a validation error identifying the offending account and the offending field, and SHALL produce no allocation result.

### Requirement 8: Data Freshness

**User Story:** As a mass-affluent user, I want to see how current each institution's data is, so that I can trust the aggregated totals.

#### Acceptance Criteria

1. WHEN the Dashboard loads account data successfully, THE Dashboard SHALL display an "as of [date]" indicator for each institution, where the date is the most recent lastUpdated value among that institution's accounts.
2. WHERE an institution has accounts with differing lastUpdated dates, THE Dashboard SHALL use the most recent lastUpdated date among that institution's accounts as its "as of" date.
3. IF any account's lastUpdated date is more than the Freshness_Threshold of 3 days before the current date, THEN THE Dashboard SHALL flag that account, and its institution, as "may be out of date".

### Requirement 9: Accessibility Basics

**User Story:** As a user who relies on assistive technology or keyboard navigation, I want the dashboard to be perceivable and operable, so that I can read my net worth and allocation without a mouse or with a screen reader.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a programmatically associated text alternative for the allocation pie chart that conveys each Asset_Class name paired with its Actual_Allocation percentage, where each percentage is expressed to one decimal place (for example, "Stocks 42.5 percent").
2. THE Dashboard SHALL allow the user to move keyboard focus to, and operate, every Target_Allocation input and its associated controls using the keyboard alone, with each focusable control reachable via sequential Tab navigation in a defined order.
3. WHILE any Target_Allocation input or associated control has keyboard focus, THE Dashboard SHALL render a visible focus indicator on that control that meets a contrast ratio of at least 3 to 1 against adjacent colors.
4. WHEN a Target_Allocation validation message is displayed, THE Dashboard SHALL programmatically associate the message with its corresponding input such that assistive technology announces the message when that input receives focus, and SHALL retain the association until the message is removed.
5. THE Dashboard SHALL render all text and the boundaries of all interactive controls at a contrast ratio of at least 4.5 to 1 against their immediate background.
6. THE Dashboard SHALL convey every difference between Actual_Allocation and Target_Allocation using a text label or non-color indicator in addition to color, such that the direction and magnitude of each difference are distinguishable without relying on color perception.
