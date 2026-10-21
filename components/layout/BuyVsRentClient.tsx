'use client';

/*
 * BuyVsRentClient — the interactive client island for the Buy-vs-Rent Scenario
 * Tester (Spec 3), the product hero feature.
 *
 * Why this is a client component: everything it owns needs the browser. It
 * fetches the resolved market data from the server-only `/api/market-data`
 * route (the FRED key never reaches the browser), seeds the editable
 * assumptions with market-derived defaults once the snapshot resolves, owns the
 * Dollar_Basis toggle, and recomputes the comparison via the pure
 * `buyVsRent.ts` `computeComparison` on every change.
 *
 * Account lifecycle (Task 18.3, R17.1–R17.5): the Starting_Assets no longer
 * arrive as server props. On mount this island reads the user's account set
 * from the browser-only Account_Store (`loadAccounts`), validates it, and
 * derives the per-class `totals` (Starting_Assets, R2.1) and the actual
 * `allocation` (Current_Allocation) with the same pure calculators the server
 * used to call. While that read is pending the island shows the Spec 1
 * `LoadingSkeleton` and renders NO figures — so sample numbers never flash
 * before the store resolves (R17.2, R17.3). An empty or unreadable store routes
 * to the single account-unavailable state (R12.3). Because the computed
 * `totals`/`allocation` are plain `useMemo` derivations of the loaded accounts,
 * any future store mutation that re-runs the load re-derives them and the whole
 * comparison recomputes (R17.5). SSR consistency: the initial accounts state is
 * `loading` (never the static file), matching the server render.
 *
 * The server page (`app/buy-vs-rent/page.tsx`) is now a thin shell: it renders
 * the DashboardShell and this island behind its error boundary, and hands down
 * only the serializable `currentYear`. It does NOT read `data/accounts.json`,
 * compute anything, or fetch market data — the account read happens here against
 * the browser store and the market read happens here against the server-only
 * route, so every loading and error state lives entirely in the island without
 * blocking the page shell.
 *
 * Market/comparison state machine (design "Market-data + comparison state
 * machine"), mirroring ProjectionClient exactly:
 *   Loading ─▶ Ready (dataSource = live | cache | snapshot)   on a 2xx snapshot
 *   Loading ─▶ RouteError                                     on error / !ok / network
 *   RouteError ─▶ Loading ─▶ Ready                            on user retry
 * The three Ready variants differ only in the banner shown (R11.5, R11.6) and
 * the dataSource carried on the snapshot; the comparison renders identically.
 * The AccountError state (R12.3) is decided on the server before this island
 * renders, so it is not part of this machine. The AccountError state (R12.3)
 * now belongs to the island's account lifecycle (above), which gates this
 * market machine: an account-unavailable store wins and this machine is never
 * reached. The over-budget purchase (R3.6) and inflation-unavailable (R10.6)
 * cases are Ready SUB-states, not machine errors: the comparison still renders.
 *
 * Seeding (R11.4): once a snapshot resolves, the editable BuyVsRentAssumptions
 * are seeded with market-derived defaults — Mortgage_Rate directly from
 * MORTGAGE30US, and Home_Appreciation_Rate / Rent_Growth_Rate from documented
 * default rates sourced to CSUSHPINSA / CUSR0000SEHA (a single index level can't
 * yield a year-over-year rate, exactly as ProjectionClient handles the CPI
 * Inflation_Rate). The remaining assumptions use documented defaults. Seeding
 * runs once per resolved snapshot and never stomps the user's subsequent edits.
 *
 * Dollar basis (R10): nominal is the default. On `today`, each nominal band
 * series (and the year-10 figures, the verdict dollar gap, and the cushion
 * figures) is converted to today's dollars via the Spec 2 discounting, using the
 * documented Inflation_Rate. When inflation is unavailable (the CPI value is
 * missing/non-finite) the basis stays on nominal and a plain-language message is
 * shown (R10.6).
 *
 * Recompute is pure and synchronous, so the Dollar_Basis switch and every
 * assumption edit update values, chart, and verdict well within the 1-second
 * budget (R9.3, R10.5) without reloading the page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Account,
  AllocationResult,
  AssetClass,
  ClassTotals,
} from '@/types/accounts';
import type {
  DollarBasis,
  MarketDataError,
  MarketDataSnapshot,
} from '@/types/market';
import type {
  BuyVsRentAssumptions,
  ComparisonBands,
  ComparisonResult,
  PathBands,
  VerdictFigures,
  Year10Composition,
} from '@/types/buyVsRent';
import {
  ASSET_CLASS_KEYS,
  buildBands,
  computeComparison,
  computeVerdict,
  findBreakevenYear,
} from '@/lib/calculations/buyVsRent';
import {
  computeActualAllocation,
  computeClassTotals,
  validateAccounts,
} from '@/lib/calculations/allocation';
import { loadAccounts } from '@/lib/accounts/accountStore';
import { computeYear10Composition } from '@/lib/calculations/composition';
import { computeTornado } from '@/lib/calculations/sensitivityTornado';
import { DEFAULT_SCENARIO_MULTIPLIERS } from '@/lib/calculations/projection';
import {
  BUY_VS_RENT_MESSAGES,
  verdict as verdictSentence,
  cacheNote,
  snapshotBanner,
} from '@/lib/buyVsRentMessages';
import { formatCurrency } from '@/lib/format';

import TwoPathChart from '@/components/charts/TwoPathChart';
import CompositionBars from '@/components/charts/CompositionBars';
import SensitivityTornado from '@/components/charts/SensitivityTornado';
import SliderStrip from '@/components/ui/SliderStrip';
import BuyVsRentAssumptionPanel, {
  type EditableField,
} from '@/components/ui/BuyVsRentAssumptionPanel';
import BuyVsRentComparisonSummary, {
  type Year10PathFigures,
} from '@/components/ui/BuyVsRentComparisonSummary';
import DollarBasisToggle from '@/components/ui/DollarBasisToggle';
import MarketDataBanner from '@/components/ui/MarketDataBanner';
import VerdictCard from '@/components/ui/VerdictCard';
import SensitivityCard from '@/components/ui/SensitivityCard';
import AllocationShiftCard from '@/components/ui/AllocationShiftCard';
import CushionCard from '@/components/ui/CushionCard';
import BuyVsRentErrorState from '@/components/ui/BuyVsRentErrorState';
import RentAssumptionNote from '@/components/ui/RentAssumptionNote';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';

// ---------------------------------------------------------------------------
// Constants (documented defaults — R11.4, R9.1)
// ---------------------------------------------------------------------------

/** The fixed comparison horizon, in whole years: year-10 figures live at index 10. */
const HORIZON = 10;

