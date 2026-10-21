/**
 * Account_Store — browser-only persistence and set-operations for the user's account set (R6, R7, R9).
 *
 * This module mirrors `lib/target/targetStore.ts`: it is the project's only account `localStorage`
 * user, is imported solely by client code (never by the pure `lib/calculations/` calculators,
 * server components, or the FRED modules, per R7.7), and every read is defensive — SSR (no
 * `window`), disabled/unavailable `localStorage`, malformed JSON, or structurally invalid stored
 * values all resolve to a safe result without throwing.
 *
 * The module is built in three slices that each append to this file:
 *   - set-operations (this slice): `startFresh`, `restoreSampleData`, `disconnectInstitution`,
 *     `upsertConnectedInstitution` — pure transforms that take accounts in and return accounts out;
 *     they do not touch `localStorage` themselves (persistence is owned by the load/save slice).
 *   - account mutation helpers (edit / delete-undo / Split_Override application).
 *   - load & recovery (`loadAccounts` / `saveAccounts`) — the only `localStorage` callers.
 *
 * The set-operations below are deliberately pure so they can be property-tested directly (design
 * Correctness Properties 8, 11, 12, 16, 17) and composed by the mutation/persistence slices without
 * re-reading storage.
 */

import type { Account, AssetClassBreakdown } from '@/types/accounts';
import { buildSampleSet } from '@/lib/accounts/sampleSet';

// ---------------------------------------------------------------------------
// Set-operations (Tasks 10.1) — pure transforms over an account set
// ---------------------------------------------------------------------------

/**
 * "Start fresh" (R6.1, R6.2): remove exactly the Sample_Accounts from the set.
 *
 * Returns a new array containing only the accounts whose `source` is NOT `'Sample'` (i.e. Manual
 * and Connected accounts), unchanged and in their original relative order. Manual edits and Plaid
 * connections survive; the shipped sample data is cleared. Non-mutating — the input array and its
 * elements are left untouched (design Property 11).
 */
export function startFresh(accounts: readonly Account[]): Account[] {
  return accounts.filter((account) => account.source !== 'Sample');
}

/**
 * "Restore sample data" (R6.3, R6.4): preserve every non-Sample account unchanged and add exactly
 * one canonical Sample_Set.
 *
 * Every Manual and Connected account is kept as-is and in its original order; any Sample_Accounts
 * already present are dropped first so the result contains exactly one copy of the canonical
 * Sample_Set with no duplicates. This makes the operation idempotent: applying it twice yields the
 * same set as applying it once (design Property 12). The appended Sample_Set is a fresh, mutable
 * copy from `buildSampleSet()` with the canonical (fixed) ids, so a later edit can convert a sample
 * into a manual account without corrupting the shared template.
 *
 * Non-Sample accounts come first (preserving their order), followed by the canonical Sample_Set, so
 * the restored sample data lands in a predictable, stable position.
 */
export function restoreSampleData(accounts: readonly Account[]): Account[] {
  const nonSample = accounts.filter((account) => account.source !== 'Sample');
  return [...nonSample, ...buildSampleSet()];
}

/**
 * "Disconnect institution" (R9.3): remove exactly the Connected_Accounts belonging to one Plaid
 * institution.
 *
 * Returns a new array with every account whose `source === 'Connected'` AND whose
 * `plaidInstitutionId === institutionId` removed; all other accounts — Sample, Manual, and
 * Connected accounts from other institutions — are preserved unchanged and in their original order
 * (design Property 16). Non-mutating.
 */
export function disconnectInstitution(
  accounts: readonly Account[],
  institutionId: string,
): Account[] {
  return accounts.filter(
    (account) =>
      !(account.source === 'Connected' && account.plaidInstitutionId === institutionId),
  );
}

/** The outcome of an upsert: the merged account set plus any overrides that could not be carried. */
export interface UpsertConnectedResult {
  /** The full account set after replacing the target institution's Connected_Accounts. */
  accounts: Account[];
  /**
   * The `Account_Match_Key`s of prior Split_Overrides that matched no freshly fetched account and
   * were therefore dropped (R4.6). Empty when every override was carried. Each entry names the
   * account whose adjustment could no longer be applied so the UI can surface a plain-language
   * message.
   */
  droppedOverrides: DroppedOverride[];
}

/** A prior Split_Override that could not be carried onto any freshly fetched account (R4.6). */
export interface DroppedOverride {
  institution: string;
  accountName: string;
  mask: string | null;
}

