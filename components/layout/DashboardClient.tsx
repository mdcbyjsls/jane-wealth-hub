'use client';

/*
 * DashboardClient — the dashboard's client island, now the OWNER of the whole
 * account lifecycle (R1.3, R1.4, R17.1–R17.5).
 *
 * This is the capstone of the account-sources-editable-and-plaid integration.
 * In Spec 1 the dashboard read the static `data/accounts.json` on the SERVER,
 * validated + computed there, and passed plain figures down to a small island
 * that only owned the target. This spec moves the SOURCE OF TRUTH into the
 * browser Account_Store: every figure the dashboard shows is now computed, on
 * the client, from the accounts the user has saved, connected, or seeded — never
 * from the static file (R17.1).
 *
 * Why a client island owns everything now: the Account_Store lives in
 * `localStorage`, so it cannot be read on the server without diverging from the
 * first client paint. The whole load → validate → compute → render pipeline must
 * therefore run in the browser. The page shell (`app/page.tsx`) is reduced to a
 * thin server component that renders the chrome and this island inside the error
 * boundary; it reads no account data.
 *
 * Lifecycle (R17.2, R17.3, R17.4):
 *   - Initial state is `accounts === null` ("not loaded yet"). The first server
 *     render and the first client paint both see `null`, so SSR and hydration
 *     agree and the Spec 1 `LoadingSkeleton` is shown. Crucially, NO sample
 *     numbers (and nothing derived from the static file) are ever rendered
 *     before the store resolves (R17.2, R17.3).
 *   - A mount-only effect calls `loadAccounts()` — the only account read — and
 *     stores both the usable accounts and the recovery discriminant. From then
 *     on the view renders the figures for exactly those accounts (R17.4).
 *
 * Recompute on mutation (R17.5, R2.7): every mutation — an editor add/edit/
 * delete/undo, a Split_Override, a Plaid connect/disconnect, start-fresh /
 * restore-sample — flows through a single `commitAccounts(next)` helper that
 * persists via `saveAccounts` and updates state. State drives a `useMemo` that
 * re-runs `validateAccounts` + the pure calculators, so the net-worth header,
 * Source_Mix_Summary, account rows, allocation, drift, and waterfall all
 * recompute from the updated set in one place.
 *
 * Clock reads (documented): now that this is a client island, deriving the
 * freshness `now = new Date()` here is correct and unavoidable — freshness is
 * relative to the moment the user is looking. `now` is captured once per load
 * into state (not re-read on every render) so repeated recomputes stay stable,
 * and it is handed to the pure `computeFreshness` / `computeAccountFreshness`
 * calculators, which never read the clock themselves.
 *
 * Five-state routing (R6, Spec 1), now client-side and driven by the store load
 * result rather than the server file:
 *   1. Loading                 — `accounts === null`: the skeleton (R17.2).
 *   2. ValidationError (R6.3)  — the loaded set fails `validateAccounts`. The
 *      store's own guard should prevent this, but we defend anyway.
 *   3. Empty, no accounts (R6.4) — the validated set is empty: $0 net worth +
 *      the "no accounts" empty state, but the editor + Plaid panel still render
 *      so the user can add or connect.
 *   4. Empty, zero balances (R6.5) — valid, non-empty, but total asset value is
 *      0: net worth + breakdown render, allocation shows the zero-balances empty
 *      state instead of the donut (no division).
 *   5. Ready (R6.1)            — the full dashboard.
 */

import { useEffect, useMemo, useState } from 'react';
import type {
  Account,
  AllocationResult,
  ClassTotals,
  DriftResult,
  FreshnessResult,
  InstitutionGroup,
  NetWorthResult,
  OnTrackStatus,
  SourceMixSummary as SourceMixSummaryData,
  TargetAllocation,
  WaterfallStep,
} from '@/types/accounts';
import {
  computeActualAllocation,
  computeClassTotals,
  computeDrift,
  computeFreshness,
  computeInstitutionGroups,
  computeNetWorth,
  computeOnTrackStatus,
  validateAccounts,
} from '@/lib/calculations/allocation';
import { computeAccountFreshness } from '@/lib/calculations/freshness';
import { computeWaterfall } from '@/lib/calculations/waterfall';
import { computeSourceMix } from '@/lib/calculations/sourceMix';
import {
  loadAccounts,
  saveAccounts,
  disconnectInstitution,
  upsertConnectedInstitution,
  type UpsertConnectedResult,
} from '@/lib/accounts/accountStore';
import { DEFAULT_TARGET, loadTarget, saveTarget } from '@/lib/target/targetStore';

