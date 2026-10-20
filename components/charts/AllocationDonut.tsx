'use client';

import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

import type {
  AllocationResult,
  AssetClass,
  ClassTotals,
  TargetAllocation,
} from '@/types/accounts';
import { formatCurrency, formatPercent, formatPercentLabel } from '@/lib/format';
import { CLASS_COLORS, CLASS_LABELS } from '@/lib/chartColors';
import ChartLegend, { type LegendItem } from '@/components/charts/ChartLegend';

/**
 * Allocation donut for the dashboard (Spec 4 — Per-view → Dashboard →
 * AllocationDonut). It evolves the earlier `AllocationPie` into a donut (an
 * inner radius) of the ACTUAL allocation, with the TARGET allocation drawn as a
 * concentric OUTER ring.
 *
 * Both rings draw each Asset_Class in the SAME color from the shared
 * `CLASS_COLORS` map — stocks navy, bonds teal, etc. — so a class reads the
 * same everywhere (R1.1). The two rings are told apart by POSITION (actual
 * inner, target outer) and by the legend/label, NEVER by a different hue per
 * class (R1.1, ui-style "never rely on color alone").
 *
 * Accessibility, mirroring {@link TwoPathChart} / the prior AllocationPie house
 * pattern:
 * - The Recharts `<svg>` is decorative and hidden from assistive technology
 *   (`aria-hidden`), so it is never the only source of the data (R3.1).
 * - A visually-hidden `<dl>` carries the authoritative content — every
 *   Asset_Class name paired with its actual and target percentage to one
 *   decimal place (R3.1, Property 20) — and the `<figure>` references it via
 *   `aria-labelledby` so a screen reader reads the figure as that list.
 * - A row of focusable call-out buttons sits outside the hidden SVG so a
 *   keyboard user gets the same tooltip a mouse user gets on hover (R3.2):
 *   focusing or hovering a class reveals its dollars and percent; blur/leave
 *   dismisses it.
 *
 * This is a single CONCEPTUAL series (one allocation, shown as actual + its
 * target reference), so the legend is STATIC — no click-to-hide. Each legend
 * item pairs a color swatch + the class label + the actual% and target%.
 *
 * Presentational only: percentages, class dollars, and the target in — markup
 * out. No calculator calls, no data fetching, no state beyond the transient
 * focused/hovered tooltip target.
 */

export interface AllocationDonutProps {
  /**
   * Actual allocation to render. Accepts either a full {@link AllocationResult}
   * or just its `percentages` map, so callers can pass whichever they hold.
   */
  allocation: AllocationResult | Record<AssetClass, number>;
  /**
   * Target allocation percentages (0–100) per Asset_Class, drawn as the outer
   * ring and shown beside the actual in the legend and text alternative.
   */
  target: TargetAllocation | Record<AssetClass, number>;
  /**
   * Dollar basis behind each actual percentage, for the tooltips. When omitted
   * (or when a full {@link AllocationResult} is passed as `allocation`, in which
   * case its `classDollars` is used) the call-outs show percent only.
   */
  classDollars?: ClassTotals;
}

/** Narrow the actual-allocation prop union to the `percentages` map. */
function toPercentages(
  allocation: AllocationDonutProps['allocation'],
): Record<AssetClass, number> {
  return 'percentages' in allocation ? allocation.percentages : allocation;
}

/** Narrow the target prop union to its per-class percentages map. */
function toTargetPercentages(
  target: AllocationDonutProps['target'],
): Record<AssetClass, number> {
  return {
    stocks: target.stocks,
    bonds: target.bonds,
    cash: target.cash,
    other: target.other,
  };
}

/** Pull the dollar basis from an explicit prop, else a full AllocationResult. */
function toClassDollars(
  allocation: AllocationDonutProps['allocation'],
  classDollars: ClassTotals | undefined,
): ClassTotals | undefined {
  if (classDollars) {
    return classDollars;
  }
  return 'classDollars' in allocation ? allocation.classDollars : undefined;
}

/** Identifies which focusable call-out (and thus tooltip) is active. */
interface TooltipTarget {
  key: AssetClass;
}

