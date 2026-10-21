/**
 * Server-only Plaid public-token exchange route (`app/api/plaid/exchange`, App Router `POST`).
 *
 * This handler closes the Plaid connection loop entirely on the server (R8.3–R8.5, R13.2, R13.3):
 *
 *   1. Parse `{ publicToken }` from the request body and gate on {@link plaidKeysPresent}; without
 *      configured credentials there is nothing to exchange, so it returns a non-2xx error.
 *   2. Exchange the Public_Token for an Access_Token via `itemPublicTokenExchange`. The resulting
 *      token lives ONLY in a local `const` for the duration of this request — it is never logged,
 *      never written to storage, never placed in the response, and is discarded when the request
 *      ends (R8.4, R8.5). Nothing in this module persists any token anywhere.
 *   3. Fetch accounts + balances (`accountsBalanceGet`) and investment holdings
 *      (`investmentsHoldingsGet`) within the same request. A holdings fetch that fails or returns
 *      nothing is tolerated: the accounts we can map are still mapped, and holdingless investment
 *      accounts fall through the pure mapper to `allocationNeedsInput` (R13.3).
 *   4. Assemble a {@link PlaidMapperInput} from the SDK shapes and call the pure
 *      {@link mapPlaidToAccounts}. The institution id/name come from the Plaid `Item` when present,
 *      else a derived label. The injected `idFor` makes each `Account.id` deterministic.
 *   5. Return `{ institutionId, institutionName, accounts }`. No token or secret appears in the
 *      body.
 *
 * Any failure returns a non-2xx JSON body with a plain-language message and leaves nothing
 * persisted; internal error detail and tokens are never leaked to the client (R13.2). This module
 * is the only place (besides the sibling routes) the Plaid SDK and its tokens live; the browser
 * receives only the mapped {@link Account}s.
 */

import { getPlaidClient, plaidKeysPresent } from '@/lib/plaid/client';
import { mapPlaidToAccounts } from '@/lib/plaid/mapper';
import type {
  PlaidAccountRaw,
  PlaidHolding,
  PlaidMapperInput,
  PlaidSecurity,
} from '@/types/plaid';
import type { Account } from '@/types/accounts';

/** Resolved per-request (token exchange, live SDK calls), so it must never be statically cached. */
export const dynamic = 'force-dynamic';

/** HTTP status when Plaid credentials are not configured on the server (R14) — nothing to exchange. */
const PLAID_NOT_CONFIGURED_STATUS = 503;
/** HTTP status for a malformed request body (missing/!string `publicToken`). */
const BAD_REQUEST_STATUS = 400;
/** HTTP status for a failed exchange / data fetch — connection could not be completed (R13.2). */
const CONNECTION_FAILED_STATUS = 502;

/** The exchange route's success body: the mapped Connected_Accounts and their institution label. */
interface ExchangeSuccess {
  institutionId: string;
  institutionName: string;
  accounts: Account[];
}

/** The exchange route's error body: a plain-language message only — never a token, secret, or stack. */
interface ExchangeError {
  error: string;
}

/**
 * Minimal structural view of the SDK account shape the mapper needs (`accountsBalanceGet` /
 * `accountsGet` return `AccountBase[]`). Declared locally so this module does not depend on the
 * SDK's exported interface names, only on the fields it actually reads.
 */
interface SdkAccount {
  account_id: string;
  name: string;
  mask: string | null;
  type: unknown; // AccountType enum — coerced to string for the mapper
  subtype: unknown; // AccountSubtype enum | null — coerced to string | null
  balances: { current: number | null };
}

/** Minimal structural view of an SDK investment holding (`investmentsHoldingsGet`). */
interface SdkHolding {
  account_id: string;
  security_id: string;
  institution_value: number;
}

/** Minimal structural view of an SDK security (`investmentsHoldingsGet`). */
interface SdkSecurity {
  security_id: string;
  name: string | null;
  type: string | null;
  subtype?: string | null;
}

/** Minimal structural view of the Plaid `Item` carried on the SDK responses. */
interface SdkItem {
  item_id: string;
  institution_id?: string | null;
  institution_name?: string | null;
}

/** Coerce an optional SDK enum/string field to a plain `string` (empty when absent). */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Coerce an optional SDK enum/string field to `string | null` (null when absent). */
function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Map one SDK account into the mapper's {@link PlaidAccountRaw} shape. A `null`/absent current
 * balance is treated as 0 so the account is still mappable (R13.3): the mapper assigns depository
 * balances to cash and liability balances via `Math.abs`, and 0 is a safe, honest default when the
 * institution did not report a balance.
 */
function toRawAccount(account: SdkAccount): PlaidAccountRaw {
  const current = account.balances.current;
  return {
    accountId: account.account_id,
    name: account.name,
    mask: account.mask,
    type: asString(account.type),
    subtype: asNullableString(account.subtype),
    balanceCurrent: typeof current === 'number' && Number.isFinite(current) ? current : 0,
  };
}

/** Map one SDK holding into the mapper's {@link PlaidHolding} shape. */
function toHolding(holding: SdkHolding): PlaidHolding {
  return {
    accountId: holding.account_id,
    securityId: holding.security_id,
    institutionValue: holding.institution_value,
  };
}

