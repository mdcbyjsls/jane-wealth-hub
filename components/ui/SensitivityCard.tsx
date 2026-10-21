/*
 * SensitivityCard — the "which assumptions matter most" card of the
 * Buy-vs-Rent comparison (R8.3).
 *
 * Pure presentational component: props in, markup out. It performs NO
 * computation and NO data fetching. The `SensitivityEntry[]` arrives already
 * ranked from the `BuyVsRent_Calculator` (largest effect on the year-10
 * difference first, with a deterministic tie-break, R8.1–R8.5); this card only
 * takes the top one or two and names each by its labeled name in plain
 * language.
 *
 * Per the spec, only the top one or two entries are shown (R8.3) — the calm,
 * uncluttered card-based ui-style over a dense ranking wall. Each entry is
 * identified by its human-readable `label` (never its internal `key`). The
 * magnitude figures behind the ranking are intentionally not surfaced here: the
 * card answers the single plain-language question "which numbers move the
 * result most?" rather than restating the calculator's internal deltas.
 *
 * Defensive on length only: the ranking is expected to be non-empty, but when
 * it is empty the card shows a plain "nothing stands out" line rather than an
 * empty list, so the view never renders a bare heading.
 */

import type { SensitivityEntry } from '@/types/buyVsRent';

export interface SensitivityCardProps {
  /**
   * The Sensitivity_Ranking from the calculator, already ordered largest effect
   * first. Only the top one or two entries are displayed (R8.3).
   */
  ranking: SensitivityEntry[];
  /** Extra Tailwind classes merged onto the card container. */
  className?: string;
}

/** The maximum number of ranked assumptions this card surfaces (R8.3). */
const MAX_REPORTED = 2;

export default function SensitivityCard({
  ranking,
  className,
}: SensitivityCardProps): React.ReactElement {
  const top = ranking.slice(0, MAX_REPORTED);

  return (
    <section
      aria-label="What matters most"
      className={`flex flex-col gap-3 rounded-lg bg-white p-6 ${className ?? ''}`}
    >
      <h3 className="text-sm font-medium text-slate-600">What matters most</h3>

      {top.length === 0 ? (
        <p className="text-sm font-normal text-slate-600">
          No single assumption stands out as the biggest driver.
        </p>
      ) : (
        <>
          <p className="text-base font-normal text-slate-700">
            These assumptions change the outcome the most:
          </p>
          <ul className="flex flex-col gap-1">
            {top.map((entry) => (
              <li
                key={entry.key}
                className="text-lg font-semibold text-slate-900"
              >
                {entry.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
