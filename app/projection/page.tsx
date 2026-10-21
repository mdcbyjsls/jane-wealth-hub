/*
 * Long-Term Wealth Projection entry point.
 *
 * Thin server shell for the projection view. With the Account_Store integration
 * (account-sources-editable-and-plaid, R17), the account lifecycle moved into
 * the client island: this file no longer reads the static `data/accounts.json`,
 * no longer validates accounts, and no longer computes `totals`/`allocation`
 * server-side. The view computes its figures from the browser-only
 * Account_Store (R17.1), shows the Spec 1 loading skeleton while that store
 * resolves (R17.2), never renders sample numbers before load (R17.3), and
 * recomputes on store changes (R17.5) — all inside `ProjectionClient`.
 *
 * Because `localStorage` is browser-only, there is nothing for the server to
 * resolve here: the shell renders immediately and the island owns both the
 * account lifecycle (skeleton / account-unavailable / ready) and the market
 * lifecycle (loading / route-error / ready). No `'use client'` here — this stays
 * a server component so the shell itself ships no client JS beyond the island.
 *
 * Clock boundary: `currentYear` is no longer derived here. The island reads the
 * clock in a mount-only effect (never during SSR) so the projection horizons
 * stay stable across hydration.
 *
 * The projection island is wrapped in `ProjectionErrorBoundary` so an
 * unexpected fault falls back to plain-language copy rather than a blank screen.
 */

import DashboardShell from '@/components/layout/DashboardShell';
import ProjectionErrorBoundary from '@/components/layout/ProjectionErrorBoundary';
import ProjectionClient from '@/components/layout/ProjectionClient';

/** Shell copy for the projection view. */
const SHELL_TITLE = 'Your long-term wealth projection';
const SHELL_DESCRIPTION =
  'See how your current allocation could grow over the next decades, as a range rather than a single guess.';

export default function ProjectionPage(): React.ReactElement {
  return (
    <DashboardShell title={SHELL_TITLE} description={SHELL_DESCRIPTION}>
      <ProjectionErrorBoundary>
        <ProjectionClient />
      </ProjectionErrorBoundary>
    </DashboardShell>
  );
}
