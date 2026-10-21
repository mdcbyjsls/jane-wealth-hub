/*
 * AccountRow — one account's row in the editor / account list, carrying its
 * Source, freshness basis, and the two user-provenance labels (R4.3, R4.4,
 * R5.2, R10.7, R13.3).
 *
 * Pure presentational component: props in, markup out. No data fetching, no
 * state, no clock read. Everything time-dependent arrives precomputed:
 *   - the account itself, and
 *   - its Source-aware freshness status (AccountFreshnessStatus), which the
 *     caller derives with `computeAccountFreshness(account, now)` at the
 *     boundary. Accepting the status rather than a `now` keeps this component
 *     free of any dependency on the freshness calculator and trivially pure.
 *
 * What it renders:
 *   - institution (emphasized), accountName, accountType, and balance
 *     (formatCurrency, tabular-nums so money lines up and never jitters);
 *   - the account's SourceBadge (Sample / Manual / Connected);
 *   - freshness: for a Manual_Account the "Updated by you on [date]" basis
 *     (R5.2) — or plain "Updated by you" when the date is null; for Sample /
 *     Connected the existing staleness cue via FreshnessBadge (R5.4), which is
 *     never color-alone (R9.6);
 *   - an "adjusted by you" label IFF `splitOverride` is present (R4.3, R4.4) —
 *     text, not color;
 *   - an "Allocation needs your input" flag IFF `allocationNeedsInput` is true
 *     (R10.7, R13.3) — a clear text cue, not color.
 *
 * Accessibility: every provenance/status signal is carried by text; color is
 * only ever a secondary reinforcement (R9.6). Money uses `tabular-nums`.
 *
 * NOTE: `SourceBadge` is authored in the parallel Task 17.1. This file imports
 * its expected default export (`SourceBadge` taking a `source: AccountSource`
 * prop). If 17.1 has not landed at typecheck time, the import will fail — that
 * is the only expected failure and resolves once 17.1 is present.
 */

import type { Account, AccountFreshnessStatus } from '@/types/accounts';
import { formatCurrency } from '@/lib/format';
import FreshnessBadge from '@/components/ui/FreshnessBadge';
import SourceBadge from '@/components/ui/SourceBadge';

export interface AccountRowProps {
  /** The account to render; its Source, splitOverride, and allocationNeedsInput drive the labels. */
  account: Account;
  /**
   * Source-aware freshness for this account, precomputed by the caller via
   * `computeAccountFreshness(account, now)`. Passing the status (not a `now`)
   * keeps the component pure and decoupled from the freshness calculator.
   */
  freshness: AccountFreshnessStatus;
}

/**
 * Readable "Mon D, YYYY" formatter, e.g. "Oct 14, 2026", matching FreshnessBadge.
 * Built once and reused.
 */
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

/**
 * Renders the freshness affordance for the row based on the precomputed basis:
 *   - `updatedByYou` (Manual): "Updated by you on [date]" (R5.2), or plain
 *     "Updated by you" when the parsed date is null so a missing/bad ISO date
 *     degrades gracefully without inventing a date or flipping to stale.
 *   - `staleness` (Sample / Connected): the shared FreshnessBadge, which shows
 *     "as of [date]" and a non-color "may be out of date" cue when stale (R5.4,
 *     R9.6).
 */
function FreshnessLine({
  freshness,
}: {
  freshness: AccountFreshnessStatus;
}): React.ReactElement {
  if (freshness.basis.kind === 'updatedByYou') {
    const { date } = freshness.basis;
    const label =
      date !== null
        ? `Updated by you on ${dateFormatter.format(date)}`
        : 'Updated by you';
    return <span className="text-sm text-gray-600">{label}</span>;
  }

  return (
    <FreshnessBadge
      asOf={freshness.lastUpdated}
      isStale={freshness.isStale}
    />
  );
}

export function AccountRow({
  account,
  freshness,
}: AccountRowProps): React.ReactElement {
  // R4.3 / R4.4: the "adjusted by you" label is shown IFF a Split_Override is present.
  const isAdjustedByYou = account.splitOverride !== undefined;
  // R10.7 / R13.3: holdingless connected investment accounts flag for user input.
  const needsAllocationInput = account.allocationNeedsInput === true;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-gray-900">
            {account.institution}
          </span>
          <span className="text-sm text-gray-700">{account.accountName}</span>
          {/*
            R9.5: account type is meaningful text, so it must clear 4.5:1
            against the white card. text-gray-600 (#4b5563) does. Final
            contrast still requires a manual audit per Task 18/19.
          */}
          <span className="text-sm text-gray-600">{account.accountType}</span>
        </div>
        <span className="text-lg font-semibold text-gray-900 tabular-nums">
          {formatCurrency(account.balance)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={account.source} />
        <FreshnessLine freshness={freshness} />
      </div>

      {(isAdjustedByYou || needsAllocationInput) && (
        <div className="flex flex-wrap items-center gap-2">
          {/*
            R4.3 / R4.4: provenance label carried by TEXT, never color alone
            (R9.6). The subtle styling is only secondary reinforcement.
          */}
          {isAdjustedByYou ? (
            <span className="inline-flex items-center rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700">
              adjusted by you
            </span>
          ) : null}
          {/*
            R10.7 / R13.3: a clear text cue that this connected investment
            account has no holdings-derived split and needs the user to set one.
            Not color-alone (R9.6); the "ⓘ" mark is decorative and hidden from
            assistive tech because the adjacent text carries the meaning.
          */}
          {needsAllocationInput ? (
            <span className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
              <span aria-hidden="true">ⓘ</span>
              <span>Allocation needs your input</span>
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default AccountRow;
