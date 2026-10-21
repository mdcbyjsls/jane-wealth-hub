# Requirements Document

## Introduction

This feature lets the user make the dashboard numbers their own. After using the read-only sample dashboard from Specs 1 through 4, the user needs to replace the simulated figures with their real financial picture: edit what the samples got wrong, add the accounts the samples miss, connect real institutions where they can, and type in the rest. This mirrors how real account aggregators work.

Every account now carries a Source: Sample (the original simulated data), Manual (added or edited by the user), or Connected (fetched from a bank through Plaid Sandbox). All three sources produce the same `Account` shape, pass through the existing `validateAccounts`, and flow into the same pure calculation functions, so the net-worth, allocation, projection, and buy-vs-rent views all work identically regardless of where an account came from.

This spec changes a decision from Spec 1, where editing accounts and persistent storage were out of scope. Account data moves from the static server-side JSON import to a browser-persisted store: the user edits and connections live in localStorage and are the source of truth, and all three views calculate from that stored data rather than the static file. The original sample set stays available to seed a first-time visitor and to be restored on demand. In scope now are editable accounts, Plaid Sandbox connections, and browser persistence; still out of scope are Plaid Production, server-side storage, webhooks, transactions, and holding-level editing. Testing scope is limited to unit tests for the Plaid-to-model mapping, the account-editing validation, and the storage load-and-fallback logic.

## Glossary

- **Account**: The core record the whole app computes on, defined in Spec 1 and extended here with a stable identifier, a Source, and source-specific fields. It carries an institution, an account type, a balance, a four-way asset-class breakdown, and freshness information.
- **Source**: The origin of an account, one of Sample, Manual, or Connected. Every account has exactly one Source.
- **Sample_Account**: An account whose Source is Sample: one of the original simulated accounts shipped with the app (the Spec 1 `data/accounts.json` set).
- **Manual_Account**: An account whose Source is Manual: one the user added by hand, or a former Sample_Account the user edited.
- **Connected_Account**: An account whose Source is Connected: one fetched from a financial institution through Plaid Sandbox and mapped into our model.
- **Account_Store**: The browser-only module that persists the user accounts to localStorage and is the single source of truth for account data at runtime. It mirrors the existing Target_Store pattern: all reads are defensive and never throw, and it is imported only by client code, never by the pure calculators, the server components, or the FRED modules.
- **Sample_Set**: The fixed, canonical set of Sample_Accounts the app ships with, used to seed a first-time visitor and to repopulate on "Restore sample data".
- **Account_Editor**: The user interface for creating, editing, and deleting accounts, including inline validation feedback.
- **Asset_Class**: One of four buckets: stocks, bonds, cash, or other, as defined in Spec 1.
- **Asset_Class_Split**: The four-way breakdown of an account across the Asset_Classes, expressed as whole-number percentages that must sum to exactly 100 for non-liability accounts.
- **Account_Type**: The category of an account. The Spec 1 set (brokerage, IRA, Roth IRA, 401(k), HYSA, checking, liability) is extended with a distinct mortgage type.
- **Liability_Account**: An account whose type is liability or mortgage; its balance is the amount owed, stored as a positive number and subtracted from net worth.
- **Mortgage_Account**: A Liability_Account whose type is specifically mortgage, which triggers the Decision-view rent-assumption note.
- **Account_Validation**: The validation applied to a single account edit or addition before it is accepted, covering required fields, field formats, and the asset-class split sum. Distinct from the batch `validateAccounts` guard that runs on load.
- **Account_Match_Key**: The tuple of institution, account name, and account mask used to decide whether a freshly fetched Connected_Account is the same account as one connected before, so a user split override can be carried across a reconnect.
- **Split_Override**: A user-supplied Asset_Class_Split applied to a Connected_Account in place of the holdings-derived split, marked with an "adjusted by you" label.
- **Stale_Rule**: The Spec 1 freshness rule that flags an account as stale when its last update is more than three days before now.
- **Updated_By_You_Date**: The date a Manual_Account was last edited by the user, shown in place of a staleness flag.
- **Source_Badge**: A visible label on each account indicating whether it is Sample, Manual, or Connected.
- **Source_Mix_Summary**: A summary on the Net_Worth_Card that, for each Source present, reports the number of accounts of that Source and that Source share of total assets as a percentage.
- **Plaid**: The third-party account-aggregation service, used in Sandbox mode only in this spec.
- **Plaid_Sandbox**: Plaid non-production test environment, which uses test credentials and simulated institutions and returns no real financial data.
- **Link_Token**: The short-lived token the server creates to initialize Plaid Link in the browser.
- **Link_Flow_Config**: The options on the Link_Token request that control which Plaid Link screens the user sees. In this spec it is set so Link opens directly to the institution picker and credential entry, with no returning-user phone-number step, and it never carries an end-user identity hint.
- **Public_Token**: The token Plaid Link returns to the browser on a successful connection, which the server exchanges for an Access_Token.
- **Access_Token**: The Plaid token that authorizes data requests for a connected institution. In this spec it exists only transiently within a single server request and is never persisted.
- **Plaid_Mapper**: The pure, unit-tested function that converts Plaid accounts, balances, and holdings into our `Account` model, including the documented Asset_Class rules for ambiguous securities.
- **Plaid_Item**: One connected institution in Plaid terms; corresponds to one connected institution in our app, producing one or more Connected_Accounts.
- **Sandbox_Test_User**: A custom Plaid Sandbox user, defined by a JSON configuration in the repo, whose accounts match the product persona. Two such users are provided, one per institution, so multi-institution aggregation can be demonstrated by connecting twice.
- **Decision_View**: The buy-vs-rent Scenario view from Spec 3, at `app/buy-vs-rent/page.tsx`.
- **Rent_Assumption_Note**: The non-blocking message shown in the Decision_View when a Mortgage_Account is present, stating that the comparison assumes the user currently rents, with an option to continue.
- **Plaid_Keys_Present**: The server-side condition that the Plaid client id and secret are configured in the environment; when false, the Plaid option is hidden or disabled.
- **Net_Worth_Card**: The dashboard element from Spec 1 that displays total net worth, extended here with the Source_Mix_Summary.

