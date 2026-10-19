import { MESSAGES } from '@/lib/messages';

/**
 * Selects which error condition to render.
 *
 * - `'load'` → account data is missing or unreadable (R6.2, LoadError).
 * - `'validation'` → account data failed shape validation (R6.3, ValidationError).
 */
export type ErrorVariant = 'load' | 'validation';

export interface ErrorStateProps {
  /** Which error condition to display. */
  variant: ErrorVariant;
}

/**
 * Maps each error variant to its centralized plain-language copy.
 *
 * Only the vetted strings from the message module are ever shown. The
 * developer-facing `ValidationError.message` detail is never rendered here (R6.6).
 */
const VARIANT_MESSAGE: Record<ErrorVariant, string> = {
  load: MESSAGES.loadError,
  validation: MESSAGES.validationError,
};

/**
 * Presentational error state for the dashboard.
 *
 * Renders the plain-language copy for LoadError (R6.2) and ValidationError (R6.3)
 * and shows NO net worth, breakdown, or allocation values (R1.5, R6.3). Pure UI:
 * no fetch, no calculations, no raw developer error text (R6.6).
 */
export function ErrorState({ variant }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-800"
    >
      <p className="text-base font-medium">{VARIANT_MESSAGE[variant]}</p>
    </div>
  );
}

export default ErrorState;
