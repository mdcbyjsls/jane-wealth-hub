/*
 * BuyVsRentComparisonSummary — the year-10 Buy and Rent call-out block for the
 * Buy-vs-Rent Scenario Tester view (R4.3, R4.4, R5.5).
 *
 * For each path it renders a single card with the path's name as a text label
 * and the year-10 base-band net worth as the headline figure, then the year-10
 * outcome expressed as a pessimistic-to-optimistic RANGE rather than a single
 * point value (R5.5, ui-style: show ranges, not false precision). Every
 * net-worth value is formatted as whole-dollar United States currency with a
 * comma thousands separator, no fractional cents, and tabular numerals so the
 * two cards' figures line up (R4.4, tech/ui-style rules).
 *
 * This is a presentational component: the caller converts the computed nominal
 * ComparisonBands into the active Dollar_Basis before passing the year-10
 * figures in, so this component does no inflation adjustment and no basis math —
 * it only labels and formats already-basis-correct values (R7.6 spirit; the
 * values are "consistent with the active Dollar_Basis" because the caller made
 * them so). Props in, markup out. No data fetching, no state, no clock.
 *
 * Accessibility / ui-style:
 * - Card-based, calm hierarchy: the base year-10 figure is the largest thing on
 *   each card; the path label and the range are visibly smaller and lighter.
 * - Navy primary text (slate-900), lighter slate for secondary figures.
 * - The two paths are told apart by their TEXT labels ("Buy" / "Rent"), never by
 *   color alone (ui-style, R5.4 spirit for the call-outs).
 * - Each figure's label is programmatically tied to its value through a shared
 *   id so assistive tech reads label and amount together, and the range carries
 *   an explicit screen-reader sentence spelling out "from … to …".
 */

import { formatCurrency } from '@/lib/format';

/** The fixed path label strings, carrying the meaning without color (ui-style). */
const PATH_LABELS = {
  buy: 'Buy',
  rent: 'Rent',
} as const;

/**
 * The three year-10 band values for one path, already expressed in the active
 * Dollar_Basis by the caller. `base` is the headline figure; `pessimistic` and
 * `optimistic` bound the displayed range (R5.5).
 */
export interface Year10PathFigures {
  base: number;
  optimistic: number;
  pessimistic: number;
}

export interface BuyVsRentComparisonSummaryProps {
  /** Year-10 Buy_Path figures (base + optimistic/pessimistic bounds), active basis. */
  buy: Year10PathFigures;
  /** Year-10 Rent_Path figures (base + optimistic/pessimistic bounds), active basis. */
  rent: Year10PathFigures;
  /** Extra Tailwind classes merged onto the container. */
  className?: string;
}

/**
 * A single path's year-10 call-out card: the path label, the base headline
 * figure (largest element, R4.3), and the pessimistic→optimistic range (R5.5).
 */
function PathCallout({
  idBase,
  label,
  figures,
}: {
  idBase: string;
  label: string;
  figures: Year10PathFigures;
}): React.ReactElement {
  const baseAmount = formatCurrency(figures.base);
  const lowAmount = formatCurrency(figures.pessimistic);
  const highAmount = formatCurrency(figures.optimistic);

  // Spelled-out range sentence so a screen reader never has to infer meaning
  // from the visual "–" separator.
  const rangeSrText = `Range from ${lowAmount} to ${highAmount}`;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-5">
      <dt
        id={`${idBase}-label`}
        className="text-sm font-medium text-slate-600"
      >
        {label} at year 10
      </dt>

      {/* Headline base figure — the largest thing on the card (ui-style). */}
      <dd
        aria-labelledby={`${idBase}-label`}
        className="text-3xl font-bold text-slate-900 tabular-nums"
      >
        {baseAmount}
      </dd>

      {/* Pessimistic → optimistic range, smaller and lighter (R5.5, ui-style). */}
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Range
        </span>
        <span className="sr-only">{rangeSrText}</span>
        <span
          aria-hidden="true"
          className="text-sm font-normal text-slate-600 tabular-nums"
        >
          {lowAmount} <span className="text-slate-400">–</span> {highAmount}
        </span>
      </div>
    </div>
  );
}

/**
 * Renders the two year-10 call-out cards (Buy and Rent) side by side, each a
 * labeled base figure with a pessimistic-to-optimistic range.
 */
export default function BuyVsRentComparisonSummary({
  buy,
  rent,
  className,
}: BuyVsRentComparisonSummaryProps): React.ReactElement {
  return (
    <section
      aria-label="Year 10 net worth for each path"
      className={className}
    >
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PathCallout idBase="bvr-year10-buy" label={PATH_LABELS.buy} figures={buy} />
        <PathCallout
          idBase="bvr-year10-rent"
          label={PATH_LABELS.rent}
          figures={rent}
        />
      </dl>
    </section>
  );
}
