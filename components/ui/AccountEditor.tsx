'use client';

/*
 * AccountEditor — the interactive account-management surface (R2, R3, R4, R6).
 *
 * This is the single place a user shapes their account set. It is a CONTROLLED
 * client island: it renders from an `accounts` prop and reports every valid
 * mutation up through `onAccountsChange(nextAccounts)`. It never touches
 * localStorage and never recomputes a view itself — the PARENT owns persistence
 * (`saveAccounts`) and the recompute of net worth / allocation / projection /
 * buy-vs-rent (R2.7, R6.5). Keeping the store outside the editor is what lets a
 * single `onAccountsChange` call drive persistence and every view in one place.
 *
 * It owns only transient, editor-local state: which row is being edited, the
 * in-progress form strings, the current inline validation message, and the
 * most-recent delete's undo token.
 *
 * What it supports:
 *   - Add a new Manual_Account (R2.2): institution, account name, type, balance,
 *     and the four-way split, via `addAccount` with an injected id factory and
 *     current date.
 *   - Edit a Sample_Account or Manual_Account (R2.1): the same fields, via
 *     `editAccount`; saving a Sample edit converts it to Manual (R2.5, handled by
 *     the store).
 *   - Delete a Sample_Account or Manual_Account (R2.3) with a brief, keyboard-
 *     reachable "Undo" affordance via `deleteAccount` / `undoDelete`. Connected
 *     accounts are never individually deletable (R2.4) — no delete control is
 *     rendered on them.
 *   - Edit ONLY the Split_Override of a Connected_Account (R4.1, R4.2): balance,
 *     institution, and type are read-only; the four split inputs run through the
 *     same `validateAccountInput` sum-to-100 rule and persist via
 *     `applySplitOverride`.
 *   - "Start fresh" (R6.1) and "Restore sample data" (R6.3) actions over the whole
 *     set.
 *
 * Inline validation (R3.4–R3.6) mirrors `TargetEditor`: on submit the raw strings
 * go through `validateAccountInput`; on failure the editor shows ONE plain-language
 * message next to the first offending field, keeps the user's entries, disables
 * Save, and does not call the parent. The message also clears live as the user
 * edits, so a corrected field drops its message and re-enables Save (R3.6).
 *
 * Liability/mortgage types bypass the split-sum rule (R3.3): the editor hides the
 * split inputs for those types, consistent with the validator (which normalizes
 * their split to all zeros).
 *
 * Accessibility: every input has an associated <label>; the inline message is tied
 * to the offending input via `aria-describedby` and announced through a
 * `role="alert"` live region; Save exposes a real `disabled` state; the undo
 * affordance is a focusable button; status/provenance is carried by text, never
 * color alone (R9.6). Styling stays calm and card-based per the private-banking
 * ui-style.
 */

import { useMemo, useState } from 'react';
import type { Account, AccountType, AssetClassBreakdown } from '@/types/accounts';
import { LIABILITY_TYPES } from '@/types/accounts';
import {
  type AccountFieldError,
  type AccountInput,
  validateAccountInput,
} from '@/lib/accounts/accountValidation';
import {
  addAccount,
  applySplitOverride,
  deleteAccount,
  editAccount,
  restoreSampleData,
  startFresh,
  undoDelete,
  type DeleteUndoToken,
} from '@/lib/accounts/accountStore';
import { formatCurrency } from '@/lib/format';

/** The known account types, offered in the editor's type <select> (R2.1, R3.1). */
const ACCOUNT_TYPES: readonly AccountType[] = [
  'brokerage',
  'IRA',
  'Roth IRA',
  '401(k)',
  'HYSA',
  'checking',
  'liability',
  'mortgage',
];

/** The four split classes in a fixed label/tab order (matches the validator's reporting order). */
const SPLIT_CLASSES: ReadonlyArray<{ key: keyof AssetClassBreakdown; label: string }> = [
  { key: 'stocks', label: 'Stocks' },
  { key: 'bonds', label: 'Bonds' },
  { key: 'cash', label: 'Cash' },
  { key: 'other', label: 'Other' },
];

/** Split-input string shape used by both the full-account form and the override form. */
type SplitInput = AccountInput['split'];

const EMPTY_SPLIT: SplitInput = { stocks: '', bonds: '', cash: '', other: '' };

