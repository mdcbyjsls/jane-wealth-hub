'use client';

/*
 * ProjectionClient — the interactive client island for the Long-Term Wealth
 * Projection view (Spec 2), now the owner of the account lifecycle (R17).
 *
 * Why this is a client component: everything it owns needs the browser. It
 * reads the user's accounts from the browser-only Account_Store (R17.1), fetches
 * the resolved market data from the server-only `/api/market-data` route (the
 * FRED key never reaches the browser), reads the Spec 1 target allocation from
 * the browser-only Target_Store after mount, owns the editable assumptions and
 * the Dollar_Basis toggle, and recomputes the projection via the pure
 * `projection.ts` functions on every change. The server page
 * (`app/projection/page.tsx`) is now a thin shell: it renders the
 * DashboardShell + this island and reads neither the static `data/accounts.json`
 * nor the FRED route. Both the account lifecycle and the market lifecycle live
 * entirely in the island so nothing blocks the page shell.
 *
 * Account lifecycle and SSR consistency (R17.1–R17.5): `localStorage` is
 * browser-only, so the first server render and the first client paint MUST NOT
 * read it — the island therefore starts in an `accounts: 'loading'` state with
 * NO totals/allocation, so no sample numbers (nor any figure derived from the
 * static file) ever appear before the store resolves (R17.3). On mount it calls
 * `loadAccounts()`, runs `validateAccounts` + `computeClassTotals` +
 * `computeActualAllocation` on the result, and derives `totals`/`allocation`
 * into client state (R17.1, R17.4). While that first read is pending the island
 * renders the Spec 1 `LoadingSkeleton` and nothing else (R17.2). The
 * projection view itself does not mutate accounts — editing happens on the
 * dashboard — so a single mount-time load is sufficient; `loadAccountsNow` is a
 * stable callback so the lifecycle could re-run (e.g. on a future focus/mutation
 * subscription) and reflect store changes (R17.5).
 *
 * Account-unavailable (mirrors the old server routing, now store-driven): if the
 * store ever yields an empty account set, there is nothing to project, so the
 * island shows the single account-unavailable state (no values, no chart) via
 * `ProjectionErrorState` with `PROJECTION_MESSAGES.accountError`. This replaces
 * the server page's account validation/error routing from Spec 1/2; the island
 * owns it now. A non-empty load always yields a usable `totals`/`allocation`
 * (the store's `loadAccounts` seeds/falls back to the Sample_Set rather than
 * returning an invalid set), and `validateAccounts` guards the shape defensively.
 *
 * Market/projection state machine (design "Market-data + projection state
 * machine"):
 *   Loading ─▶ Ready (dataSource = live | cache | snapshot)   on a 2xx snapshot
 *   Loading ─▶ RouteError                                     on error / !ok / network
 *   RouteError ─▶ Loading ─▶ Ready                            on user retry
 * The three Ready variants differ only in the banner shown (R9.3, R9.4) and the
 * Data_Source carried on each value; the projection renders identically. The
 * market machine is nested BEHIND the accounts gate: the skeleton (accounts
 * loading) and the account-unavailable state both win over the market machine,
 * because there is no point fetching a projection for accounts we don't have.
 *
 * Target lifecycle and SSR consistency (mirrors DashboardClient): `localStorage`
 * is browser-only, so state is seeded from `DEFAULT_TARGET` (the 60/20/10/10
 * example) for SSR + first-paint agreement, then the persisted target is read
 * in a mount-only effect. Recompute runs whenever the accounts, the market data,
 * the assumptions, the dollar basis, or the target change (R3.3, R5.5, R17.5).
 *
 * Dollar basis (R5.2, R5.5, R5.6, R5.7): nominal is the default. On `today`,
 * each series is converted via `toTodaysDollars` using the Inflation_Rate, with
 * the rate + CPI source shown adjacent (R5.6). When inflation is unavailable the
 * basis stays on nominal and a plain-language message is shown (R5.7).
 *
 * Assumptions recompute is pure and synchronous, so the Dollar_Basis switch and
 * every assumption edit update values and chart well within the 1-second budget
 * (R5.5) without reloading the page.
 *
 * Clock boundary: `currentYear` used to arrive as a server-derived prop. With
 * the page reduced to a thin shell, the island now reads the clock itself in a
 * mount-only effect (never during render/SSR) so the projection horizons stay
 * stable across hydration. The year is read once alongside the account load.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AllocationResult,
  AssetClass,
  ClassTotals,
  TargetAllocation,
} from '@/types/accounts';
import type {
  DollarBasis,
  MarketDataError,
  MarketDataSnapshot,
  ProjectedPoint,
  ReturnModel,
  ScenarioMultipliers,
  ScenarioSeries,
} from '@/types/market';
import {
  ASSET_CLASS_KEYS,
  DEFAULT_EQUITY_RISK_PREMIUM,
  DEFAULT_OTHER_RETURN,
  DEFAULT_SCENARIO_MULTIPLIERS,
  buildScenarios,
  computeBlendedReturn,
  deriveReturnModel,
  toTodaysDollars,
} from '@/lib/calculations/projection';
import { projectByClass } from '@/lib/calculations/projectByClass';
import {
  computeActualAllocation,
  computeClassTotals,
  validateAccounts,
} from '@/lib/calculations/allocation';
import { loadAccounts } from '@/lib/accounts/accountStore';
import { DEFAULT_TARGET, loadTarget } from '@/lib/target/targetStore';
import { formatCurrency } from '@/lib/format';
import { PROJECTION_MESSAGES } from '@/lib/projectionMessages';

import FanChart from '@/components/charts/FanChart';
import GrowthByClassArea from '@/components/charts/GrowthByClassArea';
import AssumptionPanel, {
  type AssumptionValues,
  type EditableField,
} from '@/components/ui/AssumptionPanel';
import DollarBasisToggle from '@/components/ui/DollarBasisToggle';
import MarketDataBanner from '@/components/ui/MarketDataBanner';
import ComparisonSummary from '@/components/ui/ComparisonSummary';
import ProjectionEmptyState from '@/components/ui/ProjectionEmptyState';
import ProjectionErrorState from '@/components/ui/ProjectionErrorState';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The called-out horizons, as year offsets from the current year (R1.4, R4.2). */
const HORIZON_OFFSETS = [10, 20, 30] as const;

