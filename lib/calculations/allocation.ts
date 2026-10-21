/**
 * Allocation_Calculator (pure module).
 *
 * Inputs in, numbers out. This module imports nothing from `app/`, `components/`, or `lib/fred/`,
 * performs no data fetching, touches no `localStorage`, and never reads the clock. Every
 * time-dependent value (such as freshness `now`) is passed in by the caller.
 *
 * This file is built up incrementally across tasks. The first function is `validateAccounts`,
 * which guards every other calculation entry point (R7.1 requires validation to complete before
 * any net-worth or allocation value is computed). Later tasks append the aggregation, allocation,
 * drift, and freshness functions below. Shared constants and type-guard helpers live near the top
 * so subsequent functions can reuse them.
 */

import { LIABILITY_TYPES } from '@/types/accounts';
import type {
  Account,
  AccountType,
  AllocationResult,
  AssetClass,
  AssetClassBreakdown,
  ClassDrift,
  ClassTotals,
  DriftClassification,
  DriftDirection,
  DriftResult,
  FreshnessResult,
  InstitutionFreshness,
  InstitutionGroup,
  NetWorthResult,
  OnTrackStatus,
  TargetAllocation,
  ValidationError,
  ValidationErrorCode,
  ValidationResult,
} from '@/types/accounts';

// `formatCurrency` is a pure helper (no UI, no fetch, no clock) — see lib/format.ts, which imports
// nothing from `app/` or `components/`. Reusing it here keeps whole-dollar USD formatting in one
// place rather than duplicating an `Intl.NumberFormat` in this module, so the "$42,000" in the
// largest-drift sentence always matches the dollars rendered everywhere else in the UI.
import { formatCurrency } from '@/lib/format';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Institution-name length bounds, inclusive (R7.1). */
const INSTITUTION_MIN_LENGTH = 1;
const INSTITUTION_MAX_LENGTH = 120;

/** Allowed tolerance, in percentage points, for a non-liability breakdown to sum to 100 (R7.2). */
const BREAKDOWN_SUM_TOLERANCE = 0.01;

/** The known set of account types, used to reject unknown `accountType` values (R7.1). */
const KNOWN_ACCOUNT_TYPES: readonly AccountType[] = [
  'brokerage',
  'IRA',
  'Roth IRA',
  '401(k)',
  'HYSA',
  'checking',
  'liability',
  'mortgage',
];

/** The four asset-class keys every `AssetClassBreakdown` must carry as finite numbers. */
const ASSET_CLASS_KEYS: readonly (keyof AssetClassBreakdown)[] = [
  'stocks',
  'bonds',
  'cash',
  'other',
];

/**
 * Index used on the single error emitted when `raw` is not an array at all. There is no account to
 * point at in that case, so we use -1 as a sentinel meaning "applies to the whole input, not a
 * specific account". Per-account errors always carry a real 0-based index.
 */
const NO_ACCOUNT_INDEX = -1;

// ---------------------------------------------------------------------------
// Type-guard helpers
// ---------------------------------------------------------------------------