/**
 * Canonical string form of an `Account_Match_Key` (R4.5): case-insensitive on
 * `institution` + `accountName`, exact on `mask`. Two Connected_Accounts are "the same account
 * across a reconnect" iff their match keys are equal, which is what lets a user's Split_Override
 * survive a refresh. A missing/null mask is normalized to a single sentinel so "no mask" compares
 * equal to "no mask" without colliding with any real mask string.
 */
function matchKey(institution: string, accountName: string, mask: string | null | undefined): string {
  const normalizedMask = mask ?? '\u0000no-mask';
  // JSON.stringify keeps the three parts unambiguously delimited so values that happen to contain
  // the delimiter cannot forge a collision.
  return JSON.stringify([institution.trim().toLowerCase(), accountName.trim().toLowerCase(), normalizedMask]);
}

/**
 * "Connect / reconnect an institution" (R4.5, R4.6, R9.4): replace the target institution's
 * Connected_Accounts with a freshly fetched set, carrying forward each matching Split_Override.
 *
 * Behavior (design Properties 8 and 17):
 *   - Every account NOT belonging to this Plaid institution — Sample, Manual, and Connected
 *     accounts from other institutions — is preserved unchanged and in its original order.
 *   - The institution's prior Connected_Accounts are fully replaced by `freshAccounts`, so a
 *     reconnect never leaves a stale duplicate for that institution.
 *   - Each prior Connected_Account that carried a `Split_Override` has that override copied onto the
 *     fresh account whose `Account_Match_Key` equals the prior account's; a prior override whose key
 *     matches no fresh account is dropped and reported in `droppedOverrides` (R4.6).
 *
 * The fresh accounts are placed where the institution's accounts previously began (or appended if
 * the institution was not previously present), so reconnecting in place does not reorder the set.
 * Non-mutating: inputs are not modified; carried overrides are copied onto cloned fresh accounts.
 */
export function upsertConnectedInstitution(
  accounts: readonly Account[],
  institutionId: string,
  freshAccounts: readonly Account[],
): UpsertConnectedResult {
  // Index prior overrides for this institution by match key so each fresh account can claim its own.
  const priorOverridesByKey = new Map<string, { override: AssetClassBreakdown; dropped: DroppedOverride }>();
  for (const account of accounts) {
    if (
      account.source === 'Connected' &&
      account.plaidInstitutionId === institutionId &&
      account.splitOverride
    ) {
      priorOverridesByKey.set(matchKey(account.institution, account.accountName, account.mask ?? null), {
        override: { ...account.splitOverride },
        dropped: {
          institution: account.institution,
          accountName: account.accountName,
          mask: account.mask ?? null,
        },
      });
    }
  }

  // Build the replacement set, carrying any matched override and consuming it from the map so that
  // whatever remains afterward is exactly the set of overrides with no fresh match (the dropped ones).
  const replacement: Account[] = freshAccounts.map((fresh) => {
    const key = matchKey(fresh.institution, fresh.accountName, fresh.mask ?? null);
    const prior = priorOverridesByKey.get(key);
    if (prior) {
      priorOverridesByKey.delete(key);
      return { ...fresh, splitOverride: { ...prior.override } };
    }
    return { ...fresh };
  });

  const droppedOverrides: DroppedOverride[] = [...priorOverridesByKey.values()].map((entry) => entry.dropped);

  // Splice the replacement into the position the institution previously occupied. The first index
  // where one of this institution's Connected_Accounts appears marks the insertion point; all of the
  // institution's prior accounts are removed and the fresh set is inserted there. If the institution
  // was not previously present, the fresh set is appended after the existing accounts.
  const belongsToInstitution = (account: Account): boolean =>
    account.source === 'Connected' && account.plaidInstitutionId === institutionId;

  const firstIndex = accounts.findIndex(belongsToInstitution);
  const retained = accounts.filter((account) => !belongsToInstitution(account));

  let merged: Account[];
  if (firstIndex === -1) {
    merged = [...retained, ...replacement];
  } else {
    // Count how many retained accounts precede the institution's original first position so the
    // replacement lands at the same spot in the retained-only array.
    let insertAt = 0;
    for (let i = 0; i < firstIndex; i += 1) {
      if (!belongsToInstitution(accounts[i])) {
        insertAt += 1;
      }
    }
    merged = [...retained.slice(0, insertAt), ...replacement, ...retained.slice(insertAt)];
  }

  return { accounts: merged, droppedOverrides };
}

