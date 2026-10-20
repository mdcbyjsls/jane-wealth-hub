/**
 * Centralized user-facing copy for the Long-Term Wealth Projection view.
 *
 * Mirrors `lib/messages.ts` (Spec 1): every string the projection view shows a
 * user lives here as plain-data constants or small pure functions — no UI, no
 * fetch, no imports from `app/`, `components/`, or `lib/fred/`. Keeping the
 * whole set in one place gives a future copy audit a single source and lets the
 * view compose states without inlining prose.
 *
 * All copy is plain language only (R10.5): no data-interchange format names,
 * no route/endpoint names, no numeric status codes, and no internal file names.
 * The domain terms "projection", "market data", "inflation", "contribution",
 * and the asset-class/scenario labels are intentionally permitted.
 *
 * Static strings live on {@link PROJECTION_MESSAGES}. Copy that interpolates a
 * date or a numeric range is exposed as a function (e.g. {@link cacheNote}),
 * matching how `lib/messages.ts` keeps dynamic copy out of the constant set.
 */

/** Static, non-interpolated projection copy. */
export const PROJECTION_MESSAGES = {
  /** R10.1 — market request in flight; shown in place of figures and chart. */
  loading: "Loading your projection\u2026",

  /** R9.6, R10.2 — route/market-unavailable error; retry offered elsewhere. */
  routeError:
    "We can't show your projection right now. Try again in a moment.",

  /** R10.3, R10.6 — account data could not be loaded; wins over market error. */
  accountError:
    "We couldn't load your accounts, so there's nothing to project yet.",

  /** R1.6 — Projected_Base is zero; shown alongside $0 at every horizon. */
  zeroBase: "There are no invested assets to project yet.",

  /** R5.7 — today's dollars requested but no Inflation_Rate available. */
  inflationUnavailable:
    "We couldn't adjust for inflation, so values are shown in future dollars.",

  /** R7.6 — the target is the Spec 1 example default, not a user choice. */
  exampleTarget: "based on an example target",
} as const;

/** Keys of the static projection message set. */
export type ProjectionMessageKey = keyof typeof PROJECTION_MESSAGES;

/**
 * R9.4 — "last updated" note shown when market data is served from the cache.
 * Does not present the data as live. `date` is a pre-formatted calendar date
 * (e.g. "Oct 14, 2026"); this helper does no date formatting itself.
 */
export function cacheNote(date: string): string {
  return `Market data last updated ${date}.`;
}

/**
 * R9.3 — visible fallback banner shown when saved market data is in use.
 * `date` is the pre-formatted snapshot last-updated calendar date.
 */
export function snapshotBanner(date: string): string {
  return `Using saved market data from ${date}. Live data isn't available right now.`;
}

/**
 * Assumption validation messages (R3.4, R3.5, R4.6, R6.5).
 *
 * Each message is shown inline adjacent to the offending input; the view keeps
 * the last valid projection and retains the previously accepted value. Copy is
 * plain language and names the constraint, not the field's internal identifier.
 */
export const ASSUMPTION_VALIDATION = {
  /** R3.4 — any assumption edited to a non-finite number. */
  mustBeFiniteNumber: "Enter a number.",

  /** R3.5 — Annual_Contribution below zero. */
  contributionBelowZero: "Enter zero or a larger amount.",
} as const;

/** Keys of the static assumption-validation message set. */
export type AssumptionValidationKey = keyof typeof ASSUMPTION_VALIDATION;

/**
 * R6.5 — Annual_Contribution above the accepted maximum. `maxLabel` is a
 * pre-formatted dollar amount (e.g. "$10,000,000") so this helper does no
 * currency formatting itself.
 */
export function contributionAboveMax(maxLabel: string): string {
  return `Enter an amount no larger than ${maxLabel}.`;
}

/**
 * R4.6 — Optimistic_/Pessimistic_Multiplier is non-numeric or outside its
 * permitted range. States the permitted range so the user knows what's allowed;
 * `min` and `max` are the numeric bounds for that multiplier.
 */
export function multiplierOutOfRange(min: number, max: number): string {
  return `Enter a number from ${min} to ${max}.`;
}

/**
 * Source-label and reasoning helpers for the Assumption_Panel (R2.4, R2.5,
 * R3.2). These compose the plain-language "where this number came from" copy
 * shown next to each Expected_Return.
 */

/**
 * R2.4, R3.2 — source label for a market-derived return: the human-readable
 * series name plus the value's pre-formatted "as of" calendar date, e.g.
 * sourceLabel("10-year Treasury", "Oct 14, 2026") →
 * "10-year Treasury, as of Oct 14, 2026".
 */
export function sourceLabel(seriesName: string, asOfDate: string): string {
  return `${seriesName}, as of ${asOfDate}`;
}

/**
 * R2.4 — source label for an assumption that is a documented default rather
 * than a market value (e.g. the other-class return), e.g.
 * defaultSourceLabel() → "Default assumption, editable".
 */
export function defaultSourceLabel(): string {
  return "Default assumption, editable";
}

/**
 * R2.5 — plain-language reasoning for the stocks Expected_Return: the bond
 * anchor plus the equity risk premium. Avoids jargon per the product principle.
 */
export const STOCKS_REASONING =
  "Stocks use the bond return plus an extra amount for taking on more risk.";
