'use client';

/*
 * PlaidConnectButton — the browser side of "Connect a test bank" through Plaid
 * Sandbox (R8.1, R8.6, R13).
 *
 * This is a CLIENT component. It NEVER imports the Plaid Node SDK or
 * `lib/plaid/client.ts`; the only way it reaches Plaid is by fetching our own
 * server routes, which hold the secret:
 *   1. POST /api/plaid/link-token            → { linkToken }
 *   2. (Plaid Link opens with that token; the user picks a Sandbox bank)
 *   3. POST /api/plaid/exchange { publicToken } → { institutionId, institutionName, accounts }
 * The server exchanges the public token, fetches balances/holdings, runs the
 * pure Plaid_Mapper, and discards every token (R8.2–R8.5). The browser only
 * ever sees the short-lived Link_Token and the already-mapped accounts.
 *
 * Persistence ownership (documented decision): this component does NOT import
 * the Account_Store. On a successful exchange it hands the mapped accounts to
 * the parent via the `onInstitutionConnected` callback, and the PARENT owns
 * calling `upsertConnectedInstitution`, saving, and recomputing the views
 * (R8.6). Keeping the store out of this component keeps the Plaid wiring
 * focused and leaves the single recompute/persist path in one place in the
 * parent, matching how the other editor controls report changes upward.
 *
 * Flow states (R13):
 *   - In-progress (R13.4): from the first click until Link resolves or the
 *     exchange finishes, a plain-language "Connecting…" indication is shown and
 *     no partial/unmapped data is surfaced as final.
 *   - Cancel (R13.1): Link `onExit` with no error is a no-op — we return to the
 *     idle state, add no accounts, and show NO error.
 *   - Error (R13.2): any failure of link-token creation, Link itself, the
 *     exchange, or the data fetch shows one plain-language connection-error
 *     message and leaves the existing accounts untouched (the parent is never
 *     called).
 *
 * Accessibility: the trigger is a real <button> (keyboard reachable/operable
 * with a visible focus ring). The in-progress and error messages are TEXT (not
 * color-only) inside an `aria-live="polite"` region so assistive tech announces
 * the state change; the error also carries `role="alert"`. The ⚠ glyph is
 * decorative (aria-hidden) because the adjacent text already carries meaning.
 *
 * The keys-absent explanation UI and the per-institution disconnect control are
 * out of this component's scope (task 17.4); this component only honors a
 * `disabled` prop the parent passes when Plaid keys are absent.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import type {
  PlaidLinkOnExit,
  PlaidLinkOnSuccess,
} from 'react-plaid-link';
import type { Account } from '@/types/accounts';

/** Shape of a successful `/api/plaid/exchange` response (server-mapped, R8.4). */
interface ExchangeResponse {
  institutionId: string;
  institutionName: string;
  accounts: Account[];
}

export interface PlaidConnectButtonProps {
  /**
   * Called once the server has exchanged the public token and mapped the
   * institution's accounts (R8.6). The parent runs
   * `upsertConnectedInstitution(institutionId, accounts)`, persists, and
   * recomputes the views. `institutionName` is passed through for the
   * connect/disconnect UI; the store keys on `institutionId`.
   */
  onInstitutionConnected: (
    institutionId: string,
    accounts: Account[],
    institutionName: string,
  ) => void;
  /**
   * When true, the entry point is disabled — the parent sets this when Plaid
   * keys are absent (R14.1). The plain-language "why" explanation is the
   * parent's responsibility (task 17.4); here a disabled button simply cannot
   * start a connection.
   */
  disabled?: boolean;
  /** Optional label override; defaults to the Sandbox-labeled call to action. */
  label?: string;
}

/** The three user-visible phases of the connection flow (R13.1, R13.2, R13.4). */
type FlowState =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'error' };

/** Single plain-language connection-error message for every failure path (R13.2). */
const CONNECTION_ERROR_MESSAGE =
  "We couldn't connect that test bank. Your accounts are unchanged — try again in a moment.";

/** Plain-language in-progress indication (R13.4). */
const CONNECTING_MESSAGE = 'Connecting to your test bank\u2026';

/** Default call to action, clearly labeled as Plaid Sandbox (R8.1). */
const DEFAULT_LABEL = 'Connect a test bank (Plaid Sandbox)';

