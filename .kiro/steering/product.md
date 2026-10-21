# Product Context

## Target User

A mass-affluent professional with roughly $250K–$2M in investable assets. Their money is spread across multiple banks and brokerages, and they face a common set of problems:

- They can't see their total net worth in one place.
- They don't know how today's allocation affects long-term wealth.
- They face major decisions (like buying a home) without a clear picture of the tradeoff.

## v1 Scope

### 1. Consolidated Net Worth & Allocation View

Show the user's total net worth and asset allocation across all simulated accounts in a single dashboard. Accounts span multiple institutions (e.g., Fidelity brokerage, Vanguard IRA, Chase savings). The view should make it immediately obvious where the money is and how it's divided.

### 2. Long-Term Wealth Projection

Project portfolio growth over time based on the current allocation's expected return. Show a range (optimistic / base / pessimistic) rather than a single line to avoid false precision. The assumed return rates and their sources must be visible and editable by the user.

### 3. Buy-vs-Rent Scenario Tester (Hero Feature)

Compare net worth after 10 years under two scenarios:

- **Buy**: The user purchases a home. Down payment leaves the portfolio; monthly mortgage replaces rent.
- **Rent**: The user keeps renting. The down payment stays invested, and any monthly savings vs. the mortgage payment are also invested — both at the portfolio's current expected return.

All inputs (home price, down payment %, rent, mortgage rate, appreciation rate, etc.) must be visible, editable, and sourced. The output should show net worth at year 10 for each scenario, expressed as a range.

### 4. Editable Accounts & Plaid Sandbox Connections

Accounts are editable: the user can add, edit, and delete accounts, with changes persisted in the browser (localStorage). The user can also connect test banks through Plaid Sandbox, which pulls in account balances and holdings. All three sources — sample, manual, and connected — produce the same account shape and flow into the same calculations.

## Design Principles

- **Every assumption is visible, sourced, and editable.** Never hide a number the user didn't choose.
- **Show ranges instead of false precision.** Point estimates mislead; ranges build appropriate confidence.
- **Plain language over jargon.** Avoid terms like "alpha," "basis points," or "CAGR" without explanation.

## Out of Scope for v1

- Plaid Production (Sandbox connections only, no real financial institutions)
- Server-side storage of account data (persistence is browser-only via localStorage)
- Plaid webhooks and transaction history
- Holding-level editing (editing happens at the account and allocation-split level)
- Tax optimization or after-tax return calculations
- Monte Carlo simulation
- User accounts, authentication, or server-side persistent storage
