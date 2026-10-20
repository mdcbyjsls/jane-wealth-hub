'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import type { ComparisonBands } from '@/types/buyVsRent';
import { formatCurrency } from '@/lib/format';

/**
 * Band chart of the buy-vs-rent comparison plus a programmatically associated
 * text alternative (R13.1, R13.5, R13.6).
 *
 * The visual draws two bands against a shared year axis (years 0..10): the
 * Buy_Path band (an `Area` spanning its pessimistic→optimistic range with the
 * base series as a line inside) and the Rent_Path band (the same, R5.4). The
 * two paths are told apart by a *shape* cue — the Buy base line is solid, the
 * Rent base line is dashed — and by a labeled legend, never by color alone
 * (R5.4, ui-style "never rely on color alone").
 *
 * Accessibility, mirroring {@link AllocationPie} / {@link ProjectionChart}:
 * - The Recharts `<svg>` is decorative and hidden from assistive technology
 *   (`aria-hidden`), so it is never the only source of the data (R13.5).
 * - A visually-hidden `<dl>` carries the authoritative content — the year-10
 *   Buy and Rent values for the base, optimistic, and pessimistic bands plus
 *   the Breakeven_Year, with tabular numerals — and the `<figure>` references
 *   it via `aria-labelledby` (R13.1).
 * - A row of focusable call-out buttons (one per path at each horizon) sits
 *   outside the hidden SVG so a keyboard user gets the same tooltip a mouse
 *   user gets on hover: focusing or hovering a button shows the year, the path,
 *   and that point's net-worth dollar value (R13.2); blur/leave dismisses it
 *   (R13.3). Updates are synchronous state writes, well within the 200 ms
 *   budget.
 *
 * When the comparison is unavailable the component renders no chart graphic;
 * instead it exposes the plain-language unavailable message to assistive
 * technology (R13.6).
 *
 * Presentational only: resolved bands in, markup out. No data fetching, no
 * state beyond the transient focused/hovered tooltip target. The caller passes
 * values already in the active Dollar_Basis, and an optional `basisLabel` so
 * the text alternative stays unambiguous as the basis toggles.
 */

/** The horizons called out in the text alternative and the keyboard call-outs (R13.1). */
const HORIZON_YEARS = [10] as const;

/** The three bands, in a fixed display order. */
const BAND_KEYS = ['optimistic', 'base', 'pessimistic'] as const;
type BandKey = (typeof BAND_KEYS)[number];

const BAND_LABELS: Record<BandKey, string> = {
  optimistic: 'Optimistic',
  base: 'Base',
  pessimistic: 'Pessimistic',
};

/** Which path a series belongs to. Carried by a solid vs dashed base line plus the legend text — shape, not color (R5.4). */
type PathKey = 'buy' | 'rent';

const PATH_LABELS: Record<PathKey, string> = {
  buy: 'Buy',
  rent: 'Rent',
};

/** Line/area colors. These are a visual aid only; shape + text carry meaning. */
const BUY_COLOR = '#0f1e3d'; // deep navy (primary)
const BUY_BAND = '#c7d2e8'; // light navy tint for the band fill
const RENT_COLOR = '#0d94ae'; // teal
const RENT_BAND = '#cdeaf0'; // light teal tint for the band fill

export interface ComparisonChartProps {
  /**
   * The resolved comparison bands for both paths (11 values each, years 0..10),
   * already expressed in the active Dollar_Basis by the caller. When omitted or
   * incomplete the chart renders no graphic and exposes `unavailableMessage`.
   */
  bands?: ComparisonBands;
  /** The Breakeven_Year, or `null` when buying never overtakes renting in 10 years (R6, R13.1). */
  breakevenYear?: number | null;
  /**
   * Label describing the active Dollar_Basis (e.g. "future dollars" /
   * "today's dollars"), shown in the sr-only alternative so the text stays
   * unambiguous as the basis toggles. Optional.
   */
  basisLabel?: string;
  /**
   * Plain-language message exposed to assistive technology when the comparison
   * is unavailable (R13.6). Rendered in place of the chart; no graphic is drawn.
   */
  unavailableMessage?: string;
  /** Legend label for the Buy_Path. Defaults to "Buy". */
  buyLabel?: string;
  /** Legend label for the Rent_Path. Defaults to "Rent". */
  rentLabel?: string;
}

/** A single merged chart row: year plus every series value Recharts needs. */
interface ChartRow {
  year: number;
  buyBand: [number, number]; // [pessimistic, optimistic] for the Area
  buyBase: number;
  rentBand: [number, number];
  rentBase: number;
}

/** Identifies which focusable call-out (and thus tooltip) is active. */
interface TooltipTarget {
  path: PathKey;
  band: BandKey;
  year: number;
  value: number;
}

