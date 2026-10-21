/*
 * Dashboard entry point — the Consolidated Net Worth and Allocation View
 * (account-sources-editable-and-plaid, Task 18.1).
 *
 * This is now a THIN server shell. In Spec 1 this file read the static
 * `data/accounts.json`, validated it, and computed net worth / groups /
 * allocation / freshness / waterfall on the server, passing figures down to a
 * small client island. This spec moves the source of truth into the browser
 * Account_Store (R17.1): the dashboard must compute from the user's saved,
 * connected, or seeded accounts — never from the static file — and must show the
 * loading skeleton until that store resolves (R17.2), never flashing sample
 * numbers first (R17.3).
 *
 * Because the Account_Store lives in `localStorage`, the whole load → validate →
 * compute → render pipeline must run in the browser. So this page reads no
 * account data and does no computation. It only renders the chrome
 * (`DashboardShell`) and the client island (`DashboardClient`) inside the
 * `DashboardErrorBoundary`, which still catches any unexpected fault and falls
 * back to the plain-language LoadError copy (R6). All five view states
 * (loading / validation error / empty / zero-balance / ready) are now routed
 * INSIDE the island, driven by the store load result rather than the server file.
 *
 * No `'use client'` here — the shell stays a server component; the single client
 * boundary is `DashboardClient`.
 */

import DashboardShell from '@/components/layout/DashboardShell';
import DashboardErrorBoundary from '@/components/layout/DashboardErrorBoundary';
import DashboardClient from '@/components/layout/DashboardClient';

export default function Home(): React.ReactElement {
  return (
    <DashboardErrorBoundary>
      <DashboardShell>
        <DashboardClient />
      </DashboardShell>
    </DashboardErrorBoundary>
  );
}