/**
 * Documented default Inflation_Rate, in percent per year (R10.3, R10.6).
 *
 * Mirrors ProjectionClient: the CPIAUCSL snapshot carries a single index LEVEL,
 * not a year-over-year change, so a usable annual inflation rate cannot be
 * computed from one value. When the CPI value is present we discount today's
 * dollars with this documented default. The rate is treated as UNAVAILABLE only
 * when the CPI value itself is missing/non-finite (see `isInflationAvailable`),
 * which triggers the R10.6 nominal fallback.
 */
const DEFAULT_INFLATION_RATE = 2.5;

/**
 * Documented default Home_Appreciation_Rate, percent per year (R11.4). A single
 * CSUSHPINSA index level can't yield a YoY rate, so the editable default is this
 * documented value, shown in the Assumption_Panel with its CSUSHPINSA source
 * label (same pattern as the Inflation_Rate's CPI handling).
 */
const DEFAULT_HOME_APPRECIATION_RATE = 4.0;

/**
 * Documented default Rent_Growth_Rate, percent per year (R11.4). As with
 * appreciation, a single CUSR0000SEHA index level can't yield a YoY rate, so the
 * editable default is this documented value, sourced to CUSR0000SEHA.
 */
const DEFAULT_RENT_GROWTH_RATE = 3.0;

/** The Spec 2 return assumptions used to derive the blended Investment_Return (R2.7). */
const DEFAULT_RETURN_ASSUMPTIONS = {
  equityRiskPremium: 4.0,
  otherReturn: 4.0,
} as const;

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
 * The island's account lifecycle (Task 18.3, R17.1–R17.3), running IN FRONT of
 * the market machine above. `loading` is the initial, SSR-consistent state (no
 * figures, no sample numbers); `ready` carries the validated account set the
 * Starting_Assets are derived from; `error` is the single account-unavailable
 * route for an empty or unreadable store (R12.3).
 */
