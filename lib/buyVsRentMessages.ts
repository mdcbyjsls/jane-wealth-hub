/**
 * Centralized user-facing copy for the Buy-vs-Rent Scenario Tester view.
 *
 * Mirrors `lib/projectionMessages.ts` (Spec 2) and `lib/messages.ts` (Spec 1):
 * every string the scenario view shows a user lives here as plain-data
 * constants or small pure functions — no UI, no fetch, no imports from `app/`,
 * `components/`, or `lib/fred/`. Keeping the whole set in one place gives a
 * future copy audit a single source and lets the island compose states without
 * inlining prose.
 *
 * All copy is plain language only (R12.5): no data-interchange format names, no
 * route/endpoint names, no numeric status codes, and no internal file names.
 * The domain terms "comparison", "market data", "inflation", "home", "rent",
 * "mortgage", and the path labels ("buying"/"renting") are intentionally
 * permitted. Rates are expressed as percentages with a percent sign and no
 * undefined financial jargon (R7.5).
 *
 * Static strings live on {@link BUY_VS_RENT_MESSAGES}. Copy that interpolates a
 * date, a year, a rate, or a dollar amount is exposed as a function (e.g.
 * {@link cacheNote}), matching how `lib/projectionMessages.ts` keeps dynamic
 * copy out of the constant set. Dates, rates, and dollar amounts are passed in
 * pre-formatted; these helpers do no number or date formatting themselves.
 */

/** Static, non-interpolated scenario copy. */
export const BUY_VS_RENT_MESSAGES = {
  /** R12.1 — market request in flight; shown in place of figures and chart. */
  loading: "Loading your comparison\u2026",

  /** R12.2, R12.4 — route/market-unavailable error; retry offered elsewhere. */
  routeError: "We can't show your comparison right now. Try again in a moment.",

  /** R12.3 — account data could not be loaded; wins over market error. */
  accountError:
    "We couldn't load your accounts, so there's nothing to compare yet.",

  /** R3.6 — Down_Payment + Closing_Costs exceed Starting_Assets; shown in place of a negative cushion. */
  overBudgetPurchase:
    "Buying this home would cost more than your available assets.",

  /** R10.6 — today's dollars requested but no Inflation_Rate available. */
  inflationUnavailable:
    "We couldn't adjust for inflation, so values are shown in future dollars.",
} as const;

/** Keys of the static scenario message set. */
export type BuyVsRentMessageKey = keyof typeof BUY_VS_RENT_MESSAGES;

/**
 * R11.6 — "last updated" note shown when market data is served from the cache.
 * Does not present the data as live. `date` is a pre-formatted calendar date
 * (e.g. "Oct 14, 2026"); this helper does no date formatting itself.
 */
export function cacheNote(date: string): string {
  return `Market data last updated ${date}.`;
}

/**
 * R11.5 — visible fallback banner shown when saved market data is in use.
 * `date` is the pre-formatted snapshot last-updated calendar date.
 */
export function snapshotBanner(date: string): string {
  return `Using saved market data from ${date}. Live data isn't available right now.`;
}

/**
 * Assumption validation messages (R9.4).
 *
 * Each message is shown inline adjacent to the offending input; the view keeps
 * the last valid comparison and retains the previously accepted value. Copy is
 * plain language and names the constraint, not the field's internal identifier.
 */
export const ASSUMPTION_VALIDATION = {
  /** R9.4 — any assumption edited to a non-finite number. */
  mustBeFiniteNumber: "Enter a number.",

  /** R9.6 — a dollar-denominated assumption edited below zero. */
  mustBeZeroOrMore: "Enter zero or a larger amount.",
} as const;

/** Keys of the static assumption-validation message set. */
export type AssumptionValidationKey = keyof typeof ASSUMPTION_VALIDATION;

/**
 * R9.4, R9.6 — an assumption edited outside its permitted range. States the
 * permitted range so the user knows what's allowed; `min` and `max` are the
 * numeric bounds for that assumption (e.g. multiplierOutOfRange(0, 20) →
 * "Enter a number from 0 to 20.").
 */
export function valueOutOfRange(min: number, max: number): string {
  return `Enter a number from ${min} to ${max}.`;
}

