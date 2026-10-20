import { describe, it, expect } from 'vitest';

import { computeWaterfall } from '@/lib/calculations/waterfall';
import { computeInstitutionGroups, computeNetWorth } from '@/lib/calculations/allocation';
import type { Account, AccountType, AssetClassBreakdown } from '@/types/accounts';

/**
 * Example-based unit tests for the pure `computeWaterfall` helper (Spec 4, Task 2.8).
 *
 * The waterfall is built from `computeInstitutionGroups` + `computeNetWorth` (the independent
 * oracles). The invariants checked: asset steps sum to total assets, liability steps sum to
 * −total liabilities, and the final running total equals net worth.
 */

const ALL_CASH: AssetClassBreakdown = { stocks: 0, bonds: 0, cash: 100, other: 0 };
const ALL_STOCKS: AssetClassBreakdown = { stocks: 100, bonds: 0, cash: 0, other: 0 };

function account(
  institution: string,
  accountType: AccountType,
  balance: number,
  breakdown: AssetClassBreakdown = ALL_CASH,
): Account {
  return {
    institution,
    accountType,
    balance,
    assetClassBreakdown: breakdown,
    lastUpdatedDaysAgo: 0,
  };
}

function build(accounts: Account[]) {
  const groups = computeInstitutionGroups(accounts);
  const netWorth = computeNetWorth(accounts);
  return { steps: computeWaterfall(groups, netWorth), groups, netWorth };
}

describe('computeWaterfall — steps from institutions to net worth', () => {
  it('final running total equals net worth; asset and liability steps reconcile', () => {
    const accounts: Account[] = [
      account('Fidelity', 'brokerage', 400_000, ALL_STOCKS),
      account('Vanguard', 'IRA', 250_000, ALL_STOCKS),
      account('Chase', 'checking', 50_000, ALL_CASH),
      account('Chase', 'liability', 300_000), // a mortgage held at Chase
    ];
    const { steps, netWorth } = build(accounts);

    const assetSteps = steps.filter((s) => s.kind === 'institution');
    const liabilitySteps = steps.filter((s) => s.kind === 'liability');
    const totalStep = steps[steps.length - 1];

    // Asset steps sum to total assets (700k).
    expect(assetSteps.reduce((s, x) => s + x.delta, 0)).toBeCloseTo(netWorth.totalAssets, 6);
    expect(netWorth.totalAssets).toBe(700_000);

    // Liability steps sum to −total liabilities (−300k).
    expect(liabilitySteps.reduce((s, x) => s + x.delta, 0)).toBeCloseTo(-netWorth.totalLiabilities, 6);
    expect(netWorth.totalLiabilities).toBe(300_000);

    // The final step is the grounded net-worth total, equal to net worth (400k).
    expect(totalStep.kind).toBe('total');
    expect(totalStep.isTotal).toBe(true);
    expect(totalStep.runningTotal).toBeCloseTo(netWorth.netWorth, 6);
    expect(netWorth.netWorth).toBe(400_000);
  });

  it('running totals rise through asset steps then fall through liabilities', () => {
    const accounts: Account[] = [
      account('Fidelity', 'brokerage', 400_000, ALL_STOCKS),
      account('Vanguard', 'IRA', 250_000, ALL_STOCKS),
      account('Chase', 'liability', 300_000),
    ];
    const { steps } = build(accounts);

    const assetSteps = steps.filter((s) => s.kind === 'institution');
    let prev = 0;
    for (const s of assetSteps) {
      expect(s.runningTotal).toBeGreaterThan(prev);
      prev = s.runningTotal;
    }
    const peak = prev;
    const liabilitySteps = steps.filter((s) => s.kind === 'liability');
    for (const s of liabilitySteps) {
      expect(s.runningTotal).toBeLessThan(peak);
    }
  });

  it('itemizes each liability as its own step', () => {
    const accounts: Account[] = [
      account('Fidelity', 'brokerage', 500_000, ALL_STOCKS),
      account('Chase', 'liability', 300_000),
      account('Sallie Mae', 'liability', 40_000),
    ];
    const { steps } = build(accounts);
    const liabilitySteps = steps.filter((s) => s.kind === 'liability');
    expect(liabilitySteps).toHaveLength(2);
    // Distinct labels so two liabilities stay distinguishable.
    const labels = new Set(liabilitySteps.map((s) => s.label));
    expect(labels.size).toBe(2);
  });

  it('an all-asset portfolio has one total step and no liability steps', () => {
    const accounts: Account[] = [
      account('Fidelity', 'brokerage', 300_000, ALL_STOCKS),
      account('Ally', 'HYSA', 100_000, ALL_CASH),
    ];
    const { steps, netWorth } = build(accounts);

    expect(steps.filter((s) => s.kind === 'liability')).toHaveLength(0);
    expect(steps.filter((s) => s.kind === 'total')).toHaveLength(1);
    expect(steps[steps.length - 1].runningTotal).toBeCloseTo(netWorth.netWorth, 6);
    expect(netWorth.netWorth).toBe(400_000);
  });
});
