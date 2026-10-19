# Implementation Plan: Consolidated Net Worth and Allocation View

## Overview

This plan builds the Consolidated Net Worth and Allocation View incrementally, pure logic first,
UI last, so every number is validated and tested before anything renders. The order is:

1. Project scaffolding and strict-mode config (Next.js App Router, TypeScript, Tailwind, Recharts, Vitest, fast-check).
2. Shared types in `types/accounts.ts`.
3. The static data model and `data/accounts.json`.
4. `validateAccounts` guarding the calculator entry points.
5. Each pure `Allocation_Calculator` function with its kept Vitest unit tests and the two retained
   property-based tests.
6. An early, throwaway integration checkpoint that renders real data with no styling.
7. The `Target_Store` (localStorage).
8. Centralized user-facing message constants and formatting helpers.
9. UI components, built bottom-up (primitives, then sections).
10. The dashboard state machine, error boundary, and accessibility wiring.

Freshness is modeled **relative** to the current date: `data/accounts.json` stores a
`lastUpdatedDaysAgo` offset per account, and the boundary (server component / loader) derives each
account's absolute `lastUpdated` date as `now − lastUpdatedDaysAgo days` before handing it to the
pure `computeFreshness`. This keeps the sample data from decaying into "stale" as calendar time
passes while leaving the pure calculator unchanged and testable.

The Allocation_Calculator and Target_Store are pure/deterministic. For this spec the test scope is
deliberately trimmed to fit the time budget (see the Deferred Testing note at the end): the two
most load-bearing invariants are kept as fast-check property-based tests (Property 5 and Property
8, minimum 100 iterations, tagged `// Feature: consolidated-net-worth-view, Property {n}: {text}`),
and a focused set of Vitest unit tests covers validation, aggregation, allocation rounding, drift,
and freshness.

Tasks marked with `*` are optional (test sub-tasks) and can be skipped for a faster MVP; core
implementation tasks are never optional.

## Tasks

- [x] 1. Scaffold the Next.js project and configure the toolchain
  - Initialize a Next.js App Router project with TypeScript in the workspace root
  - Enable TypeScript strict mode in `tsconfig.json`; forbid implicit `any`
  - Add and configure Tailwind CSS (config + global stylesheet)
  - Add Recharts, Vitest, fast-check, and React Testing Library as dependencies
  - Create `vitest.config.ts` (jsdom environment for component tests) and a `test` script
  - Create the directory skeleton from the structure steering: `app/`, `components/charts`, `components/layout`, `components/ui`, `lib/calculations/__tests__`, `lib/target`, `types/`, `data/`
  - Add a minimal `app/layout.tsx` and placeholder `app/page.tsx` so the project builds
  - _Requirements: foundation for all; supports R6.1, R9_

- [x] 2. Define shared TypeScript types
  - [x] 2.1 Create `types/accounts.ts` with the core account model
    - Define `AssetClass`, `AccountType`, `AssetClassBreakdown`, and `Account`
    - On `Account`, the freshness field is `lastUpdatedDaysAgo: number` (a non-negative integer offset in days), **not** a fixed ISO `lastUpdated: string`; the absolute `lastUpdated` date is derived at the boundary from `now − lastUpdatedDaysAgo days`
    - _Requirements: 1.1, 2.1, 3.1, 7.1, 7.4, 8.1, 8.3_

  - [x] 2.2 Add calculation result and target/freshness/validation types
    - Define `NetWorthResult`, `InstitutionGroup`, `ClassTotals`, `AllocationResult`, `DriftDirection`, `DriftClassification`, `ClassDrift`, `DriftResult`, `OnTrackStatus`
    - Define `TargetAllocation`, `TargetInput`
    - Define `AccountFreshness`, `InstitutionFreshness`, `FreshnessResult` (freshness types carry the **derived** absolute `lastUpdated` Date)
    - Define `ValidationErrorCode`, `ValidationError`, `ValidationResult`
    - _Requirements: 1.1, 2.2, 3.2, 4.1, 4.3, 4.7, 4.9, 5.1, 7.5, 8.1, 8.3_

