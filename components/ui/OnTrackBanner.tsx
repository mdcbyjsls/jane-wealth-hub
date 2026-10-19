/*
 * OnTrackBanner — the single status banner at the top of the allocation section
 * (R4.6).
 *
 * Pure presentational component: props in, markup out. It does no computation —
 * the `OnTrackStatus` it receives already carries the fully-formed `label`
 * ("On track" per R4.7, or "N of 4 asset classes off target" per R4.8) and, when
 * off target, the plain-language `largestDriftSentence` naming the most-drifted
 * class with direction, point magnitude, and approximate dollars (R4.9, e.g.
 * "Stocks are 8 points above your target, about $42,000").
 *
 * Accessibility (R9.6 spirit): on-track vs off-target is conveyed through TEXT —
 * the `label` itself — never through color alone. Color is a secondary,
 * decorative reinforcement (green when on track, amber when off target). The
 * banner carries `role="status"` so assistive tech announces status changes when
 * the target is edited.
 */

import type { OnTrackStatus } from '@/types/accounts';

interface OnTrackBannerProps {
  status: OnTrackStatus;
  /** Extra Tailwind classes merged onto the banner container. */
  className?: string;
}

export default function OnTrackBanner({
  status,
  className,
}: OnTrackBannerProps): React.ReactElement {
  // Color is secondary reinforcement only; the label text carries the meaning.
  const toneClasses = status.onTrack
    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
    : 'border-amber-300 bg-amber-50 text-amber-900';

  return (
    <div
      role="status"
      className={`rounded-md border px-3 py-2 ${toneClasses} ${className ?? ''}`}
    >
      <p className="text-sm font-semibold">{status.label}</p>
      {status.largestDriftSentence !== null && (
        <p className="mt-0.5 text-sm font-normal">
          {status.largestDriftSentence}
        </p>
      )}
    </div>
  );
}