// ---------------------------------------------------------------------------
// Account mutation helpers (Task 11.1) — pure transforms over an account set
// ---------------------------------------------------------------------------

/**
 * The validated, normalized fields an edit or add carries, produced by `validateAccountInput`
 * (see `lib/accounts/accountValidation.ts`). Re-exported from the validator so callers compose the
 * editor boundary and these store mutations without re-deriving the shape. For a liability/mortgage
 * type the `split` is all zeros (R3.3); for a non-liability type the four values sum to 100 (R3.2).
 */
import type { ValidatedAccountFields } from '@/lib/accounts/accountValidation';

/**
 * Edit a Sample_Account or Manual_Account in place by id (R2.1, R2.5, R5.3).
 *
 * Returns a new array with exactly the matching account replaced; order and every other account are
 * preserved. The edited account:
 *   - KEEPS its stable `id` (R1.2) and its relative `lastUpdatedDaysAgo`.
 *   - Takes the validated institution, account name, type, balance, and split from `fields`; the
 *     split becomes the account's `assetClassBreakdown`.
 *   - Has `source` set to `'Manual'` — editing a Sample_Account converts it to Manual (R2.5, design
 *     Property 2); a Manual_Account stays Manual.
 *   - Records `updatedByYouDate = updatedByYouDate` so the UI shows "Updated by you on [date]" in
 *     place of a staleness flag for both a freshly converted and an already-Manual account (R5.3).
 *
 * Purity: the "now" date is INJECTED as `updatedByYouDate` (an ISO date string) rather than read
 * from the clock here, keeping this transform deterministic and directly property-testable. The
 * caller (the editor) supplies `new Date().toISOString().slice(0, 10)` or equivalent at the
 * boundary.
 *
 * This helper is intended for Sample and Manual accounts only; the editor forbids editing a
 * Connected_Account's balance/institution/type (R4.1) and routes Connected split changes through
 * `applySplitOverride`. If `id` matches no account, the set is returned unchanged (as a new array).
 */
export function editAccount(
  accounts: readonly Account[],
  id: string,
  fields: ValidatedAccountFields,
  updatedByYouDate: string,
): Account[] {
  return accounts.map((account) => {
    if (account.id !== id) {
      return account;
    }
    return {
      ...account,
      source: 'Manual',
      institution: fields.institution,
      accountName: fields.accountName,
      accountType: fields.accountType,
      balance: fields.balance,
      assetClassBreakdown: { ...fields.split },
      updatedByYouDate,
      // A freshly converted Manual account carries no Connected-only metadata forward. Clearing
      // these keeps the account's Source story honest: it is now hand-entered, not bank-reported.
      mask: undefined,
      plaidInstitutionId: undefined,
      splitOverride: undefined,
      allocationNeedsInput: undefined,
    };
  });
}

/**
 * Add a new Manual_Account from validated fields (R2.2, R2.6).
 *
 * Returns a new array with the new account appended; existing accounts and their order are
 * untouched. The new account is stamped `source: 'Manual'` and given a NEW stable id (R2.6), with
 * its `assetClassBreakdown` taken from the validated split and `updatedByYouDate` recorded so it
 * shows the "Updated by you on [date]" basis like any Manual account. `lastUpdatedDaysAgo` is 0
 * because the account was just entered.
 *
 * Purity: the new id is produced by the INJECTED `newId` factory, and the "now" date is INJECTED as
 * `updatedByYouDate`, so this transform reads neither RNG nor clock and is directly
 * property-testable. The caller supplies a collision-free id factory (e.g. `crypto.randomUUID`,
 * optionally prefixed) and the current date at the boundary.
 */
export function addAccount(
  accounts: readonly Account[],
  fields: ValidatedAccountFields,
  newId: () => string,
  updatedByYouDate: string,
): Account[] {
  const account: Account = {
    id: newId(),
    source: 'Manual',
    institution: fields.institution,
    accountName: fields.accountName,
    accountType: fields.accountType,
    balance: fields.balance,
    assetClassBreakdown: { ...fields.split },
    lastUpdatedDaysAgo: 0,
    updatedByYouDate,
  };
  return [...accounts, account];
}

/**
 * The result of a deletion: the set with the account removed plus everything needed to undo it
 * (R2.3, design Property 3). `undoToken` captures the removed account together with the index it
 * occupied so `undoDelete` can reinsert the identical account at the identical position, restoring
 * the set exactly (same accounts, same order, same ids). `undoToken` is `null` when the id matched
 * no account, so there is nothing to undo.
 */