## Requirements

### Requirement 1: Every Account Has a Source

**User Story:** As a user, I want every account to declare where its numbers came from, so that I can tell apart the sample data, what I typed myself, and what a bank reported.

#### Acceptance Criteria

1. THE Account model SHALL carry a Source of exactly one of Sample, Manual, or Connected on every account.
2. THE Account model SHALL carry a stable identifier on every account that is unique within the Account_Store and persists across edits and reloads.
3. WHEN an account is displayed in any view, THE system SHALL show a Source_Badge indicating whether the account is Sample, Manual, or Connected.
4. THE Net_Worth_Card SHALL display a Source_Mix_Summary that, for each Source present among the current accounts, shows the number of accounts of that Source and that Source share of total assets as a percentage.
5. THE system SHALL pass accounts of every Source through the same `validateAccounts` guard and the same net-worth, allocation, projection, and buy-vs-rent calculations, with no calculation behaving differently based on Source.

### Requirement 2: Edit, Add, and Delete Sample and Manual Accounts

**User Story:** As a user, I want to correct, add, and remove accounts, so that the dashboard reflects my real finances instead of the sample data.

#### Acceptance Criteria

1. THE Account_Editor SHALL allow the user to edit the institution, account name, Account_Type, balance, and Asset_Class_Split of any Sample_Account or Manual_Account.
2. THE Account_Editor SHALL allow the user to add a new Manual_Account by entering its institution, account name, Account_Type, balance, and Asset_Class_Split.
3. THE Account_Editor SHALL allow the user to delete any Sample_Account or Manual_Account, and SHALL show a brief undo option immediately after a deletion that restores the deleted account if invoked.
4. THE Account_Editor SHALL NOT allow a Connected_Account to be deleted individually; a Connected_Account is removed only by disconnecting its institution (Requirement 9).
5. WHEN the user saves an edit to any field of a Sample_Account, THE system SHALL change that account Source from Sample to Manual.
6. WHEN the user adds a new account, THE system SHALL assign it the Manual Source and a new stable identifier.
7. WHEN the user saves a valid edit, addition, or deletion, THE system SHALL immediately recompute and update net worth, allocation, projection, and the buy-vs-rent comparison to reflect the change.

