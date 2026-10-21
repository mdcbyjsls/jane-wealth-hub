import { describe, expect, it } from 'vitest';

import { validateAccounts } from '@/lib/calculations/allocation';
import type { Account, AssetClassBreakdown, ValidationError } from '@/types/accounts';

// Unit tests for `validateAccounts` (Task 4.2). These cover one concrete example per
// ValidationErrorCode, the breakdown-sum tolerance boundary (±0.01), the liability exemption,
// and correct accountIndex reporting when the offending account is not first.
// _Requirements: 7.1, 7.2, 7.3, 7.5_

/**
 * Builds a known-good account. Callers override individual fields to craft fixtures. The default
 * breakdown sums to exactly 100, so overriding only one field keeps the rest valid.
 */
function goodAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acct-fidelity',
    source: 'Sample',
    institution: 'Fidelity',
    accountName: 'Brokerage',
    accountType: 'brokerage',
    balance: 1000,
    assetClassBreakdown: { stocks: 60, bonds: 20, cash: 10, other: 10 },
    lastUpdatedDaysAgo: 0,
    ...overrides,
  };
}

/** Builds a breakdown, defaulting to a valid 60/20/10/10 split. */
function breakdown(overrides: Partial<AssetClassBreakdown> = {}): AssetClassBreakdown {
  return { stocks: 60, bonds: 20, cash: 10, other: 10, ...overrides };
}

/** Finds the first error with the given code, or undefined when none is present. */
function findError(
  errors: ValidationError[],
  code: ValidationError['code'],
): ValidationError | undefined {
  return errors.find((e) => e.code === code);
}