export interface DeleteAccountResult {
  accounts: Account[];
  undoToken: DeleteUndoToken | null;
}

/** An opaque-to-callers record of a single deletion, sufficient to reverse it exactly (R2.3). */
export interface DeleteUndoToken {
  /** The removed account, captured by value so the undo restores the identical object contents. */
  account: Account;
  /** The position the account occupied in the pre-delete array, so undo reinserts it in place. */
  index: number;
}

/**
 * Delete a Sample_Account or Manual_Account by id (R2.3), returning both the new set and an undo
 * token.
 *
 * Returns a new array with the matching account removed and the rest preserved in order, plus an
 * `undoToken` carrying the removed account and its original index. Pass that token to `undoDelete`
 * to reinsert the account at the same position, which makes delete-then-undo a round trip to the
 * identical set — same accounts, same order, same ids (design Property 3). If `id` matches no
 * account the set is returned unchanged and `undoToken` is `null`.
 *
 * The editor forbids deleting a Connected_Account individually (R2.4); those are removed only via
 * `disconnectInstitution`. This helper does not enforce that — it is the editor's responsibility to
 * offer delete only on Sample and Manual rows.
 */
export function deleteAccount(accounts: readonly Account[], id: string): DeleteAccountResult {
  const index = accounts.findIndex((account) => account.id === id);
  if (index === -1) {
    return { accounts: [...accounts], undoToken: null };
  }
  const removed = accounts[index];
  const next = [...accounts.slice(0, index), ...accounts.slice(index + 1)];
  return {
    accounts: next,
    undoToken: { account: removed, index },
  };
}

/**
 * Undo a prior deletion (R2.3), reinserting the removed account at its original index.
 *
 * Returns a new array with `token.account` spliced back in at `token.index`, reproducing the
 * pre-delete set exactly when applied to the post-delete set — the other half of the delete-then-
 * undo round trip (design Property 3). The index is clamped into range so an undo applied to a set
 * that shrank further in the meantime still reinserts the account rather than throwing; for the
 * immediate delete→undo path the clamp is a no-op and the position is exact.
 */
export function undoDelete(accounts: readonly Account[], token: DeleteUndoToken): Account[] {
  const index = Math.max(0, Math.min(token.index, accounts.length));
  return [...accounts.slice(0, index), token.account, ...accounts.slice(index)];
}

/**
 * Apply a Split_Override to a Connected_Account by id (R4.2, R4.3, R4.4, design Property 7).
 *
 * Returns a new array with exactly the matching Connected_Account updated; order and every other
 * account are preserved. The updated account KEEPS `source === 'Connected'` (a user adjusting the
 * allocation does not make the bank-reported account manual) and gains the given `splitOverride`.
 * The "adjusted by you" label is driven purely by the presence of `splitOverride` (R4.3/R4.4), so
 * setting it here turns the label on and `clearSplitOverride` turns it back off.
 *
 * The override must be a valid sum-to-100 split (the editor runs it through `validateAccountInput`,
 * R4.2); this helper copies it as given and does not re-validate. It only mutates an account whose
 * `source === 'Connected'` and whose `id` matches — the balance, institution, and type stay
 * read-only (R4.1), and a non-Connected or unmatched id leaves the set unchanged (as a new array).
 */
export function applySplitOverride(
  accounts: readonly Account[],
  id: string,
  splitOverride: AssetClassBreakdown,
): Account[] {
  return accounts.map((account) => {
    if (account.id !== id || account.source !== 'Connected') {
      return account;
    }
    return { ...account, splitOverride: { ...splitOverride } };
  });
}

/**
 * Remove a Connected_Account's Split_Override by id (R4.4), reverting it to the bank-reported split.
 *
 * Returns a new array with the matching Connected_Account's `splitOverride` cleared; because the
 * "adjusted by you" label is driven by `splitOverride` presence, clearing it turns the label off.
 * Non-mutating; a non-Connected or unmatched id leaves the set unchanged (as a new array).
 */
export function clearSplitOverride(accounts: readonly Account[], id: string): Account[] {
  return accounts.map((account) => {
    if (account.id !== id || account.source !== 'Connected') {
      return account;
    }
    const { splitOverride: _removed, ...rest } = account;
    return rest;
  });
}

// ---------------------------------------------------------------------------
// Load & recovery (Task 12.1) — the ONLY localStorage callers in this module
// ---------------------------------------------------------------------------

