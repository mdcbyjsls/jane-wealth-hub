'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import type { ProjectedPoint, ScenarioSeries } from '@/types/market';
import { formatCurrency, formatPercent } from '@/lib/format';
import { SERIES } from '@/lib/chartColors';
import ChartLegend, { type LegendItem } from '@/components/charts/ChartLegend';

/**
 * FanChart — the long-term wealth projection as a shaded pessimistic→optimistic
 * fan with the base series as a line inside it, plus a programmatically
 * associated text alternative (R11.1 / Spec 4 R6.1, R6.2, R6.5, R3.*, R1.1).
 *
 * This evolves the prior `ProjectionChart` with the Spec 4 upgrades:
 * - The pessimistic→optimistic **band is drawn as a shaded fan** with the base
 *   line inside — the existing band pattern, kept intact (R6.1).
 * - **Labeled 10/20/30-year markers**: a vertical reference line at each
 *   horizon, a dot on the current base line, and a labeled call-out on the axis
 *   so the three decision horizons read at a glance (R6.2, R4.2).
 * - **Current vs target overlay** distinguished by *shape* (current = solid
 *   navy band+line, target = dashed teal band+line) **and** by a labeled
 *   legend — never by color alone (R3.4, carrying forward R7.4).
 * - **Click-to-hide legend** via the shared {@link ChartLegend}: toggling the
 *   current or target overlay hides it from the chart **and** annotates it
 *   "(hidden)" in the authoritative text alternative, so assistive-tech users
 *   perceive the same state (R3.3, R3.4).
 * - **Tooltips show dollars and percent change from the Projected_Base** on
 *   hover AND keyboard focus, via the focusable call-out buttons (R3.1, R3.2).
 * - All colors come from the shared `SERIES` module (R1.1).
 *
 * Dollar_Basis: the caller converts every series into the active basis before
 * passing it in and supplies `basisLabel`, exactly as before — this component
 * stays presentational and never reads the basis itself (R6.5 honored by the
 * owning island's DollarBasisToggle).
 *
 * Accessibility pattern (unchanged house style):
 * - The Recharts `<svg>` is decorative and hidden from assistive technology
 *   (`aria-hidden`), so it is never the only source of the data (R11.5).
 * - A visually-hidden `<dl>` carries the authoritative content — the base,
 *   optimistic, and pessimistic value at years 10/20/30 with tabular numerals,
 *   with any hidden overlay annotated — and the `<figure>` references it via
 *   `aria-labelledby` (R11.1).
 * - Focusable call-out buttons outside the hidden SVG give keyboard users the
 *   same hover tooltip (year, scenario dollar value, percent change from the
 *   Projected_Base to one decimal); blur/leave dismisses it (R11.2, R11.3).
 *
 * When the projection data is unavailable the component renders nothing — no
 * chart graphic (R11.6); the empty/error copy lives in sibling components.
 *
 * Presentational only: series in, markup out. No data fetching; the only state
 * is the transient focused/hovered tooltip target and the hidden-overlay set.
 */

/** The horizons called out everywhere in this view (R11.1, R4.2, R6.2). */
const HORIZON_YEARS = [10, 20, 30] as const;

/** The three scenarios, in a fixed display order. */
const SCENARIO_KEYS = ['optimistic', 'base', 'pessimistic'] as const;
type ScenarioKey = (typeof SCENARIO_KEYS)[number];

const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  optimistic: 'Optimistic',
  base: 'Base',
  pessimistic: 'Pessimistic',
};

/**
 * Which allocation a series belongs to. The current/target distinction is
 * carried by a solid vs dashed base line plus the legend text — a shape cue,
 * not color (R3.4). Also the stable toggle id in the click-to-hide legend.
 */
type SeriesKind = 'current' | 'target';

/**
 * Line/area colors, drawn from the shared color module (`@/lib/chartColors`)
 * so Current/Target use the same navy/teal as Buy/Rent everywhere. These are a
 * visual aid only; shape (solid vs dashed) + text carry meaning (R3.4).
 */
const CURRENT_COLOR = SERIES.primary; // navy (Current)
const CURRENT_BAND = SERIES.primaryBand; // navy band tint
const TARGET_COLOR = SERIES.secondary; // teal (Target)
const TARGET_BAND = SERIES.secondaryBand; // teal band tint

