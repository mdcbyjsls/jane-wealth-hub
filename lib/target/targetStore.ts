/**
 * Target_Store — browser-only persistence for the user's target allocation (R5).
 *
 * This module is the ONLY `localStorage` user in the project and is intentionally
 * browser-only. It is imported solely by the client island (`DashboardClient`), never
 * by the pure `lib/calculations/` calculator, `app/`, or `components/` directly. Keeping
 * it isolated preserves the purity/testability of the Allocation_Calculator.
 *
 * All reads are defensive: SSR (no `window`), a missing/absent value, malformed JSON, or a
 * structurally invalid stored value all resolve to `DEFAULT_TARGET` without throwing (R5.6).
 */

import type {
  TargetAllocation,
  TargetInput,
  TargetValidationResult,
} from '@/types/accounts';

/** Stable localStorage key for the persisted target allocation. */
export const STORAGE_KEY = 'jwh.targetAllocation';

/**
 * The unconfigured example default (R5.7): 60/20/10/10 with `isExample: true`. The
 * "Example target, set your own" label text lives in the UI; `isExample: true` is the
 * machine marker that this is the example rather than a persisted user choice.
 */
export const DEFAULT_TARGET: TargetAllocation = {
  stocks: 60,
  bonds: 20,
  cash: 10,
  other: 10,
  isExample: true,
};

/** Asset-class fields in the defined reporting order used for first-offender detection. */
const FIELD_ORDER: ReadonlyArray<keyof TargetInput> = [
  'stocks',
  'bonds',
  'cash',
  'other',
];

/**
 * Parse a raw user-entered string as an integer percentage in [0, 100].
 *
 * Returns `null` when the string is not a valid integer (empty, blank, decimal, non-numeric,
 * or containing stray characters), negative, or greater than 100. Only canonical integer
 * strings are accepted — e.g. "60" is valid, while "60.0", " 60", "60abc", "+60", and "" are not.
 */
function parseIntegerPercent(raw: string): number | null {
  // Canonical non-negative integer: no sign, no decimal, no whitespace, no leading zeros beyond "0".
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    return null;
  }
  return value;
}

/**
 * Validate raw target input (R5.2, R5.3).
 *
 * Field-range validity is checked BEFORE the sum, reporting the FIRST offending field in the
 * order stocks → bonds → cash → other. A field is offending when it is not a valid integer,
 * is negative, or exceeds 100 → `{ ok: false, field, message }`. If all four are integers in
 * 0–100 but do not sum to exactly 100 → `{ ok: false, field: 'sum', message }`. On success →
 * `{ ok: true, target: { ...values, isExample: false } }` (a submitted target is never an example).
 */
export function validateTarget(input: TargetInput): TargetValidationResult {
  const values: Record<keyof TargetInput, number> = {
    stocks: 0,
    bonds: 0,
    cash: 0,
    other: 0,
  };

  for (const field of FIELD_ORDER) {
    const parsed = parseIntegerPercent(input[field]);
    if (parsed === null) {
      return {
        ok: false,
        field,
        message: `${field} must be a whole number from 0 to 100.`,
      };
    }
    values[field] = parsed;
  }

  const sum = values.stocks + values.bonds + values.cash + values.other;
  if (sum !== 100) {
    return {
      ok: false,
      field: 'sum',
      message: `The four percentages must sum to exactly 100 (they currently sum to ${sum}).`,
    };
  }

  return {
    ok: true,
    target: {
      stocks: values.stocks,
      bonds: values.bonds,
      cash: values.cash,
      other: values.other,
      isExample: false,
    },
  };
}

/** True only in an environment where `window.localStorage` is usable (browser, not SSR). */
function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    // Accessing `window.localStorage` can throw in some locked-down environments.
    return false;
  }
}

/**
 * Persist a target allocation to localStorage (R5.5). No-op outside the browser or if the
 * write fails (e.g. storage disabled or quota exceeded); persistence is best-effort and never
 * throws to the caller.
 */
export function saveTarget(target: TargetAllocation): void {
  if (!hasLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(target));
  } catch {
    // Swallow write failures (private mode, quota, etc.) — persistence is best-effort.
  }
}

/**
 * Narrow an unknown parsed value to a valid `TargetAllocation`: an object with four integer
 * fields each in 0–100 that sum to exactly 100. The stored `isExample` flag is ignored here —
 * a persisted value is a real user choice, so the caller stamps `isExample: false`.
 */
function isValidStoredTarget(value: unknown): value is Record<keyof AssetClassKeys, number> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  let sum = 0;
  for (const field of FIELD_ORDER) {
    const candidate = record[field];
    if (
      typeof candidate !== 'number' ||
      !Number.isInteger(candidate) ||
      candidate < 0 ||
      candidate > 100
    ) {
      return false;
    }
    sum += candidate;
  }
  return sum === 100;
}

/** Local alias of the four numeric asset-class keys (the shape `isValidStoredTarget` guarantees). */
type AssetClassKeys = { stocks: number; bonds: number; cash: number; other: number };

/**
 * Read the persisted target (R5.6). Returns `DEFAULT_TARGET` (with `isExample: true`) when
 * nothing is stored or the stored value is missing/malformed/invalid, WITHOUT throwing. A valid
 * stored target is returned with `isExample: false` — a persisted choice is never an example.
 */
export function loadTarget(): TargetAllocation {
  if (!hasLocalStorage()) {
    return DEFAULT_TARGET;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_TARGET;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidStoredTarget(parsed)) {
      return DEFAULT_TARGET;
    }
    return {
      stocks: parsed.stocks,
      bonds: parsed.bonds,
      cash: parsed.cash,
      other: parsed.other,
      isExample: false,
    };
  } catch {
    // Malformed JSON or any read error → safe fallback, never throw (R5.6).
    return DEFAULT_TARGET;
  }
}
