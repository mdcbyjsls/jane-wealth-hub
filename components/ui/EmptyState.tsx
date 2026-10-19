/*
 * EmptyState — Task 14.3 (consolidated-net-worth-view).
 *
 * Presentational component for the dashboard's two empty conditions (R6.4, R6.5).
 * It renders only the plain-language, next-action copy from the centralized message
 * module (R6.6); it deliberately renders no numbers. The $0 net worth value is
 * composed separately by the page/header so this component never emits a misleading
 * zero of its own.
 *
 *  - 'no-accounts'   → R6.4: zero accounts present (MESSAGES.emptyNoAccounts)
 *  - 'zero-balances' → R6.5: all balances zero, nothing to allocate
 *                           (MESSAGES.emptyZeroBalances)
 */

import { MESSAGES } from '@/lib/messages';

export type EmptyStateVariant = 'no-accounts' | 'zero-balances';

export interface EmptyStateProps {
  /** Which empty condition to communicate. */
  variant: EmptyStateVariant;
}

const MESSAGE_BY_VARIANT: Record<EmptyStateVariant, string> = {
  'no-accounts': MESSAGES.emptyNoAccounts,
  'zero-balances': MESSAGES.emptyZeroBalances,
};

export default function EmptyState({ variant }: EmptyStateProps) {
  const message = MESSAGE_BY_VARIANT[variant];

  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-gray-600"
    >
      <p className="text-sm leading-relaxed">{message}</p>
    </div>
  );
}
