/*
 * BuyVsRentEmptyState — Task 8.6 (buy-vs-rent-scenario-tester).
 *
 * Presentational component for the Scenario_View's non-error "nothing to
 * compare yet" condition. It renders only a plain-language note and no chart
 * graphic and no year-10 figures (R4.5, R13.6), so the user is never left
 * looking at a blank or misleading screen (R12).
 *
 * Mirrors Spec 1's `EmptyState` and Spec 2's `ProjectionEmptyState`: a
 * `role="status"` region holding the vetted copy. The island owns the copy and
 * passes it via `message`. `lib/buyVsRentMessages.ts` (Task 7.1) centralizes the
 * strings; until a caller wires it in, this component stays decoupled by taking
 * the message as a prop rather than importing copy that may not exist yet —
 * following the same caller-supplies-copy pattern as `ProjectionErrorState`.
 *
 * All copy is plain language only (R12.5): no data-interchange format names,
 * endpoint names, status codes, or internal file names. Only vetted strings are
 * ever shown — never raw developer error text.
 */

export interface BuyVsRentEmptyStateProps {
  /**
   * The plain-language note explaining why there is nothing to compare yet. The
   * caller (the island) passes the centralized copy.
   */
  message: string;
}

export default function BuyVsRentEmptyState({
  message,
}: BuyVsRentEmptyStateProps) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-gray-600"
    >
      <p className="text-sm leading-relaxed">{message}</p>
    </div>
  );
}