export function AllocationDonut({
  allocation,
  target,
  classDollars,
}: AllocationDonutProps) {
  const [tooltip, setTooltip] = useState<TooltipTarget | null>(null);

  const percentages = toPercentages(allocation);
  const targetPercentages = toTargetPercentages(target);
  const dollars = toClassDollars(allocation, classDollars);

  const rows = CLASS_LABELS.map(({ key, label }) => ({
    key,
    label,
    actual: percentages[key],
    target: targetPercentages[key],
    dollars: dollars ? dollars[key] : undefined,
    color: CLASS_COLORS[key],
  }));

  // Static legend: swatch + class label + actual% and target% for each class.
  // Single conceptual series, so no click-to-hide (onToggle omitted).
  const legendItems: LegendItem[] = rows.map((row) => ({
    id: row.key,
    label: row.label,
    color: row.color,
    shape: 'swatch',
    valueText: `${formatPercent(row.actual)} actual · ${formatPercent(
      row.target,
    )} target`,
  }));

  return (
    <figure aria-labelledby="allocation-donut-alt" className="flex flex-col gap-4">
      {/*
        Authoritative, screen-reader-only text alternative. Lists every
        Asset_Class with its one-decimal ACTUAL and TARGET percentage (Property
        20). The figure is labeled by this list so assistive tech announces the
        content rather than the decorative SVG below.
      */}
      <dl id="allocation-donut-alt" className="sr-only tabular-nums">
        <dt>Asset allocation: actual versus target</dt>
        {rows.map((row) => (
          <dd key={row.key}>
            {`${row.label}: actual ${formatPercentLabel(
              row.actual,
            )}, target ${formatPercentLabel(row.target)}.`}
          </dd>
        ))}
      </dl>

      {/*
        Decorative chart: hidden from assistive tech, which reads the list above.
        Inner ring = actual allocation (donut); outer ring = target. Both rings
        color each class identically from CLASS_COLORS; the rings differ by
        POSITION (inner vs outer) and the legend label, not by hue (R1.1).
      */}
      <div aria-hidden="true" className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {/* Actual — inner donut. */}
            <Pie
              data={rows}
              dataKey="actual"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="40%"
              outerRadius="62%"
              isAnimationActive={false}
            >
              {rows.map((row) => (
                <Cell key={`actual-${row.key}`} fill={row.color} />
              ))}
            </Pie>
            {/* Target — outer reference ring, same colors, distinguished by
                position. A thinner, lower-opacity band so the inner actual ring
                reads as the primary figure. */}
            <Pie
              data={rows}
              dataKey="target"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="70%"
              outerRadius="82%"
              isAnimationActive={false}
            >
              {rows.map((row) => (
                <Cell
                  key={`target-${row.key}`}
                  fill={row.color}
                  fillOpacity={0.45}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/*
        Static legend (shared ChartLegend, no onToggle). Each item pairs a color
        swatch + the class label + the actual% and target%, so a class is
        identified by its label and figures, never by color alone (R1.4).
      */}
      <ChartLegend items={legendItems} />

      {/*
        Keyboard-reachable call-outs. Because the SVG is aria-hidden, these
        focusable buttons give keyboard users the same tooltip a mouse user gets
        on hover (R3.2): focusing or hovering one reveals the class's dollars
        (when a dollar basis is available) and its actual percent; blur/leave
        dismisses it.
      */}
      <section aria-label="Allocation by class" className="flex flex-col gap-2">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {rows.map((row) => {
            const isActive = tooltip?.key === row.key;
            const dollarText =
              row.dollars !== undefined && Number.isFinite(row.dollars)
                ? formatCurrency(row.dollars)
                : null;
            return (
              <li key={row.key} className="flex">
                <button
                  type="button"
                  className="relative flex w-full items-center gap-2 rounded px-1 py-0.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                  onMouseEnter={() => setTooltip({ key: row.key })}
                  onMouseLeave={() => setTooltip(null)}
                  onFocus={() => setTooltip({ key: row.key })}
                  onBlur={() => setTooltip(null)}
                >
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: row.color }}
                  />
                  <span className="text-sm font-medium text-slate-700">
                    {row.label}
                  </span>
                  <span className="ml-auto text-sm font-semibold text-slate-900 tabular-nums">
                    {formatPercent(row.actual)}
                  </span>
                  {isActive ? (
                    <span
                      role="tooltip"
                      className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white tabular-nums shadow"
                    >
                      {`${row.label}: ${
                        dollarText ? `${dollarText} · ` : ''
                      }${formatPercent(row.actual)} of portfolio`}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </figure>
  );
}

export default AllocationDonut;
