'use client';

/*
 * TargetEditor — the interactive target-allocation editor (R5).
 *
 * Four integer inputs (one per asset class: stocks, bonds, cash, other), each
 * constrained to whole numbers 0–100 (R5.1). On submit the raw string entries
 * are validated by `validateTarget` from the Target_Store (R5.2, R5.3):
 *
 *   - If the four values don't sum to 100, or any field is non-integer,
 *     negative, or greater than 100, the submission is REJECTED: a plain-language
 *     validation message is shown, the user's entered values are RETAINED (never
 *     reset), and the parent is NOT called — so nothing is persisted (R5.2, R5.3).
 *   - On a valid submission, the validated `TargetAllocation` (with
 *     `isExample: false`) is handed to the `onSave` callback; the parent
 *     (DashboardClient) persists it and recomputes drift (R5.4 side effects).
 *
 * Side-by-side display (R5.4): each class row shows its current actual % next to
 * its current target %, sourced from the `actual` AllocationResult and the
 * `currentTarget` TargetAllocation props.
 *
 * Example label (R5.7): when `currentTarget.isExample` is true, the editor shows
 * a clear "Example target, set your own" note so the user knows the shown target
 * is a starting default, not a choice they made.
 *
 * Accessibility:
 *   - All four inputs are native number inputs in a fixed document/tab order, so
 *     they are reachable and operable via sequential Tab and the keyboard (R9.2).
 *   - The validation message is associated with the offending input (and the
 *     form) via `aria-describedby`, marked `aria-invalid`, and announced through
 *     a `role="alert"` live region. It is retained until the next submission
 *     resolves it (R9.4).
 *
 * This is a client island: it owns local input state and local validation-message
 * state. It does no fetching and does not touch localStorage directly — the
 * parent owns persistence.
 */

import { useState } from 'react';
import type {
  AllocationResult,
  AssetClass,
  TargetAllocation,
  TargetInput,
} from '@/types/accounts';
import { validateTarget } from '@/lib/target/targetStore';
import { formatPercent } from '@/lib/format';

interface TargetEditorProps {
  /** The current target allocation (example default or a saved user choice). */
  currentTarget: TargetAllocation;
  /** The current actual allocation, for the side-by-side actual-vs-target view. */
  actual: AllocationResult;
  /** Called with the validated target on a successful submission (R5.4). */
  onSave: (target: TargetAllocation) => void;
}

/** The four classes in a fixed reporting / tab order (R9.2). */
const CLASSES: ReadonlyArray<{ key: AssetClass; label: string }> = [
  { key: 'stocks', label: 'Stocks' },
  { key: 'bonds', label: 'Bonds' },
  { key: 'cash', label: 'Cash' },
  { key: 'other', label: 'Other' },
];

/** The id of the validation live region, referenced by `aria-describedby`. */
const MESSAGE_ID = 'target-editor-validation';

/** Derive the initial string inputs from the current (numeric) target. */
function toInput(target: TargetAllocation): TargetInput {
  return {
    stocks: String(target.stocks),
    bonds: String(target.bonds),
    cash: String(target.cash),
    other: String(target.other),
  };
}

/** Local validation state: either clear, or a message naming the offending field. */
interface ValidationState {
  message: string | null;
  /** Which input the message is attached to; `null` for a form-level (sum) error. */
  field: AssetClass | null;
}

const NO_ERROR: ValidationState = { message: null, field: null };

export default function TargetEditor({
  currentTarget,
  actual,
  onSave,
}: TargetEditorProps): React.ReactElement {
  const [input, setInput] = useState<TargetInput>(() => toInput(currentTarget));
  const [validation, setValidation] = useState<ValidationState>(NO_ERROR);

  function handleChange(field: AssetClass, value: string): void {
    setInput((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = validateTarget(input);
    if (!result.ok) {
      // Reject: keep the user's entered values, surface the message (R5.2, R5.3, R9.4).
      setValidation({
        message: result.message,
        field: result.field === 'sum' ? null : result.field,
      });
      return;
    }
    // Valid: clear any message and hand the normalized target to the parent (R5.4).
    setValidation(NO_ERROR);
    onSave(result.target);
  }

  return (
    <section aria-label="Target allocation" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-gray-900">
          Target allocation
        </h3>
        {currentTarget.isExample && (
          <p className="text-sm font-medium text-amber-800">
            Example target, set your own
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} aria-describedby={MESSAGE_ID} noValidate>
        <ul className="flex flex-col gap-3">
          {CLASSES.map(({ key, label }) => {
            const inputId = `target-${key}`;
            const isOffending = validation.field === key;
            // The offending field — or any field when the error is the sum —
            // points at the shared validation message (R9.4).
            const describedBy =
              validation.message !== null && (isOffending || validation.field === null)
                ? MESSAGE_ID
                : undefined;
            return (
              <li
                key={key}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-4"
              >
                <label
                  htmlFor={inputId}
                  className="text-sm font-medium text-gray-700"
                >
                  {label}
                </label>

                {/* Side-by-side actual vs target (R5.4). */}
                <span className="text-sm text-gray-600 tabular-nums">
                  Actual{' '}
                  <span className="font-semibold text-gray-900">
                    {formatPercent(actual.percentages[key])}
                  </span>
                </span>

                <span className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Target</span>
                  <input
                    id={inputId}
                    name={key}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    value={input[key]}
                    onChange={(e) => handleChange(key, e.target.value)}
                    aria-invalid={isOffending || undefined}
                    // R9.4: when this field is the offending one (or the error
                    // is the form-level sum), it points at the shared live-region
                    // message via aria-describedby, so assistive tech announces
                    // the message when the input receives focus, and the
                    // association is retained until the next valid submit clears it.
                    aria-describedby={describedBy}
                    // R9.3: an always-on focus ring (focus:, not focus-visible:)
                    // so keyboard focus is unmistakable on these number inputs.
                    // Ring contrast (≥ 3:1) is a design-token concern and still
                    // needs a manual audit per Task 18/19.
                    className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
                  />
                  <span aria-hidden="true" className="text-sm text-gray-600">
                    %
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        {/* Live region: announced on error, retained until resolved (R9.4). */}
        <p
          id={MESSAGE_ID}
          role="alert"
          aria-live="assertive"
          className={
            validation.message !== null
              ? 'mt-3 text-sm font-medium text-red-700'
              : 'sr-only'
          }
        >
          {validation.message ?? ''}
        </p>

        <button
          type="submit"
          className="mt-4 self-start rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
        >
          Save target
        </button>
      </form>
    </section>
  );
}
