'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import type { ComparisonBands } from '@/types/buyVsRent';
import { formatCurrency, formatPercent } from '@/lib/format';
import { SERIES } from '@/lib/chartColors';
import ChartLegend, { type LegendItem } from '@/components/charts/ChartLegend';

/**
 * Two-path net-worth chart for the Buy-vs-Rent hero (Spec 4 — Per-view →
 * Buy-vs-Rent → TwoPathChart). It evolves the earlier `ComparisonChart`,
 * preserving its band + base-line + Call_Out_Button + Text_Alternative pattern
 * and adding, per the design:
 *
 * - a labeled **Breakeven_Marker**: a vertical reference at `breakevenYear`
 *   with a visible label on the decorative SVG, plus the breakeven sentence in
 *   the authoritative text alternative. Absent when `breakevenYear` is null.
 * - a **Click_To_Hide_Legend** (the shared interactive {@link ChartLegend})
 *   that toggles the Buy and Rent bands. The hidden state is reflected in BOTH
 *   the chart (the band/line is not drawn) AND the text alternative (the hidden
 *   path's rows are annotated "(hidden)").
 * - **dollars + percent tooltips**: each call-out shows the dollar value and
 *   that point's percent of the path's own starting (year-0) value — the
 *   "percent of that path's relevant base" the design's tooltip section calls
 *   for.
 *
 * The two paths are told apart by a *shape* cue — Buy is a solid navy line,
 * Rent a dashed teal line — and by the labeled legend, never by color alone
 * (R1.1, ui-style "never rely on color alone").
 *
 * Accessibility, mirroring {@link AllocationPie} / {@link ProjectionChart}:
 * - The Recharts `<svg>` is decorative and hidden from assistive technology
 *   (`aria-hidden`), so it is never the only source of the data (R3.1).
 * - A visually-hidden `<dl>` carries the authoritative content — the year-10
 *   Buy and Rent values for the base, optimistic, and pessimistic bands plus
 *   the Breakeven_Year, with tabular numerals — and the `<figure>` references
 *   it via `aria-labelledby`.
 * - A row of focusable call-out buttons sits outside the hidden SVG so a
 *   keyboard user gets the same tooltip a mouse user gets on hover (R3.2):
 *   focusing or hovering a button shows the year, the path, the dollar value,
 *   and the percent of the path's starting value; blur/leave dismisses it.
 *
 * When the comparison is unavailable the component renders no chart graphic;
 * instead it exposes the plain-language unavailable message to assistive
 * technology.
 *
 * Presentational only: resolved bands in, markup out. No data fetching; the
 * only state is the transient focused/hovered tooltip target and the set of
 * hidden paths. The caller passes values already in the active Dollar_Basis,
 * and an optional `basisLabel` so the text alternative stays unambiguous as the
 * basis toggles.
 */

/** The horizons called out in the text alternative and the keyboard call-outs. */
const HORIZON_YEARS = [10] as const;

/** The three bands, in a fixed display order. */
const BAND_KEYS = ['optimistic', 'base', 'pessimistic'] as const;
type BandKey = (typeof BAND_KEYS)[number];

const BAND_LABELS: Record<BandKey, string> = {
  optimistic: 'Optimistic',
  base: 'Base',
  pessimistic: 'Pessimistic',
};

/** Which path a series belongs to. Carried by a solid vs dashed base line plus the legend text — shape, not color (R1.1). */
type PathKey = 'buy' | 'rent';

const PATH_KEYS: readonly PathKey[] = ['buy', 'rent'];

const PATH_LABELS: Record<PathKey, string> = {
  buy: 'Buy',
  rent: 'Rent',
};

/**
 * Line/area colors, drawn from the shared color module (`@/lib/chartColors`)
 * so Buy/Rent use the same navy/teal as Current/Target everywhere. These are a
 * visual aid only; shape (solid vs dashed) + text carry meaning (R1.1).
 */
const BUY_COLOR = SERIES.primary; // navy (Buy)
const BUY_BAND = SERIES.primaryBand; // navy band tint
const RENT_COLOR = SERIES.secondary; // teal (Rent)
const RENT_BAND = SERIES.secondaryBand; // teal band tint

