# Implementation Plan: Account Sources (Editable & Plaid)

## Overview

This plan builds the feature from the pure, testable core outward. First the extended `Account`
type and liability source-of-truth, then the pure modules every view and route depends on
(per-account validator, `sourceMix`, the `Account_Store` set-operations and load/recovery logic,
and the `Plaid_Mapper`), each with its Vitest unit and property tests. The extended calculators and
freshness rules are updated to honor the new `Source` and `mortgage` type. Only then do the
server-only Plaid routes, the client Plaid Link wiring, the UI components, and the view/store-load
integration land, so nothing is wired before the thing it depends on exists. The two Plaid Sandbox
custom-user JSON configs and the product-scope steering update close out the spec.

All property tests use **fast-check** with a **minimum of 100 iterations**, one test per correctness
property, each tagged `// Feature: account-sources-editable-and-plaid, Property N: ...`. Pure
modules live under `lib/` (`lib/calculations`, `lib/accounts`, `lib/plaid`) with no UI or fetch
imports; tests live in the matching `__tests__/` folder. TypeScript strict mode throughout.

## Tasks

- [x] 1. Extend the Account type and liability source of truth
  - Extend `types/accounts.ts`: add `mortgage` to `AccountType`; add `AccountSource`
    (`'Sample' | 'Manual' | 'Connected'`); add `id`, `source`, `accountName`, and the optional
    source-specific fields (`updatedByYouDate`, `mask`, `plaidInstitutionId`, `splitOverride`,
    `allocationNeedsInput`) to `Account`
  - Add `AccountMatchKey` interface and `LIABILITY_TYPES = ['liability', 'mortgage']` as the single
    source of truth for the liability check
  - Add `ACCOUNTS_STORAGE_KEY = 'jwh.accounts'`, `AccountLoadResult`, `SourceMixEntry`,
    `SourceMixSummary`, and the `Plaid_Mapper` input interfaces (`PlaidSecurity`, `PlaidHolding`,
    `PlaidAccountRaw`, `PlaidMapperInput`) under `types/`
  - _Requirements: 1.1, 1.2, 4.5, 10.3, 11, 12_

- [x] 2. Implement the canonical Sample_Set
  - [x] 2.1 Create `lib/accounts/sampleSet.ts`
    - Upgrade the Spec 1 accounts to the extended shape with stable `id`, `source: 'Sample'`, and
      `accountName`; export the canonical `Sample_Set` and a pure builder
    - _Requirements: 6.3, 7.2_

- [x] 3. Implement per-account editor validation
  - [x] 3.1 Implement `lib/accounts/accountValidation.ts`
    - Write `validateAccountInput(input: AccountInput): AccountValidationResult` returning the typed
      discriminated union; non-empty institution ≤ 120, non-empty account name ≤ 120, account type
      in the known set, finite non-negative balance; non-liability split values whole 0–100 summing
      to exactly 100; liability/mortgage bypass the split-sum rule; report the first offending field
      in a fixed order
    - _Requirements: 3.1, 3.2, 3.3, 4.2_

  - [ ]* 3.2 Write property test for required-field validation
    - **Property 4: Required-field validation accepts exactly the valid inputs**
    - **Validates: Requirements 3.1**

  - [ ]* 3.3 Write property test for split validation
    - **Property 5: Split validation accepts exactly the sum-to-100 splits**
    - **Validates: Requirements 3.2, 4.2**

  - [ ]* 3.4 Write property test for liability split exemption
    - **Property 6: Liabilities are exempt from the split-sum rule**
    - **Validates: Requirements 3.3**

  - [ ]* 3.5 Write unit tests for validator field-ordering and messages
    - Cover first-offending-field selection and plain-language messages for each field
    - _Requirements: 3.4, 3.5, 3.6_

- [x] 4. Extend the calculators for Source and the mortgage type
  - [x] 4.1 Update `lib/calculations/allocation.ts` and net-worth logic to use `LIABILITY_TYPES`
    - Replace the Spec 1 `accountType === 'liability'` comparisons so `liability` and `mortgage` are
      both treated as liabilities; subtract liability balances from net worth; exclude liabilities
      from asset-class totals; ensure no calculation branches on `source`
    - _Requirements: 1.5, 12.1, 12.2, 12.3_

  - [ ]* 4.2 Write property test for Source-invariant calculations
    - **Property 1: Calculations are Source-invariant**
    - **Validates: Requirements 1.5**

  - [ ]* 4.3 Write property test for net worth and allocation liability handling
    - **Property 26: Net worth subtracts every liability; allocation excludes them**
    - **Validates: Requirements 12.1, 12.2, 12.3, 3.3**

