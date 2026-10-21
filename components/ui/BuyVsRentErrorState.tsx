/*
 * BuyVsRentErrorState — Task 8.6 (buy-vs-rent-scenario-tester).
 *
 * Presentational component for the Scenario_View's unavailable/error
 * conditions (R4.5, R12). The caller chooses the copy: the route-error message
 * when the market-data request fails (R12.2) or the account-unavailable message
 * when the Spec 1 account data cannot be resolved (R12.3, which also wins when
 * market data later fails). It renders NO year-10 figures and NO chart graphic
 * (R4.5, R13.6), and exposes the plain-language message to assistive technology
 * via `role="alert"`, mirroring Spec 1's `ErrorState` and Spec 2's
 * `ProjectionErrorState`.
 *
 * All copy is plain language only (R12.5): no data-interchange format names,
 * endpoint names, status codes, or internal file names. Only the vetted strings
 * from the centralized copy module are ever shown — never raw developer error
 * text. The island owns the copy and passes it via `message`; this component
 * stays decoupled from `lib/buyVsRentMessages.ts` (Task 7.1) by taking the
 * message as a prop, following the caller-supplies-copy pattern of
 * `ProjectionErrorState`.
 *
 * An optional `onRetry` callback renders a keyboard-operable retry control so
 * the owning island can let the user re-attempt a failed market-data request
 * (R12). When omitted (e.g. the account-unavailable case, which is not
 * retryable from this view) no button is rendered.
 */

export interface BuyVsRentErrorStateProps {
  /**
   * The plain-language message to display. The caller passes the right copy:
   * the route-error message (market unavailable, R12.2) or the account-error
   * message (Starting_Assets unavailable, R12.3).
   */
  message: string;
  /**
   * Optional retry handler. When provided, a retry button is rendered so the
   * user can re-attempt a failed market-data request.
   */
  onRetry?: () => void;
  /** Visible label for the retry control. Defaults to "Try again". */
  retryLabel?: string;
}

export default function BuyVsRentErrorState({
  message,
  onRetry,
  retryLabel = 'Try again',
}: BuyVsRentErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-800"
    >
      <p className="text-base font-medium">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