export interface TwoPathChartProps {
  /**
   * The resolved comparison bands for both paths (11 values each, years 0..10),
   * already expressed in the active Dollar_Basis by the caller. When omitted or
   * incomplete the chart renders no graphic and exposes `unavailableMessage`.
   */
  bands?: ComparisonBands;
  /** The Breakeven_Year, or `null` when buying never overtakes renting in 10 years. */
  breakevenYear?: number | null;
  /**
   * Label describing the active Dollar_Basis (e.g. "future dollars" /
   * "today's dollars"), shown in the sr-only alternative so the text stays
   * unambiguous as the basis toggles. Optional.
   */
  basisLabel?: string;
  /**
   * Plain-language message exposed to assistive technology when the comparison
   * is unavailable. Rendered in place of the chart; no graphic is drawn.
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
  buyBand?: [number, number]; // [pessimistic, optimistic] for the Area; omitted when Buy is hidden
  buyBase?: number;
  rentBand?: [number, number];
  rentBase?: number;
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

/**
 * Percent of a path's own starting (year-0 base) value — the "percent of that
 * path's relevant base" the design's tooltip section calls for. Rendered as the
 * total value relative to where the path started (e.g. 180.0% = 1.8× the
 * starting value). Omitted when there is no meaningful denominator.
 */
function percentOfStart(value: number, start: number): string {
  if (!Number.isFinite(start) || start === 0) {
    return '';
  }
  return formatPercent((value / start) * 100);
}

export function TwoPathChart({
  bands,
  breakevenYear = null,
  basisLabel,
  unavailableMessage,
  buyLabel = 'Buy',
  rentLabel = 'Rent',
}: TwoPathChartProps) {
  const [tooltip, setTooltip] = useState<TooltipTarget | null>(null);
  // Click-to-hide state: paths whose band/line are hidden. Reflected in both the
  // chart and the text alternative (hidden rows annotated).
  const [hidden, setHidden] = useState<Set<PathKey>>(() => new Set());

  const toggle = (id: string) => {
    if (id !== 'buy' && id !== 'rent') {
      return;
    }
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const buyHidden = hidden.has('buy');
  const rentHidden = hidden.has('rent');

  // Merge both paths' bands into one row per year so Recharts can draw each
  // band Area + base Line against a shared x-axis. A hidden path contributes no
  // series values, so Recharts simply does not draw it.
  const chartData = useMemo<ChartRow[]>(() => {
    if (!hasBands(bands)) {
      return [];
    }
    const rows: ChartRow[] = [];
    for (let year = 0; year < bands.buy.base.length; year += 1) {
      if (!hasValueAt(bands, year)) {
        continue;
      }
      const row: ChartRow = { year };
      if (!buyHidden) {
        row.buyBand = [bands.buy.pessimistic[year], bands.buy.optimistic[year]];
        row.buyBase = bands.buy.base[year];
      }
      if (!rentHidden) {
        row.rentBand = [
          bands.rent.pessimistic[year],
          bands.rent.optimistic[year],
        ];
        row.rentBase = bands.rent.base[year];
      }
      rows.push(row);
    }
    return rows;
  }, [bands, buyHidden, rentHidden]);

  // Comparison unavailable → render no chart graphic; expose the message to
  // assistive tech instead.
  if (!hasBands(bands) || chartData.length === 0) {
    if (unavailableMessage) {
      return <p role="status">{unavailableMessage}</p>;
    }
    return null;
  }

  const lastYear = bands.buy.base.length - 1;
  const hiddenPaths = { buy: buyHidden, rent: rentHidden };
  const altRows = buildAltRows(bands, lastYear, breakevenYear, hiddenPaths, {
    buyLabel,
    rentLabel,
  });

  const basisSuffix = basisLabel ? ` in ${basisLabel}` : '';

  // The breakeven marker is only drawn when a breakeven year exists and sits
  // within the plotted range.
  const showBreakevenMarker =
    breakevenYear !== null &&
    breakevenYear >= 0 &&
    breakevenYear <= lastYear;

  const legendItems: LegendItem[] = [
    {
      id: 'buy',
      label: `${buyLabel} (solid line)`,
      color: BUY_COLOR,
      shape: 'solid',
    },
    {
      id: 'rent',
      label: `${rentLabel} (dashed line)`,
      color: RENT_COLOR,
      shape: 'dashed',
    },
  ];

  return (
    <figure aria-labelledby="two-path-chart-alt" className="flex flex-col gap-4">
      {/*
        Authoritative, screen-reader-only text alternative. Lists the year-10
        Buy and Rent values for the base, optimistic, and pessimistic bands plus
        the Breakeven_Year, with tabular numerals. A path hidden via the
        click-to-hide legend is annotated "(hidden)" so assistive-tech users
        perceive the same visible state. The figure is labeled by this list so
        assistive tech announces the content rather than the decorative SVG.
      */}
      <dl id="two-path-chart-alt" className="sr-only tabular-nums">
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
            {!buyHidden ? (
              <Area
                dataKey="buyBand"
                stroke="none"
                fill={BUY_BAND}
                fillOpacity={0.7}
                isAnimationActive={false}
              />
            ) : null}
            {!buyHidden ? (
              <Line
                dataKey="buyBase"
                stroke={BUY_COLOR}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ) : null}
            {/* Rent band + dashed base line — shape cue, not color (R1.1). */}
            {!rentHidden ? (
              <Area
                dataKey="rentBand"
                stroke="none"
                fill={RENT_BAND}
                fillOpacity={0.5}
                isAnimationActive={false}
              />
            ) : null}
            {!rentHidden ? (
              <Line
                dataKey="rentBase"
                stroke={RENT_COLOR}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
              />
            ) : null}
            {/*
              Labeled Breakeven_Marker: a vertical reference at the breakeven
              year with a visible label. Shown only when a breakeven exists
              within the plotted range; absent when breakevenYear is null.
            */}
            {showBreakevenMarker ? (
              <ReferenceLine
                x={breakevenYear ?? undefined}
                stroke="#475569"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                label={{
                  value: `Breakeven · year ${breakevenYear}`,
                  position: 'insideTopRight',
                  fill: '#334155',
                  fontSize: 12,
                }}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/*
        Click-to-hide legend (shared interactive ChartLegend). Toggling an item
        hides that path's band in the chart and annotates its rows "(hidden)" in
        the text alternative. Each item pairs a shape cue (solid / dashed line
        sample) with the text label, so the paths are identified without relying
        on color alone (R1.4, R3.4).
      */}
      <ChartLegend
        items={legendItems}
        hidden={hidden as Set<string>}
        onToggle={toggle}
      />

      {/*
        Keyboard-reachable call-outs. Because the SVG is aria-hidden, these
        focusable buttons give keyboard users the same tooltip a mouse user gets
        on hover (R3.2): focusing or hovering one reveals the year, the path,
        that point's dollar value, and its percent of the path's starting value;
        blur/leave dismisses it. A hidden path's call-outs are omitted so the
        keyboard surface matches the visible state. The 200 ms budget is met
        with instant, synchronous state updates.
      */}
      <div className="flex flex-col gap-4">
        {!buyHidden ? (
          <CallOutGroup
            path="buy"
            label={buyLabel}
            bands={bands.buy}
            activeTooltip={tooltip}
            onShow={setTooltip}
            onHide={() => setTooltip(null)}
          />
        ) : null}
        {!rentHidden ? (
          <CallOutGroup
            path="rent"
            label={rentLabel}
            bands={bands.rent}
            activeTooltip={tooltip}
            onShow={setTooltip}
            onHide={() => setTooltip(null)}
          />
        ) : null}
      </div>
    </figure>
  );
}

/**
 * One group of focusable call-out buttons for a path: the three bands at each
 * called-out horizon. Each button owns its own tooltip, shown on focus and
 * hover and dismissed on blur and leave. The tooltip shows dollars AND the
 * value's percent of the path's own starting (year-0 base) value.
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
  // Each path's "relevant base" for the percent is its own starting value.
  const start = bands.base[0];
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
                const pct = percentOfStart(value, start);
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
                        ].toLowerCase()} ${formatCurrency(value)}${
                          pct ? ` (${pct} of starting value)` : ''
                        }`}
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
 * value for each path, plus the Breakeven_Year statement. A path hidden via the
 * click-to-hide legend is annotated "(hidden)" so the text alternative reflects
 * the same visible state.
 */
function buildAltRows(
  bands: ComparisonBands,
  year: number,
  breakevenYear: number | null,
  hiddenPaths: Record<PathKey, boolean>,
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
    const hiddenSuffix = hiddenPaths[path] ? ' (hidden)' : '';
    rows.push({
      key: `${path}-${year}`,
      text: `${label}${hiddenSuffix}, year ${year}: base ${formatCurrency(
        base,
      )}, optimistic ${formatCurrency(opt)}, pessimistic ${formatCurrency(pess)}.`,
    });
  };

  for (const path of PATH_KEYS) {
    describe(path, path === 'buy' ? labels.buyLabel : labels.rentLabel);
  }

  rows.push({
    key: 'breakeven',
    text:
      breakevenYear === null
        ? 'Buying does not overtake renting within 10 years.'
        : `Breakeven year: buying catches up to renting at year ${breakevenYear}.`,
  });

  return rows;
}

export default TwoPathChart;