/**
 * Breakeven statements for the Verdict (R6.3, R6.4).
 *
 * `findBreakevenYear` returns the first year 1..10 at which buying catches up to
 * renting, or null when none exists within the horizon.
 */

/**
 * R6.3 — a Breakeven_Year exists; `year` is the whole year (1..10) at which
 * buying catches up to renting.
 */
export function breakevenPresent(year: number): string {
  return `Buying catches up to renting in year ${year}.`;
}

/** R6.4 — no Breakeven_Year within the 10-year horizon. */
export const BREAKEVEN_ABSENT =
  "Buying does not overtake renting within 10 years.";

/**
 * Verdict phrasing (R7.1, R7.6).
 *
 * `leadingPath` is which path ends ahead at year 10 under the base band;
 * `gapLabel` is the pre-formatted absolute dollar size of the year-10
 * difference (e.g. "$124,000"), consistent with the active Dollar_Basis.
 */

/** The two path outcomes the Verdict can name, in plain language. */
export const PATH_LABEL = {
  buy: "Buying",
  rent: "Renting",
} as const;

/** Which path leads at year 10. */
export type LeadingPath = keyof typeof PATH_LABEL;

/**
 * R7.1 — states which path ends ahead at year 10 and the absolute dollar size
 * of that year-10 difference. `gapLabel` is a pre-formatted dollar amount.
 */
export function verdict(leadingPath: LeadingPath, gapLabel: string): string {
  return `${PATH_LABEL[leadingPath]} comes out ahead at year 10, by ${gapLabel}.`;
}

/**
 * Tipping-point phrasing (R7.3, R7.4).
 *
 * The Appreciation_Tipping_Point is the home-appreciation rate below which the
 * other path wins, when one exists in the −20% to +20% range.
 */

/**
 * R7.3 — an Appreciation_Tipping_Point exists in range. `rateLabel` is the
 * pre-formatted one-decimal home-appreciation rate with a percent sign (e.g.
 * "3.2%"); below this rate the other path wins.
 */
export function tippingPointPresent(rateLabel: string): string {
  return `If home prices rise more slowly than ${rateLabel} per year, the other choice comes out ahead.`;
}

/** R7.4 — no tipping point across the −20% to +20% range of home-appreciation rates. */
export const TIPPING_POINT_ABSENT =
  "The outcome doesn't flip across a wide range of home-appreciation rates.";

/**
 * Market source-label helpers for the Assumption_Panel (R9.2).
 *
 * These compose the plain-language "where this number came from" copy shown
 * next to each market-derived assumption. Each market-derived assumption cites
 * its series by a human-readable name (never the raw series identifier) plus
 * the value's pre-formatted "as of" calendar date.
 */

/**
 * Human-readable names for the three market series this view derives defaults
 * from (R9.2): the Mortgage_Rate cites the 30-year mortgage rate, the
 * Home_Appreciation_Rate cites the home-price index, and the Rent_Growth_Rate
 * cites the rent index. Plain language, no raw series identifiers.
 */
export const MARKET_SERIES_LABEL = {
  /** MORTGAGE30US — default Mortgage_Rate. */
  mortgageRate: "30-year fixed mortgage rate",
  /** CSUSHPINSA — default Home_Appreciation_Rate. */
  homeAppreciation: "national home-price index",
  /** CUSR0000SEHA — default Rent_Growth_Rate. */
  rentGrowth: "rent-of-primary-residence index",
} as const;

/** Keys of the market series label set. */
export type MarketSeriesLabelKey = keyof typeof MARKET_SERIES_LABEL;

/**
 * R9.2 — source label for a market-derived assumption: the human-readable
 * series name plus the value's pre-formatted "as of" calendar date, e.g.
 * sourceLabel(MARKET_SERIES_LABEL.mortgageRate, "Oct 14, 2026") →
 * "30-year fixed mortgage rate, as of Oct 14, 2026".
 */
export function sourceLabel(seriesName: string, asOfDate: string): string {
  return `${seriesName}, as of ${asOfDate}`;
}

/**
 * R9.1 — source label for an assumption that is a documented default rather
 * than a market value (e.g. property tax rate, HOA), e.g.
 * defaultSourceLabel() → "Default assumption, editable".
 */
export function defaultSourceLabel(): string {
  return "Default assumption, editable";
}
