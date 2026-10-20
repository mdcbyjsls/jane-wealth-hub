'use client';

import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

import type { AllocationResult, AssetClass } from '@/types/accounts';
import { formatPercent, formatPercentLabel } from '@/lib/format';

/**
 * Pie chart of the four Asset_Class buckets plus a programmatically associated
 * text alternative (R3.5, R9.1).
 *
 * Recharts renders to SVG, which is decorative here: the chart's `<svg>` is
 * hidden from assistive technology (`aria-hidden`) and is NOT the only source
 * of the data. A visually-hidden description list carries the authoritative
 * content — every Asset_Class name paired with its percentage to one decimal
 * place (e.g. "Stocks 42.5 percent") via {@link formatPercentLabel} — and the
 * `<figure>` references it with `aria-labelledby` so a screen reader reads the
 * figure as that list (Property 20).
 *
 * Color distinguishes the slices visually, but it is never the only channel:
 * each slice is labeled with its class name and percentage, and the text
 * alternative conveys the same names and values without relying on color
 * (R9.6 spirit — do not rely on color alone).
 *
 * Presentational only: an {@link AllocationResult} (or its percentages) in,
 * markup out. No data fetching, no state.
 */

/**
 * Human-readable labels for each Asset_Class, in canonical display order.
 *
 * Exported so every allocation surface (the pie, the post-purchase shift card,
 * any legend) names the classes identically — one label set, used everywhere.
 */
export const CLASS_LABELS: ReadonlyArray<{ key: AssetClass; label: string }> = [
  { key: 'stocks', label: 'Stocks' },
  { key: 'bonds', label: 'Bonds' },
  { key: 'cash', label: 'Cash' },
  { key: 'other', label: 'Other' },
];

/**
 * Distinct, print-and-contrast-friendly slice colors. Kept in the same order
 * as {@link CLASS_LABELS}. Color is a visual aid only — the text alternative,
 * not these hues, is what conveys the data to assistive tech.
 *
 * Exported so the fixed one-color-per-class mapping is reused everywhere an
 * allocation appears (per the ui-style rule), never redefined per component.
 * Color always travels with a class label; it is never the sole cue (R9.6).
 */
export const CLASS_COLORS: Record<AssetClass, string> = {
  stocks: '#2563eb', // blue-600
  bonds: '#16a34a', // green-600
  cash: '#d97706', // amber-600
  other: '#7c3aed', // violet-600
};

export interface AllocationPieProps {
  /**
   * Allocation to render. Accepts either a full {@link AllocationResult} or
   * just its `percentages` map, so callers can pass whichever they hold.
   */
  allocation: AllocationResult | Record<AssetClass, number>;
}

/** Narrow the prop union to the `percentages` map. */
function toPercentages(
  allocation: AllocationPieProps['allocation'],
): Record<AssetClass, number> {
  return 'percentages' in allocation ? allocation.percentages : allocation;
}

export function AllocationPie({ allocation }: AllocationPieProps) {
  const percentages = toPercentages(allocation);

  const rows = CLASS_LABELS.map(({ key, label }) => ({
    key,
    label,
    percent: percentages[key],
    color: CLASS_COLORS[key],
  }));

  return (
    <figure aria-labelledby="allocation-pie-alt" className="flex flex-col gap-4">
      {/*
        Authoritative, screen-reader-only text alternative. Lists every
        Asset_Class with its one-decimal percentage (Property 20). The figure is
        labeled by this list, so assistive tech announces the content rather
        than the decorative SVG below.
      */}
      <dl id="allocation-pie-alt" className="sr-only">
        <dt>Asset allocation</dt>
        {rows.map((row) => (
          <dd key={row.key}>{`${row.label} ${formatPercentLabel(row.percent)}`}</dd>
        ))}
      </dl>

      {/* Decorative chart: hidden from assistive tech, which reads the list above. */}
      <div aria-hidden="true" className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="percent"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius="80%"
              isAnimationActive={false}
            >
              {rows.map((row) => (
                <Cell key={row.key} fill={row.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/*
        Visible, labeled percentage values for each class (R3.5). These pair the
        class name and percentage with a small color swatch, so the legend never
        relies on color alone to identify a slice.
      */}
      <ul className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: row.color }}
            />
            <span className="text-sm font-medium text-gray-700">{row.label}</span>
            <span className="ml-auto text-sm font-semibold text-gray-900 tabular-nums">
              {formatPercent(row.percent)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export default AllocationPie;
