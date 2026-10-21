'use client';

/**
 * Backward-compatible shim. The two-path comparison chart now lives in
 * {@link TwoPathChart} (Spec 4 — Per-view → Buy-vs-Rent → TwoPathChart), which
 * evolved this component by adding a labeled breakeven marker, a click-to-hide
 * legend, and dollars+percent tooltips. This file keeps the former
 * `ComparisonChart` name/import path working (and the `ComparisonChartProps`
 * type alias) so existing consumers don't break; task 5.5 swaps callers to the
 * new name.
 */

import TwoPathChart, {
  type TwoPathChartProps,
} from '@/components/charts/TwoPathChart';

export type ComparisonChartProps = TwoPathChartProps;

export const ComparisonChart = TwoPathChart;

export default TwoPathChart;