/**
 * Documented default Inflation_Rate, in percent per year (R5.3, R5.6).
 *
 * The CPIAUCSL snapshot carries a single index LEVEL, not a year-over-year
 * change, so a usable annual inflation rate cannot be computed from one value.
 * When the CPI value is present we seed the editable Inflation_Rate from this
 * documented, user-editable default (near the long-run CPI trend); it is shown
 * with its CPI source label and is fully editable in the Assumption_Panel. The
 * rate is only treated as UNAVAILABLE when the CPI value itself is missing or
 * non-finite (see `isInflationAvailable`), which triggers the R5.7 fallback.
 */
const DEFAULT_INFLATION_RATE = 2.5;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * The island's market-data lifecycle. `Ready` carries the resolved snapshot;
 * the three Data_Source variants are distinguished by `snapshot.dataSource`.
 */
type MarketState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: MarketDataSnapshot }
  | { status: 'error' };

/**
 * The island's account lifecycle (R17). `loading` is the pre-mount / first-read
 * state in which NO figures derived from any account exist, so the skeleton
 * shows and no sample numbers leak (R17.2, R17.3). `ready` carries the
 * target-independent `totals` + `allocation` computed from the stored accounts
 * (R17.1, R17.4). `unavailable` is the store-driven account-error state (no
 * usable accounts → nothing to project).
 */
