/*
 * AllocationShiftCard — shows the Current_Allocation and the
 * Post_Purchase_Allocation side by side so the change the purchase causes is
 * visible at a glance (R3.3).
 *
 * Pure presentational component: props in, markup out. It performs NO
 * computation and NO data fetching. The current percentages arrive from Spec
 * 1's Current_Allocation and the post-purchase percentages from the pure
 * `computeDrawdown` (`DrawdownResult.postPurchaseAllocation`), already in the
 * active Dollar_Basis (allocation is basis-independent — it's a share of the
 * portfolio — so no conversion is needed here).
 *
 * Visual style (ui-style): a calm card with one clear idea — "how buying shifts
 * your mix." Each asset class is a labeled row showing before, after, and the
 * change in percentage points. The per-class color is the single fixed mapping
 * reused from the allocation pie ({@link CLASS_COLORS}), shown only as a small
 * swatch that always sits next to the class's text label — color is a visual
 * aid only and never the sole way a class is identified (R9.6).
 *
 * Non-color change cue (R9.6 spirit): the shift for each class is carried by
 * TEXT — a signed one-decimal point figure ("+6.2 pts" / "−4.1 pts" / "no
 * change") — reinforced by a decorative ▲/▼ shape that is hidden from assistive
 * tech. Nothing about the change depends on color perception. All percentages
 * use tabular numerals so the before/after columns line up.
 */

import type { AssetClass } from '@/types/accounts';
import { formatPercent } from '@/lib/format';
import { CLASS_COLORS, CLASS_LABELS } from '@/components/charts/AllocationPie';

export interface AllocationShiftCardProps {
  /** Current_Allocation percentages (0–100) per Asset_Class, before the purchase. */
  current: Record<AssetClass, number>;
  /** Post_Purchase_Allocation percentages (0–100) per Asset_Class (R3.2). */
  postPurchase: Record<AssetClass, number>;
  /** Extra Tailwind classes merged onto the card container. */
  className?: string;
}

/** Sign of a change in percentage points, used to pick the non-color cue. */
type Sign = 'up' | 'down' | 'flat';

function classifyShift(deltaPoints: number): Sign {
  // Round to one decimal first so a sub-0.05 residual never reads as a nonzero
  // "+0.0 pts"; the displayed figure is one-decimal anyway.
  const rounded = Math.round(deltaPoints * 10) / 10;
  if (rounded > 0) {
    return 'up';
  }
  if (rounded < 0) {
    return 'down';
  }
  return 'flat';
}

/** Decorative shape reinforcing the shift direction; hidden from assistive tech. */
function shapeGlyph(sign: Sign): string {
  if (sign === 'up') {
    return '\u25B2'; // ▲
  }
  if (sign === 'down') {
    return '\u25BC'; // ▼
  }
  return '\u2014'; // — (em dash for "no change")
}

/**
 * Signed one-decimal point magnitude, e.g. "+6.2 pts" / "−4.1 pts". The sign is
 * itself a non-color direction cue. Reuses {@link formatPercent} for the
 * one-decimal number, then swaps the percent sign for the "pts" unit.
 */
function formatShiftPoints(deltaPoints: number, sign: Sign): string {
  if (sign === 'flat') {
    return 'no change';
  }
  const magnitude = formatPercent(Math.abs(deltaPoints)).replace('%', ' pts');
  const leading = sign === 'up' ? '+' : '\u2212'; // U+2212 minus
  return `${leading}${magnitude}`;
}

export default function AllocationShiftCard({
  current,
  postPurchase,
  className,
}: AllocationShiftCardProps): React.ReactElement {
  const rows = CLASS_LABELS.map(({ key, label }) => {
    const before = current[key];
    const after = postPurchase[key];
    const deltaPoints = after - before;
    const sign = classifyShift(deltaPoints);
    return {
      key,
      label,
      color: CLASS_COLORS[key],
      before,
      after,
      sign,
      shiftLabel: formatShiftPoints(deltaPoints, sign),
    };
  });

  return (
    <section
      aria-labelledby="allocation-shift-heading"
      className={`flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 ${className ?? ''}`}
    >
      <div className="flex flex-col gap-1">
        <h3
          id="allocation-shift-heading"
          className="text-base font-semibold text-slate-900"
        >
          How buying shifts your mix
        </h3>
        <p className="text-sm font-normal text-slate-500">
          Your allocation before the purchase and after the down payment is drawn
          from your assets.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Current allocation versus allocation after the purchase, with the
            change in percentage points for each asset class
          </caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-600">
              <th scope="col" className="py-2 pr-4 font-medium">
                Asset class
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Now
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                After buying
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const glyph = shapeGlyph(row.sign);
              const srChange =
                row.sign === 'flat'
                  ? `${row.label}: no change`
                  : `${row.label}: ${row.shiftLabel}`;

              return (
                <tr
                  key={row.key}
                  className="border-b border-slate-100 last:border-0"
                >
                  <th
                    scope="row"
                    className="py-2 pr-4 text-left font-medium text-slate-800"
                  >
                    <span className="inline-flex items-center gap-2">
                      {/* Swatch is the single fixed class color, always beside
                          the text label — never the sole identifier (R9.6). */}
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 shrink-0 rounded-sm"
                        style={{ backgroundColor: row.color }}
                      />
                      {row.label}
                    </span>
                  </th>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-900">
                    {formatPercent(row.before)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-900">
                    {formatPercent(row.after)}
                  </td>
                  <td className="py-2 text-right text-slate-900">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span aria-hidden="true" className="text-xs leading-none">
                        {glyph}
                      </span>
                      <span className="tabular-nums font-medium">
                        {row.shiftLabel}
                      </span>
                      <span className="sr-only">{srChange}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
