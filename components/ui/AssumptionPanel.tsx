'use client';

/*
 * AssumptionPanel — the Assumption_Panel portion of the Projection_View.
 *
 * Lists every editable assumption behind the projection with its current value,
 * a plain-language label, and a source, honoring the product principle that no
 * number the user did not choose is ever hidden (R3.1). The listed assumptions
 * are: the four class Expected_Return values (stocks, bonds, cash, other), the
 * Equity_Risk_Premium, the Inflation_Rate, the Optimistic_ and Pessimistic_
 * Multiplier, and the Annual_Contribution.
 *
 * Controlled panel. The parent island (ProjectionClient) owns the COMMITTED
 * assumption state and the recompute; this panel owns only its local input
 * strings and per-field validation messages. The split mirrors Spec 1's
 * TargetEditor:
 *
 *   - Each input is a controlled native <input> seeded from the committed value.
 *   - On commit (blur / Enter), the raw string is parsed and range-checked for
 *     that assumption. On a VALID edit the parsed number is handed to `onCommit`
 *     so the parent recomputes (R3.3); on an INVALID edit the panel shows an
 *     inline message adjacent to the offending input, does NOT call `onCommit`
 *     (so the parent keeps the last valid projection), and reverts the input to
 *     the previously accepted committed value as the active assumption
 *     (R3.4, R3.5, R4.6, R6.5).
 *   - A reset control calls `onReset`; the parent restores every assumption to
 *     its market-derived or documented default and this panel clears all inline
 *     messages (R3.6).
 *
 * Sources (R2.4, R2.5, R3.2): market-derived returns (bonds=DGS10, cash=DTB3)
 * and the Inflation_Rate (CPIAUCSL) show their Market_Series source label plus
 * the value's "as of" calendar date; the stocks return shows the "bond anchor +
 * equity risk premium" reasoning. The other-class return and the multipliers
 * show a documented-default source label. Source/reasoning copy comes from
 * `@/lib/projectionMessages`; money and percentages are formatted via
 * `lib/format.ts`.
 *
 * Accessibility (ui-style, R11.4):
 *   - Every input is a native, keyboard-reachable control in a fixed tab order
 *     with an always-on focus ring.
 *   - Validation never relies on color alone: each message is text in a
 *     `role="alert"` region associated with its input via `aria-describedby`,
 *     and the input is marked `aria-invalid`.
 *   - Money and percentage inputs/values use `tabular-nums` so figures line up.
 *
 * This is a presentational client island: no fetching, no localStorage.
 */

import { useEffect, useRef, useState } from 'react';
import type {
  ReturnModel,
  ScenarioMultipliers,
} from '@/types/market';
import { formatCurrency, formatPercent } from '@/lib/format';
import {
  ASSUMPTION_VALIDATION,
  contributionAboveMax,
  defaultSourceLabel,
  multiplierOutOfRange,
  sourceLabel,
  STOCKS_REASONING,
} from '@/lib/projectionMessages';

// ---------------------------------------------------------------------------
// Documented ranges (R2.2, R2.3, R4.5, R6.1)
// ---------------------------------------------------------------------------

/** Equity_Risk_Premium: 0–15 percentage points inclusive (R2.2). */
const ERP_MIN = 0;
const ERP_MAX = 15;

/** Other-class return and the Inflation_Rate share the 0–20 percent/yr range (R2.3). */
const RETURN_MIN = 0;
const RETURN_MAX = 20;

/** Optimistic_Multiplier: 1.0–3.0 inclusive (R4.5). */
const OPTIMISTIC_MIN = 1.0;
const OPTIMISTIC_MAX = 3.0;

/** Pessimistic_Multiplier: 0.0–1.0 inclusive (R4.5). */
const PESSIMISTIC_MIN = 0.0;
const PESSIMISTIC_MAX = 1.0;

/** Annual_Contribution: $0–$10,000,000 inclusive (R6.1). */
const CONTRIBUTION_MIN = 0;
const CONTRIBUTION_MAX = 10_000_000;

