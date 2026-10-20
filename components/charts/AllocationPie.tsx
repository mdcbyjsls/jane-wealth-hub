'use client';

import type { AssetClass } from '@/types/accounts';
import { CLASS_COLORS, CLASS_LABELS } from '@/lib/chartColors';
import {
  AllocationDonut,
  type AllocationDonutProps,
} from '@/components/charts/AllocationDonut';

/**
 * Backward-compatible shim for the former `AllocationPie`.
 *
 * The allocation chart has evolved into {@link AllocationDonut} (Spec 4 —
 * Per-view → Dashboard → AllocationDonut): a donut of the actual allocation
 * with the target drawn as a concentric outer ring. This module stays so
 * existing importers keep working during the migration (task 7.4 swaps the
 * DashboardClient over to `AllocationDonut` directly):
 *
 * - It re-exports the shared class color/label mapping (`CLASS_COLORS`,
 *   `CLASS_LABELS`). The single source of truth lives in `@/lib/chartColors`;
 *   no component defines its own class colors (Spec 4 R1.1). Color is a visual
 *   aid only — the text alternative, not these hues, conveys the data, and
 *   color always travels with a class label (R9.6).
 * - It re-exports `AllocationPie` as a thin wrapper around `AllocationDonut`.
 *   The legacy call site passes only `allocation`; when no `target` is given
 *   the outer ring mirrors the actual allocation (a neutral reference) until a
 *   real target is wired in.
 */

export { CLASS_COLORS, CLASS_LABELS };

export type AllocationPieProps =
  Partial<Pick<AllocationDonutProps, 'target' | 'classDollars'>> &
    Pick<AllocationDonutProps, 'allocation'>;

/** Narrow the actual-allocation prop union to the `percentages` map. */
function toPercentages(
  allocation: AllocationPieProps['allocation'],
): Record<AssetClass, number> {
  return 'percentages' in allocation ? allocation.percentages : allocation;
}

/**
 * Legacy wrapper. Renders the {@link AllocationDonut}, defaulting the target
 * outer ring to the actual allocation when the caller supplies none.
 */
export function AllocationPie({
  allocation,
  target,
  classDollars,
}: AllocationPieProps) {
  const resolvedTarget = target ?? toPercentages(allocation);
  return (
    <AllocationDonut
      allocation={allocation}
      target={resolvedTarget}
      classDollars={classDollars}
    />
  );
}

export default AllocationPie;