### Requirement 3: Validate Account Edits Inline

**User Story:** As a user, I want clear, immediate feedback when an account entry is invalid, so that I can fix it without guessing.

#### Acceptance Criteria

1. THE Account_Validation SHALL require a non-empty institution of at most 120 characters, an Account_Type from the known set, and a finite, non-negative balance.
2. WHERE the Account_Type is a non-liability type, THE Account_Validation SHALL require the four Asset_Class_Split values to each be a whole number from 0 to 100 and to sum to exactly 100.
3. WHERE the Account_Type is a Liability_Account type, THE Account_Validation SHALL NOT require an Asset_Class_Split that sums to 100 and SHALL treat the account as contributing no Asset_Class value.
4. IF a field fails Account_Validation, THEN THE Account_Editor SHALL display a plain-language message next to the offending field and SHALL NOT save the account.
5. WHILE any field fails Account_Validation, THE Account_Editor SHALL prevent the edit or addition from being committed to the Account_Store.
6. WHEN the user corrects the offending field so all fields are valid, THE Account_Editor SHALL clear the inline message and allow the save.

### Requirement 4: Connected Accounts Have Read-Only Balances With Overridable Splits

**User Story:** As a user, I want bank-reported balances to stay authoritative while I still correct how an account is allocated, so that my connected data stays trustworthy but useful.

#### Acceptance Criteria

1. THE Account_Editor SHALL NOT allow the user to edit the balance, institution, or Account_Type of a Connected_Account.
2. THE Account_Editor SHALL allow the user to apply a Split_Override to a Connected_Account, subject to the same sum-to-100 validation as other accounts.
3. WHEN the user applies a Split_Override to a Connected_Account, THE system SHALL keep the account Source as Connected and SHALL show an "adjusted by you" label on that account.
4. WHEN a Connected_Account has no Split_Override, THE system SHALL NOT show the "adjusted by you" label.
5. WHEN an institution is reconnected and a freshly fetched account matches a previously connected one by Account_Match_Key (same institution, account name, and account mask), THE system SHALL carry the prior Split_Override and its "adjusted by you" label onto the refreshed account.
6. WHEN an institution is reconnected and a previously overridden account no longer matches any freshly fetched account by Account_Match_Key, THE system SHALL drop that Split_Override and SHALL tell the user in plain language that the override could no longer be applied.

### Requirement 5: Freshness for Manual Accounts

**User Story:** As a user, I want my hand-entered accounts to show when I last updated them instead of being flagged stale, so that my own data is not treated as out of date.

#### Acceptance Criteria

1. THE system SHALL exempt Manual_Accounts from the Stale_Rule so that a Manual_Account is never flagged stale regardless of how long ago it was edited.
2. WHEN displaying a Manual_Account, THE system SHALL show "Updated by you on [date]" using the Updated_By_You_Date instead of a staleness flag.
3. WHEN the user edits a Manual_Account or converts a Sample_Account to Manual by editing it, THE system SHALL set the Updated_By_You_Date to the current date.
4. THE system SHALL continue to apply the Spec 1 Stale_Rule to Sample_Accounts and, where freshness information is available, to Connected_Accounts.

### Requirement 6: Start Fresh and Restore Sample Data

**User Story:** As a user, I want to clear the sample accounts once my real data is in, and to bring the samples back if I want them, so that I control whether the demo data is present.

#### Acceptance Criteria

1. THE system SHALL provide a "Start fresh" action that removes all Sample_Accounts from the Account_Store.
2. WHEN the user invokes "Start fresh", THE system SHALL leave all Manual_Accounts and Connected_Accounts in place.
3. THE system SHALL provide a "Restore sample data" action that re-adds the canonical Sample_Set to the Account_Store.
4. WHEN the user invokes "Restore sample data", THE system SHALL leave all Manual_Accounts and Connected_Accounts in place and SHALL NOT create duplicate Sample_Accounts if the Sample_Set is already present.
5. WHEN either action changes the set of accounts, THE system SHALL immediately recompute and update all views.

### Requirement 7: Persist Accounts in the Browser With Defensive, Partial-Recovery Loading