- [x] 3. Create the static account data
  - Author `data/accounts.json` with a realistic mass-affluent spread across multiple institutions (brokerage, IRA, Roth IRA, 401(k), HYSA, checking) plus at least one liability
  - Model the liability as a **non-housing loan** (student loan or car loan), **not** a mortgage: the user currently rents and Spec 3 models the buy-vs-rent decision, so a pre-existing mortgage would contradict the product story by implying the user already owns a home. Store the amount owed as a positive balance (it is subtracted inside `computeNetWorth`)
  - Include institutions whose subtotals tie and names differing only by case to exercise ordering
  - Give each account a `lastUpdatedDaysAgo` non-negative integer offset instead of a fixed ISO date. Exactly one account is stale with `lastUpdatedDaysAgo` ~5 (more than the 3-day threshold); every other account is 0–2 days ago. The absolute `lastUpdated` date is derived at load time as the current date minus the offset, so the sample never decays into looking stale
  - Keep each non-liability `assetClassBreakdown` summing to 100; data only, no logic
  - _Requirements: 2.3, 2.5, 3.1, 7.1, 8.1, 8.3_

- [x] 4. Implement account-data validation
  - [x] 4.1 Implement `validateAccounts(raw: unknown): ValidationResult` in `lib/calculations/allocation.ts`
    - Treat raw input as `unknown`; require an array, else fail
    - Check each account for required fields and types: institution name (1–120 chars), known `AccountType`, finite balance, present `AssetClassBreakdown`, non-negative integer `lastUpdatedDaysAgo`
    - Enforce the non-liability breakdown-sum rule (sum to 100 within 0.01 tolerance); exempt liabilities
    - Report `ValidationError` with `code`, `accountIndex`, and `field` where applicable; return the discriminated union (no throwing)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 4.2 Write unit tests for `validateAccounts`
    - One concrete example per `ValidationErrorCode`, asserting reported `accountIndex` and `field`
    - Breakdown sum off by exactly 0.01 (accepted) vs 0.02 (rejected)
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

- [x] 5. Implement net worth and institution aggregation
  - [x] 5.1 Implement `computeNetWorth(accounts): NetWorthResult`
    - Sum non-liability balances as `totalAssets`; sum liability balances (positive) as `totalLiabilities`; `netWorth = totalAssets - totalLiabilities`
    - Return 0 for the empty set; allow negative net worth to flow through
    - _Requirements: 1.1, 1.4, 6.4_

  - [x] 5.2 Write unit tests for `computeNetWorth`
    - Empty set, assets only, liabilities exceeding assets (negative), all-zero balances
    - _Requirements: 1.1, 1.4, 6.4_

  - [x] 5.3 Implement `computeInstitutionGroups(accounts): InstitutionGroup[]`
    - Group accounts by institution name; subtotal = arithmetic sum of member balances
    - Order groups by descending subtotal, case-insensitive alphabetical tie-break; preserve input order of members
    - Handle sizes 0 and 1
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 6. Early integration checkpoint - render real data unstyled
  - Create a **temporary** `app/page.tsx` that imports the real `data/accounts.json`, runs `validateAccounts`, and on success renders the total net worth (`computeNetWorth`) and the institution list with subtotals (`computeInstitutionGroups`) using minimal or no styling
  - Purpose: surface data-shape, import, and aggregation integration issues early, against real sample data, before any proper UI exists
  - This is a throwaway integration checkpoint: the temporary page is replaced later by the proper UI (the `NetWorthHeader`/`InstitutionList` components and the dashboard-shell wiring tasks). Do not build out styling or states here
  - _Requirements: R1, R2_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement asset allocation
  - [x] 8.1 Implement `computeClassTotals(accounts): ClassTotals`
    - For each non-liability account, add `balance * (breakdownPercentageForClass / 100)` to each class total
    - Exclude liability accounts from all class totals
    - _Requirements: 3.1, 3.6_

  - [x] 8.2 Implement `computeActualAllocation(totals): AllocationResult`
    - Compute percentages as class total divided by sum of class totals; round to one decimal
    - Apply largest-remainder assignment so displayed percentages sum to exactly 100
    - When total asset value is 0, set all four percentages to 0 and set `isZeroTotal` true (no division by zero)
    - _Requirements: 3.2, 3.3, 3.4, 6.5_

  - [x] 8.3 Write unit tests for `computeActualAllocation`
    - Zero-total path (all 0); a case where naive rounding sums to 99.9/100.1 and residual is assigned to the largest unrounded class
    - _Requirements: 3.3, 3.4_

  - [x] 8.4 Write property test for allocation percentages
    - **Property 5: Actual allocation percentages sum to exactly 100 (or all zero)**
    - **Validates: Requirements 3.2, 3.3, 3.4, 6.5**

