'use client';

/*
 * DollarBasisToggle — switches the displayed Dollar_Basis between exactly two
 * states, `nominal` (future dollars, the default) and `today` (inflation-adjusted
 * to present-day purchasing power) (R5.1).
 *
 * The parent owns the state: this control is fully controlled via `value` and
 * reports changes through `onChange`. Nominal is the default basis, but that
 * default lives with the parent's initial state (R5.1) — this component simply
 * renders whichever `value` it is given.
 *
 * Pattern: a two-option radiogroup built from native <button> elements, which are
 * keyboard-reachable and operable by default (R5.1, R11.4). The group is labeled
 * and each option carries `role="radio"` with `aria-checked`, so assistive tech
 * announces both the group's purpose and which basis is active.
 *
 * Distinguishable without color (R5.4): the active option is marked three ways
 * that do not depend on color —
 *   1. a persistent "✓ " check-mark prefix rendered before the active label,
 *   2. a heavier font weight on the active label, and
 *   3. `aria-checked="true"` for assistive technology.
 * On top of those non-color cues the active option also gets a filled background,
 * but the control remains fully legible if color is removed. A persistent text
 * label ("Nominal" / "Today's dollars") is always visible on each option, so the
 * active basis is readable as text at all times.
 *
 * Focus (R11.4): each option shows an always-on focus ring (`focus:`, not
 * `focus-visible:`) so keyboard focus is unmistakable. Meeting the ≥ 3:1 focus-
 * ring contrast ratio is a design-token concern verified in the manual audit.
 *
 * This is a presentational client control: it holds no state and does no fetching.
 */

import type { DollarBasis } from '@/types/market';

interface DollarBasisToggleProps {
  /** The active basis (parent-owned; nominal is the parent's default). */
  value: DollarBasis;
  /** Called with the next basis when the user picks the other option. */
  onChange: (next: DollarBasis) => void;
}

/** The two options in a fixed tab order, each with its persistent text label. */
const OPTIONS: ReadonlyArray<{ basis: DollarBasis; label: string }> = [
  { basis: 'nominal', label: 'Nominal' },
  { basis: 'today', label: "Today's dollars" },
];

/** The id of the visible group label, referenced by the radiogroup. */
const GROUP_LABEL_ID = 'dollar-basis-toggle-label';

export default function DollarBasisToggle({
  value,
  onChange,
}: DollarBasisToggleProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <span
        id={GROUP_LABEL_ID}
        className="text-sm font-medium text-gray-700"
      >
        Show values in
      </span>

      <div
        role="radiogroup"
        aria-labelledby={GROUP_LABEL_ID}
        className="inline-flex self-start rounded-md border border-gray-300 p-1"
      >
        {OPTIONS.map(({ basis, label }) => {
          const isActive = value === basis;
          return (
            <button
              key={basis}
              type="button"
              role="radio"
              aria-checked={isActive}
              // Both options are native buttons, so each is a Tab stop and is
              // operable with Enter/Space — keyboard users reach and switch the
              // basis directly (R5.1, R11.4). Switching only fires when the user
              // picks the inactive option.
              onClick={() => {
                if (!isActive) {
                  onChange(basis);
                }
              }}
              className={
                isActive
                  ? 'rounded px-3 py-1 text-sm font-semibold text-gray-900 tabular-nums bg-gray-200 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1'
                  : 'rounded px-3 py-1 text-sm font-normal text-gray-700 tabular-nums hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1'
              }
            >
              {/* Non-color active cue: a persistent check-mark prefix, hidden from
                  assistive tech since aria-checked already conveys the state. */}
              <span aria-hidden="true">{isActive ? '✓ ' : ''}</span>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