export default function PlaidConnectButton({
  onInstitutionConnected,
  disabled = false,
  label,
}: PlaidConnectButtonProps): React.ReactElement {
  const [flow, setFlow] = useState<FlowState>({ status: 'idle' });
  const [linkToken, setLinkToken] = useState<string | null>(null);

  /*
   * Tracks whether the user actually initiated this connection in the current
   * attempt. `usePlaidLink` becomes `ready` as a side effect of the token being
   * set; we must only auto-`open()` for a token the user asked for, never on a
   * stale re-init. The ref is set true on click and cleared the moment Link is
   * opened so a single click opens Link exactly once.
   */
  const shouldOpenRef = useRef(false);

  /** Latest callback without forcing the Plaid effect to re-run on parent re-renders. */
  const onConnectedRef = useRef(onInstitutionConnected);
  useEffect(() => {
    onConnectedRef.current = onInstitutionConnected;
  }, [onInstitutionConnected]);

  /** Exchange the public token on the server, then hand mapped accounts upward (R8.3–R8.6). */
  const exchangePublicToken = useCallback(async (publicToken: string): Promise<void> => {
    try {
      const response = await fetch('/api/plaid/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicToken }),
      });
      if (!response.ok) {
        // Non-2xx from the exchange/fetch step → connection error (R13.2).
        setFlow({ status: 'error' });
        return;
      }
      const data = (await response.json()) as ExchangeResponse;
      if (
        typeof data.institutionId !== 'string' ||
        typeof data.institutionName !== 'string' ||
        !Array.isArray(data.accounts)
      ) {
        // Malformed success body is treated as a failure; accounts stay unchanged (R13.2).
        setFlow({ status: 'error' });
        return;
      }
      // Hand the mapped accounts to the parent, which persists and recomputes (R8.6).
      onConnectedRef.current(data.institutionId, data.accounts, data.institutionName);
      setFlow({ status: 'idle' });
      // Clear the consumed link token so a later connection mints a fresh one.
      setLinkToken(null);
    } catch {
      // Network/parse failure → one plain-language error, accounts unchanged (R13.2).
      setFlow({ status: 'error' });
    }
  }, []);

  const handleSuccess = useCallback<PlaidLinkOnSuccess>(
    (publicToken) => {
      if (publicToken === null) {
        // No token means nothing to exchange; treat as a failed connection (R13.2).
        setFlow({ status: 'error' });
        return;
      }
      // Stay in the in-progress state across the server exchange (R13.4).
      setFlow({ status: 'connecting' });
      void exchangePublicToken(publicToken);
    },
    [exchangePublicToken],
  );

  const handleExit = useCallback<PlaidLinkOnExit>((error) => {
    if (error) {
      // Link surfaced an error (not a plain cancel) → connection error (R13.2).
      setFlow({ status: 'error' });
      return;
    }
    // Plain cancel: return to idle, add nothing, show no error (R13.1).
    setFlow({ status: 'idle' });
    setLinkToken(null);
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: handleExit,
  });

  /*
   * Once a user-initiated token is set and Link reports `ready`, open it exactly
   * once. The ref gate ensures we never auto-open on an unrelated re-init.
   */
  useEffect(() => {
    if (shouldOpenRef.current && linkToken !== null && ready) {
      shouldOpenRef.current = false;
      open();
    }
  }, [linkToken, ready, open]);

  /** Mint a Link_Token on the server, then let the effect open Link when ready (R8.2, R13.2). */
  const requestLinkTokenAndOpen = useCallback(async (): Promise<void> => {
    setFlow({ status: 'connecting' });
    shouldOpenRef.current = true;
    try {
      const response = await fetch('/api/plaid/link-token', { method: 'POST' });
      if (!response.ok) {
        // link-token creation failed → connection error, accounts unchanged (R13.2).
        shouldOpenRef.current = false;
        setFlow({ status: 'error' });
        return;
      }
      const data = (await response.json()) as { linkToken?: unknown };
      if (typeof data.linkToken !== 'string' || data.linkToken.length === 0) {
        shouldOpenRef.current = false;
        setFlow({ status: 'error' });
        return;
      }
      setLinkToken(data.linkToken);
      // The open() call happens in the effect above once `ready` flips true.
    } catch {
      shouldOpenRef.current = false;
      setFlow({ status: 'error' });
    }
  }, []);

  const isConnecting = flow.status === 'connecting';
  const handleClick = useCallback(() => {
    if (disabled || isConnecting) {
      return;
    }
    void requestLinkTokenAndOpen();
  }, [disabled, isConnecting, requestLinkTokenAndOpen]);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isConnecting}
        aria-busy={isConnecting}
        className="inline-flex items-center justify-center self-start rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
      >
        {isConnecting ? 'Connecting\u2026' : (label ?? DEFAULT_LABEL)}
      </button>

      {/*
        Status region: announces the in-progress and error states to assistive
        tech as they change. Both states are conveyed in TEXT (never color
        alone, R9.6). The error additionally carries role="alert" for a prompt
        announcement and leaves the button available to retry.
      */}
      <div aria-live="polite" className="min-h-[1.25rem]">
        {isConnecting && (
          <p className="text-sm text-slate-600">{CONNECTING_MESSAGE}</p>
        )}
        {flow.status === 'error' && (
          <p
            role="alert"
            className="inline-flex items-start gap-1.5 text-sm text-red-700"
          >
            {/* Decorative glyph — the adjacent text carries the meaning (R9.6). */}
            <span aria-hidden="true">⚠</span>
            <span>{CONNECTION_ERROR_MESSAGE}</span>
          </p>
        )}
      </div>
    </div>
  );
}
