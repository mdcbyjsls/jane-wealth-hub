/*
 * Long-Term Wealth Projection entry point (long-term-wealth-projection, Task 11.1).
 *
 * This is the server component boundary for the projection view. It mirrors the
 * Spec 1 dashboard (`app/page.tsx`) exactly: the static account data is loaded,
 * validated, and turned into the target-INDEPENDENT figures the island needs —
 * the per-class dollar `totals` and the actual `allocation`. Only the
 * interactive projection runs in a client island (`ProjectionClient`); this
 * file resolves nothing that needs the browser.
 *
 * No `'use client'` here — this file must stay a server component so the JSON is
 * a build-time module import (small client bundle, nothing secret) and so
 * `validateAccounts` runs before any number is computed.
 *
 * Routing (R10.3, R10.6): any account load/validation failure — or an empty
 * account set — routes to the single account-unavailable state, which shows no
 * projected values and no chart (`ProjectionErrorState` with
 * `PROJECTION_MESSAGES.accountError`). This account error also wins over a later
 * market-data failure: when there is nothing to project, the island is never
 * even rendered. On success the shell wraps `ProjectionErrorBoundary` around
 * `ProjectionClient`.
 *
 * Clock boundary: `currentYear` is derived HERE (`new Date().getFullYear()`),
 * the only clock read for this view. `ProjectionClient` never reads the clock —
 * it receives `currentYear` as a serializable prop so the projection horizons
 * stay deterministic across the server→client bridge.
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
import ProjectionErrorBoundary from '@/components/layout/ProjectionErrorBoundary';
import ProjectionClient from '@/components/layout/ProjectionClient';
import ProjectionErrorState from '@/components/ui/ProjectionErrorState';
import { PROJECTION_MESSAGES } from '@/lib/projectionMessages';

/** Shell copy for the projection view. */
const SHELL_TITLE = 'Your long-term wealth projection';
const SHELL_DESCRIPTION =
  'See how your current allocation could grow over the next decades, as a range rather than a single guess.';

/**
 * Loads the raw account data defensively (mirrors Spec 1's `loadRawAccounts`). A
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
 * The single account-unavailable route (R10.3, R10.6): render the shell with the
 * plain-language account-error copy and no projected values or chart. This wins
 * over any later market-data failure because the island is never rendered.
 */
function accountUnavailable(): React.ReactElement {
  return (
    <DashboardShell title={SHELL_TITLE} description={SHELL_DESCRIPTION}>
      <ProjectionErrorState message={PROJECTION_MESSAGES.accountError} />
    </DashboardShell>
  );
}

export default function ProjectionPage(): React.ReactElement {
  const raw = loadRawAccounts();

  // Load failure (data missing, unreadable, or not an array) → account error.
  if (raw === null) {
    return accountUnavailable();
  }

  // Validation must complete before any number is computed.
  const validation = validateAccounts(raw);

  // Validation failure (bad data shape) → account error. No values at all.
  if (!validation.ok) {
    return accountUnavailable();
  }

  const accounts = validation.accounts;

  // No accounts → nothing to project → account error.
  if (accounts.length === 0) {
    return accountUnavailable();
  }

  // Target-independent computations, done once on the server. These are the
  // only figures the island needs; the per-class percentages drive the current
  // blended return, and the class totals sum to the Projected_Base (R1.1).
  const totals: ClassTotals = computeClassTotals(accounts);
  const allocation: AllocationResult = computeActualAllocation(totals);

  // Clock boundary: the only clock read for this view. The island receives this
  // as a serializable prop and never reads the clock itself.
  const currentYear = new Date().getFullYear();

  // Success: render the shell with the projection island guarded by its error
  // boundary. Only serializable props (plain numbers, no Dates) cross the
  // server→client bridge. Market data is fetched by the island, not here.
  return (
    <DashboardShell title={SHELL_TITLE} description={SHELL_DESCRIPTION}>
      <ProjectionErrorBoundary>
        <ProjectionClient
          allocation={allocation}
          totals={totals}
          currentYear={currentYear}
        />
      </ProjectionErrorBoundary>
    </DashboardShell>
  );
}
