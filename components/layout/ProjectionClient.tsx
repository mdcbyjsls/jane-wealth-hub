'use client';

/*
 * ProjectionClient — the interactive client island for the Long-Term Wealth
 * Projection view (Spec 2).
 *
 * Why this is a client component: everything it owns needs the browser. It
 * fetches the resolved market data from the server-only `/api/market-data`
 * route (the FRED key never reaches the browser), reads the Spec 1 target
 * allocation from the browser-only Target_Store after mount, owns the editable
 * assumptions and the Dollar_Basis toggle, and recomputes the projection via
 * the pure `projection.ts` functions on every change. The server page
 * (`app/projection/page.tsx`, Task 11.1) resolves the target-INDEPENDENT
 * account data and hands this island serializable props; it does NOT fetch
 * market data — that stays here against the server-only route so the loading
 * and error states live entirely in the island without blocking the page shell.
 *
 * Market/projection state machine (design "Market-data + projection state
 * machine"):
 *   Loading ─▶ Ready (dataSource = live | cache | snapshot)   on a 2xx snapshot
 *   Loading ─▶ RouteError                                     on error / !ok / network
 *   RouteError ─▶ Loading ─▶ Ready                            on user retry
 * The three Ready variants differ only in the banner shown (R9.3, R9.4) and the
 * Data_Source carried on each value; the projection renders identically. The
 * AccountError state (R10.3/R10.6) is decided on the server before this island
 * renders, so it is not part of this machine.
 *
 * Target lifecycle and SSR consistency (mirrors DashboardClient): `localStorage`
 * is browser-only, so state is seeded from `DEFAULT_TARGET` (the 60/20/10/10
 * example) for SSR + first-paint agreement, then the persisted target is read
 * in a mount-only effect. Recompute runs whenever the market data, the
 * assumptions, the dollar basis, or the target change (R3.3, R5.5).
 *
 * Dollar basis (R5.2, R5.5, R5.6, R5.7): nominal is the default. On `today`,
 * each series is converted via `toTodaysDollars` using the Inflation_Rate, with
 * the rate + CPI source shown adjacent (R5.6). When inflation is unavailable the
 * basis stays on nominal and a plain-language message is shown (R5.7).
 *
 * Assumptions recompute is pure and synchronous, so the Dollar_Basis switch and
 * every assumption edit update values and chart well within the 1-second budget
 * (R5.5) without reloading the page.
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
import { DEFAULT_TARGET, loadTarget } from '@/lib/target/targetStore';
import { formatCurrency } from '@/lib/format';
import { PROJECTION_MESSAGES } from '@/lib/projectionMessages';

import ProjectionChart from '@/components/charts/ProjectionChart';
import AssumptionPanel, {
  type AssumptionValues,
  type EditableField,
} from '@/components/ui/AssumptionPanel';
import DollarBasisToggle from '@/components/ui/DollarBasisToggle';
import MarketDataBanner from '@/components/ui/MarketDataBanner';
import ComparisonSummary from '@/components/ui/ComparisonSummary';
import ProjectionEmptyState from '@/components/ui/ProjectionEmptyState';
import ProjectionErrorState from '@/components/ui/ProjectionErrorState';

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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProjectionClientProps {
  /**
   * The current actual allocation from Spec 1 (target-independent), carrying the
   * per-class percentages used to derive the current blended return.
   */
  allocation: AllocationResult;
  /**
   * The per-class dollar totals from Spec 1. The Projected_Base is the sum of
   * the four class totals — the Spec 1 total of all non-liability balances (R1.1).
   */
  totals: ClassTotals;
  /** The current calendar year, derived on the server at the boundary (no clock read here). */
  currentYear: number;
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
  allocation,
  totals,
  currentYear,
  className,
}: ProjectionClientProps): React.ReactElement {
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

  // Projected_Base (R1.1) — target-independent, so derived once from totals.
  const projectedBase = useMemo(() => computeProjectedBase(totals), [totals]);
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
    if (returnModel === null) {
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
    allocation.percentages,
    target,
    projectedBase,
    currentYear,
    effectiveBasis,
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

              {/* The band chart: current + target bands (R4.3, R7.3). */}
              <ProjectionChart
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
