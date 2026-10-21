/*
 * StorageRecoveryBanner — surfaces how the saved account set was recovered on load
 * (R7.4, R7.5).
 *
 * Pure presentational component: no data fetching, no state, no clock reads, no
 * localStorage. It is handed the `recovery` discriminant from an
 * `AccountLoadResult` (produced by `loadAccounts` in `lib/accounts/accountStore.ts`)
 * and renders the matching plain-language note, or nothing at all.
 *
 * The Account_Store parses stored accounts defensively and classifies the load into
 * one of four branches. Only two of them are worth telling the user about:
 *   - `partial` — some stored accounts could not be read; the readable ones were
 *     kept. We say how many were dropped (R7.4). This is a soft, informational note:
 *     nothing is broken, the user simply lost a few entries.
 *   - `fallback` — the saved data could not be read at all, so the sample data was
 *     restored (R7.5). This is a stronger, alert-worthy state because the user's own
 *     data is gone and what they now see is the shipped sample set.
 *   - `ok` / `seeded` — normal load (valid stored set, or a first-visit seed). There
 *     is nothing to announce, so the component renders nothing.
 *
 * Accessibility / ui-style: the meaning is carried entirely by TEXT plus a symbol,
 * never color alone (R9.6, ui-style rule). The `partial` note uses `role="status"`
 * (a polite, non-interrupting announcement) with an informational "ℹ" glyph; the
 * `fallback` note uses `role="alert"` (a prompt announcement, since the user's saved
 * data was lost) with a warning "⚠" glyph. Both glyphs are `aria-hidden` because the
 * adjacent text already carries the meaning. Styling (calm slate for partial, amber
 * for fallback) is a secondary, decorative reinforcement only and reuses the quiet
 * banner treatment established by StaleDataBanner / MarketDataBanner.
 */

import type { AccountLoadResult } from '@/types/accounts';

export interface StorageRecoveryBannerProps {
  /** The recovery discriminant from `loadAccounts()` (R7.4, R7.5). */
  recovery: AccountLoadResult['recovery'];
  /** Extra Tailwind classes merged onto the banner container. */
  className?: string;
}

/**
 * Plain-language copy for the `partial` branch (R7.4). Pluralized so a single dropped
 * account reads naturally. The count is the number of stored accounts that could not
 * be read; the rest were kept.
 */
function partialMessage(dropped: number): string {
  const noun = dropped === 1 ? 'saved account' : 'saved accounts';
  return `${dropped} ${noun} couldn't be read, so we kept the rest of your accounts.`;
}

/** Plain-language copy for the `fallback` branch (R7.5). */
const FALLBACK_MESSAGE =
  "We couldn't read your saved data, so the sample data was restored.";

export default function StorageRecoveryBanner({
  recovery,
  className,
}: StorageRecoveryBannerProps): React.ReactElement | null {
  // Normal loads (valid stored set or a first-visit seed) have nothing to announce.
  if (recovery.kind === 'ok' || recovery.kind === 'seeded') {
    return null;
  }

  if (recovery.kind === 'partial') {
    // Soft, informational note — nothing is broken, a few entries were dropped (R7.4).
    return (
      <div
        role="status"
        className={`inline-flex items-start gap-1.5 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 ${className ?? ''}`}
      >
        {/* Decorative glyph — the adjacent text carries the meaning (R9.6). */}
        <span aria-hidden="true">&#8505;</span>
        <span>{partialMessage(recovery.dropped)}</span>
      </div>
    );
  }

  // recovery.kind === 'fallback' — the user's saved data was lost; sample data restored (R7.5).
  return (
    <div
      role="alert"
      className={`inline-flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 ${className ?? ''}`}
    >
      {/* Decorative glyph — the adjacent text carries the meaning (R9.6). */}
      <span aria-hidden="true">&#9888;</span>
      <span>{FALLBACK_MESSAGE}</span>
    </div>
  );
}
