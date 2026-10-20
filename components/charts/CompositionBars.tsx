'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import type { Year10Composition } from '@/types/buyVsRent';
import { formatCurrency, formatPercent } from '@/lib/format';
import { SERIES } from '@/lib/chartColors';
import { ChartLegend, type LegendItem } from '@/components/charts/ChartLegend';

/**
 * Composition_Bars — two stacked year-10 bars breaking each path's net worth
 * into its parts (Spec 4 R5.6, R2.4), with a programmatically associated text
 * alternative (R3.1, R3.2) and a Click_To_Hide_Legend (R3.4).
 *
 * The Buy bar stacks two segments — home equity and side investments — and the
 * Rent bar is a single investments segment. The three segments are told apart
 * by distinct fills from the shared color module AND by a labeled legend, never
 * by color alone (R1.1, R1.4): every segment carries a text label in the
 * legend and in the authoritative text alternative.
 *
 * Accessibility, mirroring {@link ComparisonChart} / {@link ChartLegend}:
 * - The Recharts `<svg>` is decorative and hidden from assistive technology
 *   (`aria-hidden`), so it is never the only source of the data (R3.1).
 * - A visually-hidden `<dl>` carries the authoritative content — each visible
 *   segment's dollars and its percent of that bar's total, with tabular
 *   numerals — and the `<figure>` references it via `aria-labelledby`. Hidden
 *   segments (toggled off in the legend) are reflected here: they drop out of
 *   the list and the per-bar totals recompute, so the text alternative always
 *   matches what the chart shows (R3.4).
 * - A row of focusable call-out buttons (one per visible segment) sits outside
 *   the hidden SVG so a keyboard user gets the same tooltip a mouse user gets
 *   on hover (R3.2): focusing or hovering a button shows the segment label, its
 *   dollars, and its percent of the bar; blur/leave dismisses it. Updates are
 *   synchronous state writes, well within the 200 ms budget.
 *
 * Presentational only: a resolved {@link Year10Composition} in, markup out. The
 * client island computes the composition via `computeYear10Composition`; this
 * component never calls a calculator or fetches data. The caller passes values
 * already in the active Dollar_Basis and an optional `basisLabel` so the text
 * alternative stays unambiguous as the basis toggles.
 */

/** The three stackable segments across both bars, in fixed stacking order. */
type SegmentKey = 'homeEquity' | 'sideInvestments' | 'investments';

/** Which bar a segment belongs to. */
type BarKey = 'buy' | 'rent';

interface SegmentMeta {
  key: SegmentKey;
  label: string;
  bar: BarKey;
  color: string;
}

/**
 * Segment definitions: label, owning bar, and fill. Colors come from the shared
 * `SERIES` module so Buy segments read as navy and the Rent segment as teal,
 * matching the two paths elsewhere; the Buy bar's two segments use the solid
 * color and its band tint so they stay distinguishable within the stack. These
 * are a visual aid only — the legend/label text carries the meaning (R1.4).
 */
const SEGMENTS: readonly SegmentMeta[] = [
  { key: 'homeEquity', label: 'Home equity', bar: 'buy', color: SERIES.primary },
  {
    key: 'sideInvestments',
    label: 'Side investments',
    bar: 'buy',
    color: SERIES.primaryBand,
  },
  { key: 'investments', label: 'Investments', bar: 'rent', color: SERIES.secondary },
] as const;

const BAR_LABELS: Record<BarKey, string> = {
  buy: 'Buy',
  rent: 'Rent',
};

export interface CompositionBarsProps {
  /**
   * The resolved year-10 composition for both paths, already expressed in the
   * active Dollar_Basis by the caller. When omitted or incomplete the chart
   * renders no graphic and exposes `unavailableMessage`.
   */
  composition?: Year10Composition;
  /**
   * Label describing the active Dollar_Basis (e.g. "future dollars" /
   * "today's dollars"), shown in the sr-only alternative so the text stays
   * unambiguous as the basis toggles. Optional.
   */
  basisLabel?: string;
  /**
   * Plain-language message exposed to assistive technology when the
   * composition is unavailable. Rendered in place of the chart; no graphic is
   * drawn.
   */
  unavailableMessage?: string;
}

