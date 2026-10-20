/*
 * ProjectionErrorState — Task 9.6 (long-term-wealth-projection).
 *
 * Presentational component for the projection view's unavailable/error
 * conditions (R1.7, R10). The caller chooses the copy: pass
 * `PROJECTION_MESSAGES.routeError` when the market-data request fails (R10.2) or
 * `PROJECTION_MESSAGES.accountError` when the Spec 1 account data fails to load
 * (R10.3, R10.6). It renders NO projected values and NO chart graphic (R11.6),
 * and exposes the plain-language message to assistive technology via
 * `role="alert"`, mirroring Spec 1's `ErrorState`.
 *
 * Both copy strings are plain language only (R10.5): no data-interchange format
 * names, endpoint names, status codes, or internal file names. Only the vetted
 * strings from the message module are ever shown — never raw developer error
 * text.
 *
 * An optional `onRetry` callback renders a keyboard-operable retry control so
 * the owning island can let the user re-attempt a failed market-data request
 * (R10.4). When omitted (e.g. the account-unavailable case, which is not
 * retryable from this view) no button is rendered.
 */

import { PROJECTION_MESSAGES } from '@/lib/projectionMessages';

export interface ProjectionErrorStateProps {
  /**
   * The plain-language message to display. The caller passes the right copy:
   * `PROJECTION_MESSAGES.routeError` (market unavailable, R10.2) or
   * `PROJECTION_MESSAGES.accountError` (Projected_Base unavailable, R10.3/R10.6).
   */
  message: string;
  /**
   * Optional retry handler. When provided, a retry button is rendered so the
   * user can re-attempt a failed market-data request (R10.4).
   */
  onRetry?: () => void;
  /** Visible label for the retry control. Defaults to "Try again". */
  retryLabel?: string;
}

export default function ProjectionErrorState({
  message,
  onRetry,
  retryLabel = 'Try again',
}: ProjectionErrorStateProps) {
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
