# Plaid Sandbox custom users (R15)

These two JSON files define custom Plaid **Sandbox** test users that match the
app's mass-affluent persona. They exist so the "Connect a test bank" flow can
demonstrate real, multi-institution aggregation by connecting twice — once per
institution — without any real credentials or real financial data.

Everything here is Sandbox-only. No file in this folder is read by the pure
calculators; the server-only Plaid route maps whatever the Sandbox returns into
our `Account` model via `lib/plaid/mapper.ts`.

## The two institutions

| File | Institution (Sandbox) | Accounts | Combined assets |
|---|---|---|---|
| `institution-a.json` | First Platypus Bank | High-yield savings (depository/savings) + student loan (loan/student, a liability) | ~$85.4K cash, ~$28.5K owed |
| `institution-b.json` | First Gingham Credit Union | 401(k) (investment/401k) + taxable brokerage (investment/brokerage), each holding VTI + BND | ~$924K invested |

Combined investable assets land near **$1.0M**, inside the $250K–$2M persona
range. There is **no mortgage anywhere** in either config (R15.4) — the
buy-vs-rent view's rent note only appears once a user adds a mortgage by hand.

The investment accounts hold a total stock market ETF (VTI) and a total bond
market ETF (BND) so the mapper's `classifyHolding` can derive a stocks/bonds
split from the holdings by market value. The brokerage also holds a money-market
fund (VMFXX) so a slice maps to cash. Each `starting_balance` equals the summed
holding market value (`quantity × institution_price`) so the account balance and
its holdings stay consistent.

## How to connect each institution

Both files use Plaid's current custom-user format: a top-level
`override_accounts` array, with numeric `starting_balance` / `force_available_balance`,
a `liability` object on the loan account, and a `holdings` array (each with a
`security`) on the investment accounts. See
[Plaid Sandbox: Customize test data](https://plaid.com/docs/sandbox/user-custom/)
and the [plaid/sandbox-custom-users](https://github.com/plaid/sandbox-custom-users)
reference repo. (Content was rephrased for compliance with licensing restrictions.)

There are two supported ways to drive these in Sandbox:

### Option 1 — Sandbox Studio (recommended)

1. In the Plaid Dashboard, go to **Build → Sandbox → Users**.
2. Create a custom user and paste the contents of `institution-a.json` as its
   configuration. Give it a memorable username, e.g. `jwh_platypus`.
3. Create a second custom user with `institution-b.json`, e.g. `jwh_gingham`.
4. In the app's "Connect a test bank" flow, open Plaid Link and pick a
   **non-OAuth** institution such as **First Platypus Bank** or
   **First Gingham Credit Union** (OAuth institutions can override custom
   fields). Log in with the matching username and **any non-empty password**.

### Option 2 — `user_custom` username

When going through Link directly, log in with the username `user_custom` and
paste the **entire JSON object** (the file's contents) as the password. Use
`institution-a.json` for the first connection and `institution-b.json` for the
second.

> Programmatic alternative: the same JSON can be passed to
> `/sandbox/public_token/create` via `options.override_username = "user_custom"`
> and `options.override_password = <the JSON string>`, bypassing the Link UI.

## Credentials summary (surfaced on the connect screen — R15.5)

The "Connect a test bank" screen (UI text lives in task 17.4) should tell the
user, per institution:

- **Institution A** — First Platypus Bank · username `user_custom` (or your
  Studio username) · password = contents of `institution-a.json` (or any
  non-empty password when using a saved Studio user).
- **Institution B** — First Gingham Credit Union · username `user_custom` (or
  your Studio username) · password = contents of `institution-b.json` (or any
  non-empty password when using a saved Studio user).
