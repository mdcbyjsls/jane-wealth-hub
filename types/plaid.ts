import type { Account } from '@/types/accounts';

/**
 * Input types for the Plaid_Mapper (`lib/plaid/mapper.ts`), which purely converts Plaid accounts,
 * balances, and holdings into our `Account` model (R10). These describe only the Plaid-shaped data
 * the mapper reads; the mapper itself is pure — no fetch, no clock, no RNG, no `localStorage` — so
 * the id factory is injected via `PlaidMapperInput.idFor` rather than generated inside the mapper.
 *
 * The server-only Plaid route (`app/api/plaid/exchange`) assembles these from the SDK responses,
 * calls `mapPlaidToAccounts`, and returns the resulting `Account[]`; the Plaid SDK and its tokens
 * never reach the browser.
 */

/** A security referenced by one or more holdings (R10.4, R10.5). */
export interface PlaidSecurity {
  securityId: string;
  type?: string | null;    // e.g. 'equity', 'fixed income', 'cash', 'derivative'
  subtype?: string | null;
  name?: string | null;
}

/** One holding: the market value of a security within a specific investment account (R10.6). */
export interface PlaidHolding {
  accountId: string;
  securityId: string;
  institutionValue: number; // market value of the holding
}

/** A raw Plaid account before mapping into our `Account` model (R10.2, R10.3). */
export interface PlaidAccountRaw {
  accountId: string;
  name: string;
  mask: string | null;
  type: string;             // 'depository' | 'investment' | 'loan' | 'credit' | ...
  subtype: string | null;   // 'checking' | 'savings' | 'mortgage' | '401k' | ...
  balanceCurrent: number;
}

/**
 * The complete input to `mapPlaidToAccounts`. `idFor` is an injected id factory so the mapper
 * stays pure and deterministic — it reads no clock and no RNG of its own (R10.1).
 */
export interface PlaidMapperInput {
  institution: string;
  accounts: PlaidAccountRaw[];
  securities: PlaidSecurity[];
  holdings: PlaidHolding[];
  /** Injected id factory: maps a Plaid accountId to the stable `Account.id` the store will use. */
  idFor: (accountId: string) => string;
}

/** The mapper's output: Connected_Accounts ready for the Account_Store (R10). */
export type PlaidMapperResult = Account[];
