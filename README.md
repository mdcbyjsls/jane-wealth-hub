# Jane Wealth Hub

Net worth, allocation, and long-term scenario planning for mass-affluent professionals — a calm,
private-banking-style dashboard that pulls a scattered financial picture into one place and turns
the big question ("should I buy a home or keep renting?") into a clear, honest comparison.

- Live demo: <https://jane-wealth-hub-brown.vercel.app>


---

## What this is and why

### The user

A mass-affluent professional with roughly **$250K–$2M in investable assets**, spread across several
institutions — a brokerage here, an IRA and a 401(k) there, a high-yield savings account and a
checking account somewhere else. Today they log into each site separately and have no single view of
what they own or how it is allocated.

### The problem

Three gaps, in order of how much they hurt:

1. **No consolidated picture.** They cannot see total net worth or asset allocation in one place.
2. **No link between today and tomorrow.** They do not know how their *current* allocation shapes
   long-term wealth.
3. **Big decisions made blind.** The largest financial decision many of them face — buying a home —
   gets made without a clear view of the trade-off against staying invested.

### Why buy-vs-rent is the hero

The buy-vs-rent tester is the feature that ties the whole product together. Renting is not "throwing
money away" — the renter invests the down payment and the monthly difference between owning and
renting costs, **at their current portfolio's expected return**. That single link — your allocation
drives the opportunity cost of buying — is the core insight, and it is why the comparison is built on
the same return model that powers the projection view rather than a hand-waved number. The output is
a year-by-year net-worth comparison for both paths, a breakeven marker, a plain-language verdict, and
a sensitivity view of which assumptions move the result most.

The app ships in four increments:

1. **Today** — consolidated net worth and allocation, with a target and on-track status.
2. **Future** — a long-term projection of the current allocation as a range.
3. **Decision** — the buy-vs-rent scenario tester (the hero).
4. **Make it yours** — editable accounts and Plaid Sandbox connections, so the numbers become real.

---

## APIs and how they serve the product

### FRED (Federal Reserve Economic Data) — market assumptions

Every forward-looking number is anchored to a real, cited market series rather than a magic constant.

| Series | What it is | What it powers |
|---|---|---|
| `DGS10` | 10-year Treasury yield | Bond expected return; risk-free anchor for the equity return |
| `DTB3` | 3-month Treasury bill yield | Cash expected return |
| `CPIAUCSL` | CPI (general inflation) | The nominal → today's-dollars toggle |
| `MORTGAGE30US` | 30-year fixed mortgage rate | Default mortgage rate in buy-vs-rent |
| `CSUSHPINSA` | Case-Shiller national home price index | Default home-appreciation assumption |
| `CUSR0000SEHA` | CPI for rent of primary residence | Default rent-growth assumption |

Stocks use the bond anchor plus an **editable equity risk premium** (default +4 points), with the
reasoning shown; "other" uses a documented editable default. Every assumption is visible, sourced to
its series and as-of date, and editable in the UI.

**How the integration behaves:**

- **Server-side only.** FRED is called exclusively from a Next.js API route (`app/api/market-data/`).
  The API key never reaches the browser.
- **24-hour cache.** Responses are cached so repeated page loads do not hammer the API.
- **Snapshot fallback.** A static `data/fred-snapshot.json` ships with recent values. If no key is
  configured, or a live call fails or times out, the app serves the snapshot instead of breaking.
- **Honest freshness.** When cached or snapshot data is in use, a plain-language banner says so and
  shows the as-of date ("Market data last updated … — refresh for latest"). Live data shows no banner.

The app is fully usable **with no FRED key at all** — it just runs on the snapshot.

### Plaid Sandbox — connecting test banks

Accounts can come from three sources — **Sample** (the shipped demo data), **Manual** (hand-entered),
and **Connected** (via Plaid). All three produce the same `Account` shape and flow through the same
calculations.

- **Why Sandbox.** This is a demo, not a product handling real money. Plaid Sandbox gives a realistic
  connect-and-aggregate flow with test institutions and no real credentials or real financial data.
  Plaid Production is explicitly out of scope.
