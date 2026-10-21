'use client';

import { useMemo, useState } from 'react';

import type { TornadoEntry } from '@/types/buyVsRent';
import { formatCurrency } from '@/lib/format';
import { SERIES } from '@/lib/chartColors';

/**
 * Sensitivity_Tornado: horizontal diverging bars ranking how much each editable
 * assumption moves the year-10 Buy − Rent gap (Spec 4 R5.7, R3.1, R3.2, R1.4).
 *
 * The data is the already-ranked {@link TornadoEntry}[] from the pure
 * `computeTornado` helper; this component is PRESENTATIONAL only — it never
 * calls the helper (the client island computes it), it takes the sorted array
 * as a prop and renders the top six, largest swing first.
 *
 * Each row is one assumption. Its bar is centered on the shared `baseGap` (the
 * unperturbed year-10 gap, identical across entries) and spans from the gap at
 * the assumption's low input to the gap at its high input. Both ends are
 * labeled with the input value that produced them and the resulting dollar gap.
 * The direction each end pushes the gap is shown by its POSITION relative to
 * the base line PLUS an arrow (▲ above base, ▼ below base) and text — never by
 * color alone (R1.4). This is a single-series chart, so there is no
 * click-to-hide legend.
 *
 * Accessibility mirrors {@link ComparisonChart}:
 * - The SVG bar graphic is decorative and hidden from assistive technology
 *   (`aria-hidden`), so it is never the only source of the data.
 * - A visually-hidden `<dl>` carries the authoritative Text_Alternative — for
 *   each assumption, its low and high input values and the resulting dollar
 *   gaps — and the `<figure>` references it via `aria-labelledby`.
 * - Each end of each bar is a focusable Call_Out_Button: focusing or hovering
 *   it reveals a tooltip with that end's input value and dollar gap (R3.2),
 *   giving keyboard users the same information a mouse user gets on hover;
 *   blur/leave dismisses it.
 *
 * Dollars use `formatCurrency`; the single bar fill is `SERIES.primary` (a
 * visual aid only — position + arrow + text carry the meaning).
 */

/** The tornado shows at most the top six drivers (per the task / design). */
const MAX_BARS = 6;

/** Which end of a bar a call-out / tooltip refers to. */
type EndKey = 'low' | 'high';

export interface SensitivityTornadoProps {
  /**
   * The ranked tornado entries from `computeTornado`, already sorted by `swing`
   * descending. Rendered top-six, largest first. When empty, the component
   * exposes the unavailable message (if any) instead of a graphic.
   */
  entries: TornadoEntry[];
  /**
   * Plain-language message exposed to assistive technology when there is no
   * tornado to draw. Rendered in place of the chart; no graphic is drawn.
   */
  unavailableMessage?: string;
}

/** A row ready to draw: the entry plus its resolved low/high bar offsets (0..100%). */
interface TornadoRow {
  entry: TornadoEntry;
  /** Percentage offset (0..100) of the base line across the shared scale. */
  basePercent: number;
  /** Percentage offset (0..100) of the low-input gap. */
  lowPercent: number;
  /** Percentage offset (0..100) of the high-input gap. */
  highPercent: number;
}

/** Identifies the active call-out (and thus tooltip). */
interface TooltipTarget {
  key: TornadoEntry['key'];
  end: EndKey;
}

/**
 * Format an assumption input value. The tornado mixes units (dollars, percents,
 * term years) and {@link TornadoEntry} carries no unit, so we render a plain,
 * thousands-separated number with up to one decimal — enough to label the
 * range each bar explored without implying a unit the data does not carry.
 */