type AccountsState =
  | { status: 'loading' }
  | { status: 'ready'; accounts: Account[] }
  | { status: 'error' };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BuyVsRentClientProps {
  /** The current calendar year, derived on the server at the boundary (no clock read here). */
  currentYear: number;
  /** Extra Tailwind classes merged onto the island container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a per-class percentage map (0–100) into fractions (0–1) for blending. */
function toFractions(
  percentages: Record<AssetClass, number>,
): Record<AssetClass, number> {
  const fractions = { stocks: 0, bonds: 0, cash: 0, other: 0 } as Record<
    AssetClass,
    number
  >;
  for (const key of ASSET_CLASS_KEYS) {
    fractions[key] = percentages[key] / 100;
  }
  return fractions;
}

/**
 * Inflation is available (R10.6) only when the CPI snapshot value is a finite
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
 * this is the most recent `asOf` among the six series (R11.5); for the cache
 * note it is likewise the freshest market value's date (R11.6).
 */
function mostRecentAsOf(snapshot: MarketDataSnapshot): string {
  const isoDates = [
    snapshot.cpi.asOf,
    snapshot.tenYear.asOf,
    snapshot.threeMonth.asOf,
    snapshot.mortgageRate.asOf,
    snapshot.homePriceIndex.asOf,
    snapshot.rentIndex.asOf,
  ];
  const newest = isoDates.reduce((latest, candidate) =>
    candidate > latest ? candidate : latest,
  );
  return formatAsOf(newest);
}

/**
 * Seed the editable assumptions with market-derived defaults once a snapshot
 * resolves (R11.4). Mortgage_Rate comes straight from MORTGAGE30US; the
 * appreciation and rent-growth rates use documented defaults (sourced to
 * CSUSHPINSA / CUSR0000SEHA in the panel). Everything else is a documented
 * default. Falls back to a documented mortgage rate if MORTGAGE30US is
 * missing/non-finite so the comparison always has a usable rate.
 */
function seedAssumptions(snapshot: MarketDataSnapshot): BuyVsRentAssumptions {
  const mortgageRatePercent = Number.isFinite(snapshot.mortgageRate.value)
    ? snapshot.mortgageRate.value
    : 6.5;

  return {
    homePrice: 500_000,
    downPaymentPercent: 20,
    mortgageRatePercent,
    mortgageTermYears: 30,
    propertyTaxRatePercent: 1.1,
    homeownersInsurance: 1_800,
    maintenanceRatePercent: 1,
    hoaMonthly: 0,
    closingCosts: 12_000,
    sellingCostPercent: 6,
    homeAppreciationRatePercent: DEFAULT_HOME_APPRECIATION_RATE,
    currentRentMonthly: 2_400,
    rentGrowthRatePercent: DEFAULT_RENT_GROWTH_RATE,
    rentersInsurance: 240,
    cushionMonths: 6,
    multipliers: { ...DEFAULT_SCENARIO_MULTIPLIERS },
  };
}

/**
 * Discount a nominal year-indexed series (index 0..10 = year offset from
 * `currentYear`) to today's dollars (R10.3). Mirrors the Spec 2
 * `toTodaysDollars` discount `value / (1 + inflation/100)^offset`, but operates
 * on the plain `number[]` the bands carry rather than `ProjectedPoint[]`: the
 * array index IS the year offset, so no calendar year is needed.
 */
function discountSeries(series: number[], inflationRatePercent: number): number[] {
  const factor = 1 + inflationRatePercent / 100;
  return series.map((value, offset) => value / factor ** offset);
}

/** Discount every band of one path to today's dollars (R10.3). */
function discountPathBands(bands: PathBands, inflationRatePercent: number): PathBands {
  return {
    base: discountSeries(bands.base, inflationRatePercent),
    optimistic: discountSeries(bands.optimistic, inflationRatePercent),
    pessimistic: discountSeries(bands.pessimistic, inflationRatePercent),
  };
}

/** Discount both paths' bands to today's dollars (R10.3). */
function discountBands(
  bands: ComparisonBands,
  inflationRatePercent: number,
): ComparisonBands {
  return {
    buy: discountPathBands(bands.buy, inflationRatePercent),
    rent: discountPathBands(bands.rent, inflationRatePercent),
  };
}

/** A single value's year-10 today's-dollars discount (R10.3). */
function discountYear10(value: number, inflationRatePercent: number): number {
  const factor = 1 + inflationRatePercent / 100;
  return value / factor ** HORIZON;
}

/**
 * Discount the year-10 Composition components to today's dollars (R10.3). Every
 * segment is a year-10 figure, so each uses the same {@link discountYear10}
 * factor the bands' year-10 values get — keeping Composition_Bars consistent
 * with the Two_Path_Chart when today's dollars is active.
 */
function discountComposition(
  composition: Year10Composition,
  inflationRatePercent: number,
): Year10Composition {
  const d = (value: number) => discountYear10(value, inflationRatePercent);
  const buyHomeEquity = d(composition.buy.homeEquity);
  const buySideInvestments = d(composition.buy.sideInvestments);
  const rentInvestments = d(composition.rent.investments);
  return {
    buy: {
      homeEquity: buyHomeEquity,
      sideInvestments: buySideInvestments,
      total: buyHomeEquity + buySideInvestments,
    },
    rent: {
      investments: rentInvestments,
      total: rentInvestments,
    },
  };
}

/** Pull the year-10 base/optimistic/pessimistic figures for one path's bands. */
function year10Figures(bands: PathBands): Year10PathFigures {
  return {
    base: bands.base[HORIZON],
    optimistic: bands.optimistic[HORIZON],
    pessimistic: bands.pessimistic[HORIZON],
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BuyVsRentClient({
  currentYear,
  className,
}: BuyVsRentClientProps): React.ReactElement {
  // `currentYear` is a serializable prop (never read from the clock here) so the
  // comparison stays deterministic across the server→client bridge. It is not
  // needed by the year-offset-indexed band math, but we accept it per the Task
  // 10.1 prop contract and to keep the discount convention explicit.
  void currentYear;

  // Account lifecycle (Task 18.3, R17.1–R17.3). Starts in `loading` so SSR and
  // the first client paint agree and no sample numbers ever appear before the
  // browser-only store is read. The store read happens in a mount effect below.
  const [accountsState, setAccountsState] = useState<AccountsState>({
    status: 'loading',
  });

  // Read the account set from the browser-only Account_Store after mount, then
  // validate it (R17.1). `loadAccounts` is total and never throws under SSR or
  // an unavailable localStorage, and it seeds/falls back to the Sample_Set when
  // nothing usable is stored, so the common case yields a non-empty valid set.
  // An empty set, or a set that fails validation, routes to the single account-
  // unavailable state (R12.3) — the same outcome the server page used to decide.
  // This is the recompute baseline (R17.5): a future store mutation that calls
  // this loader again re-derives `totals`/`allocation` below and the whole
  // comparison recomputes, with no change to any calculator.
  useEffect(() => {
    const result = loadAccounts();
    const validation = validateAccounts(result.accounts);
    if (!validation.ok || validation.accounts.length === 0) {
      setAccountsState({ status: 'error' });
      return;
    }
    setAccountsState({ status: 'ready', accounts: validation.accounts });
  }, []);

  // The loaded, validated account set — or null until the store resolves. Every
  // account-derived figure below keys off this, so nothing is computed from a
  // static file and nothing renders before the real set is in hand (R17.3).
  const accounts: Account[] | null =
    accountsState.status === 'ready' ? accountsState.accounts : null;

  // Starting_Assets (R2.1) and Current_Allocation, derived client-side from the
  // loaded accounts with the SAME pure calculators the server used to call.
  // Null while accounts are loading/unavailable so the render gate suppresses
  // every figure and chart. Recomputes whenever the loaded set changes (R17.5).
  const totals: ClassTotals | null = useMemo(
    () => (accounts === null ? null : computeClassTotals(accounts)),
    [accounts],
  );
  const allocation: AllocationResult | null = useMemo(
    () => (totals === null ? null : computeActualAllocation(totals)),
    [totals],
  );

  // Rent_Assumption_Note presence (R11.1, R11.4): the note is mounted iff a
  // Mortgage_Account (`accountType === 'mortgage'`) is present among the loaded
  // accounts, and not mounted otherwise. This is a pure read of the loaded set;
  // it deliberately feeds NOTHING into the comparison inputs, so mortgage
  // presence never changes the buy-vs-rent result (R11.5).
  const hasMortgage = useMemo(
    () =>
      accounts !== null &&
      accounts.some((account) => account.accountType === 'mortgage'),
    [accounts],
  );

  // Market-data lifecycle (Loading → Ready | RouteError, with retry).
  const [marketState, setMarketState] = useState<MarketState>({ status: 'loading' });

  // Editable assumptions. Null until the first snapshot resolves and seeds them
  // with market-derived defaults (R11.4). Retained across a market-data error so
  // a retry never discards the user's edits (R12.2).
  const [assumptions, setAssumptions] = useState<BuyVsRentAssumptions | null>(null);

  // Dollar_Basis — nominal is the default on initial load (R10.1).
  const [dollarBasis, setDollarBasis] = useState<DollarBasis>('nominal');

  // Return_Override (R5.5) — the island-level override for the expected-
  // investment-return slider. `null` means "use the derived base return"
  // (`comparison.investmentReturnPercent`); a number replaces that derived base
  // return for the band/composition/tornado math on the next recompute. This is
  // island-level wiring only: no calculator is modified. Cleared on Reset.
  const [returnOverride, setReturnOverride] = useState<number | null>(null);

  // Fetch the resolved market data from the server-only route. A 2xx snapshot
  // → Ready with its dataSource; any error / !ok / network fault → RouteError
  // (R12.2, R12.4). Declared as a stable callback so the retry control and the
  // mount effect share one implementation.
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
      // Network fault or unparseable body → treat as unavailable (R12.2).
      setMarketState({ status: 'error' });
    }
  }, []);

  // Kick off the initial fetch on mount.
  useEffect(() => {
    void loadMarketData();
  }, [loadMarketData]);

  // Seed the editable assumptions once a snapshot resolves (R11.4). Seeding runs
  // only while `assumptions` is still null, so a user's subsequent edits — and a
  // later cache/snapshot refresh of the same session — never stomp their work.
  useEffect(() => {
    if (marketState.status === 'ready' && assumptions === null) {
      setAssumptions(seedAssumptions(marketState.snapshot));
    }
  }, [marketState, assumptions]);

  // Whether inflation can be sourced for the today's-dollars conversion (R10.6).
  const inflationAvailable =
    marketState.status === 'ready' && isInflationAvailable(marketState.snapshot);

  // The EFFECTIVE basis: honor the user's choice unless they asked for today's
  // dollars while inflation is unavailable, in which case we stay on nominal
  // (R10.6). The message below is shown whenever that override is in effect.
  const effectiveBasis: DollarBasis =
    dollarBasis === 'today' && !inflationAvailable ? 'nominal' : dollarBasis;
  const showInflationUnavailable = dollarBasis === 'today' && !inflationAvailable;

  // The full nominal comparison. Only meaningful once market data is ready and
  // the assumptions are seeded; null otherwise so the render gate suppresses the
  // figures/chart. Pure and synchronous, so this is cheap (< 1s, R9.3, R10.5).
  const comparison: ComparisonResult | null = useMemo(() => {
    if (
      marketState.status !== 'ready' ||
      assumptions === null ||
      totals === null ||
      allocation === null
    ) {
      return null;
    }
    return computeComparison({
      startingAssets: totals,
      currentAllocationFractions: toFractions(allocation.percentages),
      market: marketState.snapshot,
      returnAssumptions: DEFAULT_RETURN_ASSUMPTIONS,
      assumptions,
    });
  }, [marketState, assumptions, totals, allocation]);

  // The Starting_Assets total — the single figure the pure band/composition/
  // tornado helpers consume. Memoized so the override recompute below keys on a
  // stable number rather than the ClassTotals object identity.
  const startingAssetsTotal = useMemo(
    () =>
      totals === null
        ? 0
        : ASSET_CLASS_KEYS.reduce((sum, key) => sum + totals[key], 0),
    [totals],
  );

  // The EFFECTIVE base Investment_Return feeding every recompute: the active
  // Return_Override if the user set one, otherwise the derived base return the
  // calculator computed (R5.5). Null while the comparison is unavailable.
  const effectiveReturn: number | null = useMemo(() => {
    if (comparison === null) {
      return null;
    }
    return returnOverride ?? comparison.investmentReturnPercent;
  }, [comparison, returnOverride]);

  // When an override is active, the derived `comparison` was computed with the
  // CALCULATOR's base return, so its bands / breakeven / verdict are stale for
  // the override. Recompute just those three from the exported pure helpers with
  // the effective return — island-level wiring, no calculator change (R5.5). The
  // basis-independent figures (drawdown, cushion, tipping point, the Spec 3
  // sensitivity ranking) are unaffected by the return and keep coming from
  // `comparison`. When no override is set this is `null` and the originals stand.
  const overriddenCore = useMemo(() => {
    if (
      comparison === null ||
      assumptions === null ||
      effectiveReturn === null ||
      returnOverride === null
    ) {
      return null;
    }
    const bands = buildBands(
      assumptions,
      startingAssetsTotal,
      effectiveReturn,
      assumptions.multipliers,
    );
    const verdict: VerdictFigures = computeVerdict(bands.buy.base, bands.rent.base);
    const breakevenYear = findBreakevenYear(bands.buy.base, bands.rent.base);
    return { bands, verdict, breakevenYear };
  }, [comparison, assumptions, effectiveReturn, returnOverride, startingAssetsTotal]);

  // The bands / verdict / breakeven the view renders: the override recompute when
  // one is active, else the calculator's own figures.
  const effectiveBands: ComparisonBands | null =
    overriddenCore?.bands ?? comparison?.bands ?? null;
  const effectiveVerdict: VerdictFigures | null =
    overriddenCore?.verdict ?? comparison?.verdict ?? null;
  const effectiveBreakevenYear: number | null =
    overriddenCore?.breakevenYear ?? comparison?.breakevenYear ?? null;

  // The year-10 Composition for the Composition_Bars (R5.6), computed from the
  // same inputs the bands use — including the effective base return — so the
  // Buy/Rent totals match the Two_Path_Chart. Nominal here; the display memo
  // applies the active Dollar_Basis discount below.
  const composition: Year10Composition | null = useMemo(() => {
    if (assumptions === null || effectiveReturn === null) {
      return null;
    }
    return computeYear10Composition(assumptions, startingAssetsTotal, effectiveReturn);
  }, [assumptions, startingAssetsTotal, effectiveReturn]);

  // The two-sided Sensitivity_Tornado entries (R5.7), already sorted by swing by
  // `computeTornado`. Keyed on the same inputs as the bands so it recomputes live
  // on every slider/panel change. Basis-independent (it ranks dollar SWINGS), so
  // it is not discounted.
  const tornadoEntries = useMemo(() => {
    if (assumptions === null || effectiveReturn === null) {
      return [];
    }
    return computeTornado(
      assumptions,
      startingAssetsTotal,
      effectiveReturn,
      assumptions.multipliers,
    );
  }, [assumptions, startingAssetsTotal, effectiveReturn]);

  // The display-basis view of the comparison. On `today` the band series and the
  // verdict/cushion dollar figures are discounted; the drawdown allocation
  // percentages and the tipping-point rate are basis-independent (R10.3).
  const display = useMemo(() => {
    if (
      comparison === null ||
      effectiveBands === null ||
      effectiveVerdict === null ||
      composition === null
    ) {
      return null;
    }
    if (effectiveBasis !== 'today') {
      return {
        bands: effectiveBands,
        verdictGap: effectiveVerdict.year10Difference,
        cashCushion: comparison.drawdown.cashCushion,
        cushionThreshold: comparison.cushionThreshold,
        composition,
      };
    }
    const infl = DEFAULT_INFLATION_RATE;
    return {
      bands: discountBands(effectiveBands, infl),
      verdictGap: discountYear10(effectiveVerdict.year10Difference, infl),
      cashCushion: discountYear10(comparison.drawdown.cashCushion, infl),
      cushionThreshold: discountYear10(comparison.cushionThreshold, infl),
      composition: discountComposition(composition, infl),
    };
  }, [comparison, effectiveBands, effectiveVerdict, composition, effectiveBasis]);

  // Commit a single valid assumption edit from the panel (R9.3).
  const handleChange = useCallback((field: EditableField, value: number): void => {
    setAssumptions((prev) => {
      if (prev === null) {
        return prev;
      }
      switch (field) {
        case 'optimisticMultiplier':
          return { ...prev, multipliers: { ...prev.multipliers, optimistic: value } };
        case 'pessimisticMultiplier':
          return { ...prev, multipliers: { ...prev.multipliers, pessimistic: value } };
        default:
          return { ...prev, [field]: value };
      }
    });
  }, []);

  // Reset every assumption to its market-derived / documented default (R9.5).
  const handleReset = useCallback((): void => {
    if (marketState.status === 'ready') {
      setAssumptions(seedAssumptions(marketState.snapshot));
    }
    // Clearing the Return_Override drops the expected-investment-return slider
    // back to the derived base return (R5.5).
    setReturnOverride(null);
  }, [marketState]);

  // The active-basis label used in the chart's text alternative (R10.3).
  const basisLabel = effectiveBasis === 'today' ? "today's dollars" : 'future dollars';

  // The one-sentence Verdict headline shown above the chart (R5.1): which path
  // ends ahead at year 10 and the dollar gap, in the active Dollar_Basis. The
  // 'tie' leader is phrased explicitly since the shared `verdict()` copy only
  // names a winning path; this mirrors VerdictCard's own tie handling so the
  // headline and the detail card never disagree.
  const verdictHeadline =
    effectiveVerdict === null || display === null
      ? null
      : effectiveVerdict.leader === 'tie'
        ? 'Buying and renting come out about even at year 10.'
        : verdictSentence(
            effectiveVerdict.leader,
            formatCurrency(display.verdictGap),
          );

  // Account lifecycle gate (Task 18.3, R17.2, R17.3), running IN FRONT of the
  // market machine. While the browser-only store read is pending we show the
  // Spec 1 LoadingSkeleton and NOTHING else — no figures, no sample numbers. An
  // empty/unreadable store is the single account-unavailable route (R12.3), and
  // it wins over any later market-data state because the market machine below is
  // only reached once accounts are ready.
  if (accountsState.status === 'loading') {
    return (
      <div className={`flex flex-col gap-8 ${className ?? ''}`} aria-busy>
        <LoadingSkeleton />
      </div>
    );
  }

  if (accountsState.status === 'error') {
    return (
      <div className={`flex flex-col gap-8 ${className ?? ''}`}>
        <BuyVsRentErrorState message={BUY_VS_RENT_MESSAGES.accountError} />
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-8 ${className ?? ''}`}>
      {/* Accounts are ready. The Rent_Assumption_Note sits above the comparison
          and is mounted iff a Mortgage_Account is present among the loaded
          accounts (R11.1); it is NOT mounted otherwise (R11.4). It is purely
          informational and feeds nothing into the comparison inputs, so mortgage
          presence never changes the buy-vs-rent result (R11.5). It renders
          regardless of the market machine's state so the acknowledgement is
          visible even while market data is still loading. */}
      {hasMortgage ? <RentAssumptionNote /> : null}

      {/* Loading: no figures, no chart, just the plain-language indication (R12.1). */}
      {marketState.status === 'loading' ? (
        <div
          role="status"
          className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-slate-600"
        >
          <p className="text-sm">{BUY_VS_RENT_MESSAGES.loading}</p>
        </div>
      ) : null}

      {/* RouteError: no figures, no chart; assumptions retained; retry offered (R12.2, R12.4). */}
      {marketState.status === 'error' ? (
        <BuyVsRentErrorState
          message={BUY_VS_RENT_MESSAGES.routeError}
          onRetry={() => void loadMarketData()}
        />
      ) : null}

      {/* Ready: the full comparison. */}
      {marketState.status === 'ready' &&
      assumptions !== null &&
      comparison !== null &&
      allocation !== null &&
      display !== null ? (
        <>
          {/* Freshness banner/note for cache + snapshot; nothing for live (R11.5, R11.6). */}
          <MarketDataBanner
            dataSource={marketState.snapshot.dataSource}
            lastUpdated={mostRecentAsOf(marketState.snapshot)}
          />

          {/* Dollar_Basis toggle (R10.1, R10.4, R10.5). */}
          <DollarBasisToggle value={dollarBasis} onChange={setDollarBasis} />

          {/* Inflation adjustment couldn't be applied → stayed on nominal (R10.6). */}
          {showInflationUnavailable ? (
            <p
              role="status"
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              {BUY_VS_RENT_MESSAGES.inflationUnavailable}
            </p>
          ) : null}

          {/* When today's dollars is active, note the rate + CPI source adjacent (R10.3). */}
          {effectiveBasis === 'today' ? (
            <p className="text-xs text-slate-500 tabular-nums">
              {`Values shown in today's dollars using an inflation rate of ${DEFAULT_INFLATION_RATE}% per year (CPI, as of ${formatAsOf(
                marketState.snapshot.cpi.asOf,
              )}).`}
            </p>
          ) : null}

          {/*
            THE HERO (R5.1, R8.1, R8.2). The verdict headline, the live slider
            strip, and the full-width Two_Path_Chart stack full width at every
            breakpoint — they are the one thing this view answers at a glance —
            followed by the Composition_Bars and the Sensitivity_Tornado. The
            supporting detail cards sit below in a responsive two-column (wide) /
            one-column (phone) grid.
          */}

          {/* 1. The one-sentence Verdict headline, above the chart (R5.1). The
              largest thing in the hero, in the active Dollar_Basis. */}
          {verdictHeadline !== null ? (
            <p
              aria-label="Verdict"
              className="text-2xl font-semibold text-slate-900 tabular-nums"
            >
              {verdictHeadline}
            </p>
          ) : null}

          {/* 2. The live "biggest drivers" slider strip, directly above the chart
              (R5.3, R5.4). The two panel-backed sliders bind to the single
              `assumptions` state via `handleChange`; the expected-return slider
              reads the effective return and sets the island-level
              Return_Override (R5.5). Full width (R8.2). */}
          {effectiveReturn !== null ? (
            <SliderStrip
              values={assumptions}
              onChange={handleChange}
              returnValue={effectiveReturn}
              onReturnChange={setReturnOverride}
              market={marketState.snapshot}
            />
          ) : null}

          {/* 3. The full-width Two_Path_Chart: Buy + Rent bands with a non-color
              path cue and a labeled breakeven marker (R5.2). Uses the effective
              breakeven so the override is reflected live. */}
          <TwoPathChart
            bands={display.bands}
            breakevenYear={effectiveBreakevenYear}
            basisLabel={basisLabel}
          />

          {/* 4. Year-10 Composition_Bars (R5.6), discounted to the active basis
              exactly like the bands so the stacks match the chart's year-10
              values. */}
          <CompositionBars
            composition={display.composition}
            basisLabel={basisLabel}
          />

          {/* 5. The Sensitivity_Tornado (R5.7): the top drivers of the year-10
              gap, already sorted by swing. Basis-independent. */}
          <SensitivityTornado entries={tornadoEntries} />

          {/* ----- Supporting detail cards below the hero ----- */}

          {/* Year-10 call-outs as labeled ranges, in the active basis (R4.3, R4.4, R5.5). */}
          <BuyVsRentComparisonSummary
            buy={year10Figures(display.bands.buy)}
            rent={year10Figures(display.bands.rent)}
          />

          {/* The plain-language verdict, breakeven, and tipping point (R6, R7).
              The verdict/breakeven reflect the effective return; the tipping
              point is the derived-return reference from the calculator. */}
          <VerdictCard
            verdictFigures={{
              leader: effectiveVerdict?.leader ?? comparison.verdict.leader,
              year10Difference: display.verdictGap,
            }}
            breakevenYear={effectiveBreakevenYear}
            tippingPointPercent={comparison.tippingPointPercent}
          />

          {/* Two-column (wide) / one-column (phone) card grid for the supporting
              detail (R8.2, calm card ui-style). */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* The one or two most influential assumptions (R8.3). */}
            <SensitivityCard ranking={comparison.sensitivity} />

            {/* Cash_Cushion vs Cushion_Threshold with the over-budget case (R3.5, R3.6). */}
            <CushionCard
              cashCushion={display.cashCushion}
              cushionThreshold={display.cushionThreshold}
              overBudget={comparison.drawdown.overBudget}
            />
          </div>

          {/* Current vs Post_Purchase_Allocation side by side (R3.3). */}
          <AllocationShiftCard
            current={allocation.percentages}
            postPurchase={comparison.drawdown.postPurchaseAllocation}
          />

          {/* Every assumption, visible / sourced / editable (R9.1–R9.6). */}
          <BuyVsRentAssumptionPanel
            values={assumptions}
            market={marketState.snapshot}
            onChange={handleChange}
            onReset={handleReset}
          />
        </>
      ) : null}
    </div>
  );
}