/** True when a path's bands all carry a usable value at the given year offset. */
function hasValueAt(bands: ComparisonBands, year: number): boolean {
  return (
    Number.isFinite(bands.buy.base[year]) &&
    Number.isFinite(bands.buy.optimistic[year]) &&
    Number.isFinite(bands.buy.pessimistic[year]) &&
    Number.isFinite(bands.rent.base[year]) &&
    Number.isFinite(bands.rent.optimistic[year]) &&
    Number.isFinite(bands.rent.pessimistic[year])
  );
}

/** True when the supplied bands have the 11 year-0..10 values each path needs. */
function hasBands(bands: ComparisonBands | undefined): bands is ComparisonBands {
  return (
    !!bands &&
    bands.buy.base.length > 0 &&
    bands.buy.optimistic.length === bands.buy.base.length &&
    bands.buy.pessimistic.length === bands.buy.base.length &&
    bands.rent.base.length === bands.buy.base.length &&
    bands.rent.optimistic.length === bands.buy.base.length &&
    bands.rent.pessimistic.length === bands.buy.base.length
  );
}

export function ComparisonChart({
  bands,
  breakevenYear = null,
  basisLabel,
  unavailableMessage,
  buyLabel = 'Buy',
  rentLabel = 'Rent',
}: ComparisonChartProps) {
  const [tooltip, setTooltip] = useState<TooltipTarget | null>(null);

  // Merge both paths' bands into one row per year so Recharts can draw each
  // band Area + base Line against a shared x-axis.
  const chartData = useMemo<ChartRow[]>(() => {
    if (!hasBands(bands)) {
      return [];
    }
    const rows: ChartRow[] = [];
    for (let year = 0; year < bands.buy.base.length; year += 1) {
      if (!hasValueAt(bands, year)) {
        continue;
      }
      rows.push({
        year,
        buyBand: [bands.buy.pessimistic[year], bands.buy.optimistic[year]],
        buyBase: bands.buy.base[year],
        rentBand: [bands.rent.pessimistic[year], bands.rent.optimistic[year]],
        rentBase: bands.rent.base[year],
      });
    }
    return rows;
  }, [bands]);

  // Comparison unavailable → render no chart graphic; expose the message to
  // assistive tech instead (R13.6).
  if (!hasBands(bands) || chartData.length === 0) {
    if (unavailableMessage) {
      return <p role="status">{unavailableMessage}</p>;
    }
    return null;
  }

  const lastYear = bands.buy.base.length - 1;
  const altRows = buildAltRows(bands, lastYear, breakevenYear, {
    buyLabel,
    rentLabel,
  });

  const basisSuffix = basisLabel ? ` in ${basisLabel}` : '';

  return (
    <figure aria-labelledby="comparison-chart-alt" className="flex flex-col gap-4">
      {/*
        Authoritative, screen-reader-only text alternative (R13.1). Lists the
        year-10 Buy and Rent values for the base, optimistic, and pessimistic
        bands plus the Breakeven_Year, with tabular numerals. The figure is
        labeled by this list so assistive tech announces the content rather than
        the decorative SVG below.
      */}
      <dl id="comparison-chart-alt" className="sr-only tabular-nums">
        <dt>{`Projected net worth at year ${lastYear} for buying versus renting${basisSuffix}`}</dt>
        {altRows.map((row) => (
          <dd key={row.key}>{row.text}</dd>
        ))}
      </dl>

      {/* Decorative chart: hidden from assistive tech, which reads the list above. */}
      <div aria-hidden="true" className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 8, right: 16, bottom: 8, left: 16 }}
          >
            <XAxis
              dataKey="year"
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }}
              tick={{ fill: '#475569', fontSize: 12 }}
            />
            <YAxis
              width={72}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#475569', fontSize: 12 }}
              tickFormatter={(v: number) => formatCurrency(v)}
            />
            {/* Buy band: pessimistic→optimistic fill, solid base line inside. */}
            <Area
              dataKey="buyBand"
              stroke="none"
              fill={BUY_BAND}
              fillOpacity={0.7}
              isAnimationActive={false}
            />
            <Line
              dataKey="buyBase"
              stroke={BUY_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {/* Rent band + dashed base line — shape cue, not color (R5.4). */}
            <Area
              dataKey="rentBand"
              stroke="none"
              fill={RENT_BAND}
              fillOpacity={0.5}
              isAnimationActive={false}
            />
            <Line
              dataKey="rentBase"
              stroke={RENT_COLOR}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/*
        Visible legend. The buy/rent distinction is carried by a line sample
        whose shape differs (solid vs dashed) AND by the text label, so the two
        paths are identified without relying on color alone (R5.4).
      */}
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        <li className="flex items-center gap-2">
          <LineSample path="buy" />
          <span className="text-sm font-medium text-slate-700">{`${buyLabel} (solid line)`}</span>
        </li>
        <li className="flex items-center gap-2">
          <LineSample path="rent" />
          <span className="text-sm font-medium text-slate-700">{`${rentLabel} (dashed line)`}</span>
        </li>
      </ul>

      {/*
        Keyboard-reachable call-outs. Because the SVG is aria-hidden, these
        focusable buttons give keyboard users the same tooltip a mouse user gets
        on hover (R13.2): focusing or hovering one reveals the year, the path,
        and that point's dollar value; blur/leave dismisses it (R13.3). The
        200 ms budget is met with instant, synchronous state updates.
      */}
      <div className="flex flex-col gap-4">
        <CallOutGroup
          path="buy"
          label={buyLabel}
          bands={bands.buy}
          activeTooltip={tooltip}
          onShow={setTooltip}
          onHide={() => setTooltip(null)}
        />
        <CallOutGroup
          path="rent"
          label={rentLabel}
          bands={bands.rent}
          activeTooltip={tooltip}
          onShow={setTooltip}
          onHide={() => setTooltip(null)}
        />
      </div>
    </figure>
  );
}