- [x] 5. Implement freshness rules for the new sources
  - [x] 5.1 Implement source-aware freshness in `lib/calculations/`
    - Exempt Manual_Accounts from the Stale_Rule; apply the three-day Stale_Rule to Sample_Accounts
      and to Connected_Accounts with freshness info; expose the "Updated by you on [date]" basis
    - _Requirements: 5.1, 5.4_

  - [ ]* 5.2 Write property test for Manual_Account freshness
    - **Property 9: Manual_Accounts are never stale**
    - **Validates: Requirements 5.1**

  - [ ]* 5.3 Write property test for Sample/Connected freshness
    - **Property 10: Sample and Connected freshness follows the three-day rule**
    - **Validates: Requirements 5.4**

- [x] 6. Implement the Source_Mix_Summary helper
  - [x] 6.1 Implement `lib/calculations/sourceMix.ts`
    - Derive one `SourceMixEntry` per Source present: count and asset-share percentage, with
      liabilities excluded from the share basis, consistent with allocation
    - _Requirements: 1.4_

  - [ ]* 6.2 Write unit tests for sourceMix
    - Cover single-source, multi-source, and liability-exclusion cases
    - _Requirements: 1.4_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the Plaid_Mapper classification
  - [x] 8.1 Implement `classifyHolding` in `lib/plaid/mapper.ts`
    - Apply the documented precedence: explicit equity/fixed-income/cash type or subtype first; then
      name heuristics ("bond", "treasury", "fixed income", "aggregate", "municipal" → bonds; "money
      market" → cash; other ETF/mutual fund → stocks); else `other` only for a truly unclassifiable
      security; document the rules in the module
    - _Requirements: 10.4, 10.5, 10.9_

  - [ ]* 8.2 Write property test for classification precedence
    - **Property 20: Holding classification respects the documented precedence**
    - **Validates: Requirements 10.4, 10.5**

  - [ ]* 8.3 Write unit tests for the five named classifyHolding examples
    - Vanguard Total Bond Market ETF → bonds; iShares Core U.S. Aggregate Bond ETF → bonds; Vanguard
      Total Stock Market ETF → stocks; SPDR S&P 500 ETF Trust → stocks; cash/money-market → cash;
      derivative/crypto/typeless → other
    - _Requirements: 10.5_

- [x] 9. Implement the Plaid_Mapper account mapping
  - [x] 9.1 Implement `mapPlaidToAccounts` in `lib/plaid/mapper.ts`
    - Pure function (imports only `@/types/*`, no fetch, no clock, no localStorage, uses the injected
      `idFor`); map depository → matching type with full balance to cash; loan `mortgage` subtype →
      `mortgage`, other loans/credit → `liability` with amount owed stored positive; investment with
      holdings → split by summed per-class market value via the largest-remainder method summing to
      100; investment with no holdings → `other: 100` and `allocationNeedsInput: true`
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7, 10.8, 13.3_

  - [ ]* 9.2 Write property test for depository mapping
    - **Property 18: Depository accounts map to all-cash**
    - **Validates: Requirements 10.2**

  - [ ]* 9.3 Write property test for loan/credit mapping
    - **Property 19: Loan and credit accounts map to liabilities with a positive balance**
    - **Validates: Requirements 10.3**

  - [ ]* 9.4 Write property test for holdings split proportionality
    - **Property 21: Holdings split is proportional to per-class market value**
    - **Validates: Requirements 10.6**

  - [ ]* 9.5 Write property test for holdingless investment accounts
    - **Property 22: A holdingless investment account flags for input**
    - **Validates: Requirements 10.7, 13.3**

  - [ ]* 9.6 Write property test for non-liability split summing to 100
    - **Property 23: Every mapped non-liability account sums to exactly 100**
    - **Validates: Requirements 10.8**

- [x] 10. Implement the Account_Store set operations
  - [x] 10.1 Implement set-ops in `lib/accounts/accountStore.ts`
    - Browser-only, mirroring `lib/target/targetStore.ts`: `startFresh()` removes only
      Sample_Accounts; `restoreSampleData()` preserves non-Sample accounts and adds exactly one
      Sample_Set idempotently; `disconnectInstitution(institutionId)` removes only that institution's
      Connected_Accounts; `upsertConnectedInstitution(institutionId, accounts)` replaces that
      institution's set, carrying Split_Overrides by Account_Match_Key and recording dropped ones
    - _Requirements: 4.5, 4.6, 6.1, 6.2, 6.3, 6.4, 9.3, 9.4_

  - [ ]* 10.2 Write property test for start fresh
    - **Property 11: Start fresh removes exactly the Sample_Accounts**
    - **Validates: Requirements 6.1, 6.2**

  - [ ]* 10.3 Write property test for restore sample data
    - **Property 12: Restore sample data preserves others, adds one Sample_Set, and is idempotent**
    - **Validates: Requirements 6.3, 6.4**

  - [ ]* 10.4 Write property test for disconnect
    - **Property 16: Disconnect removes only the target institution's Connected_Accounts**
    - **Validates: Requirements 9.3**

  - [ ]* 10.5 Write property test for reconnect replacement
    - **Property 17: Reconnect replaces rather than duplicates an institution**
    - **Validates: Requirements 9.4**

  - [ ]* 10.6 Write property test for reconnect override carry/drop
    - **Property 8: Reconnect carries matched overrides and drops unmatched ones**
    - **Validates: Requirements 4.5, 4.6**

- [x] 11. Implement the Account_Store edit, delete-undo, and override operations
  - [x] 11.1 Implement account mutation helpers in `lib/accounts/accountStore.ts`
    - Editing a Sample_Account sets `source: 'Manual'`, keeps the stable `id`, and sets
      `updatedByYouDate`; adding assigns `Manual` and a new id; delete-then-undo restores the
      identical set, order, and ids; applying a valid Split_Override to a Connected_Account keeps
      `source: 'Connected'` and sets `splitOverride`
    - _Requirements: 2.3, 2.5, 2.6, 4.3, 4.4, 5.3_

  - [ ]* 11.2 Write property test for Sample→Manual on edit
    - **Property 2: Editing a Sample_Account makes it Manual**
    - **Validates: Requirements 2.5, 1.2**

  - [ ]* 11.3 Write property test for delete-then-undo round trip
    - **Property 3: Delete-then-undo is a round trip**
    - **Validates: Requirements 2.3**

  - [ ]* 11.4 Write property test for Split_Override application
    - **Property 7: Applying a Split_Override keeps Source and toggles the label**
    - **Validates: Requirements 4.3, 4.4**

- [x] 12. Implement the Account_Store load and recovery
  - [x] 12.1 Implement `loadAccounts`/`saveAccounts` in `lib/accounts/accountStore.ts`
    - `saveAccounts` serializes the full set on every change; `loadAccounts` parses defensively and
      returns one of `ok` / `seeded` / `partial{dropped}` / `fallback`; seed Sample_Set when empty;
      load exactly the stored valid set when all valid; partial recovery keeps valid in original
      order and counts dropped; unparseable or all-invalid falls back to Sample_Set; all reads
      total and never throw under SSR or unavailable localStorage; writes best-effort and swallow
      failures
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 12.2 Write property test for save-then-load round trip
    - **Property 13: Save-then-load round trip**
    - **Validates: Requirements 7.1, 7.3**

  - [ ]* 12.3 Write property test for partial recovery
    - **Property 14: Partial recovery keeps the valid and counts the dropped**
    - **Validates: Requirements 7.4**

  - [ ]* 12.4 Write property test for total, never-throwing load
    - **Property 15: Loading is total and never throws**
    - **Validates: Requirements 7.5, 7.6**

  - [ ]* 12.5 Write unit tests for the load state-machine branches
    - empty → seeded; valid → ok; unparseable/all-invalid → fallback
    - _Requirements: 7.2, 7.5_

- [ ]* 13. Write the import-boundary static check
  - Assert no file in `lib/calculations/`, `lib/fred/`, or any server component imports
    `lib/accounts/accountStore.ts`, and that `lib/plaid/mapper.ts` imports only from `@/types/*`
  - _Requirements: 7.7, 10.1_

- [x] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement the server-only Plaid SDK client and routes
  - [x] 15.1 Implement `lib/plaid/client.ts` SDK wrapper
    - Server-only `plaid` Node SDK wrapper reading `PLAID_CLIENT_ID`/`PLAID_SECRET`, imported only
      by `app/api/plaid/` routes
    - _Requirements: 8.2, 14.4_

  - [x] 15.2 Implement `app/api/plaid/link-token/route.ts`
    - `POST` mints a `Link_Token` via `linkTokenCreate`, returns `{ linkToken }`, non-2xx on
      failure; `export const dynamic = 'force-dynamic'`
    - _Requirements: 8.2, 13.2_

  - [x] 15.3 Implement `app/api/plaid/exchange/route.ts`
    - `POST { publicToken }` exchanges for an Access_Token, fetches accounts/balances/holdings, calls
      `mapPlaidToAccounts`, discards the token without persisting, returns
      `{ institutionId, institutionName, accounts }`; never writes any token
    - _Requirements: 8.3, 8.4, 8.5, 13.2, 13.3_

  - [x] 15.4 Implement Plaid_Keys_Present server status
    - `app/api/plaid/status/route.ts` (or a field on shell server data) reports `Plaid_Keys_Present`
      from server env without exposing the secret
    - _Requirements: 14.1, 14.4_

  - [ ]* 15.5 Write route tests with a mocked Plaid client
    - Verify server-side exchange, holdings fetch, mapper invocation, and that no token or secret
      appears in any response; 1–3 representative cases
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 13.2, 14.4_

  - [ ] 15.6 Configure the Link_Token flow to open the institution picker
    - In the link-token route, send only a fixed demo client_user_id with no phone number, email, or returning-user hint, so Plaid Link opens straight to the institution picker and skips the returning-user phone step; keep products Investments, country US, language en; change nothing about token handling or the mapper
    - _Requirements: 18.1, 18.2, 18.6_

- [x] 16. Implement the Plaid Link client wiring
  - [x] 16.1 Implement `components/ui/PlaidConnectButton.tsx`
    - Wrap `react-plaid-link` with only the `Link_Token`; request the token from
      `/api/plaid/link-token`, open Link, POST the `Public_Token` to `/api/plaid/exchange`, and hand
      mapped accounts to `upsertConnectedInstitution`; `onExit` with no error is a no-op; show an
      in-progress indicator and a plain-language connection-error message, leaving accounts unchanged
      on failure
    - _Requirements: 8.1, 8.6, 13.1, 13.2, 13.4_

- [x] 17. Implement the account editing and source UI components
  - [x] 17.1 Implement `SourceBadge.tsx` and `SourceMixSummary.tsx`
    - Source badge per account; Source_Mix_Summary on the Net_Worth_Card from `sourceMix`
    - _Requirements: 1.3, 1.4_

  - [x] 17.2 Implement `AccountRow.tsx` with freshness and override labels
    - Show "Updated by you on [date]" for Manual_Accounts; "adjusted by you" iff a Split_Override is
      present; "Allocation needs your input" flag for holdingless connected investment accounts
    - _Requirements: 4.3, 4.4, 5.2, 10.7, 13.3_

  - [x] 17.3 Implement `AccountEditor.tsx` with inline validation
    - Create/edit/delete Sample and Manual accounts with the undo affordance; edit only the
      Split_Override on Connected_Accounts (balance/institution/type read-only); wire
      `validateAccountInput` for inline messages, Save gating, and message clearing; recompute views
      on save; "Start fresh" and "Restore sample data" actions
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 3.4, 3.5, 3.6, 4.1, 4.2, 6.1, 6.3, 6.5_

  - [x] 17.4 Implement `StorageRecoveryBanner.tsx` and the keys-absent/disconnect UI
    - Render the partial/fallback recovery message; hide or disable "Connect a test bank" with a
      plain-language explanation when `Plaid_Keys_Present` is false; per-institution disconnect
      control; connect screen shows the Sandbox credentials per institution
    - _Requirements: 7.4, 7.5, 9.1, 9.2, 14.1, 14.2, 14.3_

  - [x] 17.5 Implement `RentAssumptionNote.tsx`
    - Non-blocking note shown iff a Mortgage_Account is present, with a session-dismiss "continue"
      option; does not alter the buy-vs-rent calculation
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 17.6 Write component tests for editor, rent note, and keys-absent states
    - Inline message placement and Save gating; non-blocking rent note and session dismissal; Link
      cancel and in-progress states; keys-absent hide/disable; loading skeleton shows no sample
      numbers before load
    - _Requirements: 3.4, 3.5, 3.6, 11.2, 11.3, 13.1, 13.4, 14.1, 14.2, 14.3, 17.2, 17.3_

  - [ ] 17.7 Add the Sandbox sign-in and Link-flow guidance to the connect screen
    - On the connect screen, document the one-time Plaid Dashboard Link-customization toggle to disable the returning-user phone step for Sandbox, name the exact Sandbox sign-in to reach the persona accounts (user_custom with the matching institution JSON as the password, or user_good / pass_good as an alternative), and add a plain-language fallback telling the user they may enter a Sandbox test phone number and one-time code if the phone step still appears
    - _Requirements: 18.3, 18.4, 18.5_

- [x] 18. Wire the views to the Account_Store
  - [x] 18.1 Add the store-load lifecycle to `DashboardClient.tsx`
    - Render the Spec 1 skeleton while loading; on mount call `loadAccounts`, run `validateAccounts`
      and the pure calculators, render the Source_Mix_Summary and rows; recompute on every mutation;
      never render sample numbers before load
    - _Requirements: 1.3, 1.4, 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 18.2 Add the store-load lifecycle to `ProjectionClient.tsx`
    - Load from the store, show the skeleton while loading, recompute on mutation, never flash sample
      numbers
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 18.3 Add the store-load lifecycle to `BuyVsRentClient.tsx`
    - Load from the store, show the skeleton while loading, render the RentAssumptionNote when a
      mortgage is present, recompute on mutation, never flash sample numbers
    - _Requirements: 11.1, 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ]* 18.4 Write property test for the rent note presence
    - **Property 24: The rent note appears exactly when a mortgage is present**
    - **Validates: Requirements 11.1, 11.4**

  - [ ]* 18.5 Write property test for mortgage not changing buy-vs-rent
    - **Property 25: Mortgage presence does not change the buy-vs-rent result**
    - **Validates: Requirements 11.5**