- [x] 9. Implement drift and on-track status
  - [x] 9.1 Implement `computeDrift(actual, totals, target): DriftResult`
    - Per class: `driftPoints = actual% - target%`; `driftDollars = actual$ - (target%/100 * totalAssetValue)`
    - Populate `byClass`, `offTargetCount`, and `largest` (largest absolute point drift when off target, else null)
    - _Requirements: 4.1, 4.8, 4.9_

  - [x] 9.2 Implement `classifyDrift(driftPoints): DriftClassification`
    - "on track" when `abs(drift) <= 5`, "over" when `drift > 5`, "under" when `drift < -5`
    - _Requirements: 4.3, 4.4, 4.5_

  - [x] 9.3 Implement `computeOnTrackStatus(drift): OnTrackStatus`
    - "On track" when off-target count is 0; otherwise "N of 4 asset classes off target"
    - Build the plain-language largest-drift sentence (direction, point magnitude, approximate dollars); null when fully on track
    - _Requirements: 4.6, 4.7, 4.8, 4.9_

  - [x] 9.4 Write unit tests for drift and status functions
    - Drift at exactly +5 and -5 (on track boundary); fully on-track vs mixed off-target; largest-drift sentence wording
    - _Requirements: 4.3, 4.4, 4.5, 4.7, 4.8, 4.9_

  - [x] 9.5 Write property test for drift classification
    - **Property 8: Drift classification follows the ±5 threshold**
    - **Validates: Requirements 4.3, 4.4, 4.5**

- [x] 10. Implement data freshness
  - [x] 10.1 Implement `computeFreshness(accounts, now): FreshnessResult`
    - The boundary (server component / loader) derives each account's absolute `lastUpdated` date from `now − lastUpdatedDaysAgo days` and passes the derived dates (or days-ago plus `now`) into the function along with `now`; `computeFreshness` stays pure and never reads the clock
    - Per institution, `asOf` = most recent derived `lastUpdated` among member accounts
    - Flag an account stale when its derived `lastUpdated` is strictly more than 3 days before `now` (exactly 3 days is not stale); institution stale if any member is stale
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 10.2 Write unit tests for `computeFreshness`
    - Boundary expressed in days-ago: 3 days ago (not stale) vs 4 days ago (stale); differing days-ago values within one institution resolve `asOf` to the most recent
    - _Requirements: 8.2, 8.3_

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement the Target_Store (localStorage)
  - [x] 12.1 Implement `lib/target/targetStore.ts`
    - Export `DEFAULT_TARGET` (60/20/10/10, `isExample: true`)
    - Implement `validateTarget(input: TargetInput): TargetValidationResult` (integers 0–100; must sum to 100; identify offending field)
    - Implement `saveTarget(target)` and `loadTarget()` (returns `DEFAULT_TARGET` on missing/invalid stored value; validated targets return with `isExample: false`)
    - Browser-only; imported only by the client island, never by the pure calculator
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 5.7_

- [x] 13. Implement user-facing messages and formatting helpers
  - [x] 13.1 Create a centralized message-constants module
    - Define all LoadError, ValidationError, Empty (zero accounts), and empty-allocation copy in plain language with a next-action phrase; no "JSON", "validation", "localStorage", or file names
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 13.2 Implement formatting helpers in `lib/` (pure, no fetch/UI)
    - Whole-dollar USD via `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })`; negative shows explicit minus sign
    - One-decimal percentage formatter (e.g., "42.5 percent") for the pie text alternative
    - _Requirements: 1.2, 1.4, 9.1_