/** True when a type bypasses the split-sum rule (R3.3). */
function isLiabilityType(type: string): boolean {
  return (LIABILITY_TYPES as readonly string[]).includes(type);
}

/** Build the editor's string inputs from an existing account (for edit mode). */
function toAccountInput(account: Account): AccountInput {
  return {
    institution: account.institution,
    accountName: account.accountName,
    accountType: account.accountType,
    balance: String(account.balance),
    split: {
      stocks: String(account.assetClassBreakdown.stocks),
      bonds: String(account.assetClassBreakdown.bonds),
      cash: String(account.assetClassBreakdown.cash),
      other: String(account.assetClassBreakdown.other),
    },
  };
}

/** Blank inputs for the "add a new account" form. */
function blankAccountInput(): AccountInput {
  return {
    institution: '',
    accountName: '',
    accountType: 'brokerage',
    balance: '',
    split: { ...EMPTY_SPLIT },
  };
}

/** Build the split-only inputs for a Connected account's override form (R4.2). */
function toSplitInput(account: Account): SplitInput {
  const source = account.splitOverride ?? account.assetClassBreakdown;
  return {
    stocks: String(source.stocks),
    bonds: String(source.bonds),
    cash: String(source.cash),
    other: String(source.other),
  };
}

/** Local inline-validation state: a message plus which field it is attached to. */
interface ValidationState {
  message: string | null;
  field: AccountFieldError | null;
}

const NO_ERROR: ValidationState = { message: null, field: null };

/**
 * The editor can be in one of three mutually exclusive editing modes, or idle.
 *   - `add`               — the new-Manual-account form is open.
 *   - `edit` (by id)      — a Sample/Manual account's full form is open.
 *   - `override` (by id)  — a Connected account's split-only form is open.
 */
type EditingMode =
  | { kind: 'idle' }
  | { kind: 'add' }
  | { kind: 'edit'; id: string }
  | { kind: 'override'; id: string };

export interface AccountEditorProps {
  /** The current account set; the editor renders from this and reports changes up. */
  accounts: Account[];
  /**
   * Called with the next account set on every valid mutation (add/edit/delete/undo/
   * override/start-fresh/restore). The parent persists via `saveAccounts` and
   * recomputes all views (R2.7, R6.5).
   */
  onAccountsChange: (nextAccounts: Account[]) => void;
  /**
   * Injected stable-id factory for new accounts (e.g. `() => crypto.randomUUID()`).
   * Injected rather than read here so the editor stays deterministic and testable.
   */
  newId?: () => string;
  /**
   * Injected "today" as an ISO date (e.g. `new Date().toISOString().slice(0, 10)`),
   * stamped as `updatedByYouDate` on edits/adds. Injected for the same reason.
   */
  today?: string;
}

/** Field-level inline message, tied to its input via a shared id (R3.4, R9.4). */
function FieldError({
  id,
  show,
  message,
}: {
  id: string;
  show: boolean;
  message: string | null;
}): React.ReactElement {
  return (
    <p
      id={id}
      role="alert"
      aria-live="assertive"
      className={show ? 'text-sm font-medium text-red-700' : 'sr-only'}
    >
      {show ? (message ?? '') : ''}
    </p>
  );
}

