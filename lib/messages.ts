/**
 * Centralized user-facing copy for the dashboard's error and empty states.
 *
 * All error and empty-state messages shown to the user live here as plain-data
 * constants — no UI, no fetch, no imports from `app/` or `components/`. Keeping
 * the whole set in one place lets a future test (deferred Property 22) assert
 * that every message avoids banned technical terms ("JSON", "validation",
 * "localStorage", and file names) and includes a clear next action (R6.6).
 *
 * The headline term "net worth" is intentionally permitted.
 */

export const MESSAGES = {
  /** R6.2 — account data missing or unreadable. */
  loadError: "We couldn't load your accounts right now. Try refreshing the page.",
  /** R6.3 — account data fails shape validation. */
  validationError:
    "Some account information looks off, so we can't show your totals. Check your account data and try again.",
  /** R6.4 — zero accounts present. */
  emptyNoAccounts:
    "No accounts to show yet. Add an account to see your net worth and allocation.",
  /** R6.5 — all balances zero / nothing to allocate. */
  emptyZeroBalances:
    "There's nothing to allocate yet because all balances are zero. Add a balance to an account to see your allocation.",
} as const;

/** Keys of the centralized message set. */
export type MessageKey = keyof typeof MESSAGES;