- [x] 19. Add the Plaid Sandbox custom-user configs
  - [x] 19.1 Create the two Sandbox custom-user JSON files
    - `data/plaid-sandbox-users/`: institution A with a HYSA + a student loan (liability);
      institution B with a 401(k) + a brokerage; combined with no mortgage; in Plaid's current
      custom-user format
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.6_

  - [ ]* 19.2 Write schema/example tests for the two configs
    - Validate shape and contents (A: HYSA + student loan; B: 401(k) + brokerage; combined: no
      mortgage) against Plaid's current custom-user format
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.6_

- [x] 20. Update the product-scope steering document
  - [x] 20.1 Edit the product scope steering doc
    - Move real bank linking and persistent storage out of the out-of-scope list to the extent this
      spec delivers them; state editable accounts, Plaid Sandbox connections, and browser persistence
      are in scope; keep Plaid Production, server-side storage, webhooks, transactions, and
      holding-level editing out of scope
    - _Requirements: 16.1, 16.2, 16.3_

- [ ] 21. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. They include every
  property-based test, the unit/example tests, the route and component tests, the import-boundary
  check, and the config schema tests.
- Each property-based test uses fast-check with a minimum of 100 iterations, is the single test for
  its property, and is tagged `// Feature: account-sources-editable-and-plaid, Property N: ...`.
