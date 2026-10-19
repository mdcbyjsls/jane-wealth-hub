/*
 * Dashboard entry point — the Consolidated Net Worth and Allocation View
 * (consolidated-net-worth-view, Task 17.3).
 *
 * This is the real server component that replaces the Task 6 integration
 * checkpoint. It is the single boundary where the static account data is loaded,
 * validated, and turned into the target-INDEPENDENT figures the dashboard shows:
 * net worth, institution groups, actual allocation, class totals, and freshness.
 * Only the target-DEPENDENT allocation + target editor runs in a client island
 * (`DashboardClient`); everything else renders on the server.
 *
 * No `'use client'` here — this file must stay a server component so the JSON is
 * a build-time module import (small client bundle, nothing secret) and so
 * `validateAccounts` runs before any number is computed (R7.1).
 *
 * Five-state routing (R6), computed top-to-bottom:
 *   1. LoadError (R6.2)      — the import is missing/unreadable or not an array.
 *   2. ValidationError (R6.3) — `validateAccounts` returns `ok: false`.
 *   3. Empty, no accounts (R6.4) — the validated array is empty: net worth $0 +
 *      the "no accounts" empty state.
 *   4. Empty, zero balances (R6.5) — valid, non-empty, but the total asset value
 *      is 0: net worth + institution breakdown render, and the allocation section
 *      shows the "zero balances" empty state instead of the pie (no division).
 *   5. Ready (R6.1)          — valid, non-empty, non-zero: the full dashboard.
 *
 * Freshness boundary (R8.1–R8.3): `now` is derived HERE (`new Date()`), the only
 * clock read, and passed into the pure `computeFreshness` so the calculator stays
 * clock-free and deterministic. `computeFreshness` internally derives each
 * account's absolute `lastUpdated` date from `now − lastUpdatedDaysAgo days`.
 *
 * Serialization boundary: `computeFreshness` produces `Date` objects. Those cross
 * into `InstitutionList`, which renders on the SERVER (not inside the client
 * island), so the Dates never have to serialize across the server→client bridge.
 * Only `allocation` and `totals` (plain numbers, no Dates) are passed into
 * `DashboardClient`, keeping that boundary cleanly serializable — keep it that way.
 *
 * The whole dashboard subtree is wrapped in `DashboardErrorBoundary` so an
 * unexpected fault in any child falls back to the plain-language LoadError copy
 * rather than a blank or misleading screen (R6).
 */

import accountsData from '@/data/accounts.json';
import {
  computeActualAllocation,
  computeClassTotals,
  computeFreshness,
  computeInstitutionGroups,
  computeNetWorth,
  validateAccounts,
} from '@/lib/calculations/allocation';
import type {
  AllocationResult,
  ClassTotals,
  FreshnessResult,
  InstitutionGroup,
  NetWorthResult,
} from '@/types/accounts';
import DashboardShell from '@/components/layout/DashboardShell';
import DashboardErrorBoundary from '@/components/layout/DashboardErrorBoundary';
import NetWorthHeader from '@/components/ui/NetWorthHeader';
import InstitutionList from '@/components/ui/InstitutionList';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import DashboardClient from '@/components/layout/DashboardClient';

/** Net worth figures to show in the two Empty states, where there is nothing to total (R6.4). */
const ZERO_NET_WORTH: NetWorthResult = {
  totalAssets: 0,
  totalLiabilities: 0,
  netWorth: 0,
};

/**
 * Loads the raw account data defensively (R6.2). A static module import rarely
 * fails, but we still guard a thrown import/parse and a non-array shape so the
 * LoadError path is real rather than theoretical. Returns the raw value as
 * `unknown` on success (validation happens separately), or `null` to signal a
 * load failure the caller routes to LoadError.
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
    // A genuinely unreadable/unparseable import lands here → LoadError (R6.2).
    return null;
  }
}

export default function Home(): React.ReactElement {
  const raw = loadRawAccounts();

  // State 1 — LoadError (R6.2): data missing, unreadable, or not an array.
  if (raw === null) {
    return (
      <DashboardErrorBoundary>
        <DashboardShell>
          <ErrorState variant="load" />
        </DashboardShell>
      </DashboardErrorBoundary>
    );
  }

  // R7.1: validation must complete before any number is computed.
  const validation = validateAccounts(raw);

  // State 2 — ValidationError (R6.3): bad data shape. Show no values at all.
  if (!validation.ok) {
    return (
      <DashboardErrorBoundary>
        <DashboardShell>
          <ErrorState variant="validation" />
        </DashboardShell>
      </DashboardErrorBoundary>
    );
  }

  const accounts = validation.accounts;

  // State 3 — Empty, no accounts (R6.4): render net worth $0 + the "no accounts"
  // empty state. No allocation or breakdown values are meaningful here.
  if (accounts.length === 0) {
    return (
      <DashboardErrorBoundary>
        <DashboardShell>
          <NetWorthHeader netWorth={ZERO_NET_WORTH} />
          <EmptyState variant="no-accounts" />
        </DashboardShell>
      </DashboardErrorBoundary>
    );
  }

  // Target-independent computations, done once on the server.
  const netWorth: NetWorthResult = computeNetWorth(accounts);
  const groups: InstitutionGroup[] = computeInstitutionGroups(accounts);
  const totals: ClassTotals = computeClassTotals(accounts);
  const allocation: AllocationResult = computeActualAllocation(totals);

  // Freshness boundary (R8.1–R8.3): `now` is derived here — the only clock read —
  // and handed to the pure calculator so it stays clock-free.
  const now = new Date();
  const freshness: FreshnessResult = computeFreshness(accounts, now);

  // State 4 — Empty, zero balances (R6.5): valid, non-empty, but nothing to
  // allocate. Net worth and the institution breakdown still render; the
  // allocation section shows the zero-balances empty state instead of the pie
  // (no division). The freshness Dates stay server-side inside InstitutionList.
  if (allocation.isZeroTotal) {
    return (
      <DashboardErrorBoundary>
        <DashboardShell>
          <NetWorthHeader netWorth={netWorth} />
          <InstitutionList groups={groups} freshness={freshness} />
          <EmptyState variant="zero-balances" />
        </DashboardShell>
      </DashboardErrorBoundary>
    );
  }

  // State 5 — Ready (R6.1): valid, non-empty, non-zero. Full dashboard in the
  // design's document order: net worth header, institution list, then the
  // allocation + target section (the interactive client island). Only the
  // serializable `allocation` and `totals` (no Dates) cross into the client.
  return (
    <DashboardErrorBoundary>
      <DashboardShell>
        <NetWorthHeader netWorth={netWorth} />
        <InstitutionList groups={groups} freshness={freshness} />
        <DashboardClient allocation={allocation} totals={totals} />
      </DashboardShell>
    </DashboardErrorBoundary>
  );
}
