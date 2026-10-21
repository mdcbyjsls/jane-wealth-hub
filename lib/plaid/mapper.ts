import type {
  Account,
  AccountType,
  AssetClass,
  AssetClassBreakdown,
} from '@/types/accounts';
import type {
  PlaidHolding,
  PlaidMapperInput,
  PlaidSecurity,
} from '@/types/plaid';

/**
 * Plaid_Mapper — pure conversion of Plaid-shaped data into our domain model (R10).
 *
 * PURITY CONTRACT: this module imports only from `@/types/*`. It performs no fetch, reads no clock
 * or RNG, and touches no `localStorage`. Any non-determinism (ids) is injected by the caller via
 * `PlaidMapperInput.idFor`. The server-only Plaid route assembles the SDK responses and calls into
 * here; the Plaid SDK and its tokens never reach the browser.
 *
 * This file currently exports `classifyHolding` (Task 8.1). `mapPlaidToAccounts` (Task 9.1) builds
 * on the same classifier and will be added alongside it.
 *
 * ---------------------------------------------------------------------------------------------
 * Holding classification precedence (R10.4, R10.5, R10.9)
 * ---------------------------------------------------------------------------------------------
 * `classifyHolding` decides a security's Asset_Class by applying three stages IN ORDER. An earlier
 * stage that produces a class wins; later stages are only consulted when earlier ones abstain. This
 * ordering is the contract Property 20 verifies, so it must not be reordered.
 *
 *   1. By Plaid security `type`/`subtype` when present (case-insensitive):
 *        - equity                                  → stocks
 *        - fixed income / bond types               → bonds
 *        - cash / money-market types               → cash
 *      An explicit, recognized type or subtype is authoritative and short-circuits the name
 *      heuristics below. A derivative/crypto/etc. type is recognized-but-unclassifiable and falls
 *      through to stage 3 (it never leaks into the name heuristics).
 *
 *   2. Else by security `name` (case-insensitive substring match):
 *        - contains "bond", "treasury", "fixed income", "aggregate", or "municipal" → bonds
 *        - contains "money market"                                                  → cash
 *        - any other usable ETF / mutual-fund name                                  → stocks
 *      Rationale for the stocks default: a named fund that is not caught by a bond/cash keyword is
 *      overwhelmingly an equity fund, so a usable name is treated as classifiable rather than
 *      dropped to `other`. Bond keywords are checked before the stocks default so e.g. "Vanguard
 *      Total Bond Market ETF" and "iShares Core U.S. Aggregate Bond ETF" land in bonds.
 *
 *   3. Else `other` — only for a truly unclassifiable security: a derivative or crypto type, or an
 *      unknown security with no usable type AND no usable name.
 *
 * Worked examples (R10.5):
 *   - "Vanguard Total Bond Market ETF"      → bonds   (name contains "bond")
 *   - "iShares Core U.S. Aggregate Bond ETF" → bonds  (name contains "aggregate"/"bond")
 *   - "Vanguard Total Stock Market ETF"     → stocks  (usable name, no bond/cash keyword)
 *   - "SPDR S&P 500 ETF Trust"              → stocks  (usable name, no bond/cash keyword)
 *   - type "cash" or "money market"         → cash    (explicit type)
 *   - type "derivative"/"crypto", or no usable type or name → other
 */