- **Token handling (server-only, nothing persisted).** The server mints a short-lived **Link Token**;
  the browser runs Plaid Link with only that token; on success the browser sends the **Public Token**
  back to the server, which exchanges it for an **Access Token**, fetches accounts/balances/holdings,
  maps them, and **discards the access token within that same request**. The access token, public
  token, and link token are never written to storage or returned to the browser. Only the mapped
  `Connected` accounts are persisted (in the browser's localStorage).
- **The classification approximation.** Plaid returns holdings, not neat asset classes, so a pure,
  unit-tested mapper assigns each holding to stocks / bonds / cash / other by a documented precedence:
  first the Plaid security type/subtype (equity → stocks, fixed income → bonds, cash/money-market →
  cash); otherwise a security-name heuristic ("bond", "treasury", "fixed income", "aggregate",
  "municipal" → bonds; "money market" → cash; any other ETF or fund → stocks); and only a genuinely
  unclassifiable security (derivative, crypto, unknown) falls to "other". This is deliberately an
  **approximation** — a names-and-types heuristic, not holdings-level truth — and the rules live in the
  mapper module so each decision is traceable. A connected account with no holdings is flagged
  "Allocation needs your input" rather than guessed at.

---

## Run it locally

```bash
# 1. Clone
git clone https://github.com/mdcbyjsls/jane-wealth-hub.git
cd jane-wealth-hub

# 2. Install
npm install

# 3. (Optional) add API keys — the app runs without them
cp .env.example .env.local
#   then edit .env.local:
#     FRED_API_KEY=...        # omit to use the bundled market-data snapshot
#     PLAID_CLIENT_ID=...     # omit to hide the "Connect a test bank" button
#     PLAID_SECRET=...        # use your Plaid *Sandbox* secret

# 4. Run
npm run dev        # http://localhost:3000

# 5. Test / verify
npm test           # Vitest unit + property tests
npm run typecheck  # tsc --noEmit (strict mode)
npm run build      # production build
```

Next.js reads `.env.local` (and `.env`) at **startup**, so restart `npm run dev` after adding keys.
`.env.local` is gitignored — never commit real credentials.

### Plaid Sandbox demo logins

With `PLAID_CLIENT_ID` / `PLAID_SECRET` set to Sandbox values, click **Connect a test bank**, then in
Plaid Link pick a non-OAuth institution and sign in:

- **Quick test user:** username `user_good`, password `pass_good`.
- **Persona test users (two institutions, matching the mass-affluent spread):** username `user_custom`,
  and paste the contents of `data/plaid-sandbox-users/institution-a.json` (HYSA + student loan) or
  `institution-b.json` (401(k) + brokerage) as the password. Connect twice to demonstrate
  multi-institution aggregation. See `data/plaid-sandbox-users/README.md` for details.

> **If Plaid Link shows a phone-number step first:** that is Plaid's returning-user ("Layer") flow,
> which the Sandbox custom users don't satisfy. You can enter a Sandbox test phone number
> (`+1 415-555-0015`, OTP `123456`) to continue to the institution picker, or disable the
> returning-user experience for Sandbox in your Plaid Dashboard (Link → Customization).

---

## Product decisions, with reasoning

1. **Ranges over false precision.** Projections and the buy-vs-rent outcome are shown as
   pessimistic → base → optimistic bands, never a single number. A point estimate implies a certainty
   the inputs do not have; a range communicates honest uncertainty and keeps the user appropriately
   skeptical.
2. **Risk-weighted projection bands.** The optimistic and pessimistic scenarios scale the blended
   expected return by fixed multipliers (×1.5 / ×0.5 around the base), and in buy-vs-rent the buy path
   additionally flexes home appreciation. This keeps the band construction consistent and legible
   rather than inventing a bespoke volatility model — appropriate for a planning tool, not a Monte
   Carlo engine.
3. **±5-point drift threshold for "on track."** A class is "on track" while its actual weight is within
   ±5 percentage points of target, off-target beyond that. A fixed, visible band avoids nagging the
   user over normal market drift while still flagging real misallocation, and it is drawn as a shaded
   band behind the drift bars so "within tolerance" reads at a glance.
4. **Relative freshness dates, not stored timestamps.** Sample accounts store "days ago" offsets and
   the absolute date is derived at load time. If the demo stored fixed dates, the sample data would
   slowly rot into looking stale as real time passed; relative offsets keep the demo honest forever.
   Manual accounts are exempt from the stale rule entirely and instead show "Updated by you on [date]"
   — your own entry shouldn't be scolded as out of date.
5. **Never store the Plaid access token.** The access token lives only inside the single server request
   that fetches and maps the data, then is discarded. Only the mapped accounts persist, and only in the
   browser. Fewer secrets at rest, smaller blast radius, and it keeps the "Sandbox demo, not a custodian
   of real credentials" boundary crisp.
6. **One live slider strip bound to the same state as the full panel.** The buy-vs-rent "biggest
   drivers" sliders and the full assumptions panel edit **the same** underlying values — moving a
   slider updates the panel and vice versa. Two controls holding different values for one assumption
   would be a correctness bug waiting to happen, so there is a single source of truth.
7. **Scope cuts, on purpose.** Taxes, PMI, refinancing, Monte Carlo, and multi-home comparison were cut
   from buy-vs-rent; holding-level editing, Plaid Production, webhooks, transactions, and server-side
   storage were cut from the accounts work. Each would add real surface area and failure modes without
   changing the core insight the demo is built to deliver. Better to do the hero flow well than to do
   everything shallowly.

---

## How this was built with Kiro

This project was built **spec-first, one increment at a time**. Each of the five increments
(consolidated view, projection, buy-vs-rent, visualization pass, and editable accounts + Plaid) got
its own spec folder under `.kiro/specs/<name>/` with a `requirements.md` (EARS-style acceptance
criteria), a `design.md`, and a `tasks.md` implementation plan. Implementation only started once the
spec for that increment was agreed, and the pure calculation layer (`lib/calculations/`, pure
functions, inputs-in-numbers-out) was always built and tested before any UI was wired to it.

**Where the plan got pushed back on — the useful friction:**

- **Freshness-decay catch.** The first freshness design stored fixed "last updated" dates, which would
  have made the sample data drift into looking stale over time. That was caught and reworked into
  relative "days ago" offsets derived at load (decision #4 above).
- **Requirements v2 revisions.** The account-sources requirements were revised after the first pass to
  add partial-recovery loading (keep the valid accounts, drop only the corrupt ones), split-override
  carry-over on reconnect, and an explicit "all views compute from the browser store, never flash the
  sample numbers" requirement.
- **Test-scope trimming.** Property- and example-based tests were deliberately scoped to the pure
  calculation and mapping layers (projection math, buy-vs-rent math, the Plaid mapper, account
  validation, and storage load/fallback) rather than spread thin across component tests. This kept the
  highest-risk logic well covered within the time budget.

**Working log.** A running session log lives at `docs/ai-log/session-log.md`, with an append-only entry
per working session (prompt, what was done, files changed, decisions, open questions). Note that the
recorded prompts are **lightly condensed in places** for readability, and some early **test fixtures
were drafted with Claude** and then reviewed and adjusted — both are called out here for honesty about
how the work was produced.

---

## With more time

- **Finish the deferred tests.** Several property-based and component tests were marked optional to hit
  the time budget; the import-boundary static check, route tests with a mocked Plaid client, and the
  config-schema tests are the first I'd pick up.
- **Monte Carlo projections.** Replace the fixed-multiplier bands with a simulated distribution for a
  genuinely probabilistic range.
- **Taxes and after-tax returns.** Account-type-aware tax treatment (Roth vs traditional vs taxable)
  would make both the projection and buy-vs-rent materially more accurate.
- **Plaid Production.** Real institution linking requires Plaid's production approval, OAuth flows,
  webhook handling, and a server-side data store — a real project in its own right.
- **Concentration and risk warnings.** Flag an over-concentrated single asset class or a thin cash
  cushion, tying back to the drift concept.
- **Manual accessibility / contrast audit.** The color system targets the required contrast ratios by
  construction, but a final pass with a contrast tool and a screen reader (chart text alternatives,
  keyboard-dragging the range sliders) is still outstanding.

---

## Tech stack

Next.js (App Router) + TypeScript (strict) · Tailwind CSS · Recharts · Vitest + fast-check ·
Plaid + react-plaid-link (Sandbox) · deployed on Vercel. Financial math lives in pure, unit-tested
TypeScript under `lib/calculations/`; see `.kiro/steering/` for the project's standing conventions.