export interface FanChartProps {
  /** The current-allocation scenario series (base/optimistic/pessimistic). */
  current: ScenarioSeries;
  /** The optional target-allocation scenario series, when a target exists. */
  target?: ScenarioSeries;
  /**
   * The Projected_Base (year-0 invested value). Percent-change figures in the
   * tooltip are measured from this, per R11.2 / R3.2.
   */
  projectedBase: number;
  /**
   * Label describing the active Dollar_Basis (e.g. "future dollars" /
   * "today's dollars"), shown in the sr-only alternative so the text remains
   * unambiguous as the basis toggles (R6.5). Optional.
   */
  basisLabel?: string;
  /** Legend label for the current series. Defaults to "Current allocation". */
  currentLabel?: string;
  /** Legend label for the target series. Defaults to "Target allocation". */
  targetLabel?: string;
}

/** A single merged chart row: year plus every series value Recharts needs. */
interface ChartRow {
  year: number;
  currentBand: [number, number]; // [pessimistic, optimistic] for the Area
  currentBase: number;
  targetBand?: [number, number];
  targetBase?: number;
}

/** Identifies which focusable call-out (and thus tooltip) is active. */
interface TooltipTarget {
  kind: SeriesKind;
  scenario: ScenarioKey;
  year: number;
  value: number;
}

/** Look up a scenario's value at a given calendar year. */
function valueAtYear(points: ProjectedPoint[], year: number): number | undefined {
  return points.find((p) => p.year === year)?.value;
}

/** Percent change from the base to `value`, to one decimal (R11.2 / R3.2). */
function percentChangeFromBase(value: number, projectedBase: number): string {
  if (!Number.isFinite(projectedBase) || projectedBase === 0) {
    // No meaningful denominator — omit the percent rather than divide by zero.
    return '';
  }
  return formatPercent(((value - projectedBase) / projectedBase) * 100);
}

/** True when a series has at least one usable point. */
function hasPoints(series: ScenarioSeries | undefined): series is ScenarioSeries {
  return (
    !!series &&
    series.base.length > 0 &&
    series.optimistic.length > 0 &&
    series.pessimistic.length > 0
  );
}

