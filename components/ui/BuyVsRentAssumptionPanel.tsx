'use client';

/*
 * BuyVsRentAssumptionPanel — the Assumption_Panel for the Buy-vs-Rent Scenario
 * Tester (Spec 3).
 *
 * NAMING NOTE: Spec 2 already owns `components/ui/AssumptionPanel.tsx` (the
 * projection view's panel, imported by ProjectionClient). That file is left
 * untouched; this buy-vs-rent variant lives under its own name, consistent with
 * how the buy-vs-rent comparison summary was named BuyVsRentComparisonSummary.
 *
 * Lists every editable assumption behind the comparison with its current value
 * and a plain-language label, honoring the product principle that no number the
 * user did not choose is ever hidden (R9.1). The listed assumptions are the 15
 * scalar fields of `BuyVsRentAssumptions` plus the two nested Scenario
 * multipliers: Home_Price, Down_Payment_Percent, Mortgage_Rate,
 * Mortgage_Term_Years, Property_Tax_Rate, Homeowners_Insurance,
 * Maintenance_Rate, HOA_Monthly, Closing_Costs, Selling_Cost_Percent,
 * Home_Appreciation_Rate, Current_Rent_Monthly, Rent_Growth_Rate,
 * Renters_Insurance, the cushion-months multiple, the Optimistic_Multiplier, and
 * the Pessimistic_Multiplier.
 *
 * Controlled panel. The parent island (BuyVsRentClient) owns the COMMITTED
 * assumptions and the recompute; this panel owns only its local input strings
 * and per-field validation messages. The split mirrors Spec 2's AssumptionPanel:
 *
 *   - Each input is a controlled native <input> seeded from the committed value.
 *   - On commit (blur / Enter), the raw string is parsed and range-checked for
 *     that assumption. On a VALID edit the parsed number is handed up via
 *     `onChange` so the island recomputes the comparison (R9.3); on an INVALID
 *     edit the panel shows an inline message adjacent to the offending input,
 *     does NOT call `onChange` (so the island keeps the last valid comparison),
 *     and reverts the input to the previously accepted committed value as the
 *     active assumption (R9.4).
 *   - A reset control calls `onReset`; the island restores every assumption to
 *     its market-derived or documented default and this panel clears all inline
 *     messages (R9.5).
 *
 * Sources (R9.2): the three market-derived assumptions show their Market_Series
 * source label plus the value's "as of" calendar date — Mortgage_Rate cites
 * MORTGAGE30US, Home_Appreciation_Rate cites CSUSHPINSA, Rent_Growth_Rate cites
 * CUSR0000SEHA. Every other assumption shows a documented-default source label.
 * Source copy comes from `@/lib/buyVsRentMessages`; money and percentages are
 * formatted via `lib/format.ts`.
 *
 * Bounds (R9.6): Down_Payment_Percent 0–100, Mortgage_Rate 0–20,
 * Home_Appreciation_Rate and Rent_Growth_Rate −20..+20, and every
 * dollar-denominated assumption ≥ 0.
 *
 * Accessibility (ui-style, R9.4):
 *   - Every input is a native, keyboard-reachable control in a fixed tab order
 *     with an always-on focus ring.
 *   - Validation never relies on color alone: each message is text in a
 *     `role="alert"` region associated with its input via `aria-describedby`,
 *     and the input is marked `aria-invalid`.
 *   - Money and percentage inputs/values use `tabular-nums` so figures line up.
 *
 * This is a presentational client island: no fetching, no localStorage, no clock.
 */

import { useEffect, useRef, useState } from 'react';
import type { MarketDataSnapshot } from '@/types/market';
import type { BuyVsRentAssumptions } from '@/types/buyVsRent';
import { formatCurrency } from '@/lib/format';
import {
  ASSUMPTION_VALIDATION,
  MARKET_SERIES_LABEL,
  defaultSourceLabel,
  sourceLabel,
  valueOutOfRange,
} from '@/lib/buyVsRentMessages';

