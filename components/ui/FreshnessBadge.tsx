/*
 * FreshnessBadge — per-institution data-freshness indicator (R8.1, R8.2, R8.3).
 *
 * Pure presentational component: no data fetching, no state. Given an institution's
 * freshness (its derived `asOf` date and `isStale` flag), it renders an "as of
 * [date]" line (R8.1, R8.2) and, when the data is stale, a "may be out of date" cue
 * (R8.3).
 *
 * The stale cue is conveyed with a NON-COLOR indicator — the literal text "may be
 * out of date" plus a symbol — never color alone (R9.6). The cue is rendered through
 * the StaleDataBanner primitive so stale notes look consistent across the dashboard.
 *
 * The `asOf` Date is formatted in a readable, plain-language form (e.g. "Oct 14,
 * 2026") via Intl.DateTimeFormat. Only the `asOf` and `isStale` fields of
 * InstitutionFreshness are needed, so props are typed against that subset.
 */

import type { InstitutionFreshness } from '@/types/accounts';
import StaleDataBanner from '@/components/ui/StaleDataBanner';

/** The subset of InstitutionFreshness this badge needs. */
type FreshnessBadgeProps = Pick<InstitutionFreshness, 'asOf' | 'isStale'>;

/** Readable "Mon D, YYYY" formatter, e.g. "Oct 14, 2026". Built once and reused. */
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export default function FreshnessBadge({
  asOf,
  isStale,
}: FreshnessBadgeProps): React.ReactElement {
  const formattedDate = dateFormatter.format(asOf);

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm text-gray-600">
      <span>as of {formattedDate}</span>
      {isStale ? <StaleDataBanner message="may be out of date" /> : null}
    </span>
  );
}