**User Story:** As a user, I want my accounts to stick around between visits and to lose as little as possible if storage gets corrupted, so that my data is durable and the app is resilient.

#### Acceptance Criteria

1. THE Account_Store SHALL persist the full set of accounts to localStorage whenever the accounts change.
2. WHEN the app loads and no accounts are stored, THE Account_Store SHALL seed the Account_Store with the canonical Sample_Set.
3. WHEN the app loads and valid accounts are stored, THE Account_Store SHALL load exactly those accounts as the source of truth.
4. WHEN the app loads and the stored value parses but contains a mix of valid and invalid accounts, THE Account_Store SHALL keep the valid accounts, drop only the invalid ones, and surface a plain-language message stating how many stored accounts could not be read.
5. IF the stored value is missing, is not parseable as JSON, or contains no valid account at all, THEN THE Account_Store SHALL fall back to the canonical Sample_Set and SHALL surface a plain-language message that saved data could not be read and the sample data was restored.
6. THE Account_Store SHALL perform all reads defensively so that server rendering, a disabled or unavailable localStorage, or a malformed stored value resolves without throwing.
7. THE Account_Store SHALL be imported only by client code and SHALL NOT be imported by the pure calculators, the server components, or the FRED modules.

### Requirement 8: Connect a Test Bank Through Plaid Sandbox

**User Story:** As a user, I want to connect a test bank through Plaid, so that I can experience real account aggregation without exposing real credentials.

#### Acceptance Criteria

1. THE system SHALL provide a "Connect a test bank" entry point that is clearly labeled as using Plaid Sandbox and that shows the Sandbox test credentials to the user.
2. THE system SHALL create the Link_Token only on the server, so that the Plaid secret is never sent to or exposed in the browser.
3. WHEN Plaid Link returns a Public_Token, THE system SHALL exchange it for an Access_Token only on the server.
4. WHEN the exchange succeeds, THE system SHALL, within the same server request, fetch the accounts, balances, and investment holdings, map them into our Account model, and discard the Access_Token without persisting it.
5. THE system SHALL persist only the mapped Connected_Accounts, in the Account_Store, and SHALL NOT persist the Access_Token, the Public_Token, or the Link_Token anywhere.
6. WHEN the mapped Connected_Accounts are persisted, THE system SHALL immediately recompute and update all views.

### Requirement 9: Support Multiple Institutions and Disconnecting One

**User Story:** As a user, I want to connect more than one bank and remove a single one, so that I can manage each connection independently.

#### Acceptance Criteria

1. THE system SHALL allow more than one institution to be connected at the same time, each contributing its own Connected_Accounts.
2. THE system SHALL allow the user to disconnect a single connected institution.
3. WHEN the user disconnects an institution, THE system SHALL remove only that institution Connected_Accounts and SHALL leave all other accounts of every Source in place.
4. WHEN the user reconnects an institution that is already connected, THE system SHALL replace that institution Connected_Accounts rather than create a second set for it, carrying over Split_Overrides per Requirement 4.

### Requirement 10: Map Plaid Data Into Our Model

**User Story:** As a user, I want my connected holdings translated faithfully into the four asset classes, so that my allocation reflects what I actually hold.

#### Acceptance Criteria

