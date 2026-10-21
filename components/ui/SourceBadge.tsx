/*
 * SourceBadge — a small labeled badge naming an account's Source (R1.3).
 *
 * Every account carries exactly one Source: Sample, Manual, or Connected (R1.1).
 * This badge makes that origin visible wherever an account is displayed, so the
 * user can tell apart the simulated sample data, what they typed themselves, and
 * what a bank reported.
 *
 * Pure presentational component: props in, markup out. No data fetching, no state.
 *
 * Accessibility: the Source is conveyed by the badge's TEXT — the word "Sample",
 * "Manual", or "Connected" itself identifies the Source, never color alone (R9.6).
 * The subtle per-Source tint is a secondary, decorative reinforcement only; the
 * label is fully legible without it. Styling stays calm and understated per the
 * private-banking ui-style (a quiet pill, not a loud tag).
 */

import type { AccountSource } from '@/types/accounts';

export interface SourceBadgeProps {
  /** The account's Source; determines the badge label and tint (R1.1, R1.3). */
  source: AccountSource;
  /** Extra Tailwind classes merged onto the badge. */
  className?: string;
}

/**
 * Per-Source tint. This is a decorative reinforcement only — the badge text
 * already names the Source, so these classes never become the sole indicator
 * (R9.6). Tones are muted to fit the calm private-banking palette and are kept
 * clear of the reserved on-track green / off-target red/amber status colors.
 */
const SOURCE_STYLES: Record<AccountSource, string> = {
  Sample: 'border-slate-200 bg-slate-50 text-slate-600',
  Manual: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  Connected: 'border-sky-200 bg-sky-50 text-sky-700',
};

export default function SourceBadge({
  source,
  className,
}: SourceBadgeProps): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${SOURCE_STYLES[source]} ${className ?? ''}`}
    >
      {/* The word itself identifies the Source — color is only a secondary cue (R9.6). */}
      {source}
    </span>
  );
}
