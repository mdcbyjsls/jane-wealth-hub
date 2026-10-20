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

import type { ProjectedPoint, ScenarioSeries } from '@/types/market';
import { formatCurrency, formatPercent } from '@/lib/format';

/**
 * Band chart of a long-term wealth projection plus a programmatically
 * associated text alternative (R11.1, R11.5).
 *
 * The visual is a Recharts band: an `Area` spanning the pessimistic→optimistic
 * range with the base series drawn as a line inside it (R4.3). When a target
 * allocation is supplied, a second band and base line are drawn so the current
 * and target projections can be compared (R7.3). The two series are told apart
 * by a *shape* cue — the current base line is solid, the target base line is
 * dashed — and by a labeled legend, never by color alone (R7.4).
 *
 * Accessibility, mirroring {@link AllocationPie}'s house pattern:
 * - The Recharts `<svg>` is decorative and hidden from assistive technology
 *   (`aria-hidden`), so it is never the only source of the data (R11.5).
 * - A visually-hidden `<dl>` carries the authoritative content — the base,
 *   optimistic, and pessimistic value at years 10/20/30 with tabular numerals —
 *   and the `<figure>` references it via `aria-labelledby` (R11.1).
 * - A row of focusable call-out buttons (one per scenario at each horizon) sits
 *   outside the hidden SVG so a keyboard user gets the same hover tooltip a
 *   mouse user gets: focusing a button shows the year, that scenario's dollar
 *   value, and the percent change from the Projected_Base to one decimal
 *   (R11.2); blur/leave dismisses it (R11.3).
 *
 * When the projection data is unavailable the component renders nothing — no
 * chart graphic (R11.6); the empty/error copy lives in sibling components.
 *
 * Presentational only: series in, markup out. No data fetching, no state
 * beyond the transient focused/hovered tooltip target.
 */

/** The horizons called out everywhere in this view (R11.1, R4.2). */
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
 * not color (R7.4).
 */
type SeriesKind = 'current' | 'target';

/** Line/area colors. These are a visual aid only; shape + text carry meaning. */
const CURRENT_COLOR = '#0f1e3d'; // deep navy (primary)
const CURRENT_BAND = '#c7d2e8'; // light navy tint for the band fill
const TARGET_COLOR = '#0d94ae'; // teal
const TARGET_BAND = '#cdeaf0'; // light teal tint for the band fill

export interface ProjectionChartProps {
  /** The current-allocation scenario series (base/optimistic/pessimistic). */
  current: ScenarioSeries;
  /** The optional target-allocation scenario series, when a target exists. */
  target?: ScenarioSeries;
  /**
   * The Projected_Base (year-0 invested value). Percent-change figures in the
   * tooltip are measured from this, per R11.2.
   */
  projectedBase: number;
  /**
   * Label describing the active Dollar_Basis (e.g. "future dollars" /
   * "today's dollars"), shown in the sr-only alternative so the text remains
   * unambiguous as the basis toggles (R5.4). Optional.
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

/** Percent change from the base to `value`, to one decimal (R11.2). */
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

export function ProjectionChart({
  current,
  target,
  projectedBase,
  basisLabel,
  currentLabel = 'Current allocation',
  targetLabel = 'Target allocation',
}: ProjectionChartProps) {
  const [tooltip, setTooltip] = useState<TooltipTarget | null>(null);

  const hasTarget = hasPoints(target);

  // Merge the current (and optional target) series into one row per year so
  // Recharts can draw the band Area + base Line against a shared x-axis.
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
      if (hasTarget && target) {
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
  }, [current, target, hasTarget]);

  // Nothing to project → render no chart graphic at all (R11.6).
  if (!hasPoints(current) || chartData.length === 0) {
    return null;
  }

  // Build the authoritative text-alternative rows: every scenario value at each
  // called-out horizon, for the current series and (when present) the target.
  const altRows = buildAltRows(current, hasTarget ? target : undefined, {
    currentLabel,
    targetLabel,
  });

  const basisSuffix = basisLabel ? ` in ${basisLabel}` : '';