import type { AccountLoadResult, AccountType } from '@/types/accounts';
import { ACCOUNTS_STORAGE_KEY, LIABILITY_TYPES } from '@/types/accounts';

/**
 * Institution-name length bounds, inclusive (R7.1). Mirrors the bounds enforced by
 * `validateAccounts` in `lib/calculations/allocation.ts`; duplicated here (rather than imported)
 * so this per-element guard stays self-contained and the store never depends on the calculator's
 * internal, non-exported constants.
 */
const INSTITUTION_MIN_LENGTH = 1;
const INSTITUTION_MAX_LENGTH = 120;

/** Allowed tolerance, in percentage points, for a non-liability breakdown to sum to 100 (R7.2). */
const BREAKDOWN_SUM_TOLERANCE = 0.01;

/** The known set of account types, used to reject unknown `accountType` values (R7.1). */
const KNOWN_ACCOUNT_TYPES: readonly AccountType[] = [
  'brokerage',
  'IRA',
  'Roth IRA',
  '401(k)',
  'HYSA',
  'checking',
  'liability',
  'mortgage',
];

/** The four asset-class keys every `AssetClassBreakdown` must carry as finite numbers. */
const ASSET_CLASS_KEYS: readonly (keyof AssetClassBreakdown)[] = [
  'stocks',
  'bonds',
  'cash',
  'other',
];

/** Narrows `unknown` to a plain object (non-null, non-array) so property access is safe. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when `value` is a real, finite number (rejects NaN, +/-Infinity, and non-numbers). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True when `value` is one of the known account types. */
function isKnownAccountType(value: unknown): value is AccountType {
  return (
    typeof value === 'string' &&
    (KNOWN_ACCOUNT_TYPES as readonly string[]).includes(value)
  );
}

/** True when an account type is a liability (`liability` or `mortgage`, per LIABILITY_TYPES). */
function isLiabilityType(accountType: AccountType): boolean {
  return LIABILITY_TYPES.includes(accountType);
}

/**
 * Per-element shape guard used by partial recovery (R7.4). Unlike `validateAccounts`, which is
 * all-or-nothing over the whole array, this validates a SINGLE candidate so `loadAccounts` can keep
 * the good entries and drop only the bad ones. The field checks mirror `validateAccounts` exactly —
 * `id`/`source`/`institution`/`accountName`/`accountType`/`balance`/`assetClassBreakdown`/
 * `lastUpdatedDaysAgo` — so an account the calculator would accept is an account this guard accepts,
 * and vice versa. Liability types (`liability`/`mortgage`) are exempt from the sum-to-100 rule,
 * matching the calculator (R7.4).
 *
 * `id`, `source`, and `accountName` are additionally required here because a stored account must be
 * a complete `Account` the store can round-trip (R1.1, R1.2, R4.5) — `validateAccounts` guards the
 * Spec 1 compute fields; this guard also enforces the Spec-this identity/source fields the store owns.
 */
function isValidAccount(candidate: unknown): candidate is Account {
  if (!isRecord(candidate)) {
    return false;
  }

  // id — non-empty string (stable identity, R1.2).
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return false;
  }

  // source — exactly one of Sample/Manual/Connected (R1.1).
  if (
    candidate.source !== 'Sample' &&
    candidate.source !== 'Manual' &&
    candidate.source !== 'Connected'
  ) {
    return false;
  }

  // accountName — non-empty string, 1–120 chars (R4.5).
  if (
    typeof candidate.accountName !== 'string' ||
    candidate.accountName.length < INSTITUTION_MIN_LENGTH ||
    candidate.accountName.length > INSTITUTION_MAX_LENGTH
  ) {
    return false;
  }

  // institution — non-empty string, 1–120 chars (R7.1).
  if (
    typeof candidate.institution !== 'string' ||
    candidate.institution.length < INSTITUTION_MIN_LENGTH ||
    candidate.institution.length > INSTITUTION_MAX_LENGTH
  ) {
    return false;
  }

  // accountType — one of the known values (R7.1).
  if (!isKnownAccountType(candidate.accountType)) {
    return false;
  }

  // balance — finite number (R7.3).
  if (!isFiniteNumber(candidate.balance)) {
    return false;
  }

  // lastUpdatedDaysAgo — non-negative integer.
  if (
    !isFiniteNumber(candidate.lastUpdatedDaysAgo) ||
    !Number.isInteger(candidate.lastUpdatedDaysAgo) ||
    candidate.lastUpdatedDaysAgo < 0
  ) {
    return false;
  }

  // assetClassBreakdown — object of four finite numbers; non-liability must sum to 100 ±0.01 (R7.2, R7.4).
  const breakdown = candidate.assetClassBreakdown;
  if (!isRecord(breakdown)) {
    return false;
  }
  let sum = 0;
  for (const key of ASSET_CLASS_KEYS) {
    const classValue = breakdown[key];
    if (!isFiniteNumber(classValue)) {
      return false;
    }
    sum += classValue;
  }
  if (!isLiabilityType(candidate.accountType) && Math.abs(sum - 100) > BREAKDOWN_SUM_TOLERANCE) {
    return false;
  }

  return true;
}