import AllocationSection from '@/components/ui/AllocationSection';
import NetWorthWaterfall from '@/components/charts/NetWorthWaterfall';
import TargetEditor from '@/components/ui/TargetEditor';
import NetWorthHeader from '@/components/ui/NetWorthHeader';
import SourceMixSummary from '@/components/ui/SourceMixSummary';
import AccountRow from '@/components/ui/AccountRow';
import AccountEditor from '@/components/ui/AccountEditor';
import StorageRecoveryBanner from '@/components/ui/StorageRecoveryBanner';
import PlaidConnectPanel from '@/components/ui/PlaidConnectPanel';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';
import ErrorState from '@/components/ui/ErrorState';

/** Net worth figures to show in the empty / no-accounts state, where there is nothing to total (R6.4). */
const ZERO_NET_WORTH: NetWorthResult = {
  totalAssets: 0,
  totalLiabilities: 0,
  netWorth: 0,
};

/** The recovery discriminant from `loadAccounts`, surfaced by the StorageRecoveryBanner (R7.4, R7.5). */
type AccountRecovery = ReturnType<typeof loadAccounts>['recovery'];

/**
 * Everything the five-state router needs, derived in one `useMemo` from the
 * current account set so the net-worth header, Source_Mix_Summary, rows,
 * allocation, drift basis, freshness, and waterfall all recompute together on
 * every mutation (R17.5). Validation runs first (R17.1 / R7.1): a set that fails
 * routes to the ValidationError state and no figures are computed.
 */
interface DerivedDashboard {
  /** `false` only when the loaded set fails `validateAccounts` (defensive; R6.3). */
  valid: boolean;
  netWorth: NetWorthResult;
  groups: InstitutionGroup[];
  totals: ClassTotals;
  allocation: AllocationResult;
  freshness: FreshnessResult;
  waterfallSteps: WaterfallStep[];
  sourceMix: SourceMixSummaryData;
}

export interface DashboardClientProps {
  /** Extra Tailwind classes merged onto the island container. */
  className?: string;
}

