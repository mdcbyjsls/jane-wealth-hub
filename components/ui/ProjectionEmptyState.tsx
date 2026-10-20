/*
 * ProjectionEmptyState — Task 9.6 (long-term-wealth-projection).
 *
 * Presentational component for the projection view's zero-base empty condition
 * (R1.6): when the Projected_Base is zero there are no invested assets to
 * project. It renders only the plain-language note from the centralized copy
 * module; it deliberately renders no numbers. The exact $0 figures at the
 * year-10/20/30 horizons are composed separately by the island/view so this
 * component never emits a misleading zero of its own.
 *
 * Mirrors Spec 1's `EmptyState`: a `role="status"` region with the vetted copy.
 */

import { PROJECTION_MESSAGES } from '@/lib/projectionMessages';

export default function ProjectionEmptyState() {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-gray-600"
    >
      <p className="text-sm leading-relaxed">{PROJECTION_MESSAGES.zeroBase}</p>
    </div>
  );
}