1. THE Plaid_Mapper SHALL be a pure function that takes Plaid accounts, balances, and holdings and returns accounts in our Account model, importing nothing from app, components, or the FRED modules, performing no fetch, and reading no clock or localStorage.
2. THE Plaid_Mapper SHALL map depository accounts such as checking and savings to the appropriate Account_Type with their balance assigned entirely to the cash Asset_Class.
3. THE Plaid_Mapper SHALL map loan and credit-card accounts to a Liability_Account, with a loan of mortgage subtype mapped to the Mortgage_Account type and other loans and credit cards mapped to the liability type, in both cases with the amount owed stored as a positive balance.
4. WHERE an investment account has holdings, THE Plaid_Mapper SHALL classify each holding into an Asset_Class in the following order: first by the Plaid security type and subtype where provided (equity to stocks, fixed income and bond types to bonds, cash and money-market types to cash); otherwise by the security name, where a name containing "bond", "treasury", "fixed income", "aggregate", or "municipal" maps to bonds, a name containing "money market" maps to cash, and any other ETF or mutual fund maps to stocks; and SHALL map only a truly unclassifiable security (derivative, crypto, or unknown with no usable type or name) to other.
5. THE Plaid_Mapper classification SHALL satisfy these examples: "Vanguard Total Bond Market ETF" maps to bonds; "iShares Core U.S. Aggregate Bond ETF" maps to bonds; "Vanguard Total Stock Market ETF" maps to stocks; "SPDR S&P 500 ETF Trust" maps to stocks; a holding Plaid types as cash or money market maps to cash; a holding Plaid types as a derivative or crypto, or that has no usable type or name, maps to other.
6. WHERE an investment account has holdings, THE Plaid_Mapper SHALL derive the account Asset_Class_Split by summing each holding market value into its classified Asset_Class and converting to whole-number percentages that sum to exactly 100.
7. WHERE an investment account reports no holdings, THE Plaid_Mapper SHALL assign the account balance to the other Asset_Class and SHALL flag the account "Allocation needs your input" so the view can prompt the user to set the split.
8. THE Plaid_Mapper SHALL produce an Asset_Class_Split whose four whole-number percentages sum to exactly 100 for every non-liability account it returns.
9. THE Plaid_Mapper classification rules, including the security-name heuristics and the ambiguous cases, SHALL be documented in the mapping module so the classification of each case is traceable.

### Requirement 11: Mortgage Presence Note in the Decision View

**User Story:** As a user who has a mortgage, I want the buy-vs-rent view to acknowledge that I may not currently rent, so that I am not misled by a comparison built on a renting assumption.

#### Acceptance Criteria

1. WHEN a Mortgage_Account is present among the accounts, THE Decision_View SHALL display the Rent_Assumption_Note stating that the buy-vs-rent comparison assumes the user currently rents.
2. THE Rent_Assumption_Note SHALL be non-blocking so that the full buy-vs-rent comparison still renders beneath it.
3. THE Rent_Assumption_Note SHALL provide an option to continue that dismisses the note for the current session.
4. WHEN no Mortgage_Account is present, THE Decision_View SHALL NOT display the Rent_Assumption_Note.
5. THE presence of a Mortgage_Account SHALL NOT change the buy-vs-rent calculation itself, which continues to assume the user rents today.

### Requirement 12: Include Mortgages and Liabilities in Net Worth

**User Story:** As a user, I want connected or entered mortgages and loans to reduce my net worth correctly, so that my financial picture is accurate.

#### Acceptance Criteria

1. THE system SHALL treat a Mortgage_Account the same as any other Liability_Account for net-worth purposes, subtracting its positive balance from total assets.
2. THE system SHALL include Liability_Accounts of every Source in the net-worth total.
3. THE system SHALL exclude Liability_Accounts, including Mortgage_Accounts, from Asset_Class allocation totals, consistent with Spec 1.

### Requirement 13: Plaid Flow States

**User Story:** As a user, I want the Plaid connection flow to handle cancellation, errors, and missing data gracefully, so that a failed or empty connection never leaves the app broken.

#### Acceptance Criteria

1. WHEN the user cancels Plaid Link before completing a connection, THE system SHALL return to the prior state with no accounts added and SHALL NOT show an error.
2. IF link-token creation, public-token exchange, or data fetching fails, THEN THE system SHALL display a plain-language connection-error message and SHALL leave the existing accounts unchanged.
3. WHEN a connected institution returns accounts but no investment holdings data, THE system SHALL still add the accounts it can map and SHALL flag the affected investment accounts "Allocation needs your input" per Requirement 10.
4. WHILE a Plaid connection is in progress, THE system SHALL show a plain-language in-progress indication and SHALL NOT present partial or unmapped data as final.

### Requirement 14: Behave Correctly When Plaid Keys Are Absent

**User Story:** As a user running the app without Plaid credentials, I want everything except Plaid to work, so that the app is fully usable without a Plaid account.

#### Acceptance Criteria