// ---------------------------------------------------------------------------
// Field identity
// ---------------------------------------------------------------------------

/**
 * Every assumption this panel edits. The 15 scalar `BuyVsRentAssumptions`
 * fields are edited by their own key; the two nested Scenario multipliers are
 * addressed with synthetic field ids so each still maps to one input/message.
 */
export type EditableField =
  | 'homePrice'
  | 'downPaymentPercent'
  | 'mortgageRatePercent'
  | 'mortgageTermYears'
  | 'propertyTaxRatePercent'
  | 'homeownersInsurance'
  | 'maintenanceRatePercent'
  | 'hoaMonthly'
  | 'closingCosts'
  | 'sellingCostPercent'
  | 'homeAppreciationRatePercent'
  | 'currentRentMonthly'
  | 'rentGrowthRatePercent'
  | 'rentersInsurance'
  | 'cushionMonths'
  | 'optimisticMultiplier'
  | 'pessimisticMultiplier';

// ---------------------------------------------------------------------------
// Bounds (R9.6)
// ---------------------------------------------------------------------------

/** Down_Payment_Percent: 0–100 percent inclusive (R9.6). */
const DOWN_PAYMENT_MIN = 0;
const DOWN_PAYMENT_MAX = 100;

/** Mortgage_Rate: 0–20 percent inclusive (R9.6). */
const MORTGAGE_RATE_MIN = 0;
const MORTGAGE_RATE_MAX = 20;

/** Home_Appreciation_Rate and Rent_Growth_Rate: −20..+20 percent inclusive (R9.6). */
const APPRECIATION_MIN = -20;
const APPRECIATION_MAX = 20;

/** A generic non-negative lower bound for dollar-denominated assumptions (R9.6). */
const DOLLAR_MIN = 0;

// ---------------------------------------------------------------------------
// Field specification
// ---------------------------------------------------------------------------

/** How a field's number should be rendered as a secondary hint. */
type ValueKind = 'money' | 'plain';

interface FieldSpec {
  field: EditableField;
  label: string;
  /** Short unit affix shown after the input (e.g. "%", "$", "yrs", "×"). */
  unit: string;
  /** Lower bound (inclusive) or null when unbounded below. */
  min: number | null;
  /** Upper bound (inclusive) or null when unbounded above. */
  max: number | null;
  /** Native input step increment. */
  step: number;
  /** How the committed value is rendered in the secondary hint. */
  valueKind: ValueKind;
}

/**
 * Field order and bounds. The three market-derived rates (mortgage, home
 * appreciation, rent growth) carry their series source labels; the rest show a
 * documented-default label. Dollar fields are non-negative (R9.6).
 */