- [x] 14. Build UI primitive and state components
  - [x] 14.1 Implement `components/ui/LoadingSkeleton.tsx`
    - Skeleton placeholders for net worth, breakdown, and allocation sections; suppress any values
    - _Requirements: 6.1_

  - [x] 14.2 Implement `components/ui/ErrorState.tsx`
    - Render plain-language copy from the message module for LoadError and ValidationError; show no net worth, breakdown, or allocation values
    - _Requirements: 1.5, 3.7, 6.2, 6.3, 6.6_

  - [x] 14.3 Implement `components/ui/EmptyState.tsx`
    - Zero-accounts and all-zero-balances messaging with net worth $0; plain language with a next action
    - _Requirements: 6.4, 6.5, 6.6_

  - [x] 14.4 Implement `components/ui/StaleDataBanner.tsx` and `components/ui/FreshnessBadge.tsx`
    - `FreshnessBadge` shows "as of [date]" and a "may be out of date" cue when stale (non-color indicator, not color alone)
    - _Requirements: 8.1, 8.3, 9.6_

- [x] 15. Build net worth and institution UI
  - [x] 15.1 Implement `components/ui/NetWorthHeader.tsx`
    - Three labeled values (total assets, total liabilities, net worth) formatted via the currency helper; negative net worth with a minus sign
    - _Requirements: 1.2, 1.3, 1.4_

  - [x] 15.2 Implement `components/ui/InstitutionList.tsx`
    - Render institution groups in calculator order; each shows subtotal, member accounts (institution name, type, balance), and a `FreshnessBadge`
    - _Requirements: 2.1, 2.3, 2.4, 8.1, 8.2_

- [x] 16. Build allocation and target UI
  - [x] 16.1 Implement `components/charts/AllocationPie.tsx`
    - Recharts pie of the four classes plus a programmatically associated text alternative listing each class name with its one-decimal percentage
    - _Requirements: 3.5, 9.1_

  - [x] 16.2 Implement `components/ui/OnTrackBanner.tsx`
    - Single status banner: "On track" or "N of 4 asset classes off target" plus the largest-drift sentence
    - _Requirements: 4.6, 4.7, 4.8, 4.9_

  - [x] 16.3 Implement `components/ui/AllocationSection.tsx`
    - Compose `OnTrackBanner`, `AllocationPie`, and per-class rows showing actual %, target %, and drift in points and dollars with a non-color direction/magnitude indicator
    - _Requirements: 3.5, 4.2, 4.6, 9.6_

  - [x] 16.4 Implement `components/ui/TargetEditor.tsx`
    - Four integer inputs; inline validation via `validateTarget`; reject invalid submissions while retaining entered values; associate validation messages via `aria-describedby`
    - Side-by-side actual-vs-target display per class; label default target "Example target, set your own"
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7, 9.2, 9.4_

- [x] 17. Assemble the dashboard shell and state machine
  - [x] 17.1 Implement `components/layout/DashboardShell.tsx`
    - Page container with heading structure and landmarks; defined document order of sections
    - _Requirements: 9.2_

  - [x] 17.2 Implement `components/layout/DashboardClient.tsx` (client island)
    - Read/write target via `Target_Store`; recompute `computeDrift`/`classifyDrift`/`computeOnTrackStatus` when the target changes; manage target-editor validation state
    - Manage the loading state for first paint / target read
    - _Requirements: 4.1, 5.4, 5.5, 5.6, 6.1_

  - [x] 17.3 Wire `app/page.tsx` (server component), replacing the temporary checkpoint page
    - Replace the throwaway page from Task 6 with the real dashboard entry point
    - Import `data/accounts.json` as `unknown`; run `validateAccounts` before any computation
    - Derive each account's absolute `lastUpdated` date from `now − lastUpdatedDaysAgo days` at this boundary before calling `computeFreshness`
    - Route to one of the five states (Loading, LoadError, ValidationError, Empty, Ready); compute target-independent values (net worth, groups, allocation, freshness) on the server and pass serializable props to `DashboardClient`
    - _Requirements: 3.7, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 8.1, 8.2, 8.3_

  - [x] 17.4 Add a React error boundary around the dashboard
    - Catch unexpected faults and render the same plain-language LoadError copy (no stack trace or blank screen)
    - _Requirements: 6.2, 6.6_

- [x] 18. Accessibility wiring pass
  - [x] 18.1 Apply accessibility attributes and focus handling across components
    - Ensure all target inputs are reachable via sequential Tab in a defined order and operable by keyboard
    - Ensure validation messages are announced on focus via `aria-describedby` and retained until removed
    - Apply design tokens for a visible focus indicator and text/control contrast
    - _Requirements: 9.2, 9.3, 9.4, 9.5_