/** Map one SDK security into the mapper's {@link PlaidSecurity} shape. */
function toSecurity(security: SdkSecurity): PlaidSecurity {
  return {
    securityId: security.security_id,
    name: security.name,
    type: security.type,
    subtype: security.subtype ?? null,
  };
}

/**
 * Derive the institution id and display name from the Plaid `Item`(s) returned by the SDK calls,
 * preferring the first one that actually carries an institution id. Plaid Sandbox may omit the
 * institution id/name, so a stable fallback keyed on the `item_id` keeps `institutionId` non-empty
 * and deterministic (the store groups Connected_Accounts by it).
 */
function resolveInstitution(items: Array<SdkItem | undefined>): {
  institutionId: string;
  institutionName: string;
} {
  for (const item of items) {
    if (item && typeof item.institution_id === 'string' && item.institution_id.trim() !== '') {
      const name =
        typeof item.institution_name === 'string' && item.institution_name.trim() !== ''
          ? item.institution_name
          : item.institution_id;
      return { institutionId: item.institution_id, institutionName: name };
    }
  }
  // No institution id on any item — fall back to a label derived from the item id.
  const firstItem = items.find((item): item is SdkItem => item !== undefined);
  const fallbackId = firstItem ? `item-${firstItem.item_id}` : 'connected-institution';
  return { institutionId: fallbackId, institutionName: 'Connected institution' };
}

/**
 * `POST /api/plaid/exchange`. Exchanges a Public_Token for an Access_Token server-side, fetches the
 * Item's accounts/balances/holdings, maps them with the pure mapper, and returns the mapped
 * accounts. The Access_Token never leaves this function (R8.4, R8.5).
 */
export async function POST(request: Request): Promise<Response> {
  if (!plaidKeysPresent()) {
    const body: ExchangeError = {
      error: 'Bank connections are not available because Plaid credentials are not configured.',
    };
    return Response.json(body, { status: PLAID_NOT_CONFIGURED_STATUS });
  }

  // Parse the body defensively: a non-JSON or malformed body is a bad request, not a crash.
  let publicToken: unknown;
  try {
    const parsed: unknown = await request.json();
    publicToken =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { publicToken?: unknown }).publicToken
        : undefined;
  } catch {
    publicToken = undefined;
  }

  if (typeof publicToken !== 'string' || publicToken.trim() === '') {
    const body: ExchangeError = {
      error: 'The connection request was missing a valid public token. Please try connecting again.',
    };
    return Response.json(body, { status: BAD_REQUEST_STATUS });
  }

  try {
    const plaid = getPlaidClient();

    // Exchange for the Access_Token. It is held ONLY here and is never persisted, logged, or
    // returned; it is discarded when this request completes (R8.4, R8.5).
    const exchange = await plaid.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exchange.data.access_token;

    // Accounts + balances are required; a failure here means the connection could not be completed.
    const accountsResponse = await plaid.accountsBalanceGet({ access_token: accessToken });
    const sdkAccounts = accountsResponse.data.accounts as unknown as SdkAccount[];
    const accountsItem = accountsResponse.data.item as unknown as SdkItem;

    // Investment holdings are best-effort: if the fetch fails or the Item has no investment data,
    // we still map the accounts we have. Holdingless investment accounts get flagged for input by
    // the pure mapper (R10.7, R13.3).
    let holdings: PlaidHolding[] = [];
    let securities: PlaidSecurity[] = [];
    let holdingsItem: SdkItem | undefined;
    try {
      const holdingsResponse = await plaid.investmentsHoldingsGet({ access_token: accessToken });
      holdings = (holdingsResponse.data.holdings as unknown as SdkHolding[]).map(toHolding);
      securities = (holdingsResponse.data.securities as unknown as SdkSecurity[]).map(toSecurity);
      holdingsItem = holdingsResponse.data.item as unknown as SdkItem;
    } catch {
      // No holdings available — leave holdings/securities empty so investment accounts map to the
      // "Allocation needs your input" fallback rather than failing the whole connection (R13.3).
      holdings = [];
      securities = [];
    }

    const { institutionId, institutionName } = resolveInstitution([holdingsItem, accountsItem]);

    const mapperInput: PlaidMapperInput = {
      institution: institutionId,
      accounts: sdkAccounts.map(toRawAccount),
      securities,
      holdings,
      idFor: (accountId: string) => `plaid-${institutionId}-${accountId}`,
    };

    const accounts = mapPlaidToAccounts(mapperInput);

    const body: ExchangeSuccess = { institutionId, institutionName, accounts };
    return Response.json(body);
    // `accessToken` goes out of scope here and is never stored — nothing persists it (R8.5).
  } catch {
    // Any failure of exchange or the required accounts fetch: a plain-language message, no token or
    // secret leaked, and nothing persisted (R13.2).
    const body: ExchangeError = {
      error: 'We could not connect to that bank. Please try again. Your existing accounts are unchanged.',
    };
    return Response.json(body, { status: CONNECTION_FAILED_STATUS });
  }
}
