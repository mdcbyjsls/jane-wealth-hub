/**
 * Net_Worth_Waterfall steps — the data behind the dashboard waterfall chart (Spec 4
 * Visualization_Pass, R2.6, R7.3).
 *
 * The waterfall tells the "how do my accounts add up to net worth?" story as an ordered sequence of
 * steps: each institution's ASSET subtotal stacks upward toward total assets, then EACH liability is
 * an itemized downward step, and the final bar is net worth drawn from zero. This module derives
 * those steps from the already-computed `InstitutionGroup[]` and `NetWorthResult`; it introduces no
 * new account math and changes no existing calculation result.
 *
 * Because an institution may hold both asset and liability accounts, each group is split into two
 * parts: a single `institution` step carrying the group's non-liability (asset) subtotal, and one
 * `liability` step per liability account in the group. Asset steps are positive deltas (they stack
 * up); liability steps are negative deltas (they step down). The running total after the final
 * liability equals total assets − total liabilities, and the grounded total bar restates that as
 * net worth, so the final `runningTotal` equals `netWorth.netWorth` exactly.
 *
 * Pure and deterministic: data in, ordered steps out. Imports only types; no `app/`, `components/`,
 * or `lib/fred/` imports; no fetch, no `localStorage`, no clock.
 */

import type {
  Account,
  InstitutionGroup,
  NetWorthResult,
  WaterfallStep,
} from '@/types/accounts';

/** The fixed label on the grounded final bar (R7.3). */
const NET_WORTH_LABEL = 'Net worth';

/**
 * Builds a human-readable label for a single liability step. An `Account` has no dedicated name
 * field, so the label combines the owning institution with the account type (always `'liability'`
 * for these accounts) to give the step a stable, descriptive caption, e.g. "Sallie Mae liability".
 */
function liabilityLabel(account: Account): string {
  return `${account.institution} ${account.accountType}`;
}

/**
 * Produces the ordered waterfall steps from institution asset subtotals through itemized
 * liabilities down to the net-worth total bar (R2.6, R7.3).
 *
 * For each `InstitutionGroup`, in the order the groups are given (the caller sorts them for
 * display):
 *   - The group's ASSET subtotal is the sum of its non-liability account balances. When that
 *     subtotal is non-zero, it becomes one `institution` step with a positive `delta` equal to the
 *     subtotal; the running total climbs by that amount. A group that holds only liabilities
 *     contributes no asset step (its asset subtotal is 0), so the stack is not cluttered with empty
 *     bars.
 *   - Each liability account in the group becomes its own `liability` step with a negative `delta`
 *     equal to minus its balance (balances are stored positive and subtracted); the running total
 *     steps down by that balance. Liabilities are itemized one per account so the user sees each
 *     debt, not a lumped total.
 *
 * All asset steps precede all liability steps: the loop emits every group's asset step while also
 * collecting that group's liability accounts, then emits the liability steps afterward. This gives
 * the classic shape — assets stacking up to total assets, then liabilities stepping down — and makes
 * the running total monotonically non-decreasing through the asset steps and non-increasing through
 * the liability steps.
 *
 * The final step is the grounded net-worth bar: `kind: 'total'`, `isTotal: true`, `delta: 0` (it is
 * a marker, not a contribution), and `runningTotal` set to `netWorth.netWorth`. The accumulated
 * running total after the last liability already equals total assets − total liabilities, which is
 * net worth by definition (R1.1); the total bar restates that same value grounded from zero.
 *
 * Pure and deterministic: inputs in, ordered steps out — no fetch, no `localStorage`, no clock.
 */
export function computeWaterfall(
  groups: InstitutionGroup[],
  netWorth: NetWorthResult,
): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  const liabilityAccounts: Account[] = [];
  let runningTotal = 0;

  // Pass 1: emit each institution's asset subtotal as an upward step, collecting liabilities for the
  // second pass so every asset step precedes every liability step.
  for (const group of groups) {
    let assetSubtotal = 0;
    for (const account of group.accounts) {
      if (account.accountType === 'liability') {
        liabilityAccounts.push(account);
      } else {
        assetSubtotal += account.balance;
      }
    }

    // Skip groups that hold no assets (liability-only institutions) so the stack has no empty bars.
    if (assetSubtotal !== 0) {
      runningTotal += assetSubtotal;
      steps.push({
        label: group.institution,
        kind: 'institution',
        delta: assetSubtotal,
        runningTotal,
        isTotal: false,
      });
    }
  }

  // Pass 2: emit each liability as its own downward step (balances are positive, so the delta is
  // negative and the running total decreases).
  for (const account of liabilityAccounts) {
    runningTotal -= account.balance;
    steps.push({
      label: liabilityLabel(account),
      kind: 'liability',
      delta: -account.balance,
      runningTotal,
      isTotal: false,
    });
  }

  // Final grounded net-worth bar. The accumulated running total equals total assets − total
  // liabilities (= net worth); restate it from the authoritative `netWorth.netWorth` so the final
  // step is the single source of truth the chart grounds from zero.
  steps.push({
    label: NET_WORTH_LABEL,
    kind: 'total',
    delta: 0,
    runningTotal: netWorth.netWorth,
    isTotal: true,
  });

  return steps;
}