- [x] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Note: R9.3 (focus indicator ≥ 3:1) and R9.5 (text/control contrast ≥ 4.5:1) are enforced at the design-token level and require manual contrast-tool audit; they cannot be fully validated by automated tests.

## Notes

- Tasks marked with `*` are optional (test sub-tasks) and can be skipped for a faster MVP.
- Core implementation tasks are never optional and are always implemented.
- Each task references specific requirement clauses and/or design properties for traceability.
- Two correctness properties are covered by property-based tests (Property 5 and Property 8),
  minimum 100 iterations, tagged `// Feature: consolidated-net-worth-view, Property {n}: {text}`.
  The remaining properties are deferred (see Deferred Testing below).
- Kept unit tests live in `lib/calculations/__tests__/` and cover validation (4.2), net worth
  (5.2), allocation rounding (8.3), drift/status (9.4), and freshness (10.2).
- Freshness is stored relative (`lastUpdatedDaysAgo`); the absolute `lastUpdated` date is derived
  at the boundary (`now − lastUpdatedDaysAgo days`) so the sample data never decays. The pure
  `computeFreshness` receives the derived dates plus `now` and never reads the clock.
- Property-based tests use fast-check; `lib/calculations/` stays pure (no UI, no fetch, no
  localStorage); `now` and the target are passed in. `Target_Store` is the only localStorage user
  and lives under `lib/target/`.
- Task 6 creates a temporary, unstyled `app/page.tsx` as an early integration checkpoint; Task 17.3
  replaces it with the real dashboard entry point.
- Contrast requirements (R9.3, R9.5) are design-token-level and confirmed by manual audit.

## Deferred Testing

To fit the time budget for this spec, the following tests were **deferred (not abandoned)** and
should be added back when time allows. This spec primarily exists to support the main buy-vs-rent
feature (Spec 3); the calculator's core invariants remain covered by the two kept property tests
(Property 5, allocation sums to exactly 100, and Property 8, the ±5 drift threshold) plus the kept
unit tests (4.2, 5.2, 8.3, 9.4, 10.2).

Deferred property-based tests:

- Property 1 — Net worth is assets minus liabilities
- Property 2 — Institution subtotals sum their members
- Property 3 — Institution groups are correctly ordered
- Property 4 — Class totals sum weighted balances
- Property 6 — Liabilities never affect allocation
- Property 7 — Drift equals actual minus target
- Property 9 — On-track status reflects the off-target count
- Property 10 — Largest drift is the true maximum
- Property 11 — Target sum validation
- Property 12 — Target field-range validation
- Property 13 — Target persistence round-trip
- Property 14 — Breakdown-sum validation for non-liability accounts
- Property 15 — Non-finite balances are rejected
- Property 16 — Liability accounts are exempt from the breakdown rule
- Property 17 — Required-field validation identifies account and field
- Property 18 — Institution "as of" date is the most recent
- Property 19 — Staleness follows the 3-day threshold
- Property 20 — Pie text alternative lists every class with its percentage
- Property 21 — Every drift difference has a non-color indicator
- Property 22 — User-facing messages avoid technical terms

Deferred component/accessibility tests:

- The component and accessibility test task (net worth/institution/state component rendering, and
  target-editor/allocation keyboard, `aria-describedby`, and pie text-alternative assertions) is
  deferred. The accessibility attributes themselves are still implemented in Task 18; only their
  automated verification is deferred.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3"] },
    { "id": 3, "tasks": ["4.1", "5.1", "5.3", "8.1", "12.1", "13.1", "13.2"] },
    { "id": 4, "tasks": ["4.2", "5.2", "8.2", "9.1", "9.2", "9.3", "10.1"] },
    { "id": 5, "tasks": ["6", "8.3", "8.4", "9.4", "9.5", "10.2"] },
    { "id": 6, "tasks": ["14.1", "14.2", "14.3", "14.4", "15.1", "16.1", "16.2"] },
    { "id": 7, "tasks": ["15.2", "16.3", "16.4", "17.1", "17.2"] },
    { "id": 8, "tasks": ["17.3", "17.4"] },
    { "id": 9, "tasks": ["18.1"] }
  ]
}
```
