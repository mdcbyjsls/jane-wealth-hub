/**
 * Server-only Plaid SDK wrapper (R8.2, R14.4).
 *
 * This module constructs the official `plaid` Node SDK client configured against the Plaid Sandbox
 * environment, reading `PLAID_CLIENT_ID` and `PLAID_SECRET` from the server environment. It mirrors
 * the server-only pattern `lib/fred/client.ts` follows: it is imported **only** by the
 * `app/api/plaid/` routes, never by components or pages, so the Plaid secret never reaches the
 * browser.
 *
 * Unlike the FRED client — which takes its API key as a parameter so it can stay a pure fetch
 * wrapper — the Plaid SDK is configured once with credentials from `process.env`. Reading the env
 * here (rather than threading the secret through every call site) keeps the secret contained in the
 * single server-only module the routes share.
 *
 * This module is effectful: constructing the SDK client reads `process.env`. That is intentional and
 * safe because the module is server-only. It reads no clock and no `localStorage`.
 */

import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

/** Plaid credentials read from the server environment. Empty string when unset. */
const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID ?? '';
const PLAID_SECRET = process.env.PLAID_SECRET ?? '';

/**
 * Whether both Plaid credentials are configured in the server environment (R14.1, R14.4).
 *
 * The routes and the server-side status check use this predicate to decide whether to offer the
 * "Connect a test bank" entry point. It returns only a boolean and never the secret itself, so the
 * answer can be forwarded to the browser without exposing credentials.
 */
export function plaidKeysPresent(): boolean {
  return PLAID_CLIENT_ID.trim() !== '' && PLAID_SECRET.trim() !== '';
}

/**
 * Lazily-constructed singleton client. Built on first use so that merely importing this module in a
 * context without credentials does not fail; routes should gate on {@link plaidKeysPresent} first.
 */
let client: PlaidApi | undefined;

/**
 * Return the shared, Sandbox-configured {@link PlaidApi} client that `app/api/plaid/` routes use to
 * call `linkTokenCreate`, `itemPublicTokenExchange`, `accountsGet`, and `investmentsHoldingsGet`.
 *
 * The client targets `PlaidEnvironments.sandbox` and sends the client id and secret as the standard
 * Plaid request headers. The instance is created once and reused across requests.
 */
export function getPlaidClient(): PlaidApi {
  if (client === undefined) {
    const configuration = new Configuration({
      basePath: PlaidEnvironments.sandbox,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
          'PLAID-SECRET': PLAID_SECRET,
        },
      },
    });
    client = new PlaidApi(configuration);
  }
  return client;
}