type AccountsState =
  | { status: 'loading' }
  | { status: 'ready'; totals: ClassTotals; allocation: AllocationResult }
  | { status: 'unavailable' };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProjectionClientProps {
  /** Extra Tailwind classes merged onto the island container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The Projected_Base per R1.1: the Spec 1 total of all non-liability balances,
 * computed as the sum of the four class dollar totals.
 */
function computeProjectedBase(totals: ClassTotals): number {
  let sum = 0;
  for (const key of ASSET_CLASS_KEYS) {
    sum += totals[key];
  }
  return sum;
}

/** Convert a per-class percentage map (0–100) into fractions (0–1) for blending. */
function toFractions(percentages: Record<AssetClass, number>): Record<AssetClass, number> {
  const fractions = { stocks: 0, bonds: 0, cash: 0, other: 0 } as Record<AssetClass, number>;
  for (const key of ASSET_CLASS_KEYS) {
    fractions[key] = percentages[key] / 100;
  }
  return fractions;
}

/**
 * Inflation is available (R5.7) only when the CPI snapshot value is a finite
 * number. A single CPI index level cannot yield a YoY rate, so the rate itself
 * is a documented editable default — but if the CPI value is missing/non-finite
 * we cannot source the inflation assumption at all and the today's-dollars
 * conversion must fall back to nominal.
 */
function isInflationAvailable(snapshot: MarketDataSnapshot): boolean {
  return Number.isFinite(snapshot.cpi.value);
}

/** Format an ISO date string (e.g. "2026-10-14") as an unambiguous calendar date. */
function formatAsOf(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

/**
 * The last-updated date shown in the MarketDataBanner. For a snapshot fallback
 * this is the most recent `asOf` among the three series (R9.3); for the cache
 * note it is likewise the freshest market value's date (R9.4).
 */
function mostRecentAsOf(snapshot: MarketDataSnapshot): string {
  const isoDates = [snapshot.cpi.asOf, snapshot.tenYear.asOf, snapshot.threeMonth.asOf];
  const newest = isoDates.reduce((latest, candidate) =>
    candidate > latest ? candidate : latest,
  );
  return formatAsOf(newest);
}

/** The initial, default assumptions before any market data resolves. */
function initialAssumptions(): AssumptionValues {
  return {
    equityRiskPremium: DEFAULT_EQUITY_RISK_PREMIUM,
    otherReturn: DEFAULT_OTHER_RETURN,
    inflationRate: DEFAULT_INFLATION_RATE,
    multipliers: { ...DEFAULT_SCENARIO_MULTIPLIERS },
    annualContribution: 0,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectionClient({
  className,
}: ProjectionClientProps): React.ReactElement {
  // Account lifecycle (R17): starts in `loading` so SSR + first paint show the
  // skeleton and never a figure derived from the static file (R17.2, R17.3).
  const [accountsState, setAccountsState] = useState<AccountsState>({ status: 'loading' });

  // The current calendar year. Seeded to 0 and read from the clock only after
  // mount (never during render/SSR) so the server and first client paint agree;
  // the projection stays in the skeleton until the mount load resolves this.
  const [currentYear, setCurrentYear] = useState<number>(0);

  // Market-data lifecycle (Loading → Ready | RouteError, with retry).
  const [marketState, setMarketState] = useState<MarketState>({ status: 'loading' });

  // Editable assumptions. Retained across a market-data error so a retry never
  // discards the user's edits (R10.2).
  const [assumptions, setAssumptions] = useState<AssumptionValues>(initialAssumptions);

  // Dollar_Basis — nominal is the default on initial load (R5.1).
  const [dollarBasis, setDollarBasis] = useState<DollarBasis>('nominal');

  // Target allocation: seed from the example default for SSR consistency, then
  // read the persisted value after mount (mirrors DashboardClient).
  const [target, setTarget] = useState<TargetAllocation>(DEFAULT_TARGET);
  const [hasLoadedTarget, setHasLoadedTarget] = useState<boolean>(false);

  useEffect(() => {
    setTarget(loadTarget());
    setHasLoadedTarget(true);
  }, []);

  // Read the stored accounts and derive the target-independent figures (R17.1,
  // R17.4). Defensive end to end: `loadAccounts` never throws and always yields
  // a usable set (seeding/falling back to the Sample_Set when nothing valid is
  // stored), and `validateAccounts` guards the shape before any number is
  // computed. An empty set — or a set the calculator rejects — resolves to the
  // account-unavailable state (nothing to project). Declared as a stable
  // callback so the lifecycle can be re-run to reflect store mutations (R17.5);
  // the projection view does not mutate accounts itself (editing happens on the
  // dashboard), so a mount-time load is sufficient here.
  const loadAccountsNow = useCallback((): void => {
    const { accounts } = loadAccounts();
    if (accounts.length === 0) {
      setAccountsState({ status: 'unavailable' });
      return;
    }
    const validation = validateAccounts(accounts);
    if (!validation.ok) {
      setAccountsState({ status: 'unavailable' });
      return;
    }
    const totals = computeClassTotals(validation.accounts);
    const allocation = computeActualAllocation(totals);
    setAccountsState({ status: 'ready', totals, allocation });
  }, []);

  // Mount-only: read the browser-only clock and the stored accounts. Runs after
  // hydration so neither affects the server render (R17.2, R17.3).
  useEffect(() => {
    setCurrentYear(new Date().getFullYear());
    loadAccountsNow();
  }, [loadAccountsNow]);

  // Fetch the resolved market data from the server-only route. A 2xx snapshot
  // → Ready with its dataSource; any error / !ok / network fault → RouteError
  // (R10.1, R10.2, R10.4). Declared as a stable callback so the retry control
  // and the mount effect share one implementation.
  const loadMarketData = useCallback(async (): Promise<void> => {
    setMarketState({ status: 'loading' });
    try {
      const response = await fetch('/api/market-data');
      if (!response.ok) {
        setMarketState({ status: 'error' });
        return;
      }
      const body: MarketDataSnapshot | MarketDataError = await response.json();
      if ('ok' in body && body.ok === false) {
        setMarketState({ status: 'error' });
        return;
      }
      setMarketState({ status: 'ready', snapshot: body as MarketDataSnapshot });
    } catch {
      // Network fault or unparseable body → treat as unavailable (R10.2).
      setMarketState({ status: 'error' });
    }
  }, []);

  // Kick off the initial fetch on mount.
  useEffect(() => {
    void loadMarketData();
  }, [loadMarketData]);

  // The target-independent figures once the store has resolved them (R17.4).
  // Before accounts load (or when unavailable) these are null, and the accounts
  // gate below renders the skeleton / account-error state instead of any figure
  // — so the memos that read them never produce sample numbers (R17.2, R17.3).
  const accountsReady = accountsState.status === 'ready' ? accountsState : null;
  const totals: ClassTotals | null = accountsReady ? accountsReady.totals : null;
  const allocation: AllocationResult | null = accountsReady ? accountsReady.allocation : null;

  // Projected_Base (R1.1) — target-independent, so derived once from totals.
  // Zero when accounts haven't resolved; the accounts gate suppresses render
  // in that window so the value is never shown.
  const projectedBase = useMemo(
    () => (totals === null ? 0 : computeProjectedBase(totals)),
    [totals],
  );
  const isZeroBase = projectedBase === 0;

  // The derived Return_Model (R2.1–R2.5). Only meaningful once market data is
  // ready; null otherwise so the render gate below suppresses figures/chart.
  const returnModel: ReturnModel | null = useMemo(() => {
    if (marketState.status !== 'ready') {
      return null;
    }
    return deriveReturnModel(marketState.snapshot, {
      equityRiskPremium: assumptions.equityRiskPremium,
      otherReturn: assumptions.otherReturn,
    });
  }, [marketState, assumptions.equityRiskPremium, assumptions.otherReturn]);

  // Whether inflation can be sourced for the today's-dollars conversion (R5.7).
  const inflationAvailable =
    marketState.status === 'ready' && isInflationAvailable(marketState.snapshot);

  // The EFFECTIVE basis: honor the user's choice unless they asked for today's
  // dollars while inflation is unavailable, in which case we stay on nominal
  // (R5.7). The message below is shown whenever that override is in effect.
  const effectiveBasis: DollarBasis =
    dollarBasis === 'today' && !inflationAvailable ? 'nominal' : dollarBasis;
  const showInflationUnavailable = dollarBasis === 'today' && !inflationAvailable;

  // The computed scenario series for the current and target allocations, in the
  // active Dollar_Basis. Recomputes on any market/assumption/basis/target change
  // (R3.3, R5.5). Pure functions, so this is cheap and synchronous (< 1s, R5.5).
  const projection = useMemo(() => {
    if (returnModel === null || allocation === null) {
      return null;
    }
    const multipliers: ScenarioMultipliers = assumptions.multipliers;
    const contribution = assumptions.annualContribution;

    const currentFractions = toFractions(allocation.percentages);
    const targetFractions = toFractions({
      stocks: target.stocks,
      bonds: target.bonds,
      cash: target.cash,
      other: target.other,
    });

    const blendedCurrent = computeBlendedReturn(currentFractions, returnModel);
    const blendedTarget = computeBlendedReturn(targetFractions, returnModel);

    let current = buildScenarios(
      projectedBase,
      blendedCurrent,
      multipliers,
      contribution,
      currentYear,
    );
    let targetSeries = buildScenarios(
      projectedBase,
      blendedTarget,
      multipliers,
      contribution,
      currentYear,
    );

    // Convert to today's dollars only when the EFFECTIVE basis is `today`
    // (i.e. the user asked for it AND inflation is available) (R5.2, R5.3, R5.7).
    if (effectiveBasis === 'today') {
      const infl = assumptions.inflationRate;
      current = {
        base: toTodaysDollars(current.base, infl, currentYear),
        optimistic: toTodaysDollars(current.optimistic, infl, currentYear),
        pessimistic: toTodaysDollars(current.pessimistic, infl, currentYear),
      };
      targetSeries = {
        base: toTodaysDollars(targetSeries.base, infl, currentYear),
        optimistic: toTodaysDollars(targetSeries.optimistic, infl, currentYear),
        pessimistic: toTodaysDollars(targetSeries.pessimistic, infl, currentYear),
      };
    }

    return { current, target: targetSeries };
  }, [
    returnModel,
    assumptions.multipliers,
    assumptions.annualContribution,
    assumptions.inflationRate,
    allocation,
    target,
    projectedBase,
    currentYear,
    effectiveBasis,
  ]);

  // The per-class "if you never rebalance" series (R6.3, R6.4). Each Asset_Class
  // is projected independently at its own Expected_Return from its own starting
  // dollars via `projectByClass`. When the EFFECTIVE basis is `today` we apply
  // the SAME today's-dollars discounting used for the fan series above, so the
  // two charts stay in one consistent basis as the toggle flips (R6.5).
  const perClassSeries = useMemo<Record<AssetClass, ProjectedPoint[]> | null>(() => {
    if (returnModel === null || allocation === null) {
      return null;
    }
    const nominal = projectByClass(allocation.classDollars, returnModel, currentYear);
    if (effectiveBasis !== 'today') {
      return nominal;
    }
    const infl = assumptions.inflationRate;
    const discounted = {} as Record<AssetClass, ProjectedPoint[]>;
    for (const key of ASSET_CLASS_KEYS) {
      discounted[key] = toTodaysDollars(nominal[key], infl, currentYear);
    }
    return discounted;
  }, [
    returnModel,
    allocation,
    currentYear,
    effectiveBasis,
    assumptions.inflationRate,
  ]);

  // Commit a single valid assumption edit from the panel (R3.3).
  const handleCommit = useCallback((field: EditableField, value: number): void => {
    setAssumptions((prev) => {
      switch (field) {
        case 'equityRiskPremium':
          return { ...prev, equityRiskPremium: value };
        case 'otherReturn':
          return { ...prev, otherReturn: value };
        case 'inflationRate':
          return { ...prev, inflationRate: value };
        case 'optimisticMultiplier':
          return { ...prev, multipliers: { ...prev.multipliers, optimistic: value } };
        case 'pessimisticMultiplier':
          return { ...prev, multipliers: { ...prev.multipliers, pessimistic: value } };
        case 'annualContribution':
          return { ...prev, annualContribution: value };
        default: {
          const exhaustive: never = field;
          return exhaustive;
        }
      }
    });
  }, []);

  // Reset every assumption to its documented/market-derived default (R3.6).
  const handleReset = useCallback((): void => {
    setAssumptions(initialAssumptions());
  }, []);

  // The active-basis label used in the chart's text alternative (R5.4).
  const basisLabel = effectiveBasis === 'today' ? "today's dollars" : 'future dollars';

  // Accounts gate (R17.2, R17.3): while the stored accounts are loading — which
  // includes the SSR + first-paint window, since `localStorage` is browser-only
  // — show the Spec 1 loading skeleton and NOTHING else. No figure derived from
  // the static file (or any sample number) is ever on screen before the store
  // resolves. This gate sits in front of the market machine: there is no point
  // showing a projection for accounts we don't yet have.
  if (accountsState.status === 'loading') {
    return (
      <div className={`flex flex-col gap-8 ${className ?? ''}`}>
        <LoadingSkeleton />
      </div>
    );
  }

  // Account-unavailable (store-driven): no usable accounts → nothing to project.
  // Mirrors the old server-side account-error routing; the island owns it now.
  // Shows no projected values and no chart (ProjectionErrorState renders neither).
  if (accountsState.status === 'unavailable') {
    return (
      <div className={`flex flex-col gap-8 ${className ?? ''}`}>
        <ProjectionErrorState message={PROJECTION_MESSAGES.accountError} />
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-8 ${className ?? ''}`}
      // Advisory busy cue during the brief first-paint window before the
      // persisted target resolves (mirrors DashboardClient). Content still
      // renders from the example default, so nothing is hidden.
      aria-busy={hasLoadedTarget ? undefined : true}
    >
      {/* Loading: no figures, no chart, just the plain-language indication (R10.1). */}
      {marketState.status === 'loading' ? (
        <div role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-slate-600">
          <p className="text-sm">{PROJECTION_MESSAGES.loading}</p>
        </div>
      ) : null}

      {/* RouteError: no figures, no chart; assumptions retained; retry offered (R10.2, R10.4). */}
      {marketState.status === 'error' ? (
        <ProjectionErrorState
          message={PROJECTION_MESSAGES.routeError}
          onRetry={() => void loadMarketData()}
        />
      ) : null}

      {/* Ready: the full projection. */}
      {marketState.status === 'ready' && returnModel !== null && projection !== null ? (
        <>
          {/* Freshness banner/note for cache + snapshot; nothing for live (R9.3, R9.4). */}
          <MarketDataBanner
            dataSource={marketState.snapshot.dataSource}
            lastUpdated={mostRecentAsOf(marketState.snapshot)}
          />

          {/* Dollar_Basis toggle (R5.1, R5.4, R5.5). */}
          <DollarBasisToggle value={dollarBasis} onChange={setDollarBasis} />

          {/* Inflation adjustment couldn't be applied → stayed on nominal (R5.7). */}
          {showInflationUnavailable ? (
            <p
              role="status"
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              {PROJECTION_MESSAGES.inflationUnavailable}
            </p>
          ) : null}

          {/* When today's dollars is active, show the rate + CPI source adjacent (R5.6). */}
          {effectiveBasis === 'today' ? (
            <p className="text-xs text-slate-500 tabular-nums">
              {`Values shown in today's dollars using an inflation rate of ${assumptions.inflationRate}% per year (CPI, as of ${formatAsOf(marketState.snapshot.cpi.asOf)}).`}
            </p>
          ) : null}

          {/* Zero base: $0 at every horizon + the no-assets note (R1.6). */}
          {isZeroBase ? (
            <>
              <ProjectionEmptyState />
              <HorizonCallouts
                current={projection.current}
                basisLabel={basisLabel}
              />
            </>
          ) : (
            <>
              {/* Horizon call-outs: labeled ranges pessimistic→optimistic, base within (R1.4, R4.2, R4.4). */}
              <HorizonCallouts
                current={projection.current}
                basisLabel={basisLabel}
              />

              {/* The fan chart: shaded pessimistic→optimistic band + base line,
                  labeled 10/20/30 markers, current (solid navy) + target
                  (dashed teal) overlays (R6.1, R6.2, R4.3, R7.3). */}
              <FanChart
                current={projection.current}
                target={projection.target}
                projectedBase={projectedBase}
                basisLabel={basisLabel}
              />

              {/* Signed current-vs-target differences in the active basis (R7.5, R7.6). */}
              <ComparisonSummary
                current={projection.current}
                target={projection.target}
                isExample={target.isExample}
              />

              {/* "If you never rebalance" — each class grown independently at its
                  own expected return, in the same active Dollar_Basis as the fan
                  above (R6.3, R6.4, R6.5). Stacked below the fan, single column. */}
              {perClassSeries !== null ? (
                <GrowthByClassArea series={perClassSeries} basisLabel={basisLabel} />
              ) : null}
            </>
          )}

          {/* Every assumption, visible / sourced / editable (R3.1–R3.6). */}
          <AssumptionPanel
            values={assumptions}
            returnModel={returnModel}
            inflationAsOf={formatAsOf(marketState.snapshot.cpi.asOf)}
            onCommit={handleCommit}
            onReset={handleReset}
          />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizon call-outs (R1.4, R1.5, R4.2, R4.4)
// ---------------------------------------------------------------------------

/**
 * The year-10/20/30 call-outs. Each horizon is labeled with its year and shown
 * as a RANGE from the pessimistic value to the optimistic value, with the base
 * value shown within the band (R4.4, R1.4). All figures are whole-dollar USD
 * with tabular numerals (R1.5, R4.2). Values are already in the active
 * Dollar_Basis (the caller converts before passing them in).
 */
function HorizonCallouts({
  current,
  basisLabel,
}: {
  current: ScenarioSeries;
  basisLabel: string;
}): React.ReactElement {
  const firstYear = current.base[0]?.year ?? 0;

  const valueAt = (points: ScenarioSeries['base'], offset: number): number | null => {
    const point = points.find((p) => p.year === firstYear + offset);
    return point === undefined ? null : point.value;
  };

  return (
    <section
      aria-label={`Projected wealth ranges at years 10, 20, and 30 in ${basisLabel}`}
      className="grid grid-cols-1 gap-4 sm:grid-cols-3"
    >
      {HORIZON_OFFSETS.map((offset) => {
        const base = valueAt(current.base, offset);
        const optimistic = valueAt(current.optimistic, offset);
        const pessimistic = valueAt(current.pessimistic, offset);

        return (
          <div
            key={offset}
            className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-5"
          >
            <span className="text-sm font-medium text-slate-500">{`Year ${offset}`}</span>
            {base === null || optimistic === null || pessimistic === null ? (
              <span className="text-base font-normal text-slate-500">Not available</span>
            ) : (
              <>
                {/* Base is the largest, most prominent figure on the card (ui-style). */}
                <span className="text-2xl font-bold text-slate-900 tabular-nums">
                  {formatCurrency(base)}
                </span>
                {/* The range, labeled pessimistic→optimistic rather than a single point (R4.4). */}
                <span className="text-sm font-normal text-slate-600 tabular-nums">
                  {`Range: ${formatCurrency(pessimistic)} to ${formatCurrency(optimistic)}`}
                </span>
                <span className="text-xs font-normal text-slate-400">
                  Pessimistic to optimistic, base shown above
                </span>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