function formatInput(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** Whether `end`'s gap sits above (gap greater than base) or below the base gap. */
function direction(gap: number, baseGap: number): { arrow: string; word: string } {
  if (gap > baseGap) {
    return { arrow: '▲', word: 'above base' };
  }
  if (gap < baseGap) {
    return { arrow: '▼', word: 'below base' };
  }
  return { arrow: '•', word: 'at base' };
}

export function SensitivityTornado({
  entries,
  unavailableMessage,
}: SensitivityTornadoProps) {
  const [tooltip, setTooltip] = useState<TooltipTarget | null>(null);

  const rows = useMemo<TornadoRow[]>(() => {
    const top = entries.slice(0, MAX_BARS);
    if (top.length === 0) {
      return [];
    }

    // Shared horizontal scale across all rows so bar lengths are comparable.
    // Span every gap endpoint and the base so each bar is centered on the base
    // line and nothing clips. Guard a zero-width span (all gaps equal).
    const baseGap = top[0].baseGap;
    let min = baseGap;
    let max = baseGap;
    for (const e of top) {
      min = Math.min(min, e.lowGap, e.highGap);
      max = Math.max(max, e.lowGap, e.highGap);
    }
    const span = max - min;
    const toPercent = (value: number) =>
      span === 0 ? 50 : ((value - min) / span) * 100;

    return top.map((entry) => ({
      entry,
      basePercent: toPercent(entry.baseGap),
      lowPercent: toPercent(entry.lowGap),
      highPercent: toPercent(entry.highGap),
    }));
  }, [entries]);

  if (rows.length === 0) {
    if (unavailableMessage) {
      return <p role="status">{unavailableMessage}</p>;
    }
    return null;
  }

  const basePercent = rows[0].basePercent;

  return (
    <figure
      aria-labelledby="sensitivity-tornado-alt"
      className="flex flex-col gap-4"
    >
      {/*
        Authoritative, screen-reader-only Text_Alternative: for each assumption,
        its low and high input values and the resulting dollar gaps, plus the
        shared base gap. The figure is labeled by this list so assistive tech
        announces the data rather than the decorative SVG bars below.
      */}
      <dl id="sensitivity-tornado-alt" className="sr-only tabular-nums">
        <dt>
          {`Sensitivity of the year-10 buy-minus-rent gap to each assumption. Base gap ${formatCurrency(
            rows[0].entry.baseGap,
          )}.`}
        </dt>
        {rows.map(({ entry }) => (
          <dd key={entry.key}>
            {`${entry.label}: low input ${formatInput(entry.lowInput)} gives gap ${formatCurrency(
              entry.lowGap,
            )} (${direction(entry.lowGap, entry.baseGap).word}); high input ${formatInput(
              entry.highInput,
            )} gives gap ${formatCurrency(entry.highGap)} (${
              direction(entry.highGap, entry.baseGap).word
            }).`}
          </dd>
        ))}
      </dl>

      {/* Decorative bar graphic: hidden from assistive tech, which reads the list above. */}
      <div aria-hidden="true" className="relative flex flex-col gap-3">
        {/* The shared base reference line, positioned on the same scale as the bars. */}
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-slate-400"
          style={{ left: `${basePercent}%` }}
        />
        {rows.map((row) => (
          <TornadoBar key={row.entry.key} row={row} />
        ))}
      </div>

      {/*
        Keyboard-reachable call-outs. Because the bar graphic is aria-hidden,
        these focusable buttons give keyboard users the same tooltip a mouse
        user gets on hover (R3.2): each bar's low and high ends, labeled with
        the input value and resulting dollar gap, with direction shown by an
        arrow + text (not color). Focus/hover shows the tooltip; blur/leave
        dismisses it.
      */}
      <ul className="flex flex-col gap-3">
        {rows.map(({ entry }) => (
          <li
            key={entry.key}
            className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3"
          >
            <span className="text-sm font-semibold text-slate-900">
              {entry.label}
            </span>
            <div className="flex flex-wrap gap-2">
              <EndButton
                entry={entry}
                end="low"
                active={tooltip?.key === entry.key && tooltip.end === 'low'}
                onShow={setTooltip}
                onHide={() => setTooltip(null)}
              />
              <EndButton
                entry={entry}
                end="high"
                active={tooltip?.key === entry.key && tooltip.end === 'high'}
                onShow={setTooltip}
                onHide={() => setTooltip(null)}
              />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** One decorative diverging bar spanning its low-input gap to its high-input gap. */
function TornadoBar({ row }: { row: TornadoRow }) {
  const left = Math.min(row.lowPercent, row.highPercent);
  const width = Math.max(1, Math.abs(row.highPercent - row.lowPercent));
  return (
    <div className="relative h-6">
      <div
        className="absolute inset-y-1 rounded-sm"
        style={{
          left: `${left}%`,
          width: `${width}%`,
          backgroundColor: SERIES.primary,
        }}
      />
    </div>
  );
}

/**
 * A focusable call-out for one end of one bar. Shows the input value, the
 * resulting dollar gap, and the direction (arrow + text, never color alone);
 * focus/hover reveals a tooltip repeating the same, blur/leave dismisses it.
 */
function EndButton({
  entry,
  end,
  active,
  onShow,
  onHide,
}: {
  entry: TornadoEntry;
  end: EndKey;
  active: boolean;
  onShow: (t: TooltipTarget) => void;
  onHide: () => void;
}) {
  const input = end === 'low' ? entry.lowInput : entry.highInput;
  const gap = end === 'low' ? entry.lowGap : entry.highGap;
  const dir = direction(gap, entry.baseGap);
  const endLabel = end === 'low' ? 'Low' : 'High';

  return (
    <button
      type="button"
      className="relative flex items-baseline gap-2 rounded px-2 py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
      onMouseEnter={() => onShow({ key: entry.key, end })}
      onMouseLeave={onHide}
      onFocus={() => onShow({ key: entry.key, end })}
      onBlur={onHide}
    >
      <span className="text-xs text-slate-500">{`${endLabel} ${formatInput(input)}`}</span>
      <span className="text-sm font-semibold text-slate-900 tabular-nums">
        <span aria-hidden="true">{`${dir.arrow} `}</span>
        {formatCurrency(gap)}
      </span>
      {active ? (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white tabular-nums shadow"
        >
          {`${entry.label} ${endLabel.toLowerCase()} input ${formatInput(
            input,
          )}: gap ${formatCurrency(gap)} (${dir.word})`}
        </span>
      ) : null}
    </button>
  );
}

export default SensitivityTornado;
