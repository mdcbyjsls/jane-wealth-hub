'use client';

/*
 * SliderStrip — the "Typically the biggest drivers" live-slider strip for the
 * Buy-vs-Rent Scenario Tester hero (Spec 4, R5.3/R5.4/R3.3).
 *
 * This strip sits directly above the Two_Path_Chart and exposes the three
 * assumptions users most want to explore as continuous `<input type="range">`
 * controls, in a FIXED order that never reorders while a slider is dragged
 * (R5.3):
 *
 *   1. Home appreciation rate   — panel-backed field `homeAppreciationRatePercent`
 *   2. Mortgage rate            — panel-backed field `mortgageRatePercent`
 *   3. Expected investment return — island-level Return_Override (R5.5)
 *
 * SINGLE SOURCE OF TRUTH (R5.4). The two panel-backed sliders read and write the
 * exact same `assumptions` state the full BuyVsRentAssumptionPanel uses. They
 * carry the SAME clamp bounds (min/max/step) the panel defines for those fields
 * and commit through the SAME reducer the panel uses — `onChange(field, value)`,
 * typed to the panel's `EditableField`. There is no second copy of either value:
 * moving a slider updates the panel, and editing the panel moves the slider,
 * because both are views of the one island-owned `assumptions` object.
 *
 * EXPECTED INVESTMENT RETURN (R5.5). Investment return is DERIVED today (the
 * blended base return fed to `computeComparison`), not a direct editable field.
 * To expose it as a live control without touching any calculator, this slider
 * is wired to the island-level Return_Override via a distinct callback,
 * `onReturnChange`, with its current value supplied as `returnValue`. When set,
 * the island feeds this value into `computeComparison`'s base return for that
 * run and clears it on Reset. Wiring the override into `computeComparison` is
 * Task 5.5; this component only exposes the clean prop contract for it.
 *
 * PROP CONTRACT (so BuyVsRentClient / Task 5.5 can bind it to the single
 * `assumptions` state and the island-level Return_Override):
 *
 *   - values         : the committed `BuyVsRentAssumptions` (the single source of
 *                      truth). The two panel-backed sliders read their current
 *                      positions from `values.homeAppreciationRatePercent` and
 *                      `values.mortgageRatePercent`.
 *   - onChange       : the panel's committing reducer, `(field, value) => void`,
 *                      called for the two panel-backed sliders with the same
 *                      `EditableField` keys the panel uses.
 *   - returnValue    : the current expected-investment-return percent — the
 *                      active Return_Override if one is set, otherwise the
 *                      derived base return the island would otherwise use.
 *   - onReturnChange : sets the island-level Return_Override, `(value) => void`.
 *   - market         : the resolved snapshot, read ONLY for the two market-derived
 *                      sliders' source labels + as-of dates (mortgage →
 *                      MORTGAGE30US, appreciation → CSUSHPINSA). No fetching here.
 *
 * A note on "live" vs the panel's commit-on-blur. The panel commits on blur/Enter
 * and validates/reverts invalid text; a range input can only ever produce an
 * in-bounds number, so each drag tick is already a valid committed edit. We call
 * `onChange` / `onReturnChange` on every `onChange` event so the chart recomputes
 * live (R5.5) — the pure `computeComparison` is sub-second, so this is cheap.
 *
 * Accessibility / ui-style: each slider is a labeled native control with an
 * always-visible inline value readout in `tabular-nums`, a source label / as-of
 * where one exists (R5.4, preserving "every assumption is sourced"), and a
 * visible focus-visible ring. Presentational client island: no fetch, no
 * localStorage, no clock.
 */

import type { MarketDataSnapshot } from '@/types/market';
import type { BuyVsRentAssumptions } from '@/types/buyVsRent';
import { formatPercent } from '@/lib/format';
import { MARKET_SERIES_LABEL, sourceLabel } from '@/lib/buyVsRentMessages';
import type { EditableField } from '@/components/ui/BuyVsRentAssumptionPanel';

// ---------------------------------------------------------------------------
// Clamp bounds (identical to BuyVsRentAssumptionPanel's FIELD_SPECS — R5.4)
// ---------------------------------------------------------------------------

/** Home_Appreciation_Rate: −20..+20 percent, 0.1 step — same as the panel. */
const APPRECIATION_MIN = -20;
const APPRECIATION_MAX = 20;
const APPRECIATION_STEP = 0.1;

/** Mortgage_Rate: 0–20 percent, 0.1 step — same as the panel. */
const MORTGAGE_RATE_MIN = 0;
const MORTGAGE_RATE_MAX = 20;
const MORTGAGE_RATE_STEP = 0.1;

/**
 * Expected investment return bounds. Return is a derived value, not a panel
 * field, so the panel defines no bounds for it; this strip uses a sensible
 * exploration range for the Return_Override slider. 0.1 step matches the two
 * rate sliders for a consistent feel.
 */
const RETURN_MIN = 0;
const RETURN_MAX = 15;
const RETURN_STEP = 0.1;

