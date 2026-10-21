/*
 * SourceMixSummary — the Source_Mix_Summary shown on the Net_Worth_Card (R1.4).
 *
 * For each Source present among the current accounts, it reports how many accounts
 * carry that Source and that Source's share of total assets as a percentage. The
 * summary makes it obvious, at a glance, how much of the picture is sample data,
 * how much the user entered by hand, and how much a bank reported.
 *
 * Pure presentational component: props in, markup out. No data fetching, no state.
 * It takes the ALREADY-computed `SourceMixSummary` (from `computeSourceMix`) so the
 * component stays pure and the share math lives in `lib/calculations/sourceMix.ts`.
 *
 * Accessibility & style:
 *  - Each row names its Source in TEXT via {@link SourceBadge}; the percentage and
 *    count are never conveyed by color alone (R9.6).
 *  - Percentages use `tabular-nums` and one decimal so figures line up in a column
 *    and don't jitter, per the ui-style steering.
 *  - Calm, label-light layout suited to sitting quietly on the Net_Worth_Card.
 *  - The count is pluralized ("1 account" / "3 accounts") so the row reads as plain
 *    language rather than a bare figure.
 */

import type { SourceMixSummary as SourceMixSummaryData } from '@/types/accounts';
import { formatPercent } from '@/lib/format';
import SourceBadge from '@/components/ui/SourceBadge';

export interface SourceMixSummaryProps {
  /** Already-computed Source_Mix_Summary (one entry per Source present; R1.4). */
  sourceMix: SourceMixSummaryData;
  /** Extra Tailwind classes merged onto the summary container. */
  className?: string;
}

/** Plain-language account count, e.g. "1 account" / "3 accounts". */
function formatAccountCount(count: number): string {
  return `${count} ${count === 1 ? 'account' : 'accounts'}`;
}

export default function SourceMixSummary({
  sourceMix,
  className,
}: SourceMixSummaryProps): React.ReactElement | null {
  // Nothing to show when there are no accounts — render nothing rather than an
  // empty shell on the card.
  if (sourceMix.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Account sources"
      className={`flex flex-col gap-2 ${className ?? ''}`}
    >
      <h3 className="text-sm font-medium text-slate-600">Where this comes from</h3>
      <dl className="flex flex-col gap-1.5">
        {sourceMix.map((entry) => (
          <div
            key={entry.source}
            className="flex items-center justify-between gap-3"
          >
            <dt className="flex items-center gap-2">
              <SourceBadge source={entry.source} />
              <span className="text-sm text-slate-500 tabular-nums">
                {formatAccountCount(entry.count)}
              </span>
            </dt>
            <dd className="text-sm font-medium text-slate-800 tabular-nums">
              {formatPercent(entry.assetSharePct)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