export function FanChart({
  current,
  target,
  projectedBase,
  basisLabel,
  currentLabel = 'Current allocation',
  targetLabel = 'Target allocation',
}: FanChartProps) {
  const [tooltip, setTooltip] = useState<TooltipTarget | null>(null);
  // Controlled hidden-overlay set for the click-to-hide legend (R3.3). Keyed by
  // SeriesKind. The chart and the text alternative both honor it.
  const [hidden, setHidden] = useState<Set<SeriesKind>>(() => new Set());

  const hasTarget = hasPoints(target);

  // Visibility after the click-to-hide toggles. Current can also be hidden, but
  // if everything is hidden there is nothing to draw — the toggles still work.
  const showCurrent = !hidden.has('current');
  const showTarget = hasTarget && !hidden.has('target');

  const toggleKind = (id: string) => {
    const kind = id as SeriesKind;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
    // Dismiss any open tooltip whose series just got hidden.
    setTooltip((t) => (t && t.kind === kind ? null : t));
  };

  // Merge the current (and optional target) series into one row per year so
  // Recharts can draw the band Area + base Line against a shared x-axis. Hidden
  // overlays are omitted from the drawn rows (R3.3).
  const chartData = useMemo<ChartRow[]>(() => {
    if (!hasPoints(current)) {
      return [];
    }
    return current.base.map((point) => {
      const year = point.year;
      const pess = valueAtYear(current.pessimistic, year) ?? point.value;
      const opt = valueAtYear(current.optimistic, year) ?? point.value;
      const row: ChartRow = {
        year,
        currentBand: [pess, opt],
        currentBase: point.value,
      };
      if (showTarget && target) {
        const tPess = valueAtYear(target.pessimistic, year);
        const tOpt = valueAtYear(target.optimistic, year);
        const tBase = valueAtYear(target.base, year);
        if (tPess !== undefined && tOpt !== undefined && tBase !== undefined) {
          row.targetBand = [tPess, tOpt];
          row.targetBase = tBase;
        }
      }
      return row;
    });
  }, [current, target, showTarget]);

  // Nothing to project → render no chart graphic at all (R11.6).
  if (!hasPoints(current) || chartData.length === 0) {
    return null;
  }

  // Which calendar years from HORIZON_YEARS exist on the x-axis, and the
  // current base value at each — used for the labeled 10/20/30 markers (R6.2).
  const firstYear = current.base[0]?.year ?? 0;
  const horizonMarkers = HORIZON_YEARS.map((offset) => {
    const year = firstYear + offset;
    const baseValue = valueAtYear(current.base, year);
    return { offset, year, baseValue };
  }).filter((m) => m.baseValue !== undefined) as Array<{
    offset: number;
    year: number;
    baseValue: number;
  }>;

  // Build the authoritative text-alternative rows: every scenario value at each
  // called-out horizon, for the current series and (when present) the target.
  // Hidden overlays are annotated so assistive tech perceives the same state.
  const altRows = buildAltRows(current, hasTarget ? target : undefined, {
    currentLabel,
    targetLabel,
    currentHidden: !showCurrent,
    targetHidden: hasTarget && !showTarget,
  });

  const basisSuffix = basisLabel ? ` in ${basisLabel}` : '';

  // Legend items for the shared click-to-hide legend. Shape cue (solid/dashed)
  // + text label identify each overlay without relying on color (R3.4).
  const legendItems: LegendItem[] = [
    {
      id: 'current',
      label: `${currentLabel} (solid line)`,
      color: CURRENT_COLOR,
      shape: 'solid',
    },
  ];
  if (hasTarget) {
    legendItems.push({
      id: 'target',
      label: `${targetLabel} (dashed line)`,
      color: TARGET_COLOR,
      shape: 'dashed',
    });
  }
  // The legend is interactive only when there is more than one overlay to
  // toggle; a single-series projection keeps a static legend (R3.3).
  const hiddenIds = new Set<string>([...hidden]);

  return (
    <figure aria-labelledby="projection-chart-alt" className="flex flex-col gap-4">
      {/*
        Authoritative, screen-reader-only text alternative (R11.1). Lists the
        base, optimistic, and pessimistic value at years 10/20/30 with tabular
        numerals, with any hidden overlay annotated "(hidden)". The figure is
        labeled by this list so assistive tech announces the content rather than
        the decorative SVG below.
      */}
      <dl id="projection-chart-alt" className="sr-only tabular-nums">
        <dt>{`Projected wealth at years 10, 20, and 30${basisSuffix}`}</dt>
        {altRows.map((row) => (
          <dd key={row.key}>{row.text}</dd>
        ))}
      </dl>

      {/* Decorative chart: hidden from assistive tech, which reads the list above. */}
      <div aria-hidden="true" className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 24, right: 16, bottom: 8, left: 16 }}
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

            {/* Labeled 10/20/30-year markers: a reference line at each horizon
                with a "Year N" call-out, plus a dot on the current base line
                (R6.2). Shape + label, independent of the series colors. */}
            {horizonMarkers.map((m) => (
              <ReferenceLine
                key={`line-${m.offset}`}
                x={m.year}
                stroke="#94a3b8"
                strokeDasharray="3 3"
                label={{
                  value: `Year ${m.offset}`,
                  position: 'top',
                  fill: '#475569',
                  fontSize: 11,
                }}
              />
            ))}

            {/* Current band: pessimistic→optimistic fill, solid base line inside. */}
            {showCurrent ? (
              <Area
                dataKey="currentBand"
                stroke="none"
                fill={CURRENT_BAND}
                fillOpacity={0.7}
                isAnimationActive={false}
              />
            ) : null}
            {showCurrent ? (
              <Line
                dataKey="currentBase"
                stroke={CURRENT_COLOR}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ) : null}

            {showTarget ? (
              <>
                {/* Target band + dashed base line — shape cue, not color (R3.4). */}
                <Area
                  dataKey="targetBand"
                  stroke="none"
                  fill={TARGET_BAND}
                  fillOpacity={0.5}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="targetBase"
                  stroke={TARGET_COLOR}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  isAnimationActive={false}
                />
              </>
            ) : null}

            {/* Dots marking the current base value at each horizon (R6.2). */}
            {showCurrent
              ? horizonMarkers.map((m) => (
                  <ReferenceDot
                    key={`dot-${m.offset}`}
                    x={m.year}
                    y={m.baseValue}
                    r={4}
                    fill={CURRENT_COLOR}
                    stroke="#ffffff"
                    strokeWidth={1}
                  />
                ))
              : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/*
        Visible legend via the shared ChartLegend. The current/target distinction
        is carried by a line sample whose shape differs (solid vs dashed) AND by
        the text label, so the overlays are identified without relying on color
        alone (R3.4). When a target exists the legend is interactive — clicking an
        item hides that overlay in the chart and annotates it in the text
        alternative (R3.3); a single-series projection keeps it static.
      */}
      <ChartLegend
        items={legendItems}
        hidden={hasTarget ? hiddenIds : undefined}
        onToggle={hasTarget ? toggleKind : undefined}
      />

      {/*
        Keyboard-reachable call-outs. Because the SVG is aria-hidden, these
        focusable buttons give keyboard users the same tooltip a mouse user gets
        on hover (R11.2, R3.1): focusing or hovering one reveals the year, the
        focused scenario's dollar value, and the percent change from the
        Projected_Base to one decimal (R3.2); blur/leave dismisses it (R11.3). A
        hidden overlay's call-out group is omitted so the keyboard surface matches
        the visible chart.
      */}
      <div className="flex flex-col gap-4">
        {showCurrent ? (
          <CallOutGroup
            kind="current"
            label={currentLabel}
            series={current}
            projectedBase={projectedBase}
            activeTooltip={tooltip}
            onShow={setTooltip}
            onHide={() => setTooltip(null)}
          />
        ) : null}
        {showTarget && target ? (
          <CallOutGroup
            kind="target"
            label={targetLabel}
            series={target}
            projectedBase={projectedBase}
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
 * One group of focusable call-out buttons for a series: three scenarios at each
 * of the three horizons. Each button owns its own tooltip, shown on focus and
 * hover and dismissed on blur and leave. The tooltip shows dollars plus the
 * percent change from the Projected_Base (R3.2).
 */
function CallOutGroup({
  kind,
  label,
  series,
  projectedBase,
  activeTooltip,
  onShow,
  onHide,
}: {
  kind: SeriesKind;
  label: string;
  series: ScenarioSeries;
  projectedBase: number;
  activeTooltip: TooltipTarget | null;
  onShow: (t: TooltipTarget) => void;
  onHide: () => void;
}) {
  return (
    <section
      aria-label={`${label} projected ranges at years 10, 20, and 30`}
      className="flex flex-col gap-3"
    >
      <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {HORIZON_YEARS.map((offset) => {
          const firstYear = series.base[0]?.year ?? 0;
          const year = firstYear + offset;
          return (
            <div
              key={offset}
              className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3"
            >
              <span className="text-xs font-medium text-slate-500">{`Year ${offset}`}</span>
              <div className="flex flex-col gap-1">
                {SCENARIO_KEYS.map((scenario) => {
                  const value = valueAtYear(series[scenario], year);
                  if (value === undefined) {
                    return null;
                  }
                  const isActive =
                    activeTooltip?.kind === kind &&
                    activeTooltip.scenario === scenario &&
                    activeTooltip.year === year;
                  const tgt: TooltipTarget = { kind, scenario, year, value };
                  const pct = percentChangeFromBase(value, projectedBase);
                  return (
                    <button
                      key={scenario}
                      type="button"
                      className="relative flex items-baseline justify-between gap-2 rounded px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                      onMouseEnter={() => onShow(tgt)}
                      onMouseLeave={onHide}
                      onFocus={() => onShow(tgt)}
                      onBlur={onHide}
                    >
                      <span className="text-xs text-slate-500">
                        {SCENARIO_LABELS[scenario]}
                      </span>
                      <span className="text-sm font-semibold text-slate-900 tabular-nums">
                        {formatCurrency(value)}
                      </span>
                      {isActive ? (
                        <span
                          role="tooltip"
                          className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white tabular-nums shadow"
                        >
                          {`Year ${offset}: ${SCENARIO_LABELS[scenario]} ${formatCurrency(
                            value,
                          )}${pct ? ` (${pct} vs. starting value)` : ''}`}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface AltRow {
  key: string;
  text: string;
}

/**
 * Build the sr-only description rows for the current (and optional target)
 * series. A hidden overlay is annotated "(hidden)" and its per-year values are
 * omitted, so assistive-tech users perceive the same click-to-hide state the
 * sighted chart shows (R3.3).
 */
function buildAltRows(
  current: ScenarioSeries,
  target: ScenarioSeries | undefined,
  opts: {
    currentLabel: string;
    targetLabel: string;
    currentHidden: boolean;
    targetHidden: boolean;
  },
): AltRow[] {
  const rows: AltRow[] = [];

  const describe = (
    kind: SeriesKind,
    label: string,
    series: ScenarioSeries,
    isHidden: boolean,
  ) => {
    if (isHidden) {
      rows.push({ key: `${kind}-hidden`, text: `${label} (hidden).` });
      return;
    }
    const firstYear = series.base[0]?.year ?? 0;
    for (const offset of HORIZON_YEARS) {
      const year = firstYear + offset;
      const base = valueAtYear(series.base, year);
      const opt = valueAtYear(series.optimistic, year);
      const pess = valueAtYear(series.pessimistic, year);
      if (base === undefined || opt === undefined || pess === undefined) {
        continue;
      }
      rows.push({
        key: `${kind}-${offset}`,
        text: `${label}, year ${offset}: base ${formatCurrency(
          base,
        )}, optimistic ${formatCurrency(opt)}, pessimistic ${formatCurrency(
          pess,
        )}.`,
      });
    }
  };

  describe('current', opts.currentLabel, current, opts.currentHidden);
  if (target) {
    describe('target', opts.targetLabel, target, opts.targetHidden);
  }
  return rows;
}

export default FanChart;