/** Normalize an optional Plaid string field to a lowercased, trimmed token or `null`. */
function normalize(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Stage 1: map an explicit Plaid `type`/`subtype` token to an Asset_Class.
 * Returns `null` when the token is absent or recognized-but-unclassifiable (e.g. derivative,
 * crypto), so the caller can fall through to the name heuristics or to `other`.
 */
function classifyByType(token: string | null): AssetClass | null {
  if (token === null) {
    return null;
  }
  if (token.includes('equity')) {
    return 'stocks';
  }
  if (token.includes('fixed income') || token.includes('bond')) {
    return 'bonds';
  }
  // "money market" is a cash equivalent; plain "cash" covers depository-like holdings.
  if (token.includes('money market') || token.includes('cash')) {
    return 'cash';
  }
  return null;
}

/**
 * Stage 2: map a usable security `name` to an Asset_Class via the documented keyword heuristics.
 * Returns `null` only when the name is absent/empty, so the caller can fall through to `other`.
 */
function classifyByName(name: string | null): AssetClass | null {
  if (name === null) {
    return null;
  }
  const bondKeywords = ['bond', 'treasury', 'fixed income', 'aggregate', 'municipal'];
  if (bondKeywords.some((keyword) => name.includes(keyword))) {
    return 'bonds';
  }
  if (name.includes('money market')) {
    return 'cash';
  }
  // A usable name that matched no bond/cash keyword is treated as an equity fund.
  return 'stocks';
}

/**
 * Classify a single Plaid security into one of the four Asset_Classes, applying the documented
 * precedence (type/subtype → name → other). Exported for direct unit/property testing (Property 20)
 * and reused by `mapPlaidToAccounts` when deriving an investment account's Asset_Class_Split.
 *
 * @see the module header for the full, authoritative precedence rules (R10.4, R10.5, R10.9).
 */
export function classifyHolding(security: PlaidSecurity): AssetClass {
  // Stage 1: explicit type, then subtype, is authoritative and short-circuits the name heuristics.
  const byType = classifyByType(normalize(security.type));
  if (byType !== null) {
    return byType;
  }
  const bySubtype = classifyByType(normalize(security.subtype));
  if (bySubtype !== null) {
    return bySubtype;
  }

  // Stage 2: fall back to the security-name keyword heuristics.
  const byName = classifyByName(normalize(security.name));
  if (byName !== null) {
    return byName;
  }

  // Stage 3: truly unclassifiable — no usable type or name (derivative, crypto, or unknown).
  return 'other';
}

// =============================================================================================
// mapPlaidToAccounts (R10.1, R10.2, R10.3, R10.6, R10.7, R10.8, R13.3)
// =============================================================================================

/**
 * PURITY CONTRACT (restated for this function): imports only from `@/types/*`; no fetch, no clock,
 * no RNG, no `localStorage`. The only source of non-determinism — the stable `Account.id` — is
 * supplied by the injected `input.idFor`, so the same input always yields the same output. The
 * server-only Plaid route assembles `PlaidMapperInput` from the SDK responses and calls into here.
 */

/** The four asset-class keys, in a fixed order, used for deterministic iteration and tie-breaks. */
const ASSET_CLASS_KEYS: readonly AssetClass[] = ['stocks', 'bonds', 'cash', 'other'];

/** Connected accounts arrive freshly fetched, so they are treated as updated "today" (0 days ago). */
const CONNECTED_LAST_UPDATED_DAYS_AGO = 0;

/** An all-zero breakdown, cloned at each use so no two accounts share a mutable object. */
function zeroBreakdown(): AssetClassBreakdown {
  return { stocks: 0, bonds: 0, cash: 0, other: 0 };
}

/**
 * Normalize an optional Plaid `type`/`subtype` field for comparison: lowercased, trimmed, or `''`.
 * Distinct from the module-private `normalize` used by `classifyHolding` (which returns `null`);
 * here an empty string is the convenient "no usable token" sentinel for the `switch`/`includes`
 * checks below.
 */
function token(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Map a Plaid depository `subtype` to our matching `AccountType` (R10.2). Savings-like subtypes map
 * to `HYSA` (our only savings bucket); everything else depository (checking, cash management, or an
 * unknown/absent subtype) maps to `checking`. The balance itself is always assigned entirely to the
 * `cash` Asset_Class regardless of which depository type is chosen.
 */
function depositoryAccountType(subtype: string): AccountType {
  if (subtype.includes('savings') || subtype.includes('hysa') || subtype.includes('money market')) {
    return 'HYSA';
  }
  return 'checking';
}

/**
 * Decide the Liability_Account type for a Plaid loan or credit account (R10.3). A loan whose subtype
 * is a mortgage maps to the distinct `mortgage` type (which triggers the Decision-view rent note,
 * R11); every other loan and every credit card maps to the generic `liability` type.
 */
function liabilityAccountType(plaidType: string, subtype: string): AccountType {
  if (plaidType === 'loan' && subtype.includes('mortgage')) {
    return 'mortgage';
  }
  return 'liability';
}

/**
 * Convert per-class dollar sums into whole-number percentages that sum to EXACTLY 100, using the
 * same largest-remainder (Hamilton) method the Allocation_Calculator uses — specialized here to
 * whole percents rather than tenths, because an investment account's derived Asset_Class_Split is
 * stored as whole numbers (R10.6, R10.8).
 *
 *   1. Each class's ideal share is `classDollars / totalDollars * 100`.
 *   2. Floor each to an integer percent, remembering the dropped fractional remainder.
 *   3. The floors are short of 100 by `residual` (0..3 for four classes); hand those leftover
 *      percentage points out one at a time to the classes with the LARGEST dropped remainder, ties
 *      broken by `ASSET_CLASS_KEYS` order for determinism.
 *
 * `totalDollars` is guaranteed > 0 by the caller (a holdingless or all-zero-value investment account
 * takes the `other: 100` path instead), so there is no division by zero. The returned breakdown's
 * four values always sum to exactly 100.
 */
function dollarsToWholePercentSplit(classDollars: AssetClassBreakdown): AssetClassBreakdown {
  const totalDollars = ASSET_CLASS_KEYS.reduce((sum, key) => sum + classDollars[key], 0);

  const floored = zeroBreakdown();
  const remainders = zeroBreakdown();
  let assigned = 0;

  for (const key of ASSET_CLASS_KEYS) {
    const ideal = (classDollars[key] / totalDollars) * 100;
    const floor = Math.floor(ideal);
    floored[key] = floor;
    remainders[key] = ideal - floor; // dropped fractional part, in [0, 1)
    assigned += floor;
  }

  const residual = 100 - assigned;
  const rankedByRemainder = [...ASSET_CLASS_KEYS].sort((a, b) => {
    if (remainders[b] !== remainders[a]) {
      return remainders[b] - remainders[a]; // larger dropped remainder first
    }
    return ASSET_CLASS_KEYS.indexOf(a) - ASSET_CLASS_KEYS.indexOf(b); // deterministic tie-break
  });

  for (let i = 0; i < residual; i += 1) {
    floored[rankedByRemainder[i]] += 1;
  }

  return floored;
}

/**
 * Derive an investment account's Asset_Class_Split from its holdings (R10.6, R10.7, R10.8).
 *
 * Each holding's `institutionValue` (market value) is summed into the Asset_Class its security
 * classifies to via `classifyHolding`, then those per-class dollar sums are converted to whole-
 * number percentages summing to exactly 100 by the largest-remainder method.
 *
 * Two cases collapse to the "needs input" fallback (R10.7, R13.3): an account with no holdings at
 * all, and an account whose holdings carry no positive market value (so no class has any dollars to
 * weight). Both are indistinguishable for allocation purposes — there is nothing to split — so both
 * return `other: 100` with `needsInput: true`, letting the view prompt the user to set the split.
 */
function investmentSplit(
  accountId: string,
  holdings: PlaidHolding[],
  securitiesById: Map<string, PlaidSecurity>,
): { breakdown: AssetClassBreakdown; needsInput: boolean } {
  const accountHoldings = holdings.filter((holding) => holding.accountId === accountId);

  if (accountHoldings.length === 0) {
    return { breakdown: { ...zeroBreakdown(), other: 100 }, needsInput: true };
  }

  const classDollars = zeroBreakdown();
  for (const holding of accountHoldings) {
    // A holding whose value is not a positive finite number contributes nothing to the split.
    if (!Number.isFinite(holding.institutionValue) || holding.institutionValue <= 0) {
      continue;
    }
    const security = securitiesById.get(holding.securityId);
    // A holding referencing an unknown security is classified as `other` (truly unclassifiable):
    // pass a minimal security carrying just the id so `classifyHolding` applies its stage-3 rule.
    const assetClass = classifyHolding(security ?? { securityId: holding.securityId });
    classDollars[assetClass] += holding.institutionValue;
  }

  const totalDollars = ASSET_CLASS_KEYS.reduce((sum, key) => sum + classDollars[key], 0);
  if (totalDollars <= 0) {
    // Holdings existed but none carried positive market value — nothing to split (R10.7, R13.3).
    return { breakdown: { ...zeroBreakdown(), other: 100 }, needsInput: true };
  }

  return { breakdown: dollarsToWholePercentSplit(classDollars), needsInput: false };
}

/**
 * Purely convert a `PlaidMapperInput` into the `Account[]` the Account_Store stores as
 * Connected_Accounts (R10). One output account per input `PlaidAccountRaw`, in input order; every
 * account is `source: 'Connected'`, carries its `mask` and `plaidInstitutionId`, and takes its
 * stable `id` from the injected `idFor`.
 *
 * By Plaid `type`:
 *   - `depository` → matching `AccountType` (checking/HYSA), full balance to `cash` (R10.2).
 *   - `loan` / `credit` → Liability_Account: `mortgage` for a mortgage loan, else `liability`;
 *     amount owed stored as a POSITIVE balance via `Math.abs` (R10.3).
 *   - `investment` (and any other non-liability type, treated as a holdings-bearing bucket) → split
 *     derived from holdings by market value (R10.6, R10.8), or `other: 100` + `allocationNeedsInput`
 *     when there are no holdings to split (R10.7, R13.3).
 *
 * Every non-liability account it returns carries a four-value split summing to exactly 100 (R10.8):
 * depository is `cash: 100`, and investment splits come from the largest-remainder helper or the
 * `other: 100` fallback. Liability accounts carry an all-zero breakdown and contribute to no class
 * total (consistent with the calculators' LIABILITY_TYPES handling).
 */
export function mapPlaidToAccounts(input: PlaidMapperInput): Account[] {
  const { institution, accounts, securities, holdings, idFor } = input;

  const securitiesById = new Map<string, PlaidSecurity>();
  for (const security of securities) {
    securitiesById.set(security.securityId, security);
  }

  return accounts.map((raw) => {
    const plaidType = token(raw.type);
    const subtype = token(raw.subtype);

    const base = {
      id: idFor(raw.accountId),
      source: 'Connected' as const,
      institution,
      accountName: raw.name,
      lastUpdatedDaysAgo: CONNECTED_LAST_UPDATED_DAYS_AGO,
      mask: raw.mask,
      plaidInstitutionId: institution,
    };

    if (plaidType === 'loan' || plaidType === 'credit') {
      // Liability: store the amount owed as a positive balance regardless of the input's sign.
      return {
        ...base,
        accountType: liabilityAccountType(plaidType, subtype),
        balance: Math.abs(raw.balanceCurrent),
        assetClassBreakdown: zeroBreakdown(),
      };
    }

    if (plaidType === 'depository') {
      // Depository: full balance to cash, matching checking/HYSA type (R10.2).
      return {
        ...base,
        accountType: depositoryAccountType(subtype),
        balance: raw.balanceCurrent,
        assetClassBreakdown: { ...zeroBreakdown(), cash: 100 },
      };
    }

    // Investment (and any other asset-bearing type): derive the split from holdings (R10.6–R10.8).
    const { breakdown, needsInput } = investmentSplit(raw.accountId, holdings, securitiesById);
    const investmentAccount: Account = {
      ...base,
      accountType: 'brokerage',
      balance: raw.balanceCurrent,
      assetClassBreakdown: breakdown,
    };
    if (needsInput) {
      investmentAccount.allocationNeedsInput = true;
    }
    return investmentAccount;
  });
}
