/*
 * StaleDataBanner — a reusable banner primitive for presenting a "may be out of
 * date" note (R8.3).
 *
 * Pure presentational component: no data fetching, no state. It is intentionally
 * generic so either the FreshnessBadge or a page can use it to surface a stale-data
 * note. It accepts either a `message` string or arbitrary `children`; when both are
 * provided, `children` wins.
 *
 * Accessibility: the banner carries `role="note"` so assistive tech announces it as
 * an aside, and the stale cue is conveyed through TEXT and a symbol — never color
 * alone (R9.6). The amber styling is a secondary, decorative reinforcement; the "⚠"
 * mark is hidden from assistive tech (aria-hidden) because the adjacent text already
 * carries the meaning.
 */

interface StaleDataBannerProps {
  /** Plain-language note to display. Ignored when `children` is provided. */
  message?: string;
  /** Arbitrary content to render instead of `message`. */
  children?: React.ReactNode;
  /** Extra Tailwind classes merged onto the banner container. */
  className?: string;
}

export default function StaleDataBanner({
  message,
  children,
  className,
}: StaleDataBannerProps): React.ReactElement {
  return (
    <div
      role="note"
      className={`inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-800 ${className ?? ''}`}
    >
      {/* Decorative symbol — the adjacent text carries the meaning (R9.6). */}
      <span aria-hidden="true">⚠</span>
      <span>{children ?? message}</span>
    </div>
  );
}
