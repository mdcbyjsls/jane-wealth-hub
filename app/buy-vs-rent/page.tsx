/*
 * Buy-vs-Rent Scenario Tester entry point (buy-vs-rent-scenario-tester, Task 10.1).
 *
 * This is the server component boundary for the hero feature. It mirrors the
 * Spec 2 projection view (`app/projection/page.tsx`) almost exactly: the static
 * account data is loaded, validated, and turned into the figures the island
 * needs — the per-class dollar `totals` (Starting_Assets, R2.1) and the actual
 * `allocation` (Current_Allocation). The interactive comparison runs in a client
 * island (`BuyVsRentClient`); this file resolves nothing that needs the browser.
 *
 * No `'use client'` here — this file must stay a server component so the JSON is
 * a build-time module import (small client bundle, nothing secret) and so
 * `validateAccounts` runs before any number is computed.
 *
 * Routing (R4.5, R12.3): any account load/validation failure — or an empty
 * account set — routes to the single account-unavailable state, which shows no
 * figures and no chart (`BuyVsRentErrorState` with
 * `BUY_VS_RENT_MESSAGES.accountError`). This account error also wins over a
 * later market-data failure: when there is nothing to compare, the island is
 * never even rendered, so the island's own market-unavailable path never runs.
 * On success the shell wraps `BuyVsRentErrorBoundary` around `BuyVsRentClient`.
 *
 * Clock boundary: `currentYear` is derived HERE (`new Date().getFullYear()`),
 * the only clock read for this view. `BuyVsRentClient` never reads the clock —
 * it receives `currentYear` as a serializable prop so the comparison stays
 * deterministic across the server→client bridge.
 *
 * Market data is deliberately NOT fetched here. The island fetches the resolved
 * snapshot from the server-only `/api/market-data` route so the loading and
 * error states live entirely in the island without blocking the page shell.
 *
 * Serialization boundary: only `allocation`, `totals` (plain numbers, no Dates),
 * and the numeric `currentYear` cross into the client island — keep it that way.
 */

import accountsData from '@/data/accounts.json';
import {
  computeActualAllocation,
  computeClassTotals,
  validateAccounts,
} from '@/lib/calculations/allocation';
import type { AllocationResult, ClassTotals } from '@/types/accounts';
import DashboardShell from '@/components/layout/DashboardShell';
import BuyVsRentErrorBoundary from '@/components/layout/BuyVsRentErrorBoundary';
import BuyVsRentClient from '@/components/layout/BuyVsRentClient';
import BuyVsRentErrorState from '@/components/ui/BuyVsRentErrorState';
import { BUY_VS_RENT_MESSAGES } from '@/lib/buyVsRentMessages';

/** Shell copy for the buy-vs-rent hero feature. */
const SHELL_TITLE = 'Should you buy or keep renting?';
const SHELL_DESCRIPTION =
  'Compare your net worth after 10 years if you buy a home versus if you keep renting and stay invested. Every assumption is shown and editable, and each outcome is a range rather than a single guess.';

/**
 * Loads the raw account data defensively (mirrors Spec 2's `loadRawAccounts`). A
 * static module import rarely fails, but we still guard a thrown import/parse and
 * a non-array shape so the account-unavailable path is real rather than
 * theoretical. Returns the raw value as `unknown` on success (validation happens
 * separately), or `null` to signal a load failure the caller routes to the
 * account-unavailable state.
 */
function loadRawAccounts(): unknown {
  try {
    // `accountsData` is the build-time JSON import, trusted only as `unknown`.
    const raw: unknown = accountsData;
    if (!Array.isArray(raw)) {
      return null;
    }
    return raw;
  } catch {
    // A genuinely unreadable/unparseable import lands here → account error.
    return null;
  }
}

/**
 * The single account-unavailable route (R4.5, R12.3): render the shell with the
 * plain-language account-error copy and no figures or chart. This wins over any
 * later market-data failure because the island is never rendered.
 */
function accountUnavailable(): React.ReactElement {
  return (
    <DashboardShell title={SHELL_TITLE} description={SHELL_DESCRIPTION}>
      <BuyVsRentErrorState message={BUY_VS_RENT_MESSAGES.accountError} />
    </DashboardShell>
  );
}

export default function BuyVsRentPage(): React.ReactElement {
  const raw = loadRawAccounts();

  // Load failure (data missing, unreadable, or not an array) → account error.
  if (raw === null) {
    return accountUnavailable();
  }

  // Validation must complete before any number is computed.
  const validation = validateAccounts(raw);

  // Validation failure (bad data shape) → account error. No figures at all.
  if (!validation.ok) {
    return accountUnavailable();
  }

  const accounts = validation.accounts;

  // No accounts → nothing to compare → account error.
  if (accounts.length === 0) {
    return accountUnavailable();
  }

  // Target-independent computations, done once on the server. These are the
  // only figures the island needs: the per-class dollar totals are the
  // Starting_Assets (R2.1) the drawdown funds the purchase from, and the actual
  // allocation carries the Current_Allocation percentages that drive the
  // blended Investment_Return.
  const totals: ClassTotals = computeClassTotals(accounts);
  const allocation: AllocationResult = computeActualAllocation(totals);

  // Clock boundary: the only clock read for this view. The island receives this
  // as a serializable prop and never reads the clock itself.
  const currentYear = new Date().getFullYear();

  // Success: render the shell with the buy-vs-rent island guarded by its error
  // boundary. Only serializable props (plain numbers, no Dates) cross the
  // server→client bridge. Market data is fetched by the island, not here.
  return (
    <DashboardShell title={SHELL_TITLE} description={SHELL_DESCRIPTION}>
      <BuyVsRentErrorBoundary>
        <BuyVsRentClient
          allocation={allocation}
          totals={totals}
          currentYear={currentYear}
        />
      </BuyVsRentErrorBoundary>
    </DashboardShell>
  );
}