const FIELD_SPECS: readonly FieldSpec[] = [
  { field: 'homePrice', label: 'Home price', unit: '$', min: DOLLAR_MIN, max: null, step: 1000, valueKind: 'money' },
  { field: 'downPaymentPercent', label: 'Down payment', unit: '%', min: DOWN_PAYMENT_MIN, max: DOWN_PAYMENT_MAX, step: 0.5, valueKind: 'plain' },
  { field: 'mortgageRatePercent', label: 'Mortgage rate', unit: '%', min: MORTGAGE_RATE_MIN, max: MORTGAGE_RATE_MAX, step: 0.1, valueKind: 'plain' },
  { field: 'mortgageTermYears', label: 'Mortgage term', unit: 'yrs', min: DOLLAR_MIN, max: null, step: 1, valueKind: 'plain' },
  { field: 'propertyTaxRatePercent', label: 'Property tax rate', unit: '%', min: DOLLAR_MIN, max: null, step: 0.1, valueKind: 'plain' },
  { field: 'homeownersInsurance', label: 'Homeowners insurance', unit: '$/yr', min: DOLLAR_MIN, max: null, step: 100, valueKind: 'money' },
  { field: 'maintenanceRatePercent', label: 'Maintenance rate', unit: '%', min: DOLLAR_MIN, max: null, step: 0.1, valueKind: 'plain' },
  { field: 'hoaMonthly', label: 'HOA dues', unit: '$/mo', min: DOLLAR_MIN, max: null, step: 25, valueKind: 'money' },
  { field: 'closingCosts', label: 'Closing costs', unit: '$', min: DOLLAR_MIN, max: null, step: 500, valueKind: 'money' },
  { field: 'sellingCostPercent', label: 'Selling cost', unit: '%', min: DOLLAR_MIN, max: null, step: 0.5, valueKind: 'plain' },
  { field: 'homeAppreciationRatePercent', label: 'Home appreciation rate', unit: '%', min: APPRECIATION_MIN, max: APPRECIATION_MAX, step: 0.1, valueKind: 'plain' },
  { field: 'currentRentMonthly', label: 'Current rent', unit: '$/mo', min: DOLLAR_MIN, max: null, step: 50, valueKind: 'money' },
  { field: 'rentGrowthRatePercent', label: 'Rent growth rate', unit: '%', min: APPRECIATION_MIN, max: APPRECIATION_MAX, step: 0.1, valueKind: 'plain' },
  { field: 'rentersInsurance', label: 'Renters insurance', unit: '$/yr', min: DOLLAR_MIN, max: null, step: 50, valueKind: 'money' },
  { field: 'cushionMonths', label: 'Cash cushion', unit: 'mo', min: DOLLAR_MIN, max: null, step: 1, valueKind: 'plain' },
  { field: 'optimisticMultiplier', label: 'Optimistic multiplier', unit: '×', min: DOLLAR_MIN, max: null, step: 0.1, valueKind: 'plain' },
  { field: 'pessimisticMultiplier', label: 'Pessimistic multiplier', unit: '×', min: DOLLAR_MIN, max: null, step: 0.1, valueKind: 'plain' },
];

const EDITABLE_FIELDS: readonly EditableField[] = FIELD_SPECS.map(
  (spec) => spec.field,
);

// ---------------------------------------------------------------------------
// Committed-value access
// ---------------------------------------------------------------------------