- Pure modules (`lib/calculations`, `lib/accounts`, `lib/plaid/mapper.ts`) import no UI and perform
  no fetch; their tests live in the matching `__tests__/` folder.
- Server-only Plaid code (`lib/plaid/client.ts`, `app/api/plaid/*`) is the only place the Plaid
  secret is read, and no token is ever persisted.
- Checkpoints validate the pure core, the full logic layer, and the integrated app incrementally.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1", "6.1", "8.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "3.5", "4.2", "4.3", "5.2", "5.3", "6.2", "8.2", "8.3", "9.1"] },
    { "id": 3, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6", "10.1"] },
    { "id": 4, "tasks": ["10.2", "10.3", "10.4", "10.5", "10.6", "11.1"] },
    { "id": 5, "tasks": ["11.2", "11.3", "11.4", "12.1"] },
    { "id": 6, "tasks": ["12.2", "12.3", "12.4", "12.5", "13", "15.1"] },
    { "id": 7, "tasks": ["15.2", "15.3", "15.4", "16.1"] },
    { "id": 8, "tasks": ["15.5", "15.6", "17.1", "17.2", "17.3", "17.4", "17.5", "17.7", "19.1", "20.1"] },
    { "id": 9, "tasks": ["17.6", "18.1", "18.2", "18.3", "19.2"] },
    { "id": 10, "tasks": ["18.4", "18.5"] }
  ]
}
```