// ---------------------------------------------------------------------------
// Field identity and committed values
// ---------------------------------------------------------------------------

/**
 * The editable assumptions the parent commits. Class returns are not committed
 * directly: stocks/bonds/cash are derived from the market anchors + the
 * Equity_Risk_Premium, and only `equityRiskPremium`, `otherReturn`, the two
 * multipliers, the inflation rate, and the contribution are user-editable
 * numbers. The read-only derived class returns (and their sources) are shown
 * from the `returnModel` prop.
 */
export type EditableField =
  | 'equityRiskPremium'
  | 'otherReturn'
  | 'inflationRate'
  | 'optimisticMultiplier'
  | 'pessimisticMultiplier'
  | 'annualContribution';

/** The current committed numeric values owned by the parent. */
export interface AssumptionValues {
  /** Equity_Risk_Premium in percentage points (default 4.0; range 0–15). */
  equityRiskPremium: number;
  /** Other-class Expected_Return, percent/yr (default 4.0; range 0–20). */
  otherReturn: number;
  /** Inflation_Rate, percent/yr, drives today's-dollars (range 0–20). */
  inflationRate: number;
  /** Scenario multipliers (optimistic 1.0–3.0, pessimistic 0.0–1.0). */
  multipliers: ScenarioMultipliers;
  /** Annual_Contribution in dollars (default 0; range 0–10,000,000). */
  annualContribution: number;
}

