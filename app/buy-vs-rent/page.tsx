/*
 * Buy-vs-Rent Scenario Tester entry point (buy-vs-rent-scenario-tester, Task 10.1;
 * store-load integration, Task 18.3).
 *
 * This is the server component boundary for the hero feature, now a THIN SHELL.
 * As of the Account_Store integration (Task 18.3, R17.1), the Starting_Assets
 * are no longer resolved here: the account set lives in the browser-only
 * Account_Store, so `BuyVsRentClient` reads it on mount, validates it, and
 * derives the per-class `totals` (Starting_Assets, R2.1) and the actual
 * `allocation` (Current_Allocation) itself. This file therefore does NOT read
 * `data/accounts.json`, validate, or compute anything — doing so would flash
 * static sample numbers before the real store resolves (R17.3).
 *
 * No `'use client'` here — this stays a server component so it can derive the
 * `currentYear` once at the boundary and render the shell without shipping the
 * account data or any clock read into the client bundle.
 *
 * Routing (R12.3): the single account-unavailable state — an empty or unreadable
 * store — now lives inside the island's account lifecycle, not here. The shell
 * always renders the island behind its error boundary.
 *
 * Clock boundary: `currentYear` is derived HERE (`new Date().getFullYear()`),
 * the only clock read for this view, and handed to the island as a serializable
 * prop so the comparison stays deterministic across the server→client bridge.
 *
 * Market data is deliberately NOT fetched here. The island fetches the resolved
 * snapshot from the server-only `/api/market-data` route so the loading and
 * error states live entirely in the island without blocking the page shell.
 *
 * Serialization boundary: only the numeric `currentYear` crosses into the client
 * island — keep it that way.
 */

import DashboardShell from '@/components/layout/DashboardShell';
import BuyVsRentErrorBoundary from '@/components/layout/BuyVsRentErrorBoundary';
import BuyVsRentClient from '@/components/layout/BuyVsRentClient';

/** Shell copy for the buy-vs-rent hero feature. */
const SHELL_TITLE = 'Should you buy or keep renting?';
const SHELL_DESCRIPTION =
  'Compare your net worth after 10 years if you buy a home versus if you keep renting and stay invested. Every assumption is shown and editable, and each outcome is a range rather than a single guess.';

export default function BuyVsRentPage(): React.ReactElement {
  // Clock boundary: the only clock read for this view. The island receives this
  // as a serializable prop and never reads the clock itself.
  const currentYear = new Date().getFullYear();

  // Thin shell: render the buy-vs-rent island guarded by its error boundary. The
  // island reads and validates the account set from the browser store on mount
  // (R17.1) and owns every loading/error/empty state (R12.3, R17.2, R17.3), so
  // nothing account-related is resolved here. Market data is fetched by the
  // island, not here. Only the numeric `currentYear` crosses the bridge.
  return (
    <DashboardShell title={SHELL_TITLE} description={SHELL_DESCRIPTION}>
      <BuyVsRentErrorBoundary>
        <BuyVsRentClient currentYear={currentYear} />
      </BuyVsRentErrorBoundary>
    </DashboardShell>
  );
}
