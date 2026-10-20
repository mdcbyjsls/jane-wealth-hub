/*
 * MarketDataBanner — surfaces how fresh the projection's market data is (R9.3, R9.4).
 *
 * Pure presentational component: no data fetching, no state, no clock reads. Given the
 * resolved `dataSource` and a pre-formatted last-updated calendar date, it renders the
 * appropriate note and does no date formatting itself (the caller formats via
 * `lib/format.ts` / Intl, matching how FreshnessBadge composes StaleDataBanner).
 *
 * Reuses the Spec 1 StaleDataBanner idea — a `role="note"` region whose meaning is carried
 * by TEXT plus a SYMBOL, never color alone (R9.3, R9.4, ui-style rule). The styling is a
 * secondary, decorative reinforcement; every symbol is `aria-hidden` because the adjacent
 * text already carries the meaning.
 *
 * Three states, driven by `dataSource`:
 *   - `snapshot` — live data is unavailable and saved market data is in use. This is the
 *     true fallback case, so it reuses the StaleDataBanner primitive (amber "⚠" warning
 *     treatment) with the `snapshotBanner(date)` copy.
 *   - `cache`    — data came from the recent cache, not a live call. A calm "last updated"
 *     note (`cacheNote(date)`) that does NOT present the data as live; an informational "ℹ"
 *     symbol keeps a non-color cue without implying something is wrong.
 *   - `live`     — nothing to say; the component renders nothing (returns null).
 */

import type { DataSource } from '@/types/market';
import StaleDataBanner from '@/components/ui/StaleDataBanner';
import { cacheNote, snapshotBanner } from '@/lib/projectionMessages';

interface MarketDataBannerProps {
  /** Where the served market data came from (R8.6, R9). */
  dataSource: DataSource;
  /**
   * Pre-formatted last-updated calendar date (e.g. "Oct 14, 2026"). For `snapshot`
   * this is the snapshot's as-of date; for `cache` it is the cached data's as-of date.
   * This component does no date formatting — the caller formats it.
   */
  lastUpdated: string;
  /** Extra Tailwind classes merged onto the banner container. */
  className?: string;
}

export default function MarketDataBanner({
  dataSource,
  lastUpdated,
  className,
}: MarketDataBannerProps): React.ReactElement | null {
  if (dataSource === 'live') {
    // Live data needs no note.
    return null;
  }

  if (dataSource === 'snapshot') {
    // Fallback: reuse the stale-data primitive's text + symbol warning treatment.
    return (
      <StaleDataBanner message={snapshotBanner(lastUpdated)} className={className} />
    );
  }

  // dataSource === 'cache' — a calm "last updated" note that does not imply live data.
  return (
    <div
      role="note"
      className={`inline-flex items-center gap-1.5 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-sm text-gray-600 ${className ?? ''}`}
    >
      {/* Decorative symbol — the adjacent text carries the meaning (R9.4). */}
      <span aria-hidden="true">&#8505;</span>
      <span>{cacheNote(lastUpdated)}</span>
    </div>
  );
}
