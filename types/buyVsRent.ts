import type { AssetClass, ClassTotals } from '@/types/accounts';
import type {
  MarketDataSnapshot,
  ReturnAssumptions,
  ScenarioMultipliers,
} from '@/types/market';

/**
 * Shared, serializable types for the Buy-vs-Rent Scenario Tester (Spec 3).
 *
 * Every type here is a primitive or a plain object (no `Date` instances, no class
 * instances, no functions) so these values cross the server→client boundary safely
 * and are usable as island props and as test fixtures. They sit alongside the shared
 * market types; `AssetClass`/`ClassTotals` come from `@/types/accounts` and
 * `MarketDataSnapshot`/`ReturnAssumptions`/`ScenarioMultipliers`/`DollarBasis` from the
 * Spec 2 market types, reused rather than re-declared.
 *
 * _Requirements: 9.1, 3.1, 3.2, 3.4, 3.6, 4.1, 5.1, 7.1, 8.1_
 */

/** The fixed comparison horizon in whole years (R-glossary Comparison_Horizon). */
export const COMPARISON_HORIZON = 10;

/** Every editable assumption behind the comparison (R9.1). All values are numbers. */
export interface BuyVsRentAssumptions {
  homePrice: number; // dollars (R9.6: ≥ 0)
  downPaymentPercent: number; // 0–100 (R9.6)
  mortgageRatePercent: number; // 0–20, default MORTGAGE30US (R9.6, R11.4)
  mortgageTermYears: number; // default 30
  propertyTaxRatePercent: number;
  homeownersInsurance: number; // annual dollars
  maintenanceRatePercent: number; // default 1
  hoaMonthly: number; // default 0
  closingCosts: number; // dollars
  sellingCostPercent: number;
  homeAppreciationRatePercent: number; // −20..+20, default from CSUSHPINSA (R9.6, R11.4)
  currentRentMonthly: number; // dollars
  rentGrowthRatePercent: number; // −20..+20, default from CUSR0000SEHA (R9.6, R11.4)
  rentersInsurance: number; // annual dollars
  cushionMonths: number; // default 6 (R3.5)
  multipliers: ScenarioMultipliers; // optimistic 1.5 / pessimistic 0.5 default
}

/** One month of the amortization schedule (R1.4, R1.5). */
export interface AmortizationMonth {
  monthIndex: number; // 1-based
  interest: number;
  principal: number;
  balance: number; // end-of-month Loan_Balance; non-increasing, ≥ 0, exactly 0 at term end
}

/** Result of the down-payment drawdown (R3.1–R3.4, R3.6). */
export interface DrawdownResult {
  postPurchaseDollars: ClassTotals; // reduced per-class balances
  postPurchaseAllocation: Record<AssetClass, number>; // percentages (R3.2)
  cashCushion: number; // remaining cash (R3.4)
  overBudget: boolean; // funded sum exceeded Starting_Assets total (R3.6)
}

/** One band's 11-value series for both paths (years 0..10). */
export interface PathResult {
  buy: number[]; // length 11
  rent: number[]; // length 11
}

/** The three bands for one path. */
export interface PathBands {
  base: number[];
  optimistic: number[];
  pessimistic: number[];
}

/** Both paths' bands (R5.1). */
export interface ComparisonBands {
  buy: PathBands;
  rent: PathBands;
}

/** Verdict figures (R7.1). */
export interface VerdictFigures {
  leader: 'buy' | 'rent' | 'tie';
  year10Difference: number; // absolute dollar size of the base-band year-10 gap
}

/** One ranked sensitivity entry (R8). `key` identifies the editable assumption; `label` is its name. */
export interface SensitivityEntry {
  key: keyof BuyVsRentAssumptions;
  label: string;
  year10DifferenceDelta: number; // |Δ year-10 base-band difference| under the fixed relative step
}

/** Everything the orchestrator needs (resolved at the boundary / in the island). */
export interface ComparisonInput {
  startingAssets: ClassTotals; // Spec 1 ClassTotals (Starting_Assets)
  currentAllocationFractions: Record<AssetClass, number>; // AllocationResult.percentages / 100
  market: MarketDataSnapshot;
  returnAssumptions: ReturnAssumptions; // Spec 2 equityRiskPremium / otherReturn
  assumptions: BuyVsRentAssumptions;
}

/** The full nominal comparison the view renders (R4.1). Caller applies toTodaysDollars for display. */
export interface ComparisonResult {
  bands: ComparisonBands; // 11 values per band per path
  drawdown: DrawdownResult; // allocation shift + cushion (R3)
  cushionThreshold: number; // cushionMonths × first-year Ownership_Cost_Monthly (R3.5)
  breakevenYear: number | null; // R6
  verdict: VerdictFigures; // R7.1
  tippingPointPercent: number | null; // R7.2–R7.4
  sensitivity: SensitivityEntry[]; // ranked, R8
  investmentReturnPercent: number; // the base Investment_Return used (R2.7)
}
