'use client';

import { useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import type { AssetClass } from '@/types/accounts';
import type { ProjectedPoint } from '@/types/market';
import { formatCurrency, formatPercent } from '@/lib/format';
import { CLASS_COLORS, CLASS_LABELS } from '@/lib/chartColors';
import { ChartLegend, type LegendItem } from '@/components/charts/ChartLegend';

/**
 * GrowthByClassArea — a stacked area of each Asset_Class's value over the
 * projection horizon with NO rebalancing (Spec 4 R6.3, R6.4, R6.5, R3.*, R1.1).
 *
 * The chart visualizes `projectByClass`: each class projected independently at
 * its own Expected_Return from its own starting dollars, so higher-return
 * classes outgrow lower-return ones and the mix drifts apart year over year —
 * the "if you never rebalance" story. Because the four series are projected
 * independently, their stacked total is NOT the same as the Spec 2 base
 * projection (which assumes the mix stays constant); the heading and the
 * one-line note below state this explicitly (R6.4).
 *
 * House style, mirroring {@link FanChart} / {@link CompositionBars}:
 * - Classes are drawn in the shared `CLASS_LABELS` canonical order and filled
 *   with the shared `CLASS_COLORS`, so a class reads as the same color here as
 *   in every other view (R1.1). Color is a visual aid only — the legend text
 *   and the text alternative carry the meaning (R1.4).
 * - The Recharts `<svg>` is decorative and hidden from assistive technology
 *   (`aria-hidden`), so it is never the only source of the data (R3.1).
 * - A visually-hidden `<dl>` carries the authoritative content — each visible
 *   class's value and its percent of the stacked total at years 10/20/30, with
 *   tabular numerals — and the `<figure>` references it via `aria-labelledby`.
 *   Hidden classes (toggled off in the legend) drop out and the per-year totals
 *   recompute, so the text alternative always matches the chart (R3.3, R3.4).
 * - A Click_To_Hide_Legend via the shared {@link ChartLegend} toggles each
 *   class in the chart AND in the text alternative (R3.3, R3.4).
 * - Focusable call-out buttons outside the hidden SVG give keyboard users the
 *   same tooltip a mouse user gets on hover (R3.2): focusing or hovering one
 *   reveals the class, year, its dollars, and its percent of the stacked total;
 *   blur/leave dismisses it.
 *
 * Presentational only: the per-class map in, markup out. The client island
 * computes the series via `projectByClass`; this component never calls a
 * calculator or fetches data. The caller passes values already in the active
 * Dollar_Basis and an optional `basisLabel` so the text alternative stays
 * unambiguous as the basis toggles.
 */

/** The horizons called out in the text alternative and the call-outs (R6.5). */
const HORIZON_YEARS = [10, 20, 30] as const;

export interface GrowthByClassAreaProps {
  /**
   * Per-class projected points (year 0..horizon) from `projectByClass`, already
   * expressed in the active Dollar_Basis by the caller. When any class series
   * is empty the chart renders no graphic.
   */
  series: Record<AssetClass, ProjectedPoint[]>;
  /**
   * Label describing the active Dollar_Basis (e.g. "future dollars" /
   * "today's dollars"), shown in the sr-only alternative so the text stays
   * unambiguous as the basis toggles. Optional.
   */
  basisLabel?: string;
}

/** One merged chart row: year plus each class's value (hidden classes zeroed). */
interface ChartRow {
  year: number;
  stocks: number;
  bonds: number;
  cash: number;
  other: number;
}

/** Identifies which focusable call-out (and thus tooltip) is active. */
interface TooltipTarget {
  key: AssetClass;
  year: number;
  value: number;
  percent: number;
}

/** Look up a class's value at a given calendar year. */
function valueAtYear(points: ProjectedPoint[], year: number): number | undefined {
  return points.find((p) => p.year === year)?.value;
}

/** True when every class series carries at least one point. */
function hasSeries(series: Record<AssetClass, ProjectedPoint[]>): boolean {
  return CLASS_LABELS.every(({ key }) => (series[key]?.length ?? 0) > 0);
}

/** Percent of a stacked total a value represents; 0 when the total is non-positive. */
function percentOfTotal(value: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return (value / total) * 100;
}

export function GrowthByClassArea({ series, basisLabel }: GrowthByClassAreaProps) {
  // Controlled hidden set for the Click_To_Hide_Legend; the chart and the text
  // alternative both read from it so the hidden state is reflected everywhere.
  const [hidden, setHidden] = useState<Set<AssetClass>>(() => new Set());
  const [tooltip, setTooltip] = useState<TooltipTarget | null>(null);

  const toggle = (id: string) => {
    const key = id as AssetClass;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    // Dismiss any open tooltip whose class just got hidden.
    setTooltip((t) => (t && t.key === key ? null : t));
  };

  // The year axis comes from the (shared) horizon of any class series. Hidden
  // classes are zeroed so they drop out of the stack without changing the axis.
  const chartData = useMemo<ChartRow[]>(() => {
    if (!hasSeries(series)) {
      return [];
    }
    const years = series.stocks.map((p) => p.year);
    const visible = (key: AssetClass, year: number) =>
      hidden.has(key) ? 0 : valueAtYear(series[key], year) ?? 0;
    return years.map((year) => ({
      year,
      stocks: visible('stocks', year),
      bonds: visible('bonds', year),
      cash: visible('cash', year),
      other: visible('other', year),
    }));
  }, [series, hidden]);

  // Nothing to project → render no chart graphic at all (R3.1 companion to R11.6).
  if (!hasSeries(series) || chartData.length === 0) {
    return null;
  }

  const firstYear = series.stocks[0]?.year ?? 0;
  const basisSuffix = basisLabel ? ` in ${basisLabel}` : '';

  // Visible stacked total at a given year — recomputed from the visible classes
  // so the percents in the tooltips and text alternative all agree.
  const visibleTotalAt = (year: number): number =>
    CLASS_LABELS.reduce((sum, { key }) => {
      if (hidden.has(key)) {
        return sum;
      }
      return sum + (valueAtYear(series[key], year) ?? 0);
    }, 0);

  // Authoritative sr-only rows: for each called-out horizon, every visible
  // class's value and its percent of the stacked total. Hidden classes are
  // omitted and annotated so assistive tech perceives the same state (R3.3).
  const altRows: Array<{ key: string; text: string }> = [];
  for (const offset of HORIZON_YEARS) {
    const year = firstYear + offset;
    const total = visibleTotalAt(year);
    for (const { key, label } of CLASS_LABELS) {
      if (hidden.has(key)) {
        continue;
      }
      const value = valueAtYear(series[key], year);
      if (value === undefined) {
        continue;
      }
      altRows.push({
        key: `${key}-${offset}`,
        text: `Year ${offset}, ${label}: ${formatCurrency(value)}, ${formatPercent(
          percentOfTotal(value, total),
        )} of the stacked total.`,
      });
    }
  }
  const hiddenLabels = CLASS_LABELS.filter(({ key }) => hidden.has(key)).map(
    ({ label }) => label,
  );

  // Legend items (interactive → Click_To_Hide_Legend). Swatch + label identify
  // each class without relying on color (R1.4).
  const legendItems: LegendItem[] = CLASS_LABELS.map(({ key, label }) => ({
    id: key,
    label,
    color: CLASS_COLORS[key],
    shape: 'swatch',
  }));
  const hiddenIds = new Set<string>(Array.from(hidden, (k) => k as string));

  return (
    <figure
      aria-labelledby="growth-by-class-alt"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-slate-900">
          If you never rebalance
        </h3>
        {/* The one-line divergence note (R6.4): the stacked total differs from
            the base projection, which assumes the mix stays constant. */}
        <p className="text-sm text-slate-600">
          Each class grows at its own expected return with no rebalancing, so the
          mix drifts over time. The stacked total here differs from the base
          projection, which assumes your current mix stays constant.
        </p>
      </div>

      {/*
        Authoritative, screen-reader-only text alternative (R3.1). Lists each
        visible class's value and its percent of the stacked total at years
        10/20/30, with tabular numerals. Hidden classes are omitted and the
        per-year totals recompute, so the list always matches the chart (R3.3).
      */}
      <dl id="growth-by-class-alt" className="sr-only tabular-nums">
        <dt>{`Projected value by asset class at years 10, 20, and 30 with no rebalancing${basisSuffix}`}</dt>
        {altRows.map((row) => (
          <dd key={row.key}>{row.text}</dd>
        ))}
        {hiddenLabels.length > 0 ? (
          <dd>{`${hiddenLabels.join(', ')} ${
            hiddenLabels.length === 1 ? 'is' : 'are'
          } hidden.`}</dd>
        ) : null}
      </dl>

      {/* Decorative chart: hidden from assistive tech, which reads the list above. */}
      <div aria-hidden="true" className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
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
            {/* Stacked areas in CLASS_LABELS canonical order, each using CLASS_COLORS. */}
            {CLASS_LABELS.map(({ key }) => (
              <Area
                key={key}
                dataKey={key}
                stackId="byClass"
                stroke={CLASS_COLORS[key]}
                fill={CLASS_COLORS[key]}
                fillOpacity={0.75}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/*
        Interactive legend — Click_To_Hide_Legend (R3.4). Toggling a class
        updates the controlled `hidden` set, which the chart and the text
        alternative both read, so the hidden state is reflected everywhere.
      */}
      <ChartLegend items={legendItems} hidden={hiddenIds} onToggle={toggle} />

      {/*
        Keyboard-reachable call-outs. Because the SVG is aria-hidden, these
        focusable buttons give keyboard users the same tooltip a mouse user gets
        on hover (R3.2): focusing or hovering one reveals the class, its dollars,
        and its percent of the stacked total at that horizon; blur/leave
        dismisses it. Hidden classes drop out of this surface too.
      */}
      <div className="flex flex-col gap-3">
        {HORIZON_YEARS.map((offset) => {
          const year = firstYear + offset;
          const total = visibleTotalAt(year);
          const visibleClasses = CLASS_LABELS.filter(({ key }) => !hidden.has(key));
          return (
            <section
              key={offset}
              aria-label={`Year ${offset} value by asset class`}
              className="flex flex-col gap-2"
            >
              <h4 className="text-sm font-semibold text-slate-900">{`Year ${offset}`}</h4>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-50 p-3 sm:grid-cols-4">
                {visibleClasses.length === 0 ? (
                  <span className="text-xs text-slate-500">All classes hidden</span>
                ) : (
                  visibleClasses.map(({ key, label }) => {
                    const value = valueAtYear(series[key], year);
                    if (value === undefined) {
                      return null;
                    }
                    const percent = percentOfTotal(value, total);
                    const isActive =
                      tooltip?.key === key && tooltip.year === year;
                    const target: TooltipTarget = { key, year, value, percent };
                    return (
                      <button
                        key={key}
                        type="button"
                        className="relative flex flex-col items-start gap-0.5 rounded px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                        onMouseEnter={() => setTooltip(target)}
                        onMouseLeave={() => setTooltip(null)}
                        onFocus={() => setTooltip(target)}
                        onBlur={() => setTooltip(null)}
                      >
                        <span className="text-xs text-slate-500">{label}</span>
                        <span className="text-sm font-semibold text-slate-900 tabular-nums">
                          {formatCurrency(value)}
                        </span>
                        {isActive ? (
                          <span
                            role="tooltip"
                            className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white tabular-nums shadow"
                          >
                            {`Year ${offset} ${label.toLowerCase()}: ${formatCurrency(
                              value,
                            )} (${formatPercent(percent)} of total)`}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </figure>
  );
}

export default GrowthByClassArea;
