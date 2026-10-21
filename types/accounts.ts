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
  | 'liability'
  | 'mortgage'; // distinct liability type that triggers the Decision-view rent note (R10.3, R11)

/** The origin of an account; every account has exactly one Source (R1.1). */
export type AccountSource = 'Sample' | 'Manual' | 'Connected';

/**
 * The single source of truth for the liability check, replacing the Spec 1
 * `accountType === 'liability'` comparisons in the calculators (R12). An account whose
 * type is in this list is a Liability_Account: its balance is the amount owed, stored
 * positive and subtracted from net worth, and it is excluded from asset-class totals.
 */
export const LIABILITY_TYPES: readonly AccountType[] = ['liability', 'mortgage'];

/** Percentages for each class; for non-liability accounts these sum to 100 (within tolerance). */
export interface AssetClassBreakdown {
  stocks: number;
  bonds: number;
  cash: number;
  other: number;
}

export interface Account {
  /** Stable, unique within the store; persists across edits (R1.2). */
  id: string;
  /** Exactly one of Sample/Manual/Connected (R1.1). */
  source: AccountSource;
  institution: string;          // 1–120 chars, non-empty (R7.1)
  /** Shown in the editor and used in Account_Match_Key; 1–120 chars, non-empty (R4.5). */
  accountName: string;
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

  // Source-specific fields, all optional so the one Account shape serves every Source.
  /** ISO date; Manual only — shown in place of a staleness flag (R5.2, R5.3). */
  updatedByYouDate?: string;
  /** Connected only; part of Account_Match_Key (R4.5). */
  mask?: string | null;
  /** Connected only; groups a Plaid_Item's accounts (R9). */
  plaidInstitutionId?: string;
  /** Connected only; a user-supplied split shown as "adjusted by you" (R4.2, R4.3). */
  splitOverride?: AssetClassBreakdown;
  /** Connected investment with no holdings; flags "Allocation needs your input" (R10.7, R13.3). */
  allocationNeedsInput?: boolean;
}

/**
 * The tuple used on reconnect to decide whether a freshly fetched Connected_Account is the same
 * account as one connected before, so a Split_Override can be carried across a reconnect (R4.5).
 * Equality is case-insensitive on `institution` + `accountName`, exact on `mask`. A prior override
 * whose key matches no fresh account is dropped and reported (R4.6).
 */
export interface AccountMatchKey {
  institution: string;
  accountName: string;
  mask: string | null;
}

// ---------------------------------------------------------------------------
// Account_Store: stored shape, load result, and Source_Mix_Summary (R1.4, R7)
// ---------------------------------------------------------------------------

/** localStorage key for the persisted account set; mirrors Target_Store's `'jwh.targetAllocation'`. */
export const ACCOUNTS_STORAGE_KEY = 'jwh.accounts';

/**
 * The outcome of `loadAccounts`: the usable set plus which of the four recovery branches produced
 * it (R7.2, R7.4, R7.5). The store parses defensively, validates each element, and never throws.
 *   - `ok`       — valid stored set loaded as-is (R7.3)
 *   - `seeded`   — nothing stored, Sample_Set seeded (R7.2)
 *   - `partial`  — some invalid entries dropped, valid kept; `dropped` counts the losses (R7.4)
 *   - `fallback` — unreadable or all-invalid, Sample_Set restored (R7.5)
 */
export interface AccountLoadResult {
  accounts: Account[];
  recovery:
    | { kind: 'ok' }
    | { kind: 'seeded' }
    | { kind: 'partial'; dropped: number }
    | { kind: 'fallback' };
}

/**
 * One row of the Source_Mix_Summary (R1.4): a Source present in the account set, how many accounts
 * carry it, and that Source's share of total assets (liabilities excluded from the share basis,
 * consistent with allocation). Derived by a pure helper (`lib/calculations/sourceMix.ts`).
 */
export interface SourceMixEntry {
  source: AccountSource;
  count: number;
  assetSharePct: number;
}

/** One entry per Source present in the account set (R1.4). */
export type SourceMixSummary = SourceMixEntry[];

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

/**
 * Source-aware freshness for a single account (R5.1, R5.4). The Spec 1 Stale_Rule (3-day
 * Freshness_Threshold) still governs Sample_Accounts and, where freshness information is present,
 * Connected_Accounts. Manual_Accounts are EXEMPT: they are never stale no matter how long ago they
 * were edited, and instead expose an "Updated by you on [date]" basis drawn from `updatedByYouDate`.
 *
 * `basis` is a discriminated union so a caller renders the correct affordance without re-deriving
 * the rule:
 *   - `{ kind: 'staleness' }` — apply the Stale_Rule; read `isStale` (Sample / Connected).
 *   - `{ kind: 'updatedByYou'; date }` — show "Updated by you on [date]" in place of a staleness
 *     flag; `isStale` is always false (Manual). `date` is the parsed `updatedByYouDate` when it is
 *     a valid ISO date, else `null` so the caller can fall back gracefully without the basis ever
 *     flipping a Manual account to stale.
 */
export interface AccountFreshnessStatus {
  /** Never true for a Manual_Account; otherwise true iff the Stale_Rule fires (R5.1, R5.4). */
  isStale: boolean;
  /** Absolute date derived at the boundary from `now − lastUpdatedDaysAgo days`. */
  lastUpdated: Date;
  /** Which display basis applies — a staleness flag, or the Manual "Updated by you" date. */
  basis:
    | { kind: 'staleness' }
    | { kind: 'updatedByYou'; date: Date | null };
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

// ---------------------------------------------------------------------------
// Spec 4 (Visualization_Pass) net-worth waterfall model
// ---------------------------------------------------------------------------

/** What a waterfall step represents: an institution asset subtotal, one liability, or the total. */
export type WaterfallStepKind = 'institution' | 'liability' | 'total';

/**
 * One ordered step in the Net_Worth_Waterfall (Spec 4 R2.6, R7.3): institution asset subtotals
 * stacking up to total assets, each liability as its own negative step, ending at the net-worth
 * total bar. The final step's `runningTotal` equals `NetWorthResult.netWorth`.
 */
export interface WaterfallStep {
  label: string; // institution name, liability name, or "Net worth"
  kind: WaterfallStepKind;
  delta: number; // signed contribution (+ assets, − liabilities); 0 for the total marker
  runningTotal: number; // cumulative value after this step
  isTotal: boolean; // true for the final net-worth bar (drawn from 0, not floating)
}
