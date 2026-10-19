/*
 * TEMPORARY INTEGRATION CHECKPOINT — Task 6 (consolidated-net-worth-view).
 *
 * This is a throwaway, intentionally unstyled page whose only job is to surface
 * data-shape, import, and aggregation integration issues early: it imports the real
 * data/accounts.json, runs validateAccounts on it, and renders the raw net-worth and
 * institution-group numbers against real sample data before any proper UI exists.
 *
 * It will be REPLACED by Task 17.3, which wires app/page.tsx as the real dashboard
 * entry point (NetWorthHeader / InstitutionList components, the five-state machine,
 * freshness, and the DashboardClient island). Do NOT build styling, states, skeletons,
 * or real components here — those come in later tasks (15.x, 17.3).
 *
 * Supports R1 and R2 only.
 */

import accountsData from '@/data/accounts.json';
import {
  computeInstitutionGroups,
  computeNetWorth,
  validateAccounts,
} from '@/lib/calculations/allocation';

export default function Home() {
  // The imported JSON is trusted only as `unknown`; validateAccounts is the single
  // guard that must pass before any number is computed (R7.1).
  const result = validateAccounts(accountsData as unknown);

  if (!result.ok) {
    return (
      <main>
        <h1>Jane Wealth Hub — integration checkpoint (Task 6)</h1>
        <p>Account data is invalid. The following problems were found:</p>
        <ul>
          {result.errors.map((error, index) => (
            <li key={index}>
              [account {error.accountIndex}]
              {error.field ? ` (${error.field})` : ''} {error.code}: {error.message}
            </li>
          ))}
        </ul>
      </main>
    );
  }

  const netWorth = computeNetWorth(result.accounts);
  const groups = computeInstitutionGroups(result.accounts);

  return (
    <main>
      <h1>Jane Wealth Hub — integration checkpoint (Task 6)</h1>

      <section>
        <h2>Net worth</h2>
        <p>Total assets: {netWorth.totalAssets}</p>
        <p>Total liabilities: {netWorth.totalLiabilities}</p>
        <p>Net worth: {netWorth.netWorth}</p>
      </section>

      <section>
        <h2>Institutions</h2>
        <ul>
          {groups.map((group) => (
            <li key={group.institution}>
              <strong>{group.institution}</strong> — subtotal: {group.subtotal}
              <ul>
                {group.accounts.map((account, index) => (
                  <li key={index}>
                    {account.institution} / {account.accountType} / {account.balance}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