/** A single bar's row for Recharts: one numeric field per segment key. */
interface ChartRow {
  bar: BarKey;
  barLabel: string;
  homeEquity: number;
  sideInvestments: number;
  investments: number;
}

/** Identifies which focusable call-out (and thus tooltip) is active. */
interface TooltipTarget {
  bar: BarKey;
  segment: SegmentKey;
  value: number;
  percent: number;
}

/** True when the composition carries finite values for every segment + total. */
function hasComposition(
  composition: Year10Composition | undefined,
): composition is Year10Composition {
  return (
    !!composition &&
    Number.isFinite(composition.buy.homeEquity) &&
    Number.isFinite(composition.buy.sideInvestments) &&
    Number.isFinite(composition.buy.total) &&
    Number.isFinite(composition.rent.investments) &&
    Number.isFinite(composition.rent.total)
  );
}

/** Percent of a bar's (visible) total a segment represents; 0 when the total is non-positive. */
function percentOfBar(value: number, barTotal: number): number {
  if (!Number.isFinite(barTotal) || barTotal <= 0) {
    return 0;
  }
  return (value / barTotal) * 100;
}

export function CompositionBars({
  composition,
  basisLabel,
  unavailableMessage,
}: CompositionBarsProps) {
  // Controlled hidden set for the Click_To_Hide_Legend; the chart and the text
  // alternative both read from it so the hidden state is reflected everywhere.
  const [hidden, setHidden] = useState<Set<SegmentKey>>(() => new Set());
  const [tooltip, setTooltip] = useState<TooltipTarget | null>(null);

  const toggle = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id as SegmentKey)) {
        next.delete(id as SegmentKey);
      } else {
        next.add(id as SegmentKey);
      }
      return next;
    });
  };

  // Per-segment dollar values, keyed for easy lookup.
  const values = useMemo<Record<SegmentKey, number>>(() => {
    if (!hasComposition(composition)) {
      return { homeEquity: 0, sideInvestments: 0, investments: 0 };
    }
    return {
      homeEquity: composition.buy.homeEquity,
      sideInvestments: composition.buy.sideInvestments,
      investments: composition.rent.investments,
    };
  }, [composition]);

  // One row per bar, with hidden segments zeroed so they drop out of the stack.
  const chartData = useMemo<ChartRow[]>(() => {
    const visible = (key: SegmentKey) => (hidden.has(key) ? 0 : values[key]);
    return [
      {
        bar: 'buy',
        barLabel: BAR_LABELS.buy,
        homeEquity: visible('homeEquity'),
        sideInvestments: visible('sideInvestments'),
        investments: 0,
      },
      {
        bar: 'rent',
        barLabel: BAR_LABELS.rent,
        homeEquity: 0,
        sideInvestments: 0,
        investments: visible('investments'),
      },
    ];
  }, [values, hidden]);

  if (!hasComposition(composition)) {
    if (unavailableMessage) {
      return <p role="status">{unavailableMessage}</p>;
    }
    return null;
  }

  // Visible totals per bar — recomputed from the visible segments so the
  // percents in the tooltips, legend, and text alternative all agree.
  const barTotals: Record<BarKey, number> = {
    buy:
      (hidden.has('homeEquity') ? 0 : values.homeEquity) +
      (hidden.has('sideInvestments') ? 0 : values.sideInvestments),
    rent: hidden.has('investments') ? 0 : values.investments,
  };

  const basisSuffix = basisLabel ? ` in ${basisLabel}` : '';

  // Authoritative sr-only rows: each visible segment's dollars and percent of
  // its bar; hidden segments are omitted and the per-bar totals reflect that.
  const altRows = SEGMENTS.filter((seg) => !hidden.has(seg.key)).map((seg) => {
    const value = values[seg.key];
    const percent = percentOfBar(value, barTotals[seg.bar]);
    return {
      key: seg.key,
      text: `${BAR_LABELS[seg.bar]}, ${seg.label}: ${formatCurrency(
        value,
      )}, ${formatPercent(percent)} of the ${BAR_LABELS[seg.bar].toLowerCase()} bar.`,
    };
  });

  // Legend items (interactive → Click_To_Hide_Legend). Each carries its dollars
  // as the value text; the swatch + label identify the segment without color.
  const legendItems: LegendItem[] = SEGMENTS.map((seg) => ({
    id: seg.key,
    label: seg.label,
    color: seg.color,
    shape: 'swatch',
    valueText: formatCurrency(values[seg.key]),
  }));

  const hiddenIds = new Set<string>(Array.from(hidden, (k) => k as string));

  return (
    <figure
      aria-labelledby="composition-bars-alt"
      className="flex flex-col gap-4"
    >
      {/*
        Authoritative, screen-reader-only text alternative (R3.1). Lists each
        visible segment's dollars and its percent of that bar's total, with
        tabular numerals. Hidden segments are omitted and totals recompute, so
        the list always matches the chart (R3.4).
      */}
      <dl id="composition-bars-alt" className="sr-only tabular-nums">
        <dt>{`Year 10 net worth composition for buying versus renting${basisSuffix}`}</dt>
        {altRows.length === 0 ? (
          <dd>All segments are hidden.</dd>
        ) : (
          altRows.map((row) => <dd key={row.key}>{row.text}</dd>)
        )}
      </dl>

      {/* Decorative chart: hidden from assistive tech, which reads the list above. */}
      <div aria-hidden="true" className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 8, right: 16, bottom: 8, left: 16 }}
          >
            <XAxis
              dataKey="barLabel"
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
            {SEGMENTS.map((seg) => (
              <Bar
                key={seg.key}
                dataKey={seg.key}
                stackId="composition"
                fill={seg.color}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/*
        Interactive legend — Click_To_Hide_Legend (R3.4). Toggling a segment
        updates the controlled `hidden` set, which the chart and the text
        alternative both read, so the hidden state is reflected everywhere.
      */}
      <ChartLegend items={legendItems} hidden={hiddenIds} onToggle={toggle} />

      {/*
        Keyboard-reachable call-outs. Because the SVG is aria-hidden, these
        focusable buttons give keyboard users the same tooltip a mouse user gets
        on hover (R3.2): focusing or hovering one reveals the segment label, its
        dollars, and its percent of the bar; blur/leave dismisses it. Hidden
        segments drop out of this list too.
      */}
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        {(['buy', 'rent'] as const).map((bar) => {
          const segments = SEGMENTS.filter(
            (seg) => seg.bar === bar && !hidden.has(seg.key),
          );
          return (
            <section
              key={bar}
              aria-label={`${BAR_LABELS[bar]} year 10 composition`}
              className="flex flex-1 flex-col gap-3"
            >
              <h3 className="text-sm font-semibold text-slate-900">
                {BAR_LABELS[bar]}
              </h3>
              <div className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
                {segments.length === 0 ? (
                  <span className="text-xs text-slate-500">All segments hidden</span>
                ) : (
                  segments.map((seg) => {
                    const value = values[seg.key];
                    const percent = percentOfBar(value, barTotals[bar]);
                    const isActive =
                      tooltip?.bar === bar && tooltip.segment === seg.key;
                    const target: TooltipTarget = {
                      bar,
                      segment: seg.key,
                      value,
                      percent,
                    };
                    return (
                      <button
                        key={seg.key}
                        type="button"
                        className="relative flex items-baseline justify-between gap-2 rounded px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                        onMouseEnter={() => setTooltip(target)}
                        onMouseLeave={() => setTooltip(null)}
                        onFocus={() => setTooltip(target)}
                        onBlur={() => setTooltip(null)}
                      >
                        <span className="text-xs text-slate-500">{seg.label}</span>
                        <span className="text-sm font-semibold text-slate-900 tabular-nums">
                          {formatCurrency(value)}
                        </span>
                        {isActive ? (
                          <span
                            role="tooltip"
                            className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white tabular-nums shadow"
                          >
                            {`${BAR_LABELS[bar]} ${seg.label.toLowerCase()}: ${formatCurrency(
                              value,
                            )} (${formatPercent(percent)} of bar)`}
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

export default CompositionBars;