/** Narrows `unknown` to a plain object (non-null, non-array) so property access is safe. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when `value` is a real, finite number (rejects NaN, +/-Infinity, and non-numbers). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True when `value` is one of the known account types. */
function isKnownAccountType(value: unknown): value is AccountType {
  return (
    typeof value === 'string' &&
    (KNOWN_ACCOUNT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * True when an account type is a liability, i.e. a member of the `LIABILITY_TYPES` source of
 * truth (`'liability'` or `'mortgage'`). This single membership check replaces every
 * `accountType === 'liability'` comparison so the two liability types are handled identically:
 * their balances are subtracted from net worth and excluded from asset-class totals (R12.1–R12.3).
 */
function isLiabilityType(accountType: AccountType): boolean {
  return LIABILITY_TYPES.includes(accountType);
}

/** Builds a `ValidationError`, keeping the shape consistent across every check. */
function makeError(
  code: ValidationErrorCode,
  accountIndex: number,
  message: string,
  field?: string,
): ValidationError {
  return field === undefined
    ? { code, accountIndex, message }
    : { code, accountIndex, field, message };
}

// ---------------------------------------------------------------------------
// validateAccounts (R7.1–R7.5)
// ---------------------------------------------------------------------------

/**
 * Validates raw, untrusted account data against the known `Account` shape before any number is
 * computed (R7.1). Returns a discriminated union rather than throwing, so the expected
 * "bad simulated data" path stays explicit and type-checked for callers.
 *
 * Error-collection convention: all offending accounts and all offending fields are collected into
 * a single `errors` array rather than stopping at the first problem, which gives the richest
 * diagnostics. Within a single account the checks run independently and each failing field adds
 * its own error (for example, a bad `balance` and a bad `institution` on the same account produce
 * two errors), except that the breakdown-sum rule is only evaluated once the breakdown has been
 * confirmed to be a well-formed object of finite numbers — there is no point checking the sum of
 * values that are not numbers. If `raw` is not an array at all, a single error is returned with
 * `accountIndex` = -1 (a sentinel meaning "the whole input", since no account exists to point at).
 *
 * On success the input is returned typed as `Account[]`: every element has been confirmed to carry
 * the required fields with valid types, so the narrowing is sound.
 */
export function validateAccounts(raw: unknown): ValidationResult {
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      errors: [
        makeError(
          'INVALID_TYPE',
          NO_ACCOUNT_INDEX,
          'Account data must be an array of accounts.',
        ),
      ],
    };
  }

  const errors: ValidationError[] = [];

  raw.forEach((candidate: unknown, index: number) => {
    if (!isRecord(candidate)) {
      errors.push(
        makeError('INVALID_TYPE', index, 'Account must be an object.'),
      );
      return;
    }

    validateInstitution(candidate.institution, index, errors);
    const accountType = validateAccountType(candidate.accountType, index, errors);
    validateBalance(candidate.balance, index, errors);
    validateLastUpdatedDaysAgo(candidate.lastUpdatedDaysAgo, index, errors);
    validateBreakdown(candidate.assetClassBreakdown, accountType, index, errors);
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Every element passed every check above, so the narrowing to Account[] is sound.
  return { ok: true, accounts: raw as Account[] };
}

/** Validates `institution`: present, a string, length 1–120 (R7.1, R7.5). */
function validateInstitution(
  value: unknown,
  index: number,
  errors: ValidationError[],
): void {
  if (value === undefined || value === null) {
    errors.push(
      makeError('MISSING_FIELD', index, 'Account is missing an institution name.', 'institution'),
    );
    return;
  }
  if (typeof value !== 'string') {
    errors.push(
      makeError('INVALID_TYPE', index, 'Institution name must be a string.', 'institution'),
    );
    return;
  }
  if (value.length < INSTITUTION_MIN_LENGTH || value.length > INSTITUTION_MAX_LENGTH) {
    errors.push(
      makeError(
        'INSTITUTION_LENGTH',
        index,
        `Institution name must be ${INSTITUTION_MIN_LENGTH}–${INSTITUTION_MAX_LENGTH} characters; got length ${value.length}.`,
        'institution',
      ),
    );
  }
}

/**
 * Validates `accountType`: present and one of the known values (R7.1, R7.5). Returns the narrowed
 * `AccountType` when valid (so the caller can apply the liability breakdown exemption), or
 * `undefined` when invalid or missing.
 */
function validateAccountType(
  value: unknown,
  index: number,
  errors: ValidationError[],
): AccountType | undefined {
  if (value === undefined || value === null) {
    errors.push(
      makeError('MISSING_FIELD', index, 'Account is missing an account type.', 'accountType'),
    );
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push(
      makeError('INVALID_TYPE', index, 'Account type must be a string.', 'accountType'),
    );
    return undefined;
  }
  if (!isKnownAccountType(value)) {
    errors.push(
      makeError(
        'UNKNOWN_ACCOUNT_TYPE',
        index,
        `Account type "${value}" is not a known account type.`,
        'accountType',
      ),
    );
    return undefined;
  }
  return value;
}

/** Validates `balance`: present and a finite number — rejects NaN/Infinity/non-numeric (R7.3). */
function validateBalance(
  value: unknown,
  index: number,
  errors: ValidationError[],
): void {
  if (value === undefined || value === null) {
    errors.push(makeError('MISSING_FIELD', index, 'Account is missing a balance.', 'balance'));
    return;
  }
  if (!isFiniteNumber(value)) {
    errors.push(
      makeError('NON_FINITE_BALANCE', index, 'Account balance must be a finite number.', 'balance'),
    );
  }
}

/** Validates `lastUpdatedDaysAgo`: present and a non-negative integer. */
function validateLastUpdatedDaysAgo(
  value: unknown,
  index: number,
  errors: ValidationError[],
): void {
  if (value === undefined || value === null) {
    errors.push(
      makeError(
        'MISSING_FIELD',
        index,
        'Account is missing a last-updated day offset.',
        'lastUpdatedDaysAgo',
      ),
    );
    return;
  }
  if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 0) {
    errors.push(
      makeError(
        'INVALID_TYPE',
        index,
        'Last-updated day offset must be a non-negative integer.',
        'lastUpdatedDaysAgo',
      ),
    );
  }
}

/**
 * Validates `assetClassBreakdown` (R7.1, R7.2, R7.4):
 * - present and an object carrying numeric stocks/bonds/cash/other;
 * - for NON-liability accounts, the four percentages must sum to 100 within ±0.01 points (R7.2);
 * - LIABILITY accounts (`liability` or `mortgage`, per LIABILITY_TYPES) are exempt from the sum
 *   rule and accept any numeric breakdown (R7.4).
 *
 * The sum rule is only evaluated when the breakdown is a well-formed object of finite numbers;
 * checking the sum of non-numeric values would be meaningless. The liability exemption applies
 * only when `accountType` was validated as a member of LIABILITY_TYPES; if the type was
 * missing/invalid we fall back to enforcing the sum rule so a malformed account is not silently
 * exempted.
 */
function validateBreakdown(
  value: unknown,
  accountType: AccountType | undefined,
  index: number,
  errors: ValidationError[],
): void {
  if (value === undefined || value === null) {
    errors.push(
      makeError(
        'MISSING_FIELD',
        index,
        'Account is missing an asset-class breakdown.',
        'assetClassBreakdown',
      ),
    );
    return;
  }
  if (!isRecord(value)) {
    errors.push(
      makeError(
        'INVALID_TYPE',
        index,
        'Asset-class breakdown must be an object.',
        'assetClassBreakdown',
      ),
    );
    return;
  }

  let allNumeric = true;
  for (const key of ASSET_CLASS_KEYS) {
    const classValue = value[key];
    if (classValue === undefined || classValue === null) {
      errors.push(
        makeError(
          'MISSING_FIELD',
          index,
          `Asset-class breakdown is missing "${key}".`,
          'assetClassBreakdown',
        ),
      );
      allNumeric = false;
    } else if (!isFiniteNumber(classValue)) {
      errors.push(
        makeError(
          'INVALID_TYPE',
          index,
          `Asset-class breakdown "${key}" must be a finite number.`,
          'assetClassBreakdown',
        ),
      );
      allNumeric = false;
    }
  }

  // Only non-liability accounts are subject to the sum rule, and only once the four values are
  // confirmed numeric (R7.2, R7.4). Both `liability` and `mortgage` are exempt via LIABILITY_TYPES;
  // a missing/invalid type (`undefined`) is NOT exempt, so a malformed account still gets the rule.
  if (allNumeric && (accountType === undefined || !isLiabilityType(accountType))) {
    const sum =
      (value.stocks as number) +
      (value.bonds as number) +
      (value.cash as number) +
      (value.other as number);
    if (Math.abs(sum - 100) > BREAKDOWN_SUM_TOLERANCE) {
      errors.push(
        makeError(
          'BREAKDOWN_SUM',
          index,
          `Asset-class breakdown must sum to 100 (±${BREAKDOWN_SUM_TOLERANCE}); got ${sum}.`,
          'assetClassBreakdown',
        ),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// computeNetWorth (R1.1, R1.4, R6.4)
// ---------------------------------------------------------------------------

/**
 * Aggregates validated accounts into total assets, total liabilities, and net worth (R1.1).
 *
 * Assets are the balances of every non-liability account; liabilities are the balances of every
 * liability account (type `liability` or `mortgage`, per LIABILITY_TYPES). Liability balances are
 * stored as positive amounts owed (see `Account`), so
 * `totalLiabilities` is the positive total and `netWorth = totalAssets - totalLiabilities`. Net
 * worth is allowed to be negative when liabilities exceed assets and flows through unchanged
 * (R1.4). An empty account set yields zeros for all three values (R1.1 / R6.4).
 *
 * Pure and deterministic: it assumes its input has already passed `validateAccounts`, performs no
 * rounding (formatting happens in the UI layer), and reads no external state.
 */
export function computeNetWorth(accounts: Account[]): NetWorthResult {
  let totalAssets = 0;
  let totalLiabilities = 0;

  for (const account of accounts) {
    if (isLiabilityType(account.accountType)) {
      totalLiabilities += account.balance;
    } else {
      totalAssets += account.balance;
    }
  }

  return {
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
  };
}

// ---------------------------------------------------------------------------
// computeInstitutionGroups (R2.2, R2.3, R2.4, R2.5, R2.6)
// ---------------------------------------------------------------------------

/**
 * Groups validated accounts by institution and returns one `InstitutionGroup` per institution,
 * ordered for display (R2.2–R2.6).
 *
 * Grouping is CASE-INSENSITIVE: accounts whose institution names differ only by letter case belong
 * to the same group (for example, "Ally Bank" and "ally bank" are one group). Matching is done on
 * the lowercased name, but the group's displayed `institution` is the FIRST-seen account's original
 * (non-lowercased) string — a deterministic representative that avoids inventing a cased form the
 * data never contained. Accounts are never mutated.
 *
 * Each group's `subtotal` is the arithmetic sum of its member balances (R2.5). Liabilities are not
 * special-cased here: a group's subtotal is simply the sum of whatever accounts belong to that
 * institution, independent of the net-worth liability treatment. A member `accounts` array
 * preserves the input order of its members (R2 stability).
 *
 * Returned groups are ordered by DESCENDING subtotal; groups with EQUAL subtotals are tie-broken by
 * CASE-INSENSITIVE ALPHABETICAL order (A→Z) of their display name (R2.3). The comparator is total
 * and deterministic, so ordering is stable across runs (for example, two institutions that both
 * total 500000 come out alphabetically, "Fidelity" before "Vanguard").
 *
 * Sizes 0 and 1 fall out naturally: an empty input yields an empty array (R2.6), and a single
 * account yields exactly one group (R2.4).
 *
 * Pure and deterministic: it assumes its input has already passed `validateAccounts`, performs no
 * rounding (formatting happens in the UI layer), and reads no external state.
 */
export function computeInstitutionGroups(accounts: Account[]): InstitutionGroup[] {
  // Key on the lowercased institution name for case-insensitive grouping. A Map preserves
  // first-insertion order, which keeps the first-seen display name and keeps member accounts in
  // input order as they are appended.
  const groupsByKey = new Map<string, InstitutionGroup>();

  for (const account of accounts) {
    const key = account.institution.toLowerCase();
    const existing = groupsByKey.get(key);
    if (existing === undefined) {
      groupsByKey.set(key, {
        institution: account.institution, // first-seen original casing is the display name
        subtotal: account.balance,
        accounts: [account],
      });
    } else {
      existing.subtotal += account.balance;
      existing.accounts.push(account);
    }
  }

  // Descending subtotal, then case-insensitive A→Z on the display name as a deterministic
  // tie-break (R2.3).
  return [...groupsByKey.values()].sort((a, b) => {
    if (b.subtotal !== a.subtotal) {
      return b.subtotal - a.subtotal;
    }
    return a.institution.toLowerCase().localeCompare(b.institution.toLowerCase());
  });
}

// ---------------------------------------------------------------------------
// computeClassTotals (R3.1, R3.6)
// ---------------------------------------------------------------------------

/**
 * Sums validated accounts into the dollar value held in each of the four asset classes (R3.1).
 *
 * For every NON-liability account, each class total gains that account's balance weighted by its
 * breakdown percentage for that class: `balance * (assetClassBreakdown[class] / 100)`. The four
 * classes are iterated via the shared `ASSET_CLASS_KEYS` so the sum stays exhaustive and DRY.
 *
 * LIABILITY accounts (type `liability` or `mortgage`, per LIABILITY_TYPES) are excluded entirely —
 * they contribute to no class total (R3.6). All four
 * totals start at 0, so an empty account set or an all-liability set yields
 * `{ stocks: 0, bonds: 0, cash: 0, other: 0 }`.
 *
 * Pure and deterministic: it assumes its input has already passed `validateAccounts`, performs no
 * rounding (percentage rounding happens later in `computeActualAllocation`), and reads no external
 * state.
 */
export function computeClassTotals(accounts: Account[]): ClassTotals {
  const totals: ClassTotals = { stocks: 0, bonds: 0, cash: 0, other: 0 };

  for (const account of accounts) {
    if (isLiabilityType(account.accountType)) {
      continue;
    }
    for (const key of ASSET_CLASS_KEYS) {
      totals[key] += account.balance * (account.assetClassBreakdown[key] / 100);
    }
  }

  return totals;
}

// ---------------------------------------------------------------------------
// computeActualAllocation (R3.2, R3.3, R3.4, R6.5)
// ---------------------------------------------------------------------------

/** Decimal places shown for every allocation percentage: one decimal (R3.4). */
const ALLOCATION_DECIMALS = 1;

/**
 * Integer-tenths scale. All percentage rounding and residual arithmetic is done in whole "tenths
 * of a percent" (one-decimal units scaled by 10) so the four displayed values are exact one-decimal
 * numbers that provably sum to exactly 100 — never 99.9 or 100.1 from float drift (e.g. avoiding a
 * 0.30000000000004). Tenths are integers, so `+`, comparisons, and the ±1 residual nudges below are
 * all exact; only the final divide-by-10 reintroduces a decimal, and 100.0 is representable.
 */
const TENTHS_PER_PERCENT = 10 ** ALLOCATION_DECIMALS; // 10 -> one decimal place

/** Target sum of the four percentages, expressed in integer tenths (100.0% -> 1000 tenths). */
const TARGET_TOTAL_TENTHS = 100 * TENTHS_PER_PERCENT; // 1000

/**
 * Converts dollar-per-class totals into display percentages that always sum to exactly 100.0 with
 * one decimal place (R3.2, R3.4), or all 0 when there is nothing to allocate (R3.3, R6.5).
 *
 * Zero-total path (R3.3, R6.5): when the four class dollars sum to exactly 0, every percentage is 0,
 * `classDollars` echoes the (zero) input totals, `totalAssetValue` is 0, and `isZeroTotal` is true.
 * There is no division, so the zero-denominator case cannot arise.
 *
 * Non-zero path — LARGEST-REMAINDER METHOD (a.k.a. Hamilton's method). Naive independent rounding of
 * each `classTotal / totalAssetValue * 100` to one decimal can leave the four values summing to 99.9
 * or 100.1. To force an exact 100.0 while keeping every value at one decimal:
 *   1. Compute each class's ideal share in integer tenths: `classTotal / totalAssetValue * 1000`.
 *   2. Floor each to an integer number of tenths; track the fractional remainder that was dropped.
 *   3. The floored tenths sum to at most 1000 and are short by `residual = 1000 - sum(floors)`
 *      tenths (0..3 for four classes). Hand out those `residual` leftover tenths one at a time to
 *      the classes with the LARGEST dropped remainder (ties broken by `ASSET_CLASS_KEYS` order for
 *      determinism). This is the standard largest-remainder rule and matches the design note
 *      ("assign the leftover residual to the class with the largest unrounded percentage"): the
 *      class with the largest fractional part is exactly the largest-unrounded class, and the
 *      robust per-tenth distribution also handles the rare case where more than one leftover tenth
 *      must be placed. The result is that the four returned percentages ALWAYS sum to exactly 1000
 *      tenths = 100.0, each at one decimal.
 *
 * All comparison and accumulation happen in integer tenths (see `TENTHS_PER_PERCENT`), so the sum is
 * exact; the only floating-point division (`/ TENTHS_PER_PERCENT`) is applied once at the end and
 * yields clean one-decimal values whose total is representable as 100.0.
 *
 * Pure and deterministic: inputs in, numbers out — no fetch, no `localStorage`, no clock.
 */
export function computeActualAllocation(totals: ClassTotals): AllocationResult {
  const totalAssetValue = ASSET_CLASS_KEYS.reduce(
    (sum, key) => sum + totals[key],
    0,
  );

  // Zero-total path (R3.3, R6.5): nothing to allocate, so every percentage is 0. No division.
  if (totalAssetValue === 0) {
    const zeroPercentages: Record<AssetClass, number> = {
      stocks: 0,
      bonds: 0,
      cash: 0,
      other: 0,
    };
    return {
      percentages: zeroPercentages,
      classDollars: totals,
      totalAssetValue: 0,
      isZeroTotal: true,
    };
  }

  // Step 1-2: ideal share per class in integer tenths, floored, remembering each dropped remainder.
  const flooredTenths: Record<AssetClass, number> = {
    stocks: 0,
    bonds: 0,
    cash: 0,
    other: 0,
  };
  const remainders: Record<AssetClass, number> = {
    stocks: 0,
    bonds: 0,
    cash: 0,
    other: 0,
  };
  let assignedTenths = 0;

  for (const key of ASSET_CLASS_KEYS) {
    const idealTenths = (totals[key] / totalAssetValue) * TARGET_TOTAL_TENTHS;
    const floor = Math.floor(idealTenths);
    flooredTenths[key] = floor;
    remainders[key] = idealTenths - floor; // fractional part dropped by the floor, in [0, 1)
    assignedTenths += floor;
  }

  // Step 3: distribute the leftover tenths to the classes with the largest dropped remainder.
  // `residual` is a small non-negative integer (0..3 for four classes) because each floor removed
  // less than one tenth. Ranking by descending remainder, with ASSET_CLASS_KEYS order as a
  // deterministic tie-break, is the largest-remainder rule.
  const residual = TARGET_TOTAL_TENTHS - assignedTenths;
  const rankedByRemainder = [...ASSET_CLASS_KEYS].sort((a, b) => {
    if (remainders[b] !== remainders[a]) {
      return remainders[b] - remainders[a]; // larger dropped remainder first
    }
    // Deterministic tie-break: earlier in ASSET_CLASS_KEYS wins.
    return ASSET_CLASS_KEYS.indexOf(a) - ASSET_CLASS_KEYS.indexOf(b);
  });

  for (let i = 0; i < residual; i += 1) {
    flooredTenths[rankedByRemainder[i]] += 1;
  }

  // Convert the exact integer tenths back to one-decimal percentages. The tenths now sum to exactly
  // TARGET_TOTAL_TENTHS (1000), so the four percentages sum to exactly 100.0.
  const percentages: Record<AssetClass, number> = {
    stocks: flooredTenths.stocks / TENTHS_PER_PERCENT,
    bonds: flooredTenths.bonds / TENTHS_PER_PERCENT,
    cash: flooredTenths.cash / TENTHS_PER_PERCENT,
    other: flooredTenths.other / TENTHS_PER_PERCENT,
  };

  return {
    percentages,
    classDollars: totals,
    totalAssetValue,
    isZeroTotal: false,
  };
}

// ---------------------------------------------------------------------------
// classifyDrift (R4.3, R4.4, R4.5)
// ---------------------------------------------------------------------------

/**
 * The On_Track_Threshold, in percentage points. A class is considered "on track" while its drift
 * (actual% − target%) stays within ±5 points INCLUSIVE — exactly +5 and exactly −5 are on track;
 * only strictly beyond the band counts as off target. This single constant is the one source of
 * truth for the boundary and is reused by `computeDrift`/`computeOnTrackStatus` and the Property 8
 * drift-classification test, so the ±5 boundary semantics can never drift between them (R4.3–R4.5).
 */
export const ON_TRACK_THRESHOLD = 5;

/**
 * Classifies a single class's percentage-point drift against the ±5 On_Track_Threshold (R4.3–R4.5).
 *
 * `driftPoints` is the signed point drift for one asset class, `actual% − target%`: positive means
 * the class is over its target weight, negative means under. The band is INCLUSIVE at both edges:
 *   - "on track" when `Math.abs(driftPoints) <= ON_TRACK_THRESHOLD` (within ±5, so exactly +5 and
 *     exactly −5 are on track);
 *   - "over"     when `driftPoints > ON_TRACK_THRESHOLD` (more than +5 points above target);
 *   - "under"    when `driftPoints < -ON_TRACK_THRESHOLD` (more than 5 points below target).
 *
 * These three cases are exhaustive over all finite inputs, so a `direction` is always returned.
 *
 * Pure and deterministic: a number in, a classification out — no fetch, no `localStorage`, no clock.
 */
export function classifyDrift(driftPoints: number): DriftClassification {
  let direction: DriftDirection;
  if (Math.abs(driftPoints) <= ON_TRACK_THRESHOLD) {
    direction = 'on track';
  } else if (driftPoints > ON_TRACK_THRESHOLD) {
    direction = 'over';
  } else {
    direction = 'under';
  }

  return { direction };
}

// ---------------------------------------------------------------------------
// computeDrift (R4.1, R4.8, R4.9)
// ---------------------------------------------------------------------------

/**
 * Computes per-class drift of an actual allocation against a target, plus the summary figures the
 * on-track banner needs (R4.1, R4.8, R4.9).
 *
 * For each of the four asset classes (iterated via the shared `ASSET_CLASS_KEYS` so the result is
 * exhaustive and ordering is deterministic):
 *   - `driftPoints` = actual percentage − target percentage = `actual.percentages[key] - target[key]`
 *     (R4.1). `target[key]` is an integer 0–100, so this is a signed percentage-point gap: positive
 *     means the class is over its target weight, negative means under.
 *   - `driftDollars` = actual class dollars − target-implied dollars =
 *     `totals[key] - (target[key] / 100) * actual.totalAssetValue` (R4.1). The target-implied dollar
 *     amount is the target fraction of the portfolio's total asset value. Note `totals[key]` is the
 *     same dollar basis carried on `actual.classDollars[key]`; this function uses the passed-in
 *     `totals` parameter to honor the documented signature.
 *   - `direction` is `classifyDrift(driftPoints).direction`, reusing the single ±5 On_Track_Threshold
 *     definition so the band semantics can never diverge from the classifier.
 *
 * The three summary fields:
 *   - `byClass` carries all four `ClassDrift` entries keyed by asset class.
 *   - `offTargetCount` is how many classes are NOT 'on track' — i.e. 'over' or 'under' (R4.8).
 *   - `largest` is the off-target class with the LARGEST ABSOLUTE `driftPoints` (R4.9). When two
 *     off-target classes tie on absolute drift, the earlier one in `ASSET_CLASS_KEYS` wins, so the
 *     choice is deterministic. When every class is on track (`offTargetCount === 0`) there is no
 *     meaningful largest drift and `largest` is `null`.
 *
 * No drift value is rounded here — raw signed numbers flow through and the UI layer handles
 * formatting. Pure and deterministic: inputs in, numbers out — no fetch, no `localStorage`, no clock.
 */
export function computeDrift(
  actual: AllocationResult,
  totals: ClassTotals,
  target: TargetAllocation,
): DriftResult {
  const byClass = {} as Record<AssetClass, ClassDrift>;
  let offTargetCount = 0;
  let largest: ClassDrift | null = null;

  for (const key of ASSET_CLASS_KEYS) {
    const driftPoints = actual.percentages[key] - target[key];
    const driftDollars = totals[key] - (target[key] / 100) * actual.totalAssetValue;
    const { direction } = classifyDrift(driftPoints);

    const classDrift: ClassDrift = {
      assetClass: key,
      driftPoints,
      driftDollars,
      direction,
    };
    byClass[key] = classDrift;

    if (direction !== 'on track') {
      offTargetCount += 1;
      // Track the largest absolute point drift among off-target classes. The strict `>` keeps the
      // first-seen class on ties, and ASSET_CLASS_KEYS is iterated in order, so ties break
      // deterministically toward the earlier key.
      if (largest === null || Math.abs(driftPoints) > Math.abs(largest.driftPoints)) {
        largest = classDrift;
      }
    }
  }

  return { byClass, offTargetCount, largest };
}

// ---------------------------------------------------------------------------
// computeOnTrackStatus (R4.6, R4.7, R4.8, R4.9)
// ---------------------------------------------------------------------------

/** The fixed number of asset classes reported in the off-target label (R4.8). */
const ASSET_CLASS_COUNT = ASSET_CLASS_KEYS.length; // 4

/**
 * Human-readable, capitalized display names for each asset class, used only to render the
 * largest-drift sentence (R4.9). Keyed by `AssetClass` so the mapping is exhaustive and the
 * compiler flags any class that is ever added without a display name.
 */
const ASSET_CLASS_DISPLAY_NAMES: Record<AssetClass, string> = {
  stocks: 'Stocks',
  bonds: 'Bonds',
  cash: 'Cash',
  other: 'Other',
};

/**
 * Summarizes a `DriftResult` into the single banner status the UI shows above the allocation
 * section (R4.6–R4.9). Takes the already-computed drift so the ±5 On_Track_Threshold lives in
 * exactly one place (`classifyDrift`) and is never re-derived here.
 *
 * `onTrack` is true exactly when no class is off target, i.e. `drift.offTargetCount === 0` (R4.6).
 *
 * `label`:
 *   - on track  → "On track" (R4.7);
 *   - otherwise → "{N} of 4 asset classes off target", with N = `drift.offTargetCount` (R4.8). The
 *     phrasing and the fixed "4" are literal per the requirement; `ASSET_CLASS_COUNT` supplies the
 *     4 so the label and `ASSET_CLASS_KEYS` can never disagree about how many classes exist.
 *
 * `largestDriftSentence`:
 *   - null when on track (R4.9) — there is no meaningful "largest" drift to describe;
 *   - otherwise a single plain-language sentence naming the one most-drifted class (`drift.largest`,
 *     the off-target `ClassDrift` with the largest absolute `driftPoints`, chosen by `computeDrift`).
 *     Shape: "{ClassName} are {N} {point|points} {above|below} your target, about {formatCurrency}",
 *     matching the design example "Stocks are 8 points above your target, about $42,000":
 *       - the class name is capitalized via `ASSET_CLASS_DISPLAY_NAMES`;
 *       - "above" for `direction === 'over'`, "below" for `'under'` (a `largest` is off target by
 *         construction, so its direction is never 'on track');
 *       - the point magnitude is `Math.abs(driftPoints)` rounded to the nearest whole number, with
 *         "point" when that rounded magnitude is exactly 1 and "points" otherwise;
 *       - the dollar figure is `formatCurrency(Math.abs(driftDollars))`, prefixed with "about " to
 *         signal it is an approximation.
 *
 * Defensive guard: by `computeDrift`'s contract `drift.largest` is non-null whenever
 * `offTargetCount > 0`, so the off-target branch should always have a `largest`. We still guard the
 * `null` case rather than assert it — if `largest` were somehow null while off target, we return a
 * null `largestDriftSentence` (the label still reports the count) instead of risking a runtime
 * throw on a bad `DriftResult`. This trusts the contract for the label while failing soft on the
 * sentence.
 *
 * Pure and deterministic: a `DriftResult` in, a status out — no fetch, no `localStorage`, no clock.
 */
export function computeOnTrackStatus(drift: DriftResult): OnTrackStatus {
  const onTrack = drift.offTargetCount === 0;

  if (onTrack) {
    return { onTrack: true, label: 'On track', largestDriftSentence: null };
  }

  const label = `${drift.offTargetCount} of ${ASSET_CLASS_COUNT} asset classes off target`;

  const { largest } = drift;
  // Defensive: trust the contract (largest is non-null when off target) but fail soft on the
  // sentence if it is ever null, keeping the count-bearing label.
  if (largest === null) {
    return { onTrack: false, label, largestDriftSentence: null };
  }

  const className = ASSET_CLASS_DISPLAY_NAMES[largest.assetClass];
  const directionWord = largest.direction === 'over' ? 'above' : 'below';
  const points = Math.round(Math.abs(largest.driftPoints));
  const pointWord = points === 1 ? 'point' : 'points';
  const dollars = formatCurrency(Math.abs(largest.driftDollars));
  const largestDriftSentence = `${className} are ${points} ${pointWord} ${directionWord} your target, about ${dollars}`;

  return { onTrack: false, label, largestDriftSentence };
}

// ---------------------------------------------------------------------------
// computeFreshness (R8.1, R8.2, R8.3)
// ---------------------------------------------------------------------------

/** Freshness_Threshold in days: an account is stale when strictly more than this many days old. */
const FRESHNESS_THRESHOLD_DAYS = 3;

/** Milliseconds in one day, used to derive each account's absolute `lastUpdated` from `now`. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Evaluates per-institution data freshness for validated accounts (R8.1–R8.3).
 *
 * The `Account` model stores freshness as a relative `lastUpdatedDaysAgo` offset rather than an
 * absolute date, so the sample data never decays into looking stale as real time passes (see the
 * `lastUpdatedDaysAgo` design note). This function derives each account's absolute `lastUpdated`
 * date INTERNALLY as `now − lastUpdatedDaysAgo days`. That keeps it pure and deterministic: `now`
 * is a passed-in input, the clock is never read here, and nothing is fetched. Given the same
 * `accounts` and the same `now`, the output is always identical.
 *
 * Grouping mirrors `computeInstitutionGroups`: accounts are grouped CASE-INSENSITIVELY on the
 * lowercased institution name, and each group's displayed `institution` is the FIRST-seen account's
 * original casing — a deterministic representative that never invents a cased form the data did not
 * contain. A `Map` keyed on the lowercased name preserves first-insertion order, so institutions
 * appear in input order (ordering for display is handled by `computeInstitutionGroups`; this
 * function reports freshness, not display order).
 *
 * Per institution (R8.1, R8.2): `asOf` is the MOST RECENT derived `lastUpdated` among the group's
 * accounts — equivalently the account with the SMALLEST `lastUpdatedDaysAgo`. Because larger offsets
 * map to earlier dates, "most recent date" and "smallest offset" pick the same account.
 *
 * Staleness (R8.3): an account is stale IFF its derived date is strictly MORE than the 3-day
 * Freshness_Threshold before `now` — equivalently `lastUpdatedDaysAgo > 3`. Exactly 3 days is NOT
 * stale; only 4 or more is. An institution is stale IFF ANY member account is stale.
 *
 * An empty account set yields an empty `byInstitution` array.
 *
 * Pure and deterministic: inputs in, result out — no fetch, no `localStorage`, no clock read.
 */
export function computeFreshness(accounts: Account[], now: Date): FreshnessResult {
  const nowMs = now.getTime();

  // Accumulate per institution, keyed on the lowercased name for case-insensitive grouping. A Map
  // preserves first-insertion order and the first-seen display name, matching computeInstitutionGroups.
  interface FreshnessAccumulator {
    institution: string; // first-seen original casing
    asOfMs: number;      // largest (most recent) derived timestamp seen so far
    isStale: boolean;    // true once any member account is stale
  }

  const byKey = new Map<string, FreshnessAccumulator>();

  for (const account of accounts) {
    // Derive the absolute lastUpdated date from `now − lastUpdatedDaysAgo days`. This stays pure
    // because `now` is an input; the offset is a non-negative integer (guaranteed by validation).
    const lastUpdatedMs = nowMs - account.lastUpdatedDaysAgo * MS_PER_DAY;
    const accountStale = account.lastUpdatedDaysAgo > FRESHNESS_THRESHOLD_DAYS;

    const key = account.institution.toLowerCase();
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, {
        institution: account.institution,
        asOfMs: lastUpdatedMs,
        isStale: accountStale,
      });
    } else {
      // Keep the most recent (largest timestamp) as the "as of" date (R8.2).
      if (lastUpdatedMs > existing.asOfMs) {
        existing.asOfMs = lastUpdatedMs;
      }
      // Institution is stale if any member is stale (R8.3).
      existing.isStale = existing.isStale || accountStale;
    }
  }

  const byInstitution: InstitutionFreshness[] = [...byKey.values()].map((group) => ({
    institution: group.institution,
    asOf: new Date(group.asOfMs),
    isStale: group.isStale,
  }));

  return { byInstitution };
}
