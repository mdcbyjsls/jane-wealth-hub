/**
 * Per-account editor validation (R3) — pure, no UI, no fetch, no clock, no localStorage.
 *
 * This validates a single in-progress Account_Editor entry and returns a discriminated union in
 * the same style as `TargetValidationResult` (see `lib/target/targetStore.ts`): on success it
 * carries the normalized, validated fields; on failure it names the FIRST offending field in a
 * fixed order plus a plain-language, developer-facing message. The editor renders that message
 * beside the offending field, keeps Save disabled, and clears it once the field becomes valid
 * (R3.4–R3.6).
 *
 * It is distinct from the batch `validateAccounts` load guard: that one validates already-typed
 * `Account` objects on load; this one validates raw editor strings before an account is accepted.
 *
 * The `AccountInput`, `AccountFieldError`, `AccountValidationResult`, and `ValidatedAccountFields`
 * types are defined here (rather than in `types/accounts.ts`) because they describe this editor
 * boundary only and are consumed by the editor and this validator.
 */

import type { AccountType } from '@/types/accounts';
import { LIABILITY_TYPES } from '@/types/accounts';

/** Raw editor entry: every field is a string so blank / non-numeric input is catchable (R3.1). */
export interface AccountInput {
  institution: string;
  accountName: string;
  /** Raw; checked against the known `AccountType` set. */
  accountType: string;
  /** Raw string so blank / non-numeric is catchable before coercion. */
  balance: string;
  split: { stocks: string; bonds: string; cash: string; other: string };
}

/**
 * The single offending field named on a validation failure. The four asset-class keys cover an
 * out-of-range split value; `'split-sum'` covers four in-range values that do not total 100.
 */
export type AccountFieldError =
  | 'institution'
  | 'accountName'
  | 'accountType'
  | 'balance'
  | 'stocks'
  | 'bonds'
  | 'cash'
  | 'other'
  | 'split-sum';

/** Normalized, validated fields produced on success — typed, coerced, ready for the store. */
export interface ValidatedAccountFields {
  institution: string;
  accountName: string;
  accountType: AccountType;
  balance: number;
  /**
   * Whole-number asset-class split. For non-liability types the four sum to exactly 100. For
   * liability/mortgage types the split carries no asset-class value, so it is normalized to all
   * zeros regardless of what the editor held (R3.3).
   */
  split: { stocks: number; bonds: number; cash: number; other: number };
}

/** Discriminated union consistent with `TargetValidationResult`. */
export type AccountValidationResult =
  | { ok: true; value: ValidatedAccountFields }
  | { ok: false; field: AccountFieldError; message: string };

/** Max length for the free-text institution and account-name fields (R3.1). */
const MAX_TEXT_LENGTH = 120;

/** The known `AccountType` set, used to reject anything outside it (R3.1). */
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

/** Split keys in the fixed first-offender reporting order (R3.4). */
const SPLIT_FIELDS: ReadonlyArray<keyof AccountInput['split']> = [
  'stocks',
  'bonds',
  'cash',
  'other',
];

function isKnownAccountType(value: string): value is AccountType {
  return (KNOWN_ACCOUNT_TYPES as readonly string[]).includes(value);
}

function isLiabilityType(type: AccountType): boolean {
  return LIABILITY_TYPES.includes(type);
}

/**
 * Parse a raw balance string as a finite, non-negative number (R3.1). Returns `null` when the
 * string is blank, not fully numeric, non-finite, or negative. Accepts integers and decimals
 * (balances need not be whole), rejects stray characters and signed/exponent-only noise.
 */
function parseBalance(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  // Non-negative decimal: digits with an optional single decimal part, no sign, no exponent.
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

/**
 * Parse a raw split value as a whole number in [0, 100] (R3.2). Returns `null` for blanks,
 * decimals, non-numeric input, negatives, and values over 100.
 */
function parseSplitPercent(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    return null;
  }
  return value;
}

/**
 * Validate a single raw editor entry (R3.1–R3.3).
 *
 * Fields are checked in a fixed order and the FIRST offending field is reported so the editor
 * shows one inline message at a time (R3.4): institution → accountName → accountType → balance →
 * (for non-liability types) stocks → bonds → cash → other → split-sum.
 *
 * For a liability/mortgage type the split is not validated and contributes no asset-class value;
 * the normalized split is all zeros regardless of the editor's split fields (R3.3). For every
 * non-liability type each split value must be a whole number in [0, 100] and the four must sum to
 * exactly 100.
 */
export function validateAccountInput(input: AccountInput): AccountValidationResult {
  const institution = input.institution.trim();
  if (institution === '') {
    return { ok: false, field: 'institution', message: 'Institution is required.' };
  }
  if (institution.length > MAX_TEXT_LENGTH) {
    return {
      ok: false,
      field: 'institution',
      message: `Institution must be ${MAX_TEXT_LENGTH} characters or fewer.`,
    };
  }

  const accountName = input.accountName.trim();
  if (accountName === '') {
    return { ok: false, field: 'accountName', message: 'Account name is required.' };
  }
  if (accountName.length > MAX_TEXT_LENGTH) {
    return {
      ok: false,
      field: 'accountName',
      message: `Account name must be ${MAX_TEXT_LENGTH} characters or fewer.`,
    };
  }

  const accountTypeRaw = input.accountType.trim();
  if (!isKnownAccountType(accountTypeRaw)) {
    return {
      ok: false,
      field: 'accountType',
      message: 'Choose an account type from the list.',
    };
  }
  const accountType: AccountType = accountTypeRaw;

  const balance = parseBalance(input.balance);
  if (balance === null) {
    return {
      ok: false,
      field: 'balance',
      message: 'Balance must be a non-negative number.',
    };
  }

  // Liability/mortgage accounts bypass the split entirely and carry no asset-class value (R3.3).
  if (isLiabilityType(accountType)) {
    return {
      ok: true,
      value: {
        institution,
        accountName,
        accountType,
        balance,
        split: { stocks: 0, bonds: 0, cash: 0, other: 0 },
      },
    };
  }

  // Non-liability: each split value whole 0–100 (first offender), then the four sum to 100 (R3.2).
  const split = { stocks: 0, bonds: 0, cash: 0, other: 0 };
  for (const field of SPLIT_FIELDS) {
    const parsed = parseSplitPercent(input.split[field]);
    if (parsed === null) {
      return {
        ok: false,
        field,
        message: `${field} must be a whole number from 0 to 100.`,
      };
    }
    split[field] = parsed;
  }

  const sum = split.stocks + split.bonds + split.cash + split.other;
  if (sum !== 100) {
    return {
      ok: false,
      field: 'split-sum',
      message: `The four percentages must sum to exactly 100 (they currently sum to ${sum}).`,
    };
  }

  return {
    ok: true,
    value: { institution, accountName, accountType, balance, split },
  };
}