  return (
    <figure
      aria-labelledby="projection-chart-alt"
      className="flex flex-col gap-4"
    >
      {/*
        Authoritative, screen-reader-only text alternative (R11.1). Lists the
        base, optimistic, and pessimistic value at years 10/20/30 with tabular
        numerals. The figure is labeled by this list so assistive tech announces
        the content rather than the decorative SVG below.
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
            {/* Current band: pessimistic→optimistic fill, solid base line inside. */}
            <Area
              dataKey="currentBand"
              stroke="none"
              fill={CURRENT_BAND}
              fillOpacity={0.7}
              isAnimationActive={false}
            />
            <Line
              dataKey="currentBase"
              stroke={CURRENT_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {hasTarget ? (
              <>
                {/* Target band + dashed base line — shape cue, not color (R7.4). */}
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
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/*
        Visible legend. The current/target distinction is carried by a line
        sample whose shape differs (solid vs dashed) AND by the text label, so
        the two series are identified without relying on color alone (R7.4).
      */}
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        <li className="flex items-center gap-2">
          <LineSample kind="current" />
          <span className="text-sm font-medium text-slate-700">{`${currentLabel} (solid line)`}</span>
        </li>
        {hasTarget ? (
          <li className="flex items-center gap-2">
            <LineSample kind="target" />
            <span className="text-sm font-medium text-slate-700">{`${targetLabel} (dashed line)`}</span>
          </li>
        ) : null}
      </ul>

      {/*
        Keyboard-reachable call-outs. Because the SVG is aria-hidden, these
        focusable buttons give keyboard users the same tooltip a mouse user gets
        on hover (R11.2, R11.4): focusing or hovering one reveals the year, the
        focused scenario's dollar value, and the percent change from the
        Projected_Base to one decimal; blur/leave dismisses it (R11.3). The
        200 ms budget is met with instant, synchronous state updates.
      */}
      <div className="flex flex-col gap-4">
        <CallOutGroup
          kind="current"
          label={currentLabel}
          series={current}
          projectedBase={projectedBase}
          activeTooltip={tooltip}
          onShow={setTooltip}
          onHide={() => setTooltip(null)}
        />
        {hasTarget && target ? (
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

/** A small line sample for the legend: solid for current, dashed for target. */
function LineSample({ kind }: { kind: SeriesKind }) {
  const color = kind === 'current' ? CURRENT_COLOR : TARGET_COLOR;
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
        strokeDasharray={kind === 'target' ? '6 4' : undefined}
      />
    </svg>
  );
}

/**
 * One group of focusable call-out buttons for a series: three scenarios at each
 * of the three horizons. Each button owns its own tooltip, shown on focus and
 * hover and dismissed on blur and leave.
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
        {HORIZON_YEARS.map((year) => (
          <div
            key={year}
            className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3"
          >
            <span className="text-xs font-medium text-slate-500">{`Year ${year}`}</span>
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
                const target: TooltipTarget = { kind, scenario, year, value };
                const pct = percentChangeFromBase(value, projectedBase);
                return (
                  <button
                    key={scenario}
                    type="button"
                    className="relative flex items-baseline justify-between gap-2 rounded px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                    onMouseEnter={() => onShow(target)}
                    onMouseLeave={onHide}
                    onFocus={() => onShow(target)}
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
                        {`Year ${year}: ${SCENARIO_LABELS[scenario]} ${formatCurrency(
                          value,
                        )}${pct ? ` (${pct} vs. starting value)` : ''}`}
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

/** Build the sr-only description rows for the current (and optional target) series. */
function buildAltRows(
  current: ScenarioSeries,
  target: ScenarioSeries | undefined,
  labels: { currentLabel: string; targetLabel: string },
): AltRow[] {
  const rows: AltRow[] = [];
  const describe = (
    kind: SeriesKind,
    label: string,
    series: ScenarioSeries,
  ) => {
    for (const year of HORIZON_YEARS) {
      const base = valueAtYear(series.base, year);
      const opt = valueAtYear(series.optimistic, year);
      const pess = valueAtYear(series.pessimistic, year);
      if (base === undefined || opt === undefined || pess === undefined) {
        continue;
      }
      rows.push({
        key: `${kind}-${year}`,
        text: `${label}, year ${year}: base ${formatCurrency(
          base,
        )}, optimistic ${formatCurrency(opt)}, pessimistic ${formatCurrency(
          pess,
        )}.`,
      });
    }
  };

  describe('current', labels.currentLabel, current);
  if (target) {
    describe('target', labels.targetLabel, target);
  }
  return rows;
}

export default ProjectionChart;
