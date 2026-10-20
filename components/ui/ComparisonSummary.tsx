/*
 * ComparisonSummary — the signed current-vs-target comparison block for the
 * Long-Term Wealth Projection view (R7.5, R7.6).
 *
 * For each of the three horizons (year 10, 20, 30) it renders the difference
 *   target base projected value − current base projected value
 * in the active Dollar_Basis, formatted as whole-dollar United States currency
 * with thousands separators and no fractional cents, using tabular numerals so
 * the figures line up in a column (R7.5, tech/ui-style rules).
 *
 * The caller converts both series into the active Dollar_Basis before passing
 * them in, so this component does no inflation adjustment — it only differences
 * and formats already-basis-correct values.
 *
 * Accessibility (R7.5, ui-style "never rely on color alone"): the sign of each
 * difference is conveyed through TEXT — an explicit "+"/"−" in the amount plus a
 * trailing "higher"/"lower"/"no change" word — and reinforced with a decorative
 * ▲/▼ shape. The shape glyph is `aria-hidden`; its meaning is carried by the
 * adjacent words. Color, if any, is only secondary reinforcement.
 *
 * When the target is the Spec 1 example default rather than a user choice
 * (`isExample`), both the comparison heading and each difference figure are
 * labeled "based on an example target" (R7.6), using the centralized copy from
 * `lib/projectionMessages`.
 *
 * Pure and presentational: props in, markup out. No data fetching, no state.
 */

import type { ProjectedPoint, ScenarioSeries } from '@/types/market';
import { formatCurrency } from '@/lib/format';
import { PROJECTION_MESSAGES } from '@/lib/projectionMessages';

/** The horizons the comparison reports, as year offsets from the current year. */
const HORIZON_OFFSETS = [10, 20, 30] as const;

export interface ComparisonSummaryProps {
  /**
   * Current-allocation scenario series, already expressed in the active
   * Dollar_Basis by the caller.
   */
  current: ScenarioSeries;
  /**
   * Target-allocation scenario series, already expressed in the active
   * Dollar_Basis by the caller.
   */
  target: ScenarioSeries;
  /**
   * True when the Target_Allocation is the Spec 1 example default (no
   * user-configured target). Triggers the "based on an example target" labeling
   * on both the range heading and the difference figures (R7.6).
   */
  isExample: boolean;
  /** Extra Tailwind classes merged onto the container. */
  className?: string;
}

/**
 * The base projected value at a given year offset from the current year.
 *
 * `ProjectedPoint.year` is a calendar year with offset 0 = currentYear, so the
 * point for a horizon is the one whose year equals `firstYear + offset`. Returns
 * `null` when the series does not reach that horizon.
 */
function baseValueAtOffset(base: ProjectedPoint[], offset: number): number | null {
  const first = base[0];
  if (first === undefined) {
    return null;
  }
  const targetYear = first.year + offset;
  const point = base.find((p) => p.year === targetYear);
  return point === undefined ? null : point.value;
}

/** A sign classification used to pick the text/shape cue for a difference. */
type Sign = 'positive' | 'negative' | 'zero';

function classify(difference: number): Sign {
  // Round to whole dollars first so a sub-dollar residual never reads as a
  // nonzero "+$0" / "−$0"; the displayed figure is whole-dollar anyway.
  const whole = Math.round(difference);
  if (whole > 0) {
    return 'positive';
  }
  if (whole < 0) {
    return 'negative';
  }
  return 'zero';
}

/**
 * The signed, whole-dollar amount string with an explicit leading sign, e.g.
 * "+$42,000", "−$12,500", or "$0". `formatCurrency` already emits a leading
 * minus for negatives, so we only add a "+" for positive amounts and normalize
 * the minus to a true minus sign (U+2212) for cleaner typography.
 */
function formatSignedAmount(difference: number, sign: Sign): string {
  if (sign === 'positive') {
    return `+${formatCurrency(difference)}`;
  }
  if (sign === 'negative') {
    // formatCurrency renders e.g. "-$12,500"; swap the hyphen-minus for −.
    return formatCurrency(difference).replace('-', '\u2212');
  }
  return formatCurrency(0);
}

/** Decorative shape glyph reinforcing the sign; hidden from assistive tech. */
function shapeGlyph(sign: Sign): string {
  if (sign === 'positive') {
    return '\u25B2'; // ▲
  }
  if (sign === 'negative') {
    return '\u25BC'; // ▼
  }
  return '\u2014'; // — (em dash for "no change")
}

/** Plain-language direction word carrying the sign's meaning for all users. */
function directionWord(sign: Sign): string {
  if (sign === 'positive') {
    return 'higher';
  }
  if (sign === 'negative') {
    return 'lower';
  }
  return 'no change';
}

interface HorizonRow {
  offset: number;
  label: string;
  difference: number | null;
}

function buildRows(current: ScenarioSeries, target: ScenarioSeries): HorizonRow[] {
  return HORIZON_OFFSETS.map((offset) => {
    const targetValue = baseValueAtOffset(target.base, offset);
    const currentValue = baseValueAtOffset(current.base, offset);
    const difference =
      targetValue === null || currentValue === null
        ? null
        : targetValue - currentValue;
    return { offset, label: `Year ${offset}`, difference };
  });
}

export default function ComparisonSummary({
  current,
  target,
  isExample,
  className,
}: ComparisonSummaryProps): React.ReactElement {
  const rows = buildRows(current, target);

  // R7.6 — when the target is the example default, qualify the heading and each
  // figure with the centralized "based on an example target" copy.
  const exampleNote = isExample ? PROJECTION_MESSAGES.exampleTarget : null;
  const headingText = isExample
    ? `Target vs current (${exampleNote})`
    : 'Target vs current';

  return (
    <section
      aria-label="Target versus current projection comparison"
      className={`flex flex-col gap-3 ${className ?? ''}`}
    >
      <h3 className="text-sm font-semibold text-slate-900">{headingText}</h3>

      <dl className="flex flex-col gap-2">
        {rows.map((row) => {
          if (row.difference === null) {
            return (
              <div
                key={row.offset}
                className="flex items-baseline justify-between gap-4"
              >
                <dt className="text-sm font-medium text-slate-600">
                  {row.label}
                </dt>
                <dd className="text-sm font-normal text-slate-500">
                  Not available
                </dd>
              </div>
            );
          }

          const sign = classify(row.difference);
          const amount = formatSignedAmount(row.difference, sign);
          const glyph = shapeGlyph(sign);
          const direction = directionWord(sign);

          // The accessible description spells out the sign in words so a screen
          // reader never depends on the decorative ▲/▼ glyph or on color.
          const srDescription =
            sign === 'zero'
              ? `${row.label}: no change`
              : `${row.label}: target is ${amount} ${direction}`;

          return (
            <div
              key={row.offset}
              className="flex items-baseline justify-between gap-4"
            >
              <dt className="text-sm font-medium text-slate-600">{row.label}</dt>
              <dd className="flex items-baseline gap-2 text-right">
                <span className="sr-only">{srDescription}</span>
                <span aria-hidden="true" className="text-sm text-slate-500">
                  {glyph}
                </span>
                <span
                  aria-hidden="true"
                  className="text-base font-semibold text-slate-900 tabular-nums"
                >
                  {amount}
                </span>
                <span aria-hidden="true" className="text-sm text-slate-600">
                  {direction}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>

      {exampleNote !== null && (
        <p className="text-xs font-normal text-slate-500">
          These differences are {exampleNote}.
        </p>
      )}
    </section>
  );
}
