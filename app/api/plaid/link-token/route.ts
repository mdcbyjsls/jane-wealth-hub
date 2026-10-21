/**
 * Server-only Plaid link-token route (`Plaid_Link_Token_Route`, App Router `POST`).
 *
 * This handler mints the short-lived `Link_Token` that the browser needs to initialize Plaid Link
 * (R8.2). Creating the token here — rather than in the client — is what keeps the Plaid secret on
 * the server: the secret is read once in `lib/plaid/client.ts` (via the SDK headers) and is never
 * placed in this route's request or response. The route returns only `{ linkToken }` on success.
 *
 * It mirrors the server-only orchestration pattern of `app/api/market-data/route.ts`: a thin adapter
 * that gates on configuration, calls the effectful collaborator, and serializes the outcome. When
 * the Plaid credentials are absent (`plaidKeysPresent()` is false) it returns a non-2xx JSON error
 * so the client can hide or disable the connect entry point (R14.1); when the Plaid SDK call fails
 * it returns a non-2xx JSON body carrying a plain-language message and never the underlying error
 * detail or secret (R13.2).
 */

import { CountryCode, Products } from 'plaid';
import { getPlaidClient, plaidKeysPresent } from '@/lib/plaid/client';

/**
 * The token is minted per request against live Plaid credentials, so the route must never be
 * statically cached.
 */
export const dynamic = 'force-dynamic';

/** HTTP status when Plaid credentials are not configured (precondition not met). */
const PLAID_NOT_CONFIGURED_STATUS = 400;

/** HTTP status when the Plaid SDK call fails (upstream dependency unavailable). */
const PLAID_UNAVAILABLE_STATUS = 502;

/**
 * Fixed demo user id for the single-user Sandbox experience. There are no real user accounts in
 * this spec, so one stable `client_user_id` is sufficient to associate the Link session.
 */
const DEMO_CLIENT_USER_ID = 'jane-wealth-hub-demo-user';

/**
 * `POST /api/plaid/link-token`. Mints a `Link_Token` for Plaid Link.
 *
 * Returns `{ linkToken }` with a 200 on success. Returns a non-2xx JSON error when credentials are
 * absent or the Plaid call fails — the error body is a plain-language message only and never leaks
 * the secret or raw SDK error (R13.2).
 */
export async function POST(): Promise<Response> {
  // Gate on configuration before touching the SDK so a keys-absent deployment fails cleanly (R14.1).
  if (!plaidKeysPresent()) {
    return Response.json(
      { error: 'Plaid is not configured. Add Plaid credentials to connect a test bank.' },
      { status: PLAID_NOT_CONFIGURED_STATUS },
    );
  }

  try {
    const client = getPlaidClient();
    const response = await client.linkTokenCreate({
      user: { client_user_id: DEMO_CLIENT_USER_ID },
      client_name: 'Jane Wealth Hub',
      // Investments covers holdings and balances, which the Plaid_Mapper needs to split accounts.
      products: [Products.Investments],
      country_codes: [CountryCode.Us],
      language: 'en',
    });

    return Response.json({ linkToken: response.data.link_token });
  } catch {
    // Swallow the SDK error detail: never forward it (it can echo request context) and never the
    // secret. Surface a plain-language message the client can show as-is (R13.2).
    return Response.json(
      { error: 'Could not start the bank connection. Please try again.' },
      { status: PLAID_UNAVAILABLE_STATUS },
    );
  }
}
