/*
 * AllocationSection — the composed allocation view (R3.5, R4.2, R4.6, R9.6).
 *
 * Pure presentational component: props in, markup out. It performs NO
 * computation and NO data fetching — all numbers arrive pre-computed from the
 * Allocation_Calculator via props (the `AllocationResult`, the `DriftResult`,
 * the `OnTrackStatus`, and the `TargetAllocation`). It only lays out and
 * formats what it is given.
 *
 * Composition, top to bottom (per the design's UI composition for this
 * section):
 *   1. `OnTrackBanner` at the very top (R4.6) — overall status plus the
 *      largest-drift sentence.
 *   2. `AllocationPie` (R3.5) — the pie of the four Asset_Class buckets with
 *      its programmatically associated text alternative.
 *   3. Per-class rows (R4.2), one per Asset_Class, each showing the actual
 *      percentage, the target percentage, and the Drift in BOTH percentage
 *      points and dollars.
 *
 * Non-color indicator (R9.6): each row's drift direction and magnitude are
 * conveyed with TEXT and a SYMBOL (▲ over, ▼ under, ● on track) plus a word
 * ("over" / "under" / "on track") — never color alone. Color, where present,
 * is only secondary reinforcement. A visually-hidden phrase gives assistive
 * technology the same direction-and-magnitude meaning.
 */

import type {
  AllocationResult,
  AssetClass,
  DriftResult,
  OnTrackStatus,
  TargetAllocation,
} from '@/types/accounts';
import { formatCurrency, formatPercent } from '@/lib/format';
import OnTrackBanner from '@/components/ui/OnTrackBanner';
import { AllocationPie } from '@/components/charts/AllocationPie';

/** Human-readable labels for each Asset_Class, in canonical display order. */
const CLASS_ROWS: ReadonlyArray<{ key: AssetClass; label: string }> = [
  { key: 'stocks', label: 'Stocks' },
  { key: 'bonds', label: 'Bonds' },
  { key: 'cash', label: 'Cash' },
  { key: 'other', label: 'Other' },
];

export interface AllocationSectionProps {
  /** Actual allocation — percentages and the dollar basis behind them (R3.5). */
  allocation: AllocationResult;
  /** Per-class drift in points and dollars, plus direction (R4.2). */
  drift: DriftResult;
  /** Overall status rendered in the banner at the top (R4.6). */
  onTrackStatus: OnTrackStatus;
  /** Target percentages for the target column. */
  target: TargetAllocation;
  /** Extra Tailwind classes merged onto the section container. */
  className?: string;
}

/**
 * Non-color cue for a drift direction: a shape symbol plus a word, so the
 * direction reads without relying on color (R9.6). The symbol is marked
 * `aria-hidden` and paired with the word so assistive tech hears the word.
 */
const DIRECTION_CUE: Record<
  DriftResult['byClass'][AssetClass]['direction'],
  { symbol: string; word: string }
> = {
  over: { symbol: '▲', word: 'over' },
  under: { symbol: '▼', word: 'under' },
  'on track': { symbol: '●', word: 'on track' },
};

/**
 * Format the point magnitude of a drift to one decimal with an explicit sign,
 * e.g. +8.0 pts / -3.5 pts / 0.0 pts. The sign is a non-color direction cue in
 * its own right.
 */
function formatDriftPoints(points: number): string {
  const safe = Number.isFinite(points) ? points : 0;
  const sign = safe > 0 ? '+' : safe < 0 ? '-' : '';
  return `${sign}${formatPercent(Math.abs(safe))}`.replace('%', ' pts');
}

/** Format the dollar magnitude of a drift with an explicit sign, e.g. +$42,000. */
function formatDriftDollars(dollars: number): string {
  const safe = Number.isFinite(dollars) ? dollars : 0;
  const sign = safe > 0 ? '+' : '';
  return `${sign}${formatCurrency(safe)}`;
}

export default function AllocationSection({
  allocation,
  drift,
  onTrackStatus,
  target,
  className,
}: AllocationSectionProps): React.ReactElement {
  return (
    <section
      aria-labelledby="allocation-section-heading"
      className={`flex flex-col gap-6 ${className ?? ''}`}
    >
      <h2 id="allocation-section-heading" className="text-lg font-semibold text-gray-900">
        Asset allocation
      </h2>

      {/* 1. Overall status banner at the top (R4.6). */}
      <OnTrackBanner status={onTrackStatus} />

      {/* 2. The pie with its text alternative (R3.5). */}
      <AllocationPie allocation={allocation} />

      {/* 3. Per-class rows: actual %, target %, and drift in points + dollars (R4.2). */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Actual allocation versus target, with the difference for each asset class
          </caption>
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-600">
              <th scope="col" className="py-2 pr-4 font-medium">
                Asset class
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Actual
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Target
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Difference
              </th>
            </tr>
          </thead>
          <tbody>
            {CLASS_ROWS.map(({ key, label }) => {
              const actualPct = allocation.percentages[key];
              const targetPct = target[key];
              const classDrift = drift.byClass[key];
              const cue = DIRECTION_CUE[classDrift.direction];

              return (
                <tr key={key} className="border-b border-gray-100 last:border-0">
                  <th scope="row" className="py-2 pr-4 text-left font-medium text-gray-800">
                    {label}
                  </th>
                  <td className="py-2 pr-4 text-right tabular-nums text-gray-900">
                    {formatPercent(actualPct)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-gray-900">
                    {formatPercent(targetPct)}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-900">
                    {/*
                      Non-color direction + magnitude cue (R9.6): a shape symbol
                      and a word carry the direction; the signed points and
                      dollars carry the magnitude. Color is not used here at all,
                      so the meaning never depends on color perception.
                    */}
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span aria-hidden="true" className="text-xs leading-none">
                        {cue.symbol}
                      </span>
                      <span className="tabular-nums font-medium">
                        {formatDriftPoints(classDrift.driftPoints)}
                      </span>
                      <span className="tabular-nums text-gray-600">
                        ({formatDriftDollars(classDrift.driftDollars)})
                      </span>
                      <span className="sr-only">
                        {`${cue.word} target`}
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
