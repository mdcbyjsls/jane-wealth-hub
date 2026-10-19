/**
 * Pure formatting helpers shared by UI components so they never implement
 * ad-hoc number formatting.
 *
 * No imports from `app/` or `components/`, no fetch, no localStorage — inputs
 * in, strings out. Functions are deterministic for a given input.
 *
 * The `Intl.NumberFormat` instances are constructed once at module scope and
 * reused, since constructing them is comparatively expensive.
 */

/**
 * Whole-dollar USD formatter: thousands separators, no cents, rounded to the
 * nearest whole dollar. Negative values render with a leading minus sign
 * (default Intl behavior), e.g. -1234.5 → "-$1,235".
 */
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** One-decimal plain-number formatter, e.g. 42.5 → "42.5". */
const oneDecimalFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Format a numeric value as whole-dollar United States currency (R1.2, R1.4).
 *
 * Rounds to the nearest whole dollar, inserts thousands separators, and shows
 * no fractional cents. Negative amounts render with an explicit leading minus
 * sign (e.g. "-$1,234").
 *
 * Inputs come from already-validated account data, so a simple implementation
 * is sufficient. We still guard against non-finite values (NaN / ±Infinity)
 * defensively so a bad number never renders as a confusing string like "$NaN";
 * such inputs fall back to "$0".
 */
export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) {
    return currencyFormatter.format(0);
  }
  return currencyFormatter.format(value);
}

/**
 * Format a numeric percentage to one decimal place with the spelled-out word
 * "percent" (R9.1), e.g. 42.5 → "42.5 percent".
 *
 * Used for the allocation pie chart's text alternative; combined with a class
 * name this produces the design's example "Stocks 42.5 percent".
 *
 * `value` is the percentage itself (0–100), not a 0–1 fraction. Non-finite
 * input falls back to "0.0 percent".
 */
export function formatPercentLabel(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${oneDecimalFormatter.format(safe)} percent`;
}

/**
 * Compact one-decimal percentage variant for chart labels, e.g. 42.5 → "42.5%".
 *
 * Same numeric formatting as {@link formatPercentLabel} but with a "%" symbol
 * instead of the spelled-out word, for dense visual contexts where the longer
 * screen-reader-friendly label would be too wide.
 */
export function formatPercent(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${oneDecimalFormatter.format(safe)}%`;
}