/** True only in an environment where `window.localStorage` is usable (browser, not SSR). */
function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    // Accessing `window.localStorage` can throw in some locked-down environments.
    return false;
  }
}

/**
 * Persist the full account set to localStorage (R7.1), serializing on every change. No-op outside
 * the browser or if the write fails (storage disabled, private mode, quota exceeded); persistence
 * is best-effort and never throws to the caller (R7.6). This is the only writer of
 * `ACCOUNTS_STORAGE_KEY`; it always writes the complete set so the stored value is the single
 * source of truth (no partial/delta writes to reconcile on load).
 */
export function saveAccounts(accounts: Account[]): void {
  if (!hasLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
  } catch {
    // Swallow write failures (private mode, quota, SSR edge) — persistence is best-effort (R7.6).
  }
}

/**
 * Read the persisted account set defensively (R7.2–R7.6), returning both the usable accounts and
 * which of the four recovery branches produced them. Never throws under SSR or an unavailable
 * `localStorage`, and never throws on malformed stored content (R7.6, design Property 15).
 *
 * Branches (design load state machine; Data Models `AccountLoadResult`):
 *   - SSR / no usable `localStorage` / nothing stored (`null`) → seed the Sample_Set,
 *     `{ kind: 'seeded' }` (R7.2). A first-time visitor and a non-browser caller land here.
 *   - a valid stored array whose every element passes `isValidAccount` → those accounts as-is,
 *     `{ kind: 'ok' }` (R7.3, design Property 13).
 *   - a stored array mixing valid and invalid elements, with AT LEAST ONE valid remaining → the
 *     valid accounts in their original relative order, `{ kind: 'partial', dropped: N }` where N is
 *     the count of dropped invalid entries (R7.4, design Property 14).
 *   - unparseable JSON, a non-array value, or an array with NO valid account at all (which includes
 *     the empty array and the all-invalid array) → restore the Sample_Set, `{ kind: 'fallback' }`
 *     (R7.5). Any read error is caught and funneled here too.
 *
 * The seeded and fallback branches both return a fresh, mutable `buildSampleSet()` copy with the
 * canonical ids, so the caller may mutate the result freely.
 */
export function loadAccounts(): AccountLoadResult {
  if (!hasLocalStorage()) {
    // SSR or no usable storage: treat as a first visit with nothing stored → seed (R7.2, R7.6).
    return { accounts: buildSampleSet(), recovery: { kind: 'seeded' } };
  }

  try {
    const raw = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (raw === null) {
      // Nothing stored → first visit, seed the Sample_Set (R7.2).
      return { accounts: buildSampleSet(), recovery: { kind: 'seeded' } };
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      // Parsed to a non-array (wrong-typed JSON) → unreadable, fall back (R7.5).
      return { accounts: buildSampleSet(), recovery: { kind: 'fallback' } };
    }

    const valid: Account[] = [];
    let dropped = 0;
    for (const candidate of parsed) {
      if (isValidAccount(candidate)) {
        valid.push(candidate);
      } else {
        dropped += 1;
      }
    }

    if (valid.length === 0) {
      // All-invalid or empty array → nothing usable, fall back to the Sample_Set (R7.5).
      return { accounts: buildSampleSet(), recovery: { kind: 'fallback' } };
    }

    if (dropped === 0) {
      // Every element valid → load the stored set exactly as-is (R7.3).
      return { accounts: valid, recovery: { kind: 'ok' } };
    }

    // Some valid, some invalid → keep the valid in original order, report the losses (R7.4).
    return { accounts: valid, recovery: { kind: 'partial', dropped } };
  } catch {
    // Unparseable JSON or any read error → never throw; fall back to the Sample_Set (R7.5, R7.6).
    return { accounts: buildSampleSet(), recovery: { kind: 'fallback' } };
  }
}
