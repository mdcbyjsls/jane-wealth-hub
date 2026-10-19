/** The four asset-allocation buckets. */
export type AssetClass = 'stocks' | 'bonds' | 'cash' | 'other';

/** Account categories. `liability` is modeled as an account so the data shape stays uniform. */
export type AccountType =
  | 'brokerage'
  | 'IRA'
  | 'Roth IRA'
  | '401(k)'
  | 'HYSA'
  | 'checking'
  | 'liability';

/** Percentages for each class; for non-liability accounts these sum to 100 (within tolerance). */
export interface AssetClassBreakdown {
  stocks: number;
  bonds: number;
  cash: number;
  other: number;
}

export interface Account {
  institution: string;          // 1–120 chars, non-empty (R7.1)
  accountType: AccountType;
  /** Positive number. For liabilities this is the amount owed, stored positive and subtracted. */
  balance: number;              // finite (R7.3)
  assetClassBreakdown: AssetClassBreakdown;
  /**
   * Non-negative integer count of days before "now" that this account was last updated.
   * Stored relative (not as a fixed date) so the sample data never decays into looking stale
   * as real time passes. The absolute `lastUpdated` Date is derived at the boundary (server
   * component / loader) as `now − lastUpdatedDaysAgo days` and handed to the pure freshness
   * calculator; the JSON never stores an absolute date.
   */
  lastUpdatedDaysAgo: number;   // integer >= 0
}

// ---------------------------------------------------------------------------
// Calculation result models (R1.1, R2.2, R3.2, R4.1)
// ---------------------------------------------------------------------------

export interface NetWorthResult {
  totalAssets: number;       // sum of non-liability balances
  totalLiabilities: number;  // sum of liability balances (positive)
  netWorth: number;          // totalAssets - totalLiabilities (may be negative, R1.4)
}

export interface InstitutionGroup {
  institution: string;
  subtotal: number;          // arithmetic sum of member balances (R2.5)
  accounts: Account[];       // members, preserving input order
}

/** Dollar value held in each class (liabilities excluded, R3.6). */
export type ClassTotals = Record<AssetClass, number>;

/** Actual allocation percentages, one decimal, summing to exactly 100 (R3.4) or all 0 (R3.3). */
export interface AllocationResult {
  percentages: Record<AssetClass, number>;
  classDollars: ClassTotals;  // the dollar basis behind each percentage
  totalAssetValue: number;    // sum across classes; 0 triggers the zero-total path
  isZeroTotal: boolean;       // true when totalAssetValue === 0 (R3.3)
}

// ---------------------------------------------------------------------------
// Drift and on-track status models (R4.1, R4.3, R4.7, R4.9)
// ---------------------------------------------------------------------------

export type DriftDirection = 'on track' | 'over' | 'under';

export interface DriftClassification {
  direction: DriftDirection;  // against ±5 On_Track_Threshold (R4.3–R4.5)
}

export interface ClassDrift {
  assetClass: AssetClass;
  driftPoints: number;        // actual% - target% (R4.1)
  driftDollars: number;       // actual$ - target-implied$ (R4.1)
  direction: DriftDirection;
}

export interface DriftResult {
  byClass: Record<AssetClass, ClassDrift>;
  offTargetCount: number;             // count of over/under (R4.8)
  largest: ClassDrift | null;         // largest absolute point drift when off target (R4.9)
}

export interface OnTrackStatus {
  onTrack: boolean;
  /** "On track" (R4.7) or "N of 4 asset classes off target" (R4.8). */
  label: string;
  /** Plain-language largest-drift sentence (R4.9), null when fully on track. */
  largestDriftSentence: string | null;
}

// ---------------------------------------------------------------------------
// Target model (R5.1)
// ---------------------------------------------------------------------------

export interface TargetAllocation {
  stocks: number;   // integer 0–100
  bonds: number;
  cash: number;
  other: number;
  /** True only for the unconfigured default (R5.7). Cleared once the user saves a valid target. */
  isExample: boolean;
}

/** Raw user entry before validation — strings so non-integer/blank input can be caught. */
export interface TargetInput {
  stocks: string;
  bonds: string;
  cash: string;
  other: string;
}

/**
 * Result of validating a `TargetInput` (R5.2, R5.3). Discriminated union consistent with
 * `ValidationResult` / `TargetValidationResult` elsewhere in this module. On success it carries a
 * normalized `TargetAllocation`; on failure it names the single offending field — one of the four
 * asset classes or `'sum'` when the four values are each in range but do not total 100 — plus a
 * developer-facing message. Consumed by `validateTarget` in the Target_Store (Task 12.1) and the
 * `TargetEditor` for inline, field-level feedback.
 */
export type TargetValidationResult =
  | { ok: true; target: TargetAllocation }
  | { ok: false; field: keyof AssetClassBreakdown | 'sum'; message: string };

// ---------------------------------------------------------------------------
// Freshness model (R8.1, R8.3) — carries the DERIVED absolute lastUpdated Date
// ---------------------------------------------------------------------------

export interface AccountFreshness {
  /** Absolute date derived at the boundary from `now − lastUpdatedDaysAgo days`. */
  lastUpdated: Date;
  isStale: boolean;   // more than Freshness_Threshold (3 days) before `now` (R8.3)
}

export interface InstitutionFreshness {
  institution: string;
  asOf: Date;         // most recent derived lastUpdated among the group's accounts (R8.1, R8.2)
  isStale: boolean;   // true if any member account is stale (R8.3)
}

export interface FreshnessResult {
  byInstitution: InstitutionFreshness[];
}

// ---------------------------------------------------------------------------
// Validation error model (R7.5, R6.6)
// ---------------------------------------------------------------------------

export type ValidationErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_TYPE'
  | 'NON_FINITE_BALANCE'
  | 'INSTITUTION_LENGTH'
  | 'UNKNOWN_ACCOUNT_TYPE'
  | 'BREAKDOWN_SUM';

export interface ValidationError {
  code: ValidationErrorCode;
  accountIndex: number;       // which account (R7.2, R7.3, R7.5)
  field?: string;             // offending field where applicable (R7.5)
  message: string;            // developer-facing detail; never shown verbatim to the user (R6.6)
}

export type ValidationResult =
  | { ok: true; accounts: Account[] }
  | { ok: false; errors: ValidationError[] };
