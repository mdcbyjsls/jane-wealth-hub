/*
 * VerdictCard — the plain-language bottom line of the Buy-vs-Rent comparison
 * (R7.1, R7.3–R7.6, R6.3, R6.4).
 *
 * Pure presentational component: props in, markup out. It performs NO
 * computation and NO data fetching. The `VerdictFigures`, the Breakeven_Year,
 * and the Appreciation_Tipping_Point all arrive pre-computed from the
 * `BuyVsRent_Calculator`, and every displayed value is already expressed in the
 * active Dollar_Basis by the caller (R7.6) — this card only formats and lays
 * out what it is given.
 *
 * Three plain-language statements, as the calm card-based ui-style prescribes
 * (one card answers "what's the one thing here?"):
 *   1. The headline Verdict — which path ends ahead at year 10 under the base
 *      band and the absolute dollar size of that gap, as whole-dollar United
 *      States currency with thousands separators and tabular numerals so the
 *      figure doesn't jitter (R7.1). This is the largest thing on the card.
 *   2. The breakeven statement — the year buying catches up to renting, or the
 *      plain "does not overtake within 10 years" statement (R6.3, R6.4).
 *   3. The tipping-point sentence — the one-decimal home-appreciation rate
 *      below which the other path wins, or the "does not flip" statement
 *      (R7.3, R7.4).
 *
 * All copy comes from `lib/buyVsRentMessages.ts` (plain language, percent sign,
 * no undefined jargon per R7.5); all number formatting comes from
 * `lib/format.ts`. The "tie" leader case — buying and renting end level at year
 * 10 — is handled explicitly since the centralized `verdict()` helper only
 * names a winning path.
 */

import type { VerdictFigures } from '@/types/buyVsRent';
import { formatCurrency, formatPercent } from '@/lib/format';
import {
  BREAKEVEN_ABSENT,
  TIPPING_POINT_ABSENT,
  breakevenPresent,
  tippingPointPresent,
  verdict,
} from '@/lib/buyVsRentMessages';

export interface VerdictCardProps {
  /**
   * The year-10 Verdict figures from the calculator: which path leads under the
   * base band and the absolute dollar size of the gap. `year10Difference` is
   * already expressed in the active Dollar_Basis by the caller (R7.6).
   */
  verdictFigures: VerdictFigures;
  /**
   * The Breakeven_Year (first year 1..10 at which buying catches up to renting
   * under the base band), or `null` when buying does not overtake renting
   * within the 10-year horizon (R6).
   */
  breakevenYear: number | null;
  /**
   * The Appreciation_Tipping_Point as a home-appreciation percentage (e.g. 3.2
   * for 3.2%), or `null` when the outcome does not flip across −20%..+20% (R7).
   */
  tippingPointPercent: number | null;
  /** Extra Tailwind classes merged onto the card container. */
  className?: string;
}

/**
 * The headline Verdict sentence. When the two paths end level at year 10 the
 * calculator reports a `'tie'` leader; the centralized `verdict()` helper only
 * names a winning path, so the tie is phrased here in the same plain, active
 * Dollar_Basis terms.
 */
function verdictSentence(figures: VerdictFigures): string {
  if (figures.leader === 'tie') {
    return 'Buying and renting come out about even at year 10.';
  }
  return verdict(figures.leader, formatCurrency(figures.year10Difference));
}

export default function VerdictCard({
  verdictFigures,
  breakevenYear,
  tippingPointPercent,
  className,
}: VerdictCardProps): React.ReactElement {
  const headline = verdictSentence(verdictFigures);

  const breakevenText =
    breakevenYear === null ? BREAKEVEN_ABSENT : breakevenPresent(breakevenYear);

  const tippingPointText =
    tippingPointPercent === null
      ? TIPPING_POINT_ABSENT
      : tippingPointPresent(formatPercent(tippingPointPercent));

  return (
    <section
      aria-label="Verdict"
      className={`flex flex-col gap-3 rounded-lg bg-white p-6 ${className ?? ''}`}
    >
      <h3 className="text-sm font-medium text-slate-600">Verdict</h3>

      {/*
       * The headline is the largest thing on the card (ui-style hierarchy). The
       * dollar gap inside it is rendered with tabular numerals via
       * `tabular-nums` on the container so the figure lines up and doesn't
       * jitter (R7.1, ui-style tabular-numerals rule).
       */}
      <p className="text-xl font-semibold text-slate-900 tabular-nums">
        {headline}
      </p>

      <p className="text-sm font-normal text-slate-600">{breakevenText}</p>

      <p className="text-sm font-normal text-slate-600">{tippingPointText}</p>
    </section>
  );
}