/** Read the committed numeric value for a field, used to seed and to revert inputs. */
function committedValue(
  field: EditableField,
  values: BuyVsRentAssumptions,
): number {
  switch (field) {
    case 'optimisticMultiplier':
      return values.multipliers.optimistic;
    case 'pessimisticMultiplier':
      return values.multipliers.pessimistic;
    default:
      return values[field];
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** A parsed-and-range-checked edit: either a committed number or a message. */
type FieldValidation =
  | { ok: true; value: number }
  | { ok: false; message: string };

/**
 * Parse a raw input string for `spec` and range-check it against that field's
 * bounds (R9.6). A non-finite entry always fails with `mustBeFiniteNumber`
 * (R9.4). A bounded field out of range yields `valueOutOfRange(min, max)`; a
 * dollar field below zero yields `mustBeZeroOrMore`.
 */
function validateField(spec: FieldSpec, raw: string): FieldValidation {
  // `Number('')` is 0, which would silently accept a blank; treat blank as
  // non-finite so clearing an input surfaces the finite-number message (R9.4).
  const parsed = raw.trim() === '' ? Number.NaN : Number(raw);

  if (!Number.isFinite(parsed)) {
    return { ok: false, message: ASSUMPTION_VALIDATION.mustBeFiniteNumber };
  }

  const belowMin = spec.min !== null && parsed < spec.min;
  const aboveMax = spec.max !== null && parsed > spec.max;

  if (belowMin || aboveMax) {
    // A field bounded on both sides states its permitted range; a field bounded
    // only below at zero (every dollar assumption) states the simpler ≥ 0 rule.
    if (spec.min !== null && spec.max !== null) {
      return { ok: false, message: valueOutOfRange(spec.min, spec.max) };
    }
    return { ok: false, message: ASSUMPTION_VALIDATION.mustBeZeroOrMore };
  }

  return { ok: true, value: parsed };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BuyVsRentAssumptionPanelProps {
  /** The committed assumptions (island-owned). */
  values: BuyVsRentAssumptions;
  /**
   * The resolved market snapshot, read only for the three market-derived
   * assumptions' source labels and as-of dates (R9.2). No fetching here.
   */
  market: MarketDataSnapshot;
  /**
   * Report a single valid, in-range edit up to the island, which updates its
   * committed assumptions and recomputes the comparison (R9.3). Never called
   * for invalid input.
   */
  onChange: (field: EditableField, value: number) => void;
  /** Reset every assumption to its default; the panel clears all messages (R9.5). */
  onReset: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Per-field local state: the raw input string and any inline message. */
type DraftState = Record<EditableField, string>;
type MessageState = Partial<Record<EditableField, string>>;

/** Build the initial draft strings from the committed values. */
function toDrafts(values: BuyVsRentAssumptions): DraftState {
  const drafts = {} as DraftState;
  for (const field of EDITABLE_FIELDS) {
    drafts[field] = String(committedValue(field, values));
  }
  return drafts;
}

/**
 * The pre-formatted source label for a field (R9.2): the three market-derived
 * rates cite their Market_Series name plus the value's as-of date; everything
 * else is a documented default.
 */
function sourceFor(field: EditableField, market: MarketDataSnapshot): string {
  switch (field) {
    case 'mortgageRatePercent':
      return sourceLabel(MARKET_SERIES_LABEL.mortgageRate, market.mortgageRate.asOf);
    case 'homeAppreciationRatePercent':
      return sourceLabel(MARKET_SERIES_LABEL.homeAppreciation, market.homePriceIndex.asOf);
    case 'rentGrowthRatePercent':
      return sourceLabel(MARKET_SERIES_LABEL.rentGrowth, market.rentIndex.asOf);
    default:
      return defaultSourceLabel();
  }
}

export default function BuyVsRentAssumptionPanel({
  values,
  market,
  onChange,
  onReset,
}: BuyVsRentAssumptionPanelProps): React.ReactElement {
  const [drafts, setDrafts] = useState<DraftState>(() => toDrafts(values));
  const [messages, setMessages] = useState<MessageState>({});

  // Keep the drafts in sync when the island changes a committed value from the
  // outside (a reset, or a market-derived default landing once the snapshot
  // resolves). We compare against the committed values this effect last
  // applied, so a field the user is actively (invalidly) editing is never
  // stomped: only fields whose committed value actually moved — and that have
  // no pending inline message — are reseeded to the new accepted value (R9.5).
  const lastSynced = useRef<BuyVsRentAssumptions>(values);
  useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next: DraftState = { ...prev };
      for (const field of EDITABLE_FIELDS) {
        const committed = committedValue(field, values);
        const previousCommitted = committedValue(field, lastSynced.current);
        if (committed !== previousCommitted && messages[field] === undefined) {
          next[field] = String(committed);
          changed = true;
        }
      }
      lastSynced.current = values;
      return changed ? next : prev;
    });
  }, [values, messages]);

  function handleChange(field: EditableField, raw: string): void {
    setDrafts((prev) => ({ ...prev, [field]: raw }));
  }

  /**
   * Commit an edit on blur/Enter: validate, and either hand the island the new
   * value (clearing any message) or keep the last valid comparison while
   * showing the inline message and reverting the input to the committed value.
   */
  function handleCommit(spec: FieldSpec): void {
    const result = validateField(spec, drafts[spec.field]);
    if (result.ok) {
      setMessages((prev) => {
        const next = { ...prev };
        delete next[spec.field];
        return next;
      });
      // Normalize the draft to the accepted numeric value so, e.g., "5.00"
      // settles to "5" and matches what the island now holds.
      setDrafts((prev) => ({ ...prev, [spec.field]: String(result.value) }));
      onChange(spec.field, result.value);
      return;
    }
    // Invalid: show the message, retain the previously accepted value as the
    // active assumption, and leave the island's comparison untouched (R9.4).
    setMessages((prev) => ({ ...prev, [spec.field]: result.message }));
    setDrafts((prev) => ({
      ...prev,
      [spec.field]: String(committedValue(spec.field, values)),
    }));
  }

  function handleReset(): void {
    // Clear every inline message (R9.5) and ask the island to restore defaults.
    // The sync effect reseeds the drafts once the island pushes the restored
    // values, so a field that had been showing an invalid draft returns to its
    // default rather than keeping the rejected entry.
    setMessages({});
    setDrafts(toDrafts(values));
    onReset();
  }

  return (
    <section
      aria-label="Comparison assumptions"
      className="flex flex-col gap-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-100"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-slate-900">Assumptions</h3>
          <p className="text-sm text-slate-600">
            Every number here is editable. Change any value to see how it moves
            the comparison.
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
        >
          Reset to defaults
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {FIELD_SPECS.map((spec) => (
          <EditableRow
            key={spec.field}
            spec={spec}
            source={sourceFor(spec.field, market)}
            valueHint={
              spec.valueKind === 'money'
                ? formatCurrency(committedValue(spec.field, values))
                : undefined
            }
            draft={drafts[spec.field]}
            message={messages[spec.field]}
            onChange={handleChange}
            onCommit={handleCommit}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface EditableRowProps {
  spec: FieldSpec;
  /** The source / default label shown beneath the input (R9.2). */
  source: string;
  /** Optional pre-formatted hint (e.g. a dollar assumption as formatted currency). */
  valueHint?: string;
  draft: string;
  /** Inline validation message for this field, if any (R9.4). */
  message?: string;
  onChange: (field: EditableField, raw: string) => void;
  onCommit: (spec: FieldSpec) => void;
}

/**
 * An editable assumption row: a labeled number input with its source and an
 * inline, adjacent validation message. The message is a `role="alert"` region
 * associated via `aria-describedby`, and the input is `aria-invalid` when the
 * message is present — never color alone (ui-style, R9.4).
 */
function EditableRow({
  spec,
  source,
  valueHint,
  draft,
  message,
  onChange,
  onCommit,
}: EditableRowProps): React.ReactElement {
  const inputId = `bvr-assumption-${spec.field}`;
  const messageId = `${inputId}-message`;
  const hasMessage = message !== undefined;

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[1fr_auto] items-center gap-4">
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
          {spec.label}
        </label>

        <span className="flex items-center gap-2">
          <input
            id={inputId}
            name={spec.field}
            type="number"
            inputMode="decimal"
            min={spec.min ?? undefined}
            max={spec.max ?? undefined}
            step={spec.step}
            value={draft}
            onChange={(e) => onChange(spec.field, e.target.value)}
            onBlur={() => onCommit(spec)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onCommit(spec);
              }
            }}
            aria-invalid={hasMessage || undefined}
            aria-describedby={hasMessage ? messageId : undefined}
            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
          />
          <span aria-hidden="true" className="w-10 text-sm text-slate-600">
            {spec.unit}
          </span>
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-4">
        <span className="text-xs text-slate-500">{source}</span>
        {valueHint !== undefined && (
          <span className="text-xs text-slate-500 tabular-nums">{valueHint}</span>
        )}
      </div>

      {/* Inline validation adjacent to the input (R9.4). Rendered only when
          present; text + role, never color alone. */}
      {hasMessage && (
        <p
          id={messageId}
          role="alert"
          aria-live="assertive"
          className="text-sm font-medium text-red-700"
        >
          {message}
        </p>
      )}
    </div>
  );
}