describe('validateAccounts', () => {
  describe('valid input', () => {
    it('accepts a fully valid array and preserves the accounts', () => {
      const accounts: Account[] = [
        goodAccount(),
        goodAccount({ institution: 'Vanguard', accountType: 'IRA', balance: 50000 }),
        goodAccount({ accountType: 'liability', balance: 15000, assetClassBreakdown: breakdown({ stocks: 0, bonds: 0, cash: 0, other: 0 }) }),
      ];

      const result = validateAccounts(accounts);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.accounts).toEqual(accounts);
        expect(result.accounts).toHaveLength(3);
      }
    });
  });

  describe('one example per ValidationErrorCode', () => {
    it('reports MISSING_FIELD for an account missing institution', () => {
      const raw: unknown = [
        {
          accountType: 'brokerage',
          balance: 1000,
          assetClassBreakdown: breakdown(),
          lastUpdatedDaysAgo: 0,
        },
      ];

      const result = validateAccounts(raw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = findError(result.errors, 'MISSING_FIELD');
        expect(error).toBeDefined();
        expect(error?.accountIndex).toBe(0);
        expect(error?.field).toBe('institution');
      }
    });

    it('reports INVALID_TYPE with accountIndex -1 when the top-level input is not an array', () => {
      const raw: unknown = { not: 'an array' };

      const result = validateAccounts(raw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toHaveLength(1);
        const error = result.errors[0];
        expect(error.code).toBe('INVALID_TYPE');
        expect(error.accountIndex).toBe(-1);
      }
    });

    it('reports INVALID_TYPE for a wrong-typed accountType (number)', () => {
      const raw: unknown = [
        {
          institution: 'Fidelity',
          accountType: 42,
          balance: 1000,
          assetClassBreakdown: breakdown(),
          lastUpdatedDaysAgo: 0,
        },
      ];

      const result = validateAccounts(raw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = findError(result.errors, 'INVALID_TYPE');
        expect(error).toBeDefined();
        expect(error?.accountIndex).toBe(0);
        expect(error?.field).toBe('accountType');
      }
    });

    it('reports NON_FINITE_BALANCE for a NaN balance', () => {
      const raw: unknown = [goodAccount({ balance: NaN })];

      const result = validateAccounts(raw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = findError(result.errors, 'NON_FINITE_BALANCE');
        expect(error).toBeDefined();
        expect(error?.accountIndex).toBe(0);
        expect(error?.field).toBe('balance');
      }
    });

    it('reports NON_FINITE_BALANCE for an Infinity balance', () => {
      const raw: unknown = [goodAccount({ balance: Number.POSITIVE_INFINITY })];

      const result = validateAccounts(raw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = findError(result.errors, 'NON_FINITE_BALANCE');
        expect(error).toBeDefined();
        expect(error?.field).toBe('balance');
      }
    });

    it('reports INSTITUTION_LENGTH for an empty institution name', () => {
      const raw: unknown = [goodAccount({ institution: '' })];

      const result = validateAccounts(raw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = findError(result.errors, 'INSTITUTION_LENGTH');
        expect(error).toBeDefined();
        expect(error?.accountIndex).toBe(0);
        expect(error?.field).toBe('institution');
      }
    });

    it('reports INSTITUTION_LENGTH for a 121-character institution name', () => {
      const raw: unknown = [goodAccount({ institution: 'a'.repeat(121) })];

      const result = validateAccounts(raw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = findError(result.errors, 'INSTITUTION_LENGTH');
        expect(error).toBeDefined();
        expect(error?.field).toBe('institution');
      }
    });

    it('reports UNKNOWN_ACCOUNT_TYPE for an unrecognized account type', () => {
      // `accountType` is deliberately outside the AccountType union, so build via unknown.
      const raw: unknown = [
        {
          institution: 'Fidelity',
          accountType: 'crypto-wallet',
          balance: 1000,
          assetClassBreakdown: breakdown(),
          lastUpdatedDaysAgo: 0,
        },
      ];

      const result = validateAccounts(raw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = findError(result.errors, 'UNKNOWN_ACCOUNT_TYPE');
        expect(error).toBeDefined();
        expect(error?.accountIndex).toBe(0);
        expect(error?.field).toBe('accountType');
      }
    });

    it('reports BREAKDOWN_SUM for a non-liability breakdown summing to 90', () => {
      const raw: unknown = [
        goodAccount({ assetClassBreakdown: breakdown({ stocks: 50 }) }), // 50+20+10+10 = 90
      ];

      const result = validateAccounts(raw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = findError(result.errors, 'BREAKDOWN_SUM');
        expect(error).toBeDefined();
        expect(error?.accountIndex).toBe(0);
        expect(error?.field).toBe('assetClassBreakdown');
      }
    });
  });

  describe('breakdown-sum tolerance boundary', () => {
    it('accepts a non-liability breakdown off by exactly 0.01 (sum 100.01)', () => {
      const raw: unknown = [
        goodAccount({ assetClassBreakdown: breakdown({ stocks: 60.01 }) }), // 60.01+20+10+10 = 100.01
      ];

      const result = validateAccounts(raw);

      expect(result.ok).toBe(true);
    });

    it('rejects a non-liability breakdown off by 0.02 (sum 100.02) with BREAKDOWN_SUM', () => {
      const raw: unknown = [
        goodAccount({ assetClassBreakdown: breakdown({ stocks: 60.02 }) }), // 60.02+20+10+10 = 100.02
      ];

      const result = validateAccounts(raw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = findError(result.errors, 'BREAKDOWN_SUM');
        expect(error).toBeDefined();
        expect(error?.accountIndex).toBe(0);
        expect(error?.field).toBe('assetClassBreakdown');
      }
    });
  });

  describe('liability exemption', () => {
    it('accepts a liability account whose breakdown sums to 0', () => {
      const raw: unknown = [
        goodAccount({
          accountType: 'liability',
          balance: 20000,
          assetClassBreakdown: breakdown({ stocks: 0, bonds: 0, cash: 0, other: 0 }),
        }),
      ];

      const result = validateAccounts(raw);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        // Guard: no breakdown-sum error should have been raised for a liability.
        expect(findError(result.errors, 'BREAKDOWN_SUM')).toBeUndefined();
      }
    });
  });

  describe('accountIndex reporting', () => {
    it('reports the index of the offending account when it is not the first', () => {
      const raw: unknown = [
        goodAccount(),
        goodAccount({ balance: NaN }), // second account (index 1) is the problem
      ];

      const result = validateAccounts(raw);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const error = findError(result.errors, 'NON_FINITE_BALANCE');
        expect(error).toBeDefined();
        expect(error?.accountIndex).toBe(1);
        expect(error?.field).toBe('balance');
      }
    });
  });
});
