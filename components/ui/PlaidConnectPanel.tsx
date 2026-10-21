'use client';

/*
 * PlaidConnectPanel — the "Connect a test bank" surface: the keys-absent explanation,
 * the Sandbox-credentials guidance, the connect entry point, and the per-institution
 * disconnect controls (R8.1, R9.1, R9.2, R14.1, R14.2, R14.3, R15.5).
 *
 * This is a CLIENT component but it does NOT own persistence. Like PlaidConnectButton,
 * it reports changes upward and lets the parent (a *Client island) run the
 * Account_Store set-operations, persist, and recompute the views:
 *   - a successful connect flows out through `onInstitutionConnected` (passed straight
 *     through to the wrapped PlaidConnectButton; the parent calls
 *     `upsertConnectedInstitution` + save + recompute, R8.6);
 *   - a disconnect flows out through `onDisconnect(institutionId)` (the parent calls
 *     `disconnectInstitution` + save + recompute, R9.3).
 * This panel neither imports the Account_Store nor the Plaid SDK; it only reads the
 * already-loaded accounts to derive which institutions are currently connected.
 *
 * Keys-absent behavior (R14.1, R14.2): the parent fetches `/api/plaid/status` and
 * passes the resulting `plaidKeysPresent` boolean down. When it is false this panel
 * DISABLES the connect entry point (rather than hiding it) and shows a plain-language
 * explanation that Plaid credentials are not configured — so the user understands why
 * the button is inert instead of the feature silently vanishing. Every non-Plaid
 * feature stays untouched (R14.3): this panel only governs the Plaid entry point.
 *
 * Multiple institutions (R9.1): the connect button stays available after a successful
 * connection, so the user can connect a second institution; each connected institution
 * then gets its own disconnect control (R9.2).
 *
 * Sandbox credentials (R14.3 connect-screen explanation, R15.5): the connect screen
 * summarizes, per institution, which Sandbox credentials to use — the `user_custom`
 * username plus the matching institution JSON as the password — drawn from
 * `data/plaid-sandbox-users/README.md`. These are test-only Sandbox instructions, not
 * real secrets.
 *
 * Accessibility / ui-style: calm, card-like layout with generous spacing. All controls
 * are real <button>s (keyboard reachable/operable with a visible focus ring). The
 * keys-absent explanation is TEXT (never color alone, R9.6) in a `role="note"` region.
 * Each disconnect button has an accessible name naming its institution so a screen
 * reader hears "Disconnect First Platypus Bank", not a bare "Disconnect".
 */

import { useMemo } from 'react';
import type { Account } from '@/types/accounts';
import PlaidConnectButton from '@/components/ui/PlaidConnectButton';
import type { PlaidConnectButtonProps } from '@/components/ui/PlaidConnectButton';

/** A currently-connected institution, derived from the Connected_Accounts in the set (R9.1). */
export interface ConnectedInstitution {
  /** Plaid institution id; the key the Account_Store disconnects on (R9.3). */
  institutionId: string;
  /** Display name shown on the disconnect control. */
  name: string;
  /** How many Connected_Accounts this institution contributes, shown as a quiet count. */
  accountCount: number;
}

/**
 * Per-institution Sandbox credential guidance surfaced on the connect screen
 * (R14.3, R15.5). Summarized from `data/plaid-sandbox-users/README.md`; these are
 * Sandbox test instructions, not real credentials.
 */
interface SandboxCredential {
  institution: string;
  /** Which config file's contents to paste as the password. */
  configFile: string;
}

const SANDBOX_CREDENTIALS: readonly SandboxCredential[] = [
  { institution: 'First Platypus Bank', configFile: 'institution-a.json' },
  { institution: 'First Gingham Credit Union', configFile: 'institution-b.json' },
];

/** Shared Sandbox username for the `user_custom` login path (R15.5). */
const SANDBOX_USERNAME = 'user_custom';

/**
 * Derive the list of currently-connected institutions from the account set (R9.1, R9.2).
 *
 * Groups every `source === 'Connected'` account by `plaidInstitutionId`, so each Plaid
 * institution appears once with its account count. The institution display name is taken
 * from the member accounts' `institution` field. Pure: accounts in, grouped list out, in
 * first-seen order so the disconnect controls keep a stable position across re-renders.
 * Connected accounts without a `plaidInstitutionId` cannot be targeted by
 * `disconnectInstitution`, so they are skipped here.
 */
export function deriveConnectedInstitutions(accounts: readonly Account[]): ConnectedInstitution[] {
  const byId = new Map<string, ConnectedInstitution>();
  for (const account of accounts) {
    if (account.source !== 'Connected' || !account.plaidInstitutionId) {
      continue;
    }
    const existing = byId.get(account.plaidInstitutionId);
    if (existing) {
      existing.accountCount += 1;
    } else {
      byId.set(account.plaidInstitutionId, {
        institutionId: account.plaidInstitutionId,
        name: account.institution,
        accountCount: 1,
      });
    }
  }
  return [...byId.values()];
}