export default function AccountEditor({
  accounts,
  onAccountsChange,
  newId = () => crypto.randomUUID(),
  today = new Date().toISOString().slice(0, 10),
}: AccountEditorProps): React.ReactElement {
  const [mode, setMode] = useState<EditingMode>({ kind: 'idle' });
  const [input, setInput] = useState<AccountInput>(() => blankAccountInput());
  const [splitInput, setSplitInput] = useState<SplitInput>(() => ({ ...EMPTY_SPLIT }));
  const [validation, setValidation] = useState<ValidationState>(NO_ERROR);
  const [undoState, setUndoState] = useState<DeleteUndoToken | null>(null);

  const editingType = input.accountType;
  const splitHidden = isLiabilityType(editingType);

  /** The account currently targeted by an edit/override mode, if any. */
  const activeAccount = useMemo(() => {
    if (mode.kind === 'edit' || mode.kind === 'override') {
      return accounts.find((account) => account.id === mode.id) ?? null;
    }
    return null;
  }, [mode, accounts]);

  // --- mode transitions -----------------------------------------------------

  function openAdd(): void {
    setInput(blankAccountInput());
    setValidation(NO_ERROR);
    setMode({ kind: 'add' });
  }

  function openEdit(account: Account): void {
    setInput(toAccountInput(account));
    setValidation(NO_ERROR);
    setMode({ kind: 'edit', id: account.id });
  }

  function openOverride(account: Account): void {
    setSplitInput(toSplitInput(account));
    setValidation(NO_ERROR);
    setMode({ kind: 'override', id: account.id });
  }

  function closeForm(): void {
    setMode({ kind: 'idle' });
    setValidation(NO_ERROR);
  }

  // --- field change handlers (clear the message as a field is corrected, R3.6) ---

  /**
   * Re-run validation on the next input and, if the previously offending field is
   * now valid, clear the inline message so a corrected field immediately re-enables
   * Save (R3.6). We only ever clear here; the authoritative message is (re)set on
   * submit, so typing never surfaces a brand-new error mid-keystroke.
   */
  function reconcileMessage(next: AccountInput): void {
    if (validation.message === null) {
      return;
    }
    const result = validateAccountInput(next);
    if (result.ok || result.field !== validation.field) {
      setValidation(NO_ERROR);
    }
  }

  function handleFieldChange<K extends 'institution' | 'accountName' | 'accountType' | 'balance'>(
    field: K,
    value: string,
  ): void {
    const next: AccountInput = { ...input, [field]: value };
    setInput(next);
    reconcileMessage(next);
  }

  function handleSplitChange(key: keyof AssetClassBreakdown, value: string): void {
    const next: AccountInput = { ...input, split: { ...input.split, [key]: value } };
    setInput(next);
    reconcileMessage(next);
  }

  /** Override-form split change: validate the split against a synthetic full input (R4.2). */
  function handleOverrideSplitChange(key: keyof AssetClassBreakdown, value: string): void {
    const nextSplit: SplitInput = { ...splitInput, [key]: value };
    setSplitInput(nextSplit);
    if (validation.message !== null && activeAccount) {
      const result = validateAccountInput(overrideInput(activeAccount, nextSplit));
      if (result.ok || result.field !== validation.field) {
        setValidation(NO_ERROR);
      }
    }
  }

  // --- submit handlers ------------------------------------------------------

  function handleFullSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = validateAccountInput(input);
    if (!result.ok) {
      setValidation({ message: result.message, field: result.field });
      return;
    }
    setValidation(NO_ERROR);

    if (mode.kind === 'add') {
      onAccountsChange(addAccount(accounts, result.value, newId, today));
    } else if (mode.kind === 'edit') {
      onAccountsChange(editAccount(accounts, mode.id, result.value, today));
    }
    closeForm();
  }

  function handleOverrideSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (mode.kind !== 'override' || !activeAccount) {
      return;
    }
    const result = validateAccountInput(overrideInput(activeAccount, splitInput));
    if (!result.ok) {
      setValidation({ message: result.message, field: result.field });
      return;
    }
    setValidation(NO_ERROR);
    const override: AssetClassBreakdown = result.value.split;
    onAccountsChange(applySplitOverride(accounts, mode.id, override));
    closeForm();
  }

  // --- delete / undo --------------------------------------------------------

  function handleDelete(account: Account): void {
    const result = deleteAccount(accounts, account.id);
    if (result.undoToken === null) {
      return;
    }
    // Close any open form targeting the account we just removed.
    if ((mode.kind === 'edit' || mode.kind === 'override') && mode.id === account.id) {
      closeForm();
    }
    setUndoState(result.undoToken);
    onAccountsChange(result.accounts);
  }

  function handleUndo(): void {
    if (undoState === null) {
      return;
    }
    onAccountsChange(undoDelete(accounts, undoState));
    setUndoState(null);
  }

  // --- whole-set actions (R6.1, R6.3) --------------------------------------

  function handleStartFresh(): void {
    closeForm();
    setUndoState(null);
    onAccountsChange(startFresh(accounts));
  }

  function handleRestoreSample(): void {
    closeForm();
    setUndoState(null);
    onAccountsChange(restoreSampleData(accounts));
  }

  // --- derived render flags -------------------------------------------------

  // Live Save-gating: Save is disabled whenever the current form fails validation
  // (R3.5). We compute validity from the live inputs so the button reflects the
  // current entries without waiting for a submit.
  const fullFormValid = validateAccountInput(input).ok;
  const overrideFormValid =
    activeAccount !== null && validateAccountInput(overrideInput(activeAccount, splitInput)).ok;

  return (
    <section aria-label="Accounts" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900">Your accounts</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openAdd}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
          >
            Add account
          </button>
          <button
            type="button"
            onClick={handleStartFresh}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
          >
            Start fresh
          </button>
          <button
            type="button"
            onClick={handleRestoreSample}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
          >
            Restore sample data
          </button>
        </div>
      </header>

      {/* Undo affordance for the most recent deletion (R2.3). Text carries the
          meaning; the control is a focusable button reachable by keyboard. */}
      {undoState !== null && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
        >
          <span className="text-sm text-gray-700">
            Deleted {undoState.account.institution} — {undoState.account.accountName}.
          </span>
          <button
            type="button"
            onClick={handleUndo}
            className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
          >
            Undo
          </button>
        </div>
      )}

      {/* Add / edit full-account form (R2.1, R2.2). */}
      {(mode.kind === 'add' || mode.kind === 'edit') && (
        <form
          onSubmit={handleFullSubmit}
          noValidate
          className="flex flex-col gap-4 rounded-lg border border-gray-200 p-4"
        >
          <h3 className="text-sm font-semibold text-gray-900">
            {mode.kind === 'add' ? 'Add a new account' : 'Edit account'}
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="acct-institution" className="text-sm font-medium text-gray-700">
                Institution
              </label>
              <input
                id="acct-institution"
                type="text"
                value={input.institution}
                onChange={(e) => handleFieldChange('institution', e.target.value)}
                aria-invalid={validation.field === 'institution' || undefined}
                aria-describedby={
                  validation.field === 'institution' ? 'acct-institution-error' : undefined
                }
                className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
              />
              <FieldError
                id="acct-institution-error"
                show={validation.field === 'institution'}
                message={validation.message}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="acct-name" className="text-sm font-medium text-gray-700">
                Account name
              </label>
              <input
                id="acct-name"
                type="text"
                value={input.accountName}
                onChange={(e) => handleFieldChange('accountName', e.target.value)}
                aria-invalid={validation.field === 'accountName' || undefined}
                aria-describedby={validation.field === 'accountName' ? 'acct-name-error' : undefined}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
              />
              <FieldError
                id="acct-name-error"
                show={validation.field === 'accountName'}
                message={validation.message}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="acct-type" className="text-sm font-medium text-gray-700">
                Account type
              </label>
              <select
                id="acct-type"
                value={input.accountType}
                onChange={(e) => handleFieldChange('accountType', e.target.value)}
                aria-invalid={validation.field === 'accountType' || undefined}
                aria-describedby={validation.field === 'accountType' ? 'acct-type-error' : undefined}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
              >
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <FieldError
                id="acct-type-error"
                show={validation.field === 'accountType'}
                message={validation.message}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="acct-balance" className="text-sm font-medium text-gray-700">
                Balance
              </label>
              <input
                id="acct-balance"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={input.balance}
                onChange={(e) => handleFieldChange('balance', e.target.value)}
                aria-invalid={validation.field === 'balance' || undefined}
                aria-describedby={validation.field === 'balance' ? 'acct-balance-error' : undefined}
                className="rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
              />
              <FieldError
                id="acct-balance-error"
                show={validation.field === 'balance'}
                message={validation.message}
              />
            </div>
          </div>

          {/* Split inputs — hidden for liability/mortgage types, which bypass the
              split-sum rule (R3.3). A plain-language note explains why. */}
          {splitHidden ? (
            <p className="text-sm text-gray-600">
              This is a liability, so it has no asset-class split.
            </p>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-gray-700">
                Asset-class split (must total 100)
              </legend>
              <div className="grid gap-3 sm:grid-cols-4">
                {SPLIT_CLASSES.map(({ key, label }) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label htmlFor={`acct-split-${key}`} className="text-sm text-gray-700">
                      {label}
                    </label>
                    <span className="flex items-center gap-1">
                      <input
                        id={`acct-split-${key}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={100}
                        step={1}
                        value={input.split[key]}
                        onChange={(e) => handleSplitChange(key, e.target.value)}
                        aria-invalid={
                          validation.field === key || validation.field === 'split-sum' || undefined
                        }
                        aria-describedby={
                          validation.field === key || validation.field === 'split-sum'
                            ? 'acct-split-error'
                            : undefined
                        }
                        className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
                      />
                      <span aria-hidden="true" className="text-sm text-gray-600">
                        %
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <FieldError
                id="acct-split-error"
                show={
                  validation.field === 'stocks' ||
                  validation.field === 'bonds' ||
                  validation.field === 'cash' ||
                  validation.field === 'other' ||
                  validation.field === 'split-sum'
                }
                message={validation.message}
              />
            </fieldset>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!fullFormValid}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
            >
              Save account
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Connected-account split-override form (R4.1, R4.2). Balance / institution /
          type are shown read-only; only the split is editable. */}
      {mode.kind === 'override' && activeAccount && (
        <form
          onSubmit={handleOverrideSubmit}
          noValidate
          className="flex flex-col gap-4 rounded-lg border border-gray-200 p-4"
        >
          <h3 className="text-sm font-semibold text-gray-900">Adjust allocation</h3>
          <p className="text-sm text-gray-600">
            {activeAccount.institution} — {activeAccount.accountName} ·{' '}
            <span className="tabular-nums">{formatCurrency(activeAccount.balance)}</span> ·{' '}
            {activeAccount.accountType}
          </p>
          <p className="text-sm text-gray-600">
            Balance, institution, and type are reported by your bank and can&apos;t be edited here.
          </p>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-gray-700">
              Asset-class split (must total 100)
            </legend>
            <div className="grid gap-3 sm:grid-cols-4">
              {SPLIT_CLASSES.map(({ key, label }) => (
                <div key={key} className="flex flex-col gap-1">
                  <label htmlFor={`override-split-${key}`} className="text-sm text-gray-700">
                    {label}
                  </label>
                  <span className="flex items-center gap-1">
                    <input
                      id={`override-split-${key}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={1}
                      value={splitInput[key]}
                      onChange={(e) => handleOverrideSplitChange(key, e.target.value)}
                      aria-invalid={
                        validation.field === key || validation.field === 'split-sum' || undefined
                      }
                      aria-describedby={
                        validation.field === key || validation.field === 'split-sum'
                          ? 'override-split-error'
                          : undefined
                      }
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
                    />
                    <span aria-hidden="true" className="text-sm text-gray-600">
                      %
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <FieldError
              id="override-split-error"
              show={
                validation.field === 'stocks' ||
                validation.field === 'bonds' ||
                validation.field === 'cash' ||
                validation.field === 'other' ||
                validation.field === 'split-sum'
              }
              message={validation.message}
            />
          </fieldset>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!overrideFormValid}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
            >
              Save allocation
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Account list with per-row actions. */}
      <ul className="flex flex-col gap-3">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-4"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-gray-900">{account.institution}</span>
              <span className="text-sm text-gray-700">{account.accountName}</span>
              <span className="text-sm text-gray-600">
                {account.accountType} ·{' '}
                <span className="tabular-nums">{formatCurrency(account.balance)}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              {account.source === 'Connected' ? (
                // R4.1: a Connected account can only have its split adjusted; no
                // full edit and no individual delete (R2.4).
                <button
                  type="button"
                  onClick={() => openOverride(account)}
                  className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
                >
                  Adjust allocation
                </button>
              ) : (
                // Sample / Manual accounts: full edit and delete (R2.1, R2.3).
                <>
                  <button
                    type="button"
                    onClick={() => openEdit(account)}
                    className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(account)}
                    className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Build a full `AccountInput` for a Connected account from its read-only fields plus
 * the in-progress split strings, so the Split_Override runs through the SAME
 * `validateAccountInput` sum-to-100 rule as any other account (R4.2). The institution,
 * account name, type, and balance come straight from the account (already valid), so
 * only the split can fail — which is exactly what we want the override form to report.
 */
function overrideInput(account: Account, split: SplitInput): AccountInput {
  return {
    institution: account.institution,
    accountName: account.accountName,
    accountType: account.accountType,
    balance: String(account.balance),
    split,
  };
}
