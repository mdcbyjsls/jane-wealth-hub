import type { NetWorthResult } from "@/types/accounts";
import { formatCurrency } from "@/lib/format";

/**
 * Presentational header showing the three top-line figures from a
 * {@link NetWorthResult}: total assets, total liabilities, and net worth
 * (R1.3). Each value is formatted as whole-dollar USD with thousands
 * separators via {@link formatCurrency} (R1.2); a negative net worth renders
 * with an explicit leading minus sign because `formatCurrency` emits one
 * (R1.4).
 *
 * Pure and presentational: props in, markup out. No data fetching, no state.
 */
export interface NetWorthHeaderProps {
  /** Already-computed net worth figures from the Allocation_Calculator. */
  netWorth: NetWorthResult;
}

/** A single labeled currency figure, with its label programmatically tied to
 * its value via a shared id so assistive tech reads them together. */
function Figure({
  id,
  label,
  value,
  emphasis = false,
}: {
  id: string;
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt id={`${id}-label`} className="text-sm font-medium text-gray-600">
        {label}
      </dt>
      <dd
        aria-labelledby={`${id}-label`}
        className={
          emphasis
            ? "text-3xl font-bold text-gray-900 tabular-nums"
            : "text-xl font-semibold text-gray-800 tabular-nums"
        }
      >
        {formatCurrency(value)}
      </dd>
    </div>
  );
}

export function NetWorthHeader({ netWorth }: NetWorthHeaderProps) {
  const { totalAssets, totalLiabilities, netWorth: net } = netWorth;

  return (
    <section aria-label="Net worth summary">
      <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Figure id="net-worth-assets" label="Total assets" value={totalAssets} />
        <Figure
          id="net-worth-liabilities"
          label="Total liabilities"
          value={totalLiabilities}
        />
        <Figure
          id="net-worth-total"
          label="Net worth"
          value={net}
          emphasis
        />
      </dl>
    </section>
  );
}

export default NetWorthHeader;