1. WHERE Plaid_Keys_Present is false, THE system SHALL hide or disable the "Connect a test bank" entry point.
2. WHERE the "Connect a test bank" entry point is disabled rather than hidden, THE system SHALL show a plain-language explanation that Plaid credentials are not configured.
3. WHERE Plaid_Keys_Present is false, THE system SHALL keep every non-Plaid feature fully functional, including sample data, manual editing, persistence, and all three views.
4. THE system SHALL determine Plaid_Keys_Present on the server and SHALL NOT expose the Plaid secret to the browser in any case.

### Requirement 15: Configure Sandbox Test Users Matching the Persona

**User Story:** As a user trying the demo, I want the test banks to return a realistic, multi-institution financial picture, so that the connected experience resembles a real mass-affluent user.

#### Acceptance Criteria

1. THE repo SHALL include custom Plaid Sandbox user JSON configurations that match the product persona, split across two institutions so multi-institution aggregation can be demonstrated by connecting twice.
2. THE first institution configuration SHALL include a high-yield savings account and a student loan modeled as a Liability_Account.
3. THE second institution configuration SHALL include a 401(k) and a brokerage account.
4. THE combined Sandbox_Test_User configurations SHALL NOT include a mortgage.
5. THE "Connect a test bank" screen SHALL explain which Sandbox credentials to use for each institution.
6. THE Sandbox_Test_User configurations SHALL follow Plaid current Sandbox custom-user format.

### Requirement 16: Update the Product Scope

**User Story:** As a maintainer, I want the product scope to reflect that accounts are now editable and connectable, so that the steering documents stay accurate.

#### Acceptance Criteria

1. THE product scope document SHALL remove real bank linking and persistent storage from the out-of-scope list to the extent this spec delivers them.
2. THE product scope document SHALL state that editable accounts, Plaid Sandbox connections, and browser persistence are in scope.
3. THE product scope document SHALL keep Plaid Production, server-side storage, webhooks, transactions, and holding-level editing as out of scope.

### Requirement 17: All Views Calculate From the Browser-Stored Accounts

**User Story:** As a user, I want every view to compute from my own stored accounts rather than the static sample file, so that what I see is always my real data and never a flash of the samples.

#### Acceptance Criteria

1. THE dashboard, projection, and buy-vs-rent views SHALL compute their figures from the accounts in the Account_Store, not from the static server-side `data/accounts.json` file.
2. WHILE the stored accounts are loading, each view SHALL show the existing Spec 1 loading skeleton.
3. THE views SHALL NOT render sample numbers, or any figures derived from the static file, before the stored accounts have loaded.
4. WHEN the stored accounts have loaded, THE views SHALL render the computed figures for exactly those accounts.
5. WHEN the stored accounts change through editing, adding, deleting, connecting, or disconnecting, THE views SHALL recompute from the updated Account_Store contents.

### Requirement 18: Plaid Link Opens Directly to the Institution Picker

**User Story:** As a user connecting a test bank, I want Plaid Link to take me straight to choosing an institution and signing in, so that I am not stopped by a phone-number or returning-user step that the Sandbox test users cannot satisfy.

#### Acceptance Criteria

1. THE Link_Token request SHALL be configured so that Plaid Link opens directly to the institution-selection and credential-entry flow, without a preceding phone-number or returning-user ("Layer") identity step.
2. THE system SHALL NOT send any end-user phone number, email, or other returning-user identity hint on the Link_Token request, so that Plaid does not route the session into the returning-user experience.
3. WHERE Plaid account-level configuration would otherwise enable a phone-number or returning-user step for the Sandbox environment, THE "Connect a test bank" screen SHALL document the one-time Plaid Dashboard Link-customization setting the user must disable, since that setting cannot be overridden from code.
4. THE "Connect a test bank" screen SHALL state the exact Sandbox sign-in to use to reach the persona accounts: the "user_custom" username with the matching institution JSON as the password, and the default "user_good" / "pass_good" test credentials as an alternative, consistent with Requirement 15.
5. IF Plaid Link still presents a phone-number step despite the above, THEN THE "Connect a test bank" screen SHALL tell the user, in plain language, that they may enter a Sandbox test phone number and one-time code to continue to the institution picker.
6. THE Link_Token flow configuration SHALL NOT change the server-only token handling, the Plaid_Mapper, or any calculation; it affects only which Plaid Link screens the user sees.
