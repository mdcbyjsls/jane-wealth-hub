/**
 * Server-only Plaid status route (`Plaid_Keys_Present`, App Router `GET`).
 *
 * This thin handler reports whether the Plaid client id and secret are configured in the server
 * environment, so the browser can decide whether to offer the "Connect a test bank" entry point
 * (R14.1) without ever seeing the credentials themselves. The determination happens entirely on the
 * server (R14.4): the only thing that crosses to the client is the boolean that
 * {@link plaidKeysPresent} returns — never the client id, never the secret, in any response body,
 * header, or payload.
 *
 * Like the market-data route, this must resolve per request (the env check is read at request time),
 * so it opts out of Next's static route cache.
 */

import { plaidKeysPresent } from '@/lib/plaid/client';

/**
 * The status reflects server env that is read at request time, so the route must never be statically
 * cached.
 */
export const dynamic = 'force-dynamic';

/**
 * `GET /api/plaid/status`. Returns `{ plaidKeysPresent: boolean }` computed by the server-only
 * {@link plaidKeysPresent} predicate. The response carries only the boolean — the Plaid client id
 * and secret are never included (R14.4) — which lets the client hide or disable the Plaid entry
 * point (R14.1).
 */
export async function GET(): Promise<Response> {
  return Response.json({ plaidKeysPresent: plaidKeysPresent() });
}
