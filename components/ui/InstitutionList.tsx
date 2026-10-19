/*
 * InstitutionList — grouped accounts with subtotals and per-institution
 * freshness (R2.1, R2.3, R2.4, R8.1, R8.2).
 *
 * Pure presentational component: props in, markup out. No data fetching, no
 * state. It renders the institution groups EXACTLY in the order the calculator
 * produced them — `computeInstitutionGroups` already orders by descending
 * subtotal with a case-insensitive alphabetical tie-break (R2.3), so this
 * component must NOT re-sort.
 *
 * For each institution group it shows:
 *  - the institution name and its subtotal, formatted as whole-dollar USD via
 *    `formatCurrency` (R2.4);
 *  - each member account's institution name, account type, and balance (R2.1),
 *    preserving the input order the calculator kept;
 *  - a `FreshnessBadge` for that institution (R8.1, R8.2).
 *
 * Freshness is paired to a group by matching institution name against the
 * `FreshnessResult.byInstitution` entries. If no freshness entry is found for a
 * group (defensive — should not happen for well-formed data), the group renders
 * without a badge rather than crashing.
 */

import type {
  FreshnessResult,
  InstitutionFreshness,
  InstitutionGroup,
} from '@/types/accounts';
import { formatCurrency } from '@/lib/format';
import FreshnessBadge from '@/components/ui/FreshnessBadge';

export interface InstitutionListProps {
  /**
   * Institution groups already ordered by the calculator
   * (`computeInstitutionGroups`). Rendered in the given order — do not re-sort.
   */
  groups: InstitutionGroup[];
  /** Per-institution freshness, matched to each group by institution name. */
  freshness: FreshnessResult;
}

export function InstitutionList({
  groups,
  freshness,
}: InstitutionListProps): React.ReactElement {
  /**
   * Index freshness by institution name for O(1) lookup while preserving the
   * calculator's group order. Keyed by the exact institution string so a group
   * with no matching entry resolves to `undefined` and renders without a badge.
   */
  const freshnessByInstitution = new Map<string, InstitutionFreshness>(
    freshness.byInstitution.map((entry) => [entry.institution, entry]),
  );

  return (
    <section aria-label="Accounts by institution">
      <ul className="flex flex-col gap-6">
        {groups.map((group) => {
          const institutionFreshness = freshnessByInstitution.get(
            group.institution,
          );

          return (
            <li
              key={group.institution}
              className="rounded-lg border border-gray-200 p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold text-gray-900">
                  {group.institution}
                </h3>
                <span className="text-lg font-semibold text-gray-900 tabular-nums">
                  {formatCurrency(group.subtotal)}
                </span>
              </div>

              {institutionFreshness ? (
                <div className="mt-1">
                  <FreshnessBadge
                    asOf={institutionFreshness.asOf}
                    isStale={institutionFreshness.isStale}
                  />
                </div>
              ) : null}

              <ul className="mt-3 flex flex-col gap-2">
                {group.accounts.map((account, index) => (
                  <li
                    key={`${account.institution}-${account.accountType}-${index}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                  >
                    <span className="text-gray-700">
                      <span className="font-medium text-gray-900">
                        {account.institution}
                      </span>{' '}
                      {/*
                        R9.5: account type is meaningful text, so it must clear
                        4.5:1 against the white card. text-gray-600 (#4b5563)
                        does; text-gray-500 (#6b7280) is borderline (~4:1).
                        Final contrast still requires a manual audit per Task 18/19.
                      */}
                      <span className="text-gray-600">
                        {account.accountType}
                      </span>
                    </span>
                    <span className="text-gray-900 tabular-nums">
                      {formatCurrency(account.balance)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default InstitutionList;
