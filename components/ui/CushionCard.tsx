/*
 * CushionCard — shows the Cash_Cushion left after the purchase against the
 * Cushion_Threshold, with a non-color status cue (R3.5), and swaps in a
 * plain-language over-budget message when the purchase costs more than the
 * user's available assets (R3.6).
 *
 * Pure presentational component: props in, markup out. No computation, no data
 * fetching. The cushion and the over-budget flag come from the pure
 * `computeDrawdown` (`DrawdownResult.cashCushion` / `.overBudget`); the
 * threshold is `cushionMonths × first-year Ownership_Cost_Monthly`, computed by
 * `computeComparison`. Both dollar figures arrive already in the active
 * Dollar_Basis, so this card only formats and compares.
 *
 * Over-budget (R3.6): when `overBudget` is true, the Down_Payment plus
 * Closing_Costs exceed the Starting_Assets total, so a cushion figure would be
 * negative and meaningless. In that case the card shows the centralized
 * over-budget message ({@link BUY_VS_RENT_MESSAGES.overBudgetPurchase}) in
 * place of any cushion number — it never renders a negative balance as if it
 * were valid.
 *
 * Status cue (R3.5, ui-style): whether the cushion is at or above the threshold
 * is carried by TEXT (a word — "Healthy cushion" / "Below your target") and a
 * SHAPE (a ✓ check / ▲ up-triangle), reinforced by the reserved status colors
 * (green = on track, amber = below). Color is only reinforcement and always
 * travels with the icon and the words, so the status reads without color
 * perception (R9.6). Dollar figures use tabular numerals.
 */

import { formatCurrency } from '@/lib/format';
import { BUY_VS_RENT_MESSAGES } from '@/lib/buyVsRentMessages';

export interface CushionCardProps {
  /** Cash_Cushion remaining after the drawdown (R3.4), active Dollar_Basis. */
  cashCushion: number;
  /** Cushion_Threshold = cushionMonths × first-year Ownership_Cost_Monthly (R3.5). */
  cushionThreshold: number;
  /** True when Down_Payment + Closing_Costs exceed Starting_Assets (R3.6). */
  overBudget: boolean;
  /** Extra Tailwind classes merged onto the card container. */
  className?: string;
}

export default function CushionCard({
  cashCushion,
  cushionThreshold,
  overBudget,
  className,
}: CushionCardProps): React.ReactElement {
  const cardClasses = `flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 ${className ?? ''}`;

  // R3.6 — purchase exceeds available assets: show the plain-language message
  // in place of any (negative) cushion figure; never render a negative balance.
  if (overBudget) {
    return (
      <section aria-labelledby="cushion-heading" className={cardClasses}>
        <h3
          id="cushion-heading"
          className="text-base font-semibold text-slate-900"
        >
          Cash cushion
        </h3>
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900"
        >
          <span aria-hidden="true" className="text-sm leading-5">
            {'\u25B2'}
          </span>
          <p className="text-sm font-medium">
            {BUY_VS_RENT_MESSAGES.overBudgetPurchase}
          </p>
        </div>
      </section>
    );
  }

  const isHealthy = cashCushion >= cushionThreshold;

  // Reserved status colors (ui-style): green = on track, amber = below target.
  // Always paired with the icon + word below, so meaning never rests on color.
  const statusTone = isHealthy
    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
    : 'border-amber-300 bg-amber-50 text-amber-900';
  const statusGlyph = isHealthy ? '\u2713' : '\u25B2'; // ✓ check / ▲ up-triangle
  const statusWord = isHealthy ? 'Healthy cushion' : 'Below your target';
  const statusDetail = isHealthy
    ? 'Your remaining cash covers your target months of ownership costs.'
    : 'Your remaining cash is below your target months of ownership costs.';

  return (
    <section aria-labelledby="cushion-heading" className={cardClasses}>
      <h3
        id="cushion-heading"
        className="text-base font-semibold text-slate-900"
      >
        Cash cushion
      </h3>

      {/* Headline figure: the largest thing on the card (ui-style hierarchy). */}
      <div className="flex flex-col gap-1">
        <span className="text-3xl font-semibold text-slate-900 tabular-nums">
          {formatCurrency(cashCushion)}
        </span>
        <span className="text-sm font-normal text-slate-500 tabular-nums">
          Target cushion {formatCurrency(cushionThreshold)}
        </span>
      </div>

      {/* Non-color status cue (R3.5): shape + word + detail, color as backup. */}
      <div
        role="status"
        className={`flex items-start gap-2 rounded-md border px-3 py-2 ${statusTone}`}
      >
        <span aria-hidden="true" className="text-sm leading-5">
          {statusGlyph}
        </span>
        <div className="flex flex-col">
          <p className="text-sm font-semibold">{statusWord}</p>
          <p className="text-sm font-normal">{statusDetail}</p>
        </div>
      </div>
    </section>
  );
}
