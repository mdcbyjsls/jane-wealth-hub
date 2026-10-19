# Tech Stack & Constraints

## Stack

- **Framework**: Next.js (App Router) with TypeScript
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Testing**: Vitest
- **Deployment**: Vercel

## Market Data (FRED API)

Relevant series:
| Series ID | What it represents |
|---|---|
| `MORTGAGE30US` | 30-year fixed mortgage rate |
| `CPIAUCSL` | CPI (general inflation) |
| `CUSR0000SEHA` | CPI for rent of primary residence |
| `CSUSHPINSA` | Case-Shiller national home price index |
| `DGS10` | 10-year Treasury yield (risk-free rate proxy) |

### Rules for FRED data

- **Server-side only.** FRED calls happen exclusively in Next.js API routes (`/app/api/`). The FRED API key is never exposed to the browser.
- **Cache for 24 hours.** Store responses so repeated page loads don't hammer the API.
- **Snapshot fallback.** Ship a static `data/fred-snapshot.json` with recent values. If no API key is configured, or if the API call fails, the app falls back to this snapshot and displays a visible banner telling the user when the data was last updated.
- **Stale-data indicator.** When cached or snapshot data is in use, the UI must show a clear, plain-language note (e.g., "Market data last updated Oct 14, 2026 — refresh for latest").

## Account Data

Simulated via static JSON (`data/accounts.json`). No real bank linking. Accounts should represent a realistic mass-affluent spread: brokerage, IRA/Roth IRA, 401(k), HYSA, and checking.

## Financial Calculations

- Live in pure TypeScript functions under `lib/calculations/`.
- No UI imports, no fetch calls — inputs in, numbers out.
- Every public function must have Vitest unit tests in `lib/calculations/__tests__/`.
- These functions are the source of truth for all projection and scenario math.

## General Constraints

- TypeScript strict mode on.
- No `any` types without a comment explaining why.
- Environment variables follow the `.env` / `.env.example` pattern described in the git-workflow steering file.