/** Format the ISO as-of date the same way the island/panel do (UTC, unambiguous). */
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SliderStripProps {
  /**
   * The committed assumptions — the single source of truth shared with the full
   * Assumption_Panel (R5.4). The two panel-backed sliders read their positions
   * from here; moving them calls `onChange` so this same state updates.
   */
  values: BuyVsRentAssumptions;
  /**
   * The panel's committing reducer. Called for the two panel-backed sliders
   * (home appreciation, mortgage rate) with the same `EditableField` keys the
   * panel uses, so there is exactly one source of truth (R5.4).
   */
  onChange: (field: EditableField, value: number) => void;
  /**
   * The current expected-investment-return percent: the active Return_Override
   * if set, else the derived base return the island would otherwise use (R5.5).
   */
  returnValue: number;
  /** Set the island-level Return_Override from the investment-return slider (R5.5). */
  onReturnChange: (value: number) => void;
  /**
   * The resolved market snapshot, read ONLY for the two market-derived sliders'
   * source labels + as-of dates (R5.4). No fetching here.
   */
  market: MarketDataSnapshot;
  /** Extra Tailwind classes merged onto the strip container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SliderStrip({
  values,
  onChange,
  returnValue,
  onReturnChange,
  market,
  className,
}: SliderStripProps): React.ReactElement {
  return (
    <section
      aria-label="Typically the biggest drivers"
      className={`flex flex-col gap-5 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-100 ${
        className ?? ''
      }`}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-slate-900">
          Typically the biggest drivers
        </h3>
        <p className="text-sm text-slate-600">
          Drag any slider to see the comparison update live. These three
          assumptions usually move the outcome the most.
        </p>
      </div>

      {/*
        Fixed order, top to bottom (R5.3). The order is defined by the literal
        sequence of these three rows and never changes, so dragging one slider
        never reorders the strip.
      */}
      <div className="flex flex-col gap-5">
        {/* 1. Home appreciation rate — panel-backed field (CSUSHPINSA source). */}
        <SliderRow
          id="slider-home-appreciation"
          label="Home appreciation rate"
          value={values.homeAppreciationRatePercent}
          min={APPRECIATION_MIN}
          max={APPRECIATION_MAX}
          step={APPRECIATION_STEP}
          readout={formatPercent(values.homeAppreciationRatePercent)}
          source={sourceLabel(
            MARKET_SERIES_LABEL.homeAppreciation,
            formatAsOf(market.homePriceIndex.asOf),
          )}
          onChange={(value) => onChange('homeAppreciationRatePercent', value)}
        />

        {/* 2. Mortgage rate — panel-backed field (MORTGAGE30US source). */}
        <SliderRow
          id="slider-mortgage-rate"
          label="Mortgage rate"
          value={values.mortgageRatePercent}
          min={MORTGAGE_RATE_MIN}
          max={MORTGAGE_RATE_MAX}
          step={MORTGAGE_RATE_STEP}
          readout={formatPercent(values.mortgageRatePercent)}
          source={sourceLabel(
            MARKET_SERIES_LABEL.mortgageRate,
            formatAsOf(market.mortgageRate.asOf),
          )}
          onChange={(value) => onChange('mortgageRatePercent', value)}
        />

        {/* 3. Expected investment return — island-level Return_Override (R5.5). */}
        <SliderRow
          id="slider-expected-return"
          label="Expected investment return"
          value={returnValue}
          min={RETURN_MIN}
          max={RETURN_MAX}
          step={RETURN_STEP}
          readout={formatPercent(returnValue)}
          source="Derived from your current allocation, editable"
          onChange={onReturnChange}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface SliderRowProps {
  /** Stable id tying the label to its range input. */
  id: string;
  /** Plain-language assumption name. */
  label: string;
  /** Current value (the slider position); a controlled input. */
  value: number;
  /** Clamp bounds + step, matching the panel for the two panel-backed fields. */
  min: number;
  max: number;
  step: number;
  /** Pre-formatted inline value readout (tabular-nums), e.g. "4.0%". */
  readout: string;
  /** Source label / as-of where one exists; "derived" for the return slider. */
  source: string;
  /** Emit a committed value on every drag tick (range inputs are always in-bounds). */
  onChange: (value: number) => void;
}

/**
 * One labeled slider: a header row (label + live readout), the native
 * `<input type="range">` carrying the clamp bounds, and the source/as-of line
 * beneath. The readout uses `tabular-nums` so the figure doesn't jitter as it
 * changes; the range input has an always-visible focus-visible ring.
 */
function SliderRow({
  id,
  label,
  value,
  min,
  max,
  step,
  readout,
  source,
  onChange,
}: SliderRowProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        <span className="text-sm font-semibold text-slate-900 tabular-nums">
          {readout}
        </span>
      </div>

      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer accent-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2"
      />

      <span className="text-xs text-slate-500">{source}</span>
    </div>
  );
}
