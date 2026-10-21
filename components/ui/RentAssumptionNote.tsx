'use client';

/*
 * RentAssumptionNote — a non-blocking note for the Buy-vs-Rent Decision_View
 * acknowledging that the comparison assumes the user rents today, shown when a
 * Mortgage_Account is present (R11).
 *
 * The parent decides whether to mount this at all: it is rendered only when a
 * Mortgage_Account exists among the accounts (R11.1), and not rendered when no
 * mortgage is present (R11.4). This component owns only its own session-dismiss
 * state — it does not inspect accounts or do any mortgage detection.
 *
 * The note is purely informational: it does NOT change the buy-vs-rent
 * calculation, which continues to assume the user rents today (R11.5). This
 * component performs no calculation, no data fetching, and no clock reads.
 *
 * Non-blocking (R11.2): this is a dismissible inline banner, not a modal or
 * overlay, so the full buy-vs-rent comparison still renders around it. It takes
 * no focus trap and lays out in normal document flow.
 *
 * Session dismiss (R11.3): a real <button> hides the note for the current
 * session via local component state. "Session" scope is satisfied by useState —
 * the dismissal lives for as long as this component instance is mounted and is
 * intentionally not persisted, so a fresh session shows the note again.
 *
 * Accessibility / ui-style:
 * - role="note" so assistive tech announces it as an aside (matches the other
 *   banner primitives in this project).
 * - The meaning is carried by TEXT, never color alone (ui-style, R9.6 spirit).
 *   A calm, decorative "ℹ" symbol is aria-hidden because the adjacent text
 *   already carries the meaning; styling is secondary reinforcement only.
 * - The continue control is a real, keyboard-operable <button> with a visible
 *   text label and a visible focus ring (ui-style: keyboard reachable and
 *   operable with a visible focus indicator).
 */

import { useState } from 'react';

import { RENT_ASSUMPTION_NOTE } from '@/lib/buyVsRentMessages';

interface RentAssumptionNoteProps {
  /** Extra Tailwind classes merged onto the note container. */
  className?: string;
}

export default function RentAssumptionNote({
  className,
}: RentAssumptionNoteProps): React.ReactElement | null {
  // Session-scoped dismissal (R11.3): lives for this component instance only,
  // intentionally not persisted so a new session surfaces the note again.
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  return (
    <div
      role="note"
      className={`flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 sm:flex-row sm:items-start sm:justify-between ${className ?? ''}`}
    >
      <div className="flex items-start gap-2">
        {/* Decorative symbol — the adjacent text carries the meaning (R9.6). */}
        <span aria-hidden="true" className="select-none text-slate-500">
          &#8505;
        </span>
        <p>{RENT_ASSUMPTION_NOTE.body}</p>
      </div>

      {/* Real, keyboard-operable continue control with a visible focus ring. */}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={RENT_ASSUMPTION_NOTE.continueAriaLabel}
        className="shrink-0 self-start rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
      >
        {RENT_ASSUMPTION_NOTE.continueLabel}
      </button>
    </div>
  );
}