export default function DashboardClient({
  className,
}: DashboardClientProps): React.ReactElement {
  // `null` = "store not loaded yet"; the first server render and first client
  // paint both see it, so SSR agrees with hydration and the skeleton shows
  // instead of any sample number (R17.2, R17.3).
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [recovery, setRecovery] = useState<AccountRecovery>({ kind: 'seeded' });
  // Freshness `now`, captured once at load so repeated recomputes stay stable
  // (see the clock-reads note in the file header). Seeded to a fixed value until
  // the load effect runs; it is only ever consumed once `accounts !== null`.
  const [now, setNow] = useState<Date>(() => new Date());

  // Target lifecycle (unchanged from Spec 1): seed from the example default so
  // SSR and first paint agree, then read the persisted target after mount.
  const [target, setTarget] = useState<TargetAllocation>(DEFAULT_TARGET);

  // A plain-language note when a Plaid reconnect could not carry some prior
  // Split_Overrides onto the freshly fetched accounts (R4.6). Cleared on the
  // next successful mutation.
  const [droppedOverrideNote, setDroppedOverrideNote] = useState<string | null>(null);

  // Whether the server reported Plaid credentials are configured (R14.1, R14.4).
  // Defaults to false so the "Connect a test bank" entry point stays disabled
  // until the status fetch confirms keys are present — a safe, non-flashing
  // default (never offering a connection we cannot complete).
  const [plaidKeysPresent, setPlaidKeysPresent] = useState<boolean>(false);

  // Mount-only: read the browser-only stores. This is the ONLY account read, and
  // it runs after hydration so it never affects the server render (R17.2–R17.4).
  useEffect(() => {
    const result = loadAccounts();
    setAccounts(result.accounts);
    setRecovery(result.recovery);
    setNow(new Date());
    setTarget(loadTarget());
  }, []);

  // Mount-only: ask the server whether Plaid keys are configured (R14.1, R14.4).
  // The server-only `plaidKeysPresent` lives behind `/api/plaid/status`, which
  // returns only the boolean — the secret never reaches the browser. A failed
  // fetch leaves the default `false`, so the connect entry point stays disabled.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/plaid/status');
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { plaidKeysPresent?: unknown };
        if (active && typeof data.plaidKeysPresent === 'boolean') {
          setPlaidKeysPresent(data.plaidKeysPresent);
        }
      } catch {
        // Leave the safe `false` default; the panel explains the entry point is unavailable.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  /**
   * Single commit path for every mutation (R2.7, R17.5): persist the full set
   * and update state, which re-runs the derivation below. Keeping persistence
   * and the recompute trigger in one place means the editor, the Plaid panel,
   * and every whole-set action all drive the views identically.
   */
  function commitAccounts(next: Account[]): void {
    saveAccounts(next);
    setAccounts(next);
  }

  // Plaid connect (R8.6): replace the institution's Connected_Accounts, carrying
  // matched Split_Overrides and surfacing any that could not be carried (R4.6).
  function handleInstitutionConnected(
    institutionId: string,
    connectedAccounts: Account[],
    institutionName: string,
  ): void {
    const current = accounts ?? [];
    const result: UpsertConnectedResult = upsertConnectedInstitution(
      current,
      institutionId,
      connectedAccounts,
    );
    setDroppedOverrideNote(describeDroppedOverrides(result.droppedOverrides, institutionName));
    commitAccounts(result.accounts);
  }

  // Plaid disconnect (R9.3): remove just that institution's Connected_Accounts.
  function handleDisconnect(institutionId: string): void {
    const current = accounts ?? [];
    setDroppedOverrideNote(null);
    commitAccounts(disconnectInstitution(current, institutionId));
  }

  // Editor / whole-set actions (R2.7): the editor hands us the next set; we
  // clear any stale reconnect note and commit.
  function handleAccountsChange(next: Account[]): void {
    setDroppedOverrideNote(null);
    commitAccounts(next);
  }

  // Persist the validated target and update state so drift/status recompute (R5.4, R5.5).
  function handleSaveTarget(next: TargetAllocation): void {
    saveTarget(next);
    setTarget(next);
  }

  // The whole target-INDEPENDENT derivation, recomputed on every account change
  // and the one-time `now` (R17.5). Validation gates every figure (R17.1/R7.1).
  const derived: DerivedDashboard | null = useMemo(() => {
    if (accounts === null) {
      return null;
    }
    const validation = validateAccounts(accounts);
    if (!validation.ok) {
      return {
        valid: false,
        netWorth: ZERO_NET_WORTH,
        groups: [],
        totals: { stocks: 0, bonds: 0, cash: 0, other: 0 },
        allocation: computeActualAllocation({ stocks: 0, bonds: 0, cash: 0, other: 0 }),
        freshness: { byInstitution: [] },
        waterfallSteps: [],
        sourceMix: [],
      };
    }

    const valid = validation.accounts;
    const netWorth = computeNetWorth(valid);
    const groups = computeInstitutionGroups(valid);
    const totals = computeClassTotals(valid);
    const allocation = computeActualAllocation(totals);
    const freshness = computeFreshness(valid, now);
    const waterfallSteps = computeWaterfall(groups, netWorth);
    const sourceMix = computeSourceMix(valid);

    return {
      valid: true,
      netWorth,
      groups,
      totals,
      allocation,
      freshness,
      waterfallSteps,
      sourceMix,
    };
  }, [accounts, now]);

  // Target-DEPENDENT math (R4.1): drift + on-track status, recomputed when the
  // target or the derived allocation/totals change.
  const drift: DriftResult | null = useMemo(() => {
    if (derived === null || !derived.valid) {
      return null;
    }
    return computeDrift(derived.allocation, derived.totals, target);
  }, [derived, target]);

  const onTrackStatus: OnTrackStatus | null = useMemo(
    () => (drift === null ? null : computeOnTrackStatus(drift)),
    [drift],
  );

  // --- State 1 — Loading (R17.2, R17.3): skeleton, no sample numbers. ---
  if (accounts === null || derived === null) {
    return (
      <div className={className}>
        <LoadingSkeleton />
      </div>
    );
  }

  // --- State 2 — ValidationError (R6.3): defensive; the store guard normally
  // prevents an invalid loaded set, but if one slips through show no figures. ---
  if (!derived.valid) {
    return (
      <div className={className}>
        <ErrorState variant="validation" />
      </div>
    );
  }

  const { netWorth, groups, totals, allocation, freshness, waterfallSteps, sourceMix } = derived;

  // Shared editing surfaces rendered in every non-loading state so the user can
  // always add, edit, connect, or disconnect — even from an empty set.
  const editingSurfaces = (
    <>
      <AccountEditor accounts={accounts} onAccountsChange={handleAccountsChange} />
      <PlaidConnectPanel
        accounts={accounts}
        plaidKeysPresent={plaidKeysPresent}
        onInstitutionConnected={handleInstitutionConnected}
        onDisconnect={handleDisconnect}
      />
    </>
  );

  return (
    <div className={`flex flex-col gap-8 ${className ?? ''}`}>
      {/* Recovery note (R7.4, R7.5) and any dropped-override note (R4.6). */}
      <StorageRecoveryBanner recovery={recovery} />
      {droppedOverrideNote !== null && (
        <div
          role="status"
          className="inline-flex items-start gap-1.5 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        >
          <span aria-hidden="true">&#8505;</span>
          <span>{droppedOverrideNote}</span>
        </div>
      )}

      {/* State 3 — Empty, no accounts (R6.4). */}
      {accounts.length === 0 ? (
        <>
          <NetWorthHeader netWorth={ZERO_NET_WORTH} />
          <EmptyState variant="no-accounts" />
          {editingSurfaces}
        </>
      ) : (
        <>
          {/* Net_Worth_Card: the headline figures plus the Source_Mix_Summary (R1.4). */}
          <section aria-label="Net worth" className="flex flex-col gap-6">
            <NetWorthHeader netWorth={netWorth} />
            <SourceMixSummary sourceMix={sourceMix} />
          </section>

          {/* Per-account rows with Source badge + source-aware freshness (R1.3). */}
          <section aria-label="Your accounts" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Accounts</h2>
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                freshness={computeAccountFreshness(account, now)}
              />
            ))}
          </section>

          {allocation.isZeroTotal ? (
            // State 4 — Empty, zero balances (R6.5): net worth + waterfall render,
            // allocation shows the zero-balances empty state instead of the donut.
            <>
              <section
                aria-labelledby="net-worth-waterfall-heading"
                className="flex flex-col gap-4"
              >
                <h2
                  id="net-worth-waterfall-heading"
                  className="text-lg font-semibold text-slate-900"
                >
                  How your net worth adds up
                </h2>
                <NetWorthWaterfall steps={waterfallSteps} />
              </section>
              <EmptyState variant="zero-balances" />
            </>
          ) : (
            // State 5 — Ready (R6.1): the full dashboard.
            <>
              <section
                aria-labelledby="net-worth-waterfall-heading"
                className="flex flex-col gap-4"
              >
                <h2
                  id="net-worth-waterfall-heading"
                  className="text-lg font-semibold text-slate-900"
                >
                  How your net worth adds up
                </h2>
                <NetWorthWaterfall steps={waterfallSteps} />
              </section>

              {drift !== null && onTrackStatus !== null && (
                <AllocationSection
                  allocation={allocation}
                  drift={drift}
                  onTrackStatus={onTrackStatus}
                  target={target}
                />
              )}
              <TargetEditor currentTarget={target} actual={allocation} onSave={handleSaveTarget} />
            </>
          )}

          {editingSurfaces}
        </>
      )}
    </div>
  );
}

/**
 * Build a plain-language note for any Split_Overrides that a reconnect could not
 * carry onto the freshly fetched accounts (R4.6). Returns `null` when nothing was
 * dropped, so the caller shows no note in the common case.
 */
function describeDroppedOverrides(
  dropped: UpsertConnectedResult['droppedOverrides'],
  institutionName: string,
): string | null {
  if (dropped.length === 0) {
    return null;
  }
  const noun = dropped.length === 1 ? 'allocation adjustment' : 'allocation adjustments';
  return (
    `${dropped.length} ${noun} you'd made no longer match the accounts ${institutionName} ` +
    `returned, so ${dropped.length === 1 ? 'it was' : 'they were'} not carried over. ` +
    `You can re-adjust those accounts if needed.`
  );
}