export interface PlaidConnectPanelProps {
  /** The currently-loaded account set; used to derive the connected-institution list (R9.1). */
  accounts: readonly Account[];
  /**
   * Whether the server reported Plaid credentials are configured (the parent fetches
   * `/api/plaid/status`, R14.4). When false the connect entry point is disabled with a
   * plain-language explanation (R14.1, R14.2).
   */
  plaidKeysPresent: boolean;
  /** Passed through to PlaidConnectButton; the parent persists + recomputes (R8.6). */
  onInstitutionConnected: PlaidConnectButtonProps['onInstitutionConnected'];
  /**
   * Called when the user disconnects one institution (R9.2). The parent runs
   * `disconnectInstitution(institutionId)`, persists, and recomputes the views (R9.3).
   */
  onDisconnect: (institutionId: string) => void;
  /** Extra Tailwind classes merged onto the panel container. */
  className?: string;
}

/** Plain-language explanation shown when Plaid keys are absent (R14.2). */
const KEYS_ABSENT_MESSAGE =
  'Connecting a test bank is unavailable because Plaid credentials are not configured. ' +
  'Everything else — sample data, manual accounts, and all three views — still works.';

export default function PlaidConnectPanel({
  accounts,
  plaidKeysPresent,
  onInstitutionConnected,
  onDisconnect,
  className,
}: PlaidConnectPanelProps): React.ReactElement {
  const connectedInstitutions = useMemo(
    () => deriveConnectedInstitutions(accounts),
    [accounts],
  );

  return (
    <section
      aria-labelledby="plaid-connect-heading"
      className={`flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 ${className ?? ''}`}
    >
      <div className="flex flex-col gap-1">
        <h3 id="plaid-connect-heading" className="text-base font-semibold text-slate-900">
          Connect a test bank
        </h3>
        <p className="text-sm text-slate-600">
          Pull in balances and holdings from a Plaid Sandbox test bank. No real credentials
          and no real financial data are used.
        </p>
      </div>

      {plaidKeysPresent ? (
        <>
          {/* Connect entry point stays available so more than one institution can connect (R9.1). */}
          <PlaidConnectButton onInstitutionConnected={onInstitutionConnected} />

          {/* Sandbox credentials guidance, per institution (R14.3, R15.5). */}
          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">Sandbox sign-in details</p>
            <p className="text-sm text-slate-600">
              In Plaid Link, pick the matching bank and sign in with username{' '}
              <code className="rounded bg-slate-200 px-1 py-0.5 text-xs text-slate-800">
                {SANDBOX_USERNAME}
              </code>
              . For the password, paste the contents of that institution&apos;s config file
              from{' '}
              <code className="rounded bg-slate-200 px-1 py-0.5 text-xs text-slate-800">
                data/plaid-sandbox-users/
              </code>
              . (If you saved these as Studio users instead, use your Studio username and any
              non-empty password.)
            </p>
            <ul className="flex flex-col gap-1.5">
              {SANDBOX_CREDENTIALS.map((credential) => (
                <li key={credential.configFile} className="text-sm text-slate-700">
                  <span className="font-medium text-slate-900">{credential.institution}</span>
                  {' — password = contents of '}
                  <code className="rounded bg-slate-200 px-1 py-0.5 text-xs text-slate-800">
                    {credential.configFile}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        /*
          Keys absent: disable the entry point (rather than hide it) and explain why in
          plain language, so the feature's absence is understood rather than mysterious
          (R14.1, R14.2). The meaning is in the TEXT, never color alone (R9.6).
        */
        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled
            className="inline-flex items-center justify-center self-start rounded-md bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
          >
            Connect a test bank (Plaid Sandbox)
          </button>
          <p
            role="note"
            className="inline-flex items-start gap-1.5 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          >
            {/* Decorative glyph — the adjacent text carries the meaning (R9.6). */}
            <span aria-hidden="true">&#8505;</span>
            <span>{KEYS_ABSENT_MESSAGE}</span>
          </p>
        </div>
      )}

      {/* Per-institution disconnect controls, one per connected institution (R9.2). */}
      {connectedInstitutions.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
          <p className="text-sm font-medium text-slate-900">Connected banks</p>
          <ul className="flex flex-col gap-2">
            {connectedInstitutions.map((institution) => (
              <li
                key={institution.institutionId}
                className="flex items-center justify-between gap-4 rounded-md border border-slate-200 px-3 py-2"
              >
                <span className="text-sm text-slate-700">
                  <span className="font-medium text-slate-900">{institution.name}</span>
                  <span className="text-slate-500">
                    {' · '}
                    {institution.accountCount}{' '}
                    {institution.accountCount === 1 ? 'account' : 'accounts'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onDisconnect(institution.institutionId)}
                  aria-label={`Disconnect ${institution.name}`}
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 hover:bg-slate-100"
                >
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