interface AssumptionPanelProps {
  /** The committed assumption values (parent-owned). */
  values: AssumptionValues;
  /**
   * The derived Return_Model, for displaying each class's Expected_Return and
   * its source/reasoning (R2.4, R2.5, R3.2). Bonds/cash sources name their
   * Market_Series and as-of date; stocks shows the equity-risk-premium reasoning.
   */
  returnModel: ReturnModel;
  /**
   * The CPIAUCSL "as of" date for the Inflation_Rate source label (R3.2),
   * pre-formatted as a calendar date (e.g. "Oct 14, 2026").
   */
  inflationAsOf: string;
  /**
   * Commit a single valid, in-range edit. The parent updates its committed
   * state and recomputes the projection (R3.3). Never called for invalid input.
   */
  onCommit: (field: EditableField, value: number) => void;
  /** Reset every assumption to its default; the panel clears all messages (R3.6). */
  onReset: () => void;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** A parsed-and-range-checked edit: either a committed number or a message. */
type FieldValidation =
  | { ok: true; value: number }
  | { ok: false; message: string };

/**
 * Parse a raw input string for `field` and range-check it. A non-finite entry
 * always fails with `mustBeFiniteNumber` (R3.4). Otherwise each field enforces
 * its documented range, with field-specific copy for the contribution (R3.5,
 * R6.5) and the multipliers (R4.6).
 */
function validateField(field: EditableField, raw: string): FieldValidation {
  // `Number('')` is 0, which would silently accept a blank; treat blank as
  // non-finite so clearing an input surfaces the finite-number message (R3.4).
  const parsed = raw.trim() === '' ? Number.NaN : Number(raw);

  if (!Number.isFinite(parsed)) {
    return { ok: false, message: ASSUMPTION_VALIDATION.mustBeFiniteNumber };
  }

  switch (field) {
    case 'equityRiskPremium':
      if (parsed < ERP_MIN || parsed > ERP_MAX) {
        return { ok: false, message: multiplierOutOfRange(ERP_MIN, ERP_MAX) };
      }
      return { ok: true, value: parsed };

    case 'otherReturn':
    case 'inflationRate':
      if (parsed < RETURN_MIN || parsed > RETURN_MAX) {
        return { ok: false, message: multiplierOutOfRange(RETURN_MIN, RETURN_MAX) };
      }
      return { ok: true, value: parsed };

    case 'optimisticMultiplier':
      if (parsed < OPTIMISTIC_MIN || parsed > OPTIMISTIC_MAX) {
        return {
          ok: false,
          message: multiplierOutOfRange(OPTIMISTIC_MIN, OPTIMISTIC_MAX),
        };
      }
      return { ok: true, value: parsed };

    case 'pessimisticMultiplier':
      if (parsed < PESSIMISTIC_MIN || parsed > PESSIMISTIC_MAX) {
        return {
          ok: false,
          message: multiplierOutOfRange(PESSIMISTIC_MIN, PESSIMISTIC_MAX),
        };
      }
      return { ok: true, value: parsed };

    case 'annualContribution':
      if (parsed < CONTRIBUTION_MIN) {
        return { ok: false, message: ASSUMPTION_VALIDATION.contributionBelowZero };
      }
      if (parsed > CONTRIBUTION_MAX) {
        return {
          ok: false,
          message: contributionAboveMax(formatCurrency(CONTRIBUTION_MAX)),
        };
      }
      return { ok: true, value: parsed };

    default: {
      // Exhaustiveness guard: a new EditableField must be handled above.
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

/** The committed numeric value for a field, used to seed and to revert inputs. */
function committedValue(field: EditableField, values: AssumptionValues): number {
  switch (field) {
    case 'equityRiskPremium':
      return values.equityRiskPremium;
    case 'otherReturn':
      return values.otherReturn;
    case 'inflationRate':
      return values.inflationRate;
    case 'optimisticMultiplier':
      return values.multipliers.optimistic;
    case 'pessimisticMultiplier':
      return values.multipliers.pessimistic;
    case 'annualContribution':
      return values.annualContribution;
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Per-field local state: the raw input string and any inline message. */
type DraftState = Record<EditableField, string>;
type MessageState = Partial<Record<EditableField, string>>;

const EDITABLE_FIELDS: readonly EditableField[] = [
  'equityRiskPremium',
  'otherReturn',
  'inflationRate',
  'optimisticMultiplier',
  'pessimisticMultiplier',
  'annualContribution',
];

/** Build the initial draft strings from the committed values. */
function toDrafts(values: AssumptionValues): DraftState {
  return {
    equityRiskPremium: String(values.equityRiskPremium),
    otherReturn: String(values.otherReturn),
    inflationRate: String(values.inflationRate),
    optimisticMultiplier: String(values.multipliers.optimistic),
    pessimisticMultiplier: String(values.multipliers.pessimistic),
    annualContribution: String(values.annualContribution),
  };
}

export default function AssumptionPanel({
  values,
  returnModel,
  inflationAsOf,
  onCommit,
  onReset,
}: AssumptionPanelProps): React.ReactElement {
  const [drafts, setDrafts] = useState<DraftState>(() => toDrafts(values));
  const [messages, setMessages] = useState<MessageState>({});

  // Keep the drafts in sync when the parent changes a committed value from the
  // outside (a reset, or a derived class return shifting after an ERP edit).
  // We compare against the committed values this effect last applied, so a
  // field the user is actively (invalidly) editing is never stomped: only
  // fields whose committed value actually moved — and that have no pending
  // inline message — are reseeded to the new accepted value (R3.6).
  const lastSynced = useRef<AssumptionValues>(values);
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
   * Commit an edit on blur: validate, and either hand the parent the new value
   * (clearing any message) or keep the last valid projection while showing the
   * inline message and reverting the input to the committed value.
   */
  function handleCommit(field: EditableField): void {
    const result = validateField(field, drafts[field]);
    if (result.ok) {
      setMessages((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      // Normalize the draft to the accepted numeric value so, e.g., "4.00"
      // settles to "4" and matches what the parent now holds.
      setDrafts((prev) => ({ ...prev, [field]: String(result.value) }));
      onCommit(field, result.value);
      return;
    }
    // Invalid: show the message, retain the previously accepted value as the
    // active assumption, and leave the parent's projection untouched.
    setMessages((prev) => ({ ...prev, [field]: result.message }));
    setDrafts((prev) => ({
      ...prev,
      [field]: String(committedValue(field, values)),
    }));
  }

  function handleReset(): void {
    // Clear every inline message (R3.6) and ask the parent to restore defaults.
    // The sync effect reseeds the drafts once the parent pushes the restored
    // values, so a field that had been showing an invalid draft returns to its
    // default rather than keeping the rejected entry.
    setMessages({});
    setDrafts(toDrafts(values));
    onReset();
  }

  return (
    <section aria-label="Projection assumptions" className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-slate-900">Assumptions</h3>
          <p className="text-sm text-slate-600">
            Every number here is editable. Change any value to see how it moves
            the projection.
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

      {/* Expected returns per class (R3.1): bonds/cash derived from market
          anchors, stocks from the bond anchor + ERP, other a default. */}
      <div className="flex flex-col gap-4">
        <h4 className="text-sm font-semibold text-slate-900">
          Expected returns
        </h4>

        {/* Stocks — derived, read-only, with the bond-anchor + ERP reasoning. */}
        <DerivedReturnRow
          label={returnModel.stocks.label}
          valueLabel={formatPercent(returnModel.stocks.returnPercent)}
          source={returnModel.stocks.source}
          reasoning={STOCKS_REASONING}
        />

        {/* Bonds — market-anchored (DGS10), read-only. */}
        <DerivedReturnRow
          label={returnModel.bonds.label}
          valueLabel={formatPercent(returnModel.bonds.returnPercent)}
          source={returnModel.bonds.source}
        />

        {/* Cash — market-anchored (DTB3), read-only. */}
        <DerivedReturnRow
          label={returnModel.cash.label}
          valueLabel={formatPercent(returnModel.cash.returnPercent)}
          source={returnModel.cash.source}
        />

        {/* Other — editable default return (R2.3). */}
        <EditableRow
          field="otherReturn"
          label="Other"
          unit="%"
          source={defaultSourceLabel()}
          draft={drafts.otherReturn}
          message={messages.otherReturn}
          min={RETURN_MIN}
          max={RETURN_MAX}
          step={0.1}
          onChange={handleChange}
          onCommit={handleCommit}
        />

        {/* Equity risk premium — editable, feeds the stocks return (R2.2). */}
        <EditableRow
          field="equityRiskPremium"
          label="Equity risk premium"
          unit="pts"
          source={defaultSourceLabel()}
          draft={drafts.equityRiskPremium}
          message={messages.equityRiskPremium}
          min={ERP_MIN}
          max={ERP_MAX}
          step={0.1}
          onChange={handleChange}
          onCommit={handleCommit}
        />
      </div>

      {/* Scenario multipliers (R4.5). */}
      <div className="flex flex-col gap-4">
        <h4 className="text-sm font-semibold text-slate-900">
          Scenario range
        </h4>
        <p className="text-sm text-slate-600">
          Each multiplier scales the base expected return to form the optimistic
          and pessimistic ends of the range.
        </p>

        <EditableRow
          field="optimisticMultiplier"
          label="Optimistic multiplier"
          unit="×"
          source={defaultSourceLabel()}
          draft={drafts.optimisticMultiplier}
          message={messages.optimisticMultiplier}
          min={OPTIMISTIC_MIN}
          max={OPTIMISTIC_MAX}
          step={0.1}
          onChange={handleChange}
          onCommit={handleCommit}
        />

        <EditableRow
          field="pessimisticMultiplier"
          label="Pessimistic multiplier"
          unit="×"
          source={defaultSourceLabel()}
          draft={drafts.pessimisticMultiplier}
          message={messages.pessimisticMultiplier}
          min={PESSIMISTIC_MIN}
          max={PESSIMISTIC_MAX}
          step={0.1}
          onChange={handleChange}
          onCommit={handleCommit}
        />
      </div>

      {/* Inflation + contribution (R3.1, R5.6, R6.1). */}
      <div className="flex flex-col gap-4">
        <h4 className="text-sm font-semibold text-slate-900">
          Inflation and contributions
        </h4>

        {/* Inflation rate — CPIAUCSL-derived default, editable (R3.2, R5.6). */}
        <EditableRow
          field="inflationRate"
          label="Inflation rate"
          unit="%"
          source={sourceLabel('CPI (general inflation)', inflationAsOf)}
          draft={drafts.inflationRate}
          message={messages.inflationRate}
          min={RETURN_MIN}
          max={RETURN_MAX}
          step={0.1}
          onChange={handleChange}
          onCommit={handleCommit}
        />

        {/* Annual contribution — editable dollar amount (R6.1, R6.4). */}
        <EditableRow
          field="annualContribution"
          label="Annual contribution"
          unit="$/yr"
          valueHint={formatCurrency(values.annualContribution)}
          source={defaultSourceLabel()}
          draft={drafts.annualContribution}
          message={messages.annualContribution}
          min={CONTRIBUTION_MIN}
          max={CONTRIBUTION_MAX}
          step={1000}
          onChange={handleChange}
          onCommit={handleCommit}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface DerivedReturnRowProps {
  label: string;
  valueLabel: string;
  source: string;
  /** Optional plain-language reasoning (stocks: bond anchor + ERP, R2.5). */
  reasoning?: string;
}

/**
 * A read-only Expected_Return row for a class whose value is derived (bonds and
 * cash from market anchors, stocks from the bond anchor + ERP). Shows the value,
 * its source, and — for stocks — the plain-language reasoning (R2.4, R2.5, R3.2).
 */
function DerivedReturnRow({
  label,
  valueLabel,
  source,
  reasoning,
}: DerivedReturnRowProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-base font-semibold text-slate-900 tabular-nums">
          {valueLabel}
        </span>
      </div>
      <span className="text-xs text-slate-500">{source}</span>
      {reasoning !== undefined && (
        <span className="text-xs text-slate-500">{reasoning}</span>
      )}
    </div>
  );
}

interface EditableRowProps {
  field: EditableField;
  label: string;
  /** Short unit affix shown after the input (e.g. "%", "pts", "×", "$/yr"). */
  unit: string;
  /** The source / default label shown beneath the input (R2.4, R3.2). */
  source: string;
  /** Optional pre-formatted hint (e.g. the contribution as formatted currency). */
  valueHint?: string;
  draft: string;
  /** Inline validation message for this field, if any (R3.4, R3.5, R4.6, R6.5). */
  message?: string;
  min: number;
  max: number;
  step: number;
  onChange: (field: EditableField, raw: string) => void;
  onCommit: (field: EditableField) => void;
}

/**
 * An editable assumption row: a labeled number input with its source and an
 * inline, adjacent validation message. The message is a `role="alert"` region
 * associated via `aria-describedby`, and the input is `aria-invalid` when the
 * message is present — never color alone (ui-style, R3.4, R3.5, R4.6, R6.5).
 */
function EditableRow({
  field,
  label,
  unit,
  source,
  valueHint,
  draft,
  message,
  min,
  max,
  step,
  onChange,
  onCommit,
}: EditableRowProps): React.ReactElement {
  const inputId = `assumption-${field}`;
  const messageId = `${inputId}-message`;
  const hasMessage = message !== undefined;

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[1fr_auto] items-center gap-4">
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
          {label}
        </label>

        <span className="flex items-center gap-2">
          <input
            id={inputId}
            name={field}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={draft}
            onChange={(e) => onChange(field, e.target.value)}
            onBlur={() => onCommit(field)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onCommit(field);
              }
            }}
            aria-invalid={hasMessage || undefined}
            aria-describedby={hasMessage ? messageId : undefined}
            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
          />
          <span aria-hidden="true" className="w-10 text-sm text-slate-600">
            {unit}
          </span>
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-4">
        <span className="text-xs text-slate-500">{source}</span>
        {valueHint !== undefined && (
          <span className="text-xs text-slate-500 tabular-nums">{valueHint}</span>
        )}
      </div>

      {/* Inline validation adjacent to the input (R3.4, R3.5, R4.6, R6.5).
          Rendered only when present; text + role, never color alone. */}
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