/** A small line sample for the legend: solid for buy, dashed for rent. */
function LineSample({ path }: { path: PathKey }) {
  const color = path === 'buy' ? BUY_COLOR : RENT_COLOR;
  return (
    <svg
      aria-hidden="true"
      width="28"
      height="12"
      viewBox="0 0 28 12"
      className="shrink-0"
    >
      <line
        x1="0"
        y1="6"
        x2="28"
        y2="6"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={path === 'rent' ? '6 4' : undefined}
      />
    </svg>
  );
}

/**
 * One group of focusable call-out buttons for a path: the three bands at each
 * called-out horizon. Each button owns its own tooltip, shown on focus and
 * hover and dismissed on blur and leave.
 */
function CallOutGroup({
  path,
  label,
  bands,
  activeTooltip,
  onShow,
  onHide,
}: {
  path: PathKey;
  label: string;
  bands: ComparisonBands[PathKey];
  activeTooltip: TooltipTarget | null;
  onShow: (t: TooltipTarget) => void;
  onHide: () => void;
}) {
  return (
    <section
      aria-label={`${label} projected ranges at year 10`}
      className="flex flex-col gap-3"
    >
      <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-1">
        {HORIZON_YEARS.map((year) => (
          <div key={year} className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
            <span className="text-xs font-medium text-slate-500">{`Year ${year}`}</span>
            <div className="flex flex-col gap-1">
              {BAND_KEYS.map((band) => {
                const value = bands[band][year];
                if (!Number.isFinite(value)) {
                  return null;
                }
                const isActive =
                  activeTooltip?.path === path &&
                  activeTooltip.band === band &&
                  activeTooltip.year === year;
                const target: TooltipTarget = { path, band, year, value };
                return (
                  <button
                    key={band}
                    type="button"
                    className="relative flex items-baseline justify-between gap-2 rounded px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                    onMouseEnter={() => onShow(target)}
                    onMouseLeave={onHide}
                    onFocus={() => onShow(target)}
                    onBlur={onHide}
                  >
                    <span className="text-xs text-slate-500">{BAND_LABELS[band]}</span>
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(value)}
                    </span>
                    {isActive ? (
                      <span
                        role="tooltip"
                        className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white tabular-nums shadow"
                      >
                        {`Year ${year}: ${PATH_LABELS[path]} ${BAND_LABELS[
                          band
                        ].toLowerCase()} ${formatCurrency(value)}`}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface AltRow {
  key: string;
  text: string;
}

/**
 * Build the sr-only description rows: the year-10 base/optimistic/pessimistic
 * value for each path, plus the Breakeven_Year statement (R13.1).
 */
function buildAltRows(
  bands: ComparisonBands,
  year: number,
  breakevenYear: number | null,
  labels: { buyLabel: string; rentLabel: string },
): AltRow[] {
  const rows: AltRow[] = [];

  const describe = (path: PathKey, label: string) => {
    const band = bands[path];
    const base = band.base[year];
    const opt = band.optimistic[year];
    const pess = band.pessimistic[year];
    if (
      !Number.isFinite(base) ||
      !Number.isFinite(opt) ||
      !Number.isFinite(pess)
    ) {
      return;
    }
    rows.push({
      key: `${path}-${year}`,
      text: `${label}, year ${year}: base ${formatCurrency(
        base,
      )}, optimistic ${formatCurrency(opt)}, pessimistic ${formatCurrency(pess)}.`,
    });
  };

  describe('buy', labels.buyLabel);
  describe('rent', labels.rentLabel);

  rows.push({
    key: 'breakeven',
    text:
      breakevenYear === null
        ? 'Buying does not overtake renting within 10 years.'
        : `Breakeven year: buying catches up to renting at year ${breakevenYear}.`,
  });

  return rows;
}

export default ComparisonChart;
