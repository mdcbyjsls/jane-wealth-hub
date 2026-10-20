'use client';

import { useMemo, useState } from 'react';

import type { WaterfallStep, WaterfallStepKind } from '@/types/accounts';
import { formatCurrency, formatPercent } from '@/lib/format';
import { SERIES, STATUS } from '@/lib/chartColors';

/**
 * Net_Worth_Waterfall — floating step bars showing how each institution's asset
 * subtotal stacks up, how each liability steps the total back down, and where
 * net worth lands (Spec 4 — Per-view → Dashboard → NetWorthWaterfall; R7.3,
 * R7.4, R1.4, R3.1, R3.2).
 *
 * The data is the ordered {@link WaterfallStep}[] from the pure
 * `computeWaterfall` helper. This component is PRESENTATIONAL only — it never
 * calls the helper (the server page / client island computes it), it takes the
 * steps as a prop and renders them.
 *
 * Shape + position tell the three kinds apart, never color alone (R1.4):
 * - **Institution asset steps** are *floating* bars that *rise* — each sits on
 *   top of the previous running total and climbs by its positive delta. Marked
 *   with a ▲ "asset" cue.
 * - **Liability steps** are *floating* bars that *drop* — each hangs from the
 *   previous running total down by its (negative) delta. Marked with a ▼
 *   "liability" cue.
 * - The **net-worth total** is a single *grounded* bar drawn from zero (not
 *   floating). Marked with a ■ "total" cue.
 * Every step is labeled, so position + shape + text all carry the meaning;
 * color (navy for assets, the reserved off-target amber for liabilities as a
 * *secondary* cue only, slate for the total) is a visual aid layered on top.
 *
 * Percent denominator: total assets (the sum of the positive asset-step
 * deltas). Each step's tooltip and text-alternative percent is its signed
 * dollar amount as a share of total assets, so a liability reads as "how much
 * of your assets this debt offsets" and the total bar reads as net worth as a
 * percent of total assets. Documented here because the design leaves the
 * meaningful denominator to the component.
 *
 * Accessibility mirrors {@link SensitivityTornado} / {@link CompositionBars}:
 * - The decorative bar graphic is `aria-hidden`, so it is never the only
 *   source of the data (R3.1).
 * - A visually-hidden `<dl>` carries the authoritative Text_Alternative — each
 *   step's label, signed dollars (delta), and running total, with tabular
 *   numerals — and the `<figure>` references it via `aria-labelledby`.
 * - Each step is a focusable Call_Out_Button so a keyboard user gets the same
 *   tooltip a mouse user gets on hover (R3.2): focus/hover reveals the step's
 *   label, signed dollars, percent of total assets, and running total;
 *   blur/leave dismisses it.
 */

/** Visual treatment for each step kind: color is a secondary cue only. */
const KIND_COLOR: Record<WaterfallStepKind, string> = {
  institution: SERIES.primary, // navy — assets
  liability: STATUS.offTarget, // reserved amber — liabilities (secondary cue only)
  total: '#475569', // slate — the grounded total
};

/** Shape glyph + word paired with every step so the kind never relies on color (R1.4). */
const KIND_CUE: Record<WaterfallStepKind, { glyph: string; word: string }> = {
  institution: { glyph: '▲', word: 'asset' },
  liability: { glyph: '▼', word: 'liability' },
  total: { glyph: '■', word: 'total' },
};

export interface NetWorthWaterfallProps {
  /**
   * The ordered waterfall steps from `computeWaterfall`: institution asset
   * subtotals, then each liability, ending at the grounded net-worth bar. When
   * empty the component exposes the unavailable message (if any) instead of a
   * graphic.
   */
  steps: WaterfallStep[];
  /**
   * Plain-language message exposed to assistive technology when there is no
   * waterfall to draw. Rendered in place of the chart; no graphic is drawn.
   */
  unavailableMessage?: string;
}

/** A step resolved to its drawable floating bar, as percentage offsets of the shared scale. */
interface WaterfallRow {
  step: WaterfallStep;
  /** Percentage offset (0..100) of the bar's bottom edge on the shared scale. */
  bottomPercent: number;
  /** Percentage height (0..100) of the bar. */
  heightPercent: number;
}

/** Percent of total assets a signed dollar amount represents; 0 when assets are non-positive. */
function percentOfAssets(value: number, totalAssets: number): number {
  if (!Number.isFinite(totalAssets) || totalAssets <= 0) {
    return 0;
  }
  return (value / totalAssets) * 100;
}

export function NetWorthWaterfall({
  steps,
  unavailableMessage,
}: NetWorthWaterfallProps) {
  const [active, setActive] = useState<number | null>(null);

  // Total assets = sum of the positive asset-step deltas. The shared percent
  // denominator for every tooltip and text-alternative figure.
  const totalAssets = useMemo(
    () =>
      steps.reduce(
        (sum, step) => (step.kind === 'institution' ? sum + step.delta : sum),
        0,
      ),
    [steps],
  );

  // Resolve each step to a floating (or grounded) bar on a shared vertical
  // scale spanning 0..max running total, so bar heights are comparable.
  const rows = useMemo<WaterfallRow[]>(() => {
    if (steps.length === 0) {
      return [];
    }

    // The scale spans from 0 (or the lowest running total, if ever negative)
    // up to the highest running total reached, so no bar clips.
    let min = 0;
    let max = 0;
    for (const step of steps) {
      min = Math.min(min, step.runningTotal);
      max = Math.max(max, step.runningTotal);
    }
    const span = max - min;
    const toPercent = (value: number) =>
      span === 0 ? 0 : ((value - min) / span) * 100;

    return steps.map((step) => {
      if (step.isTotal) {
        // Grounded bar: drawn from the scale's zero up to the net-worth total.
        const bottom = toPercent(min <= 0 ? 0 : min);
        const top = toPercent(step.runningTotal);
        return {
          step,
          bottomPercent: Math.min(bottom, top),
          heightPercent: Math.max(1, Math.abs(top - bottom)),
        };
      }
      // Floating bar: spans from the previous running total to this one, so an
      // asset step rises and a liability step drops.
      const previous = step.runningTotal - step.delta;
      const a = toPercent(previous);
      const b = toPercent(step.runningTotal);
      return {
        step,
        bottomPercent: Math.min(a, b),
        heightPercent: Math.max(1, Math.abs(b - a)),
      };
    });
  }, [steps]);

  if (rows.length === 0) {
    if (unavailableMessage) {
      return <p role="status">{unavailableMessage}</p>;
    }
    return null;
  }

  return (
    <figure
      aria-labelledby="net-worth-waterfall-alt"
      className="flex flex-col gap-4"
    >
      {/*
        Authoritative, screen-reader-only Text_Alternative (R3.1): each step's
        label, its signed dollars (delta), and the running total after it, with
        tabular numerals. The figure is labeled by this list so assistive tech
        announces the data rather than the decorative bars below.
      */}
      <dl id="net-worth-waterfall-alt" className="sr-only tabular-nums">
        <dt>
          {`How your accounts add up to net worth. Total assets ${formatCurrency(
            totalAssets,
          )}.`}
        </dt>
        {rows.map(({ step }, index) => {
          const cue = KIND_CUE[step.kind];
          const signedDollars = step.isTotal
            ? formatCurrency(step.runningTotal)
            : formatSignedCurrency(step.delta);
          return (
            <dd key={`${step.label}-${index}`}>
              {`${step.label} (${cue.word}): ${signedDollars}, running total ${formatCurrency(
                step.runningTotal,
              )}.`}
            </dd>
          );
        })}
      </dl>

      {/* Decorative floating-bar graphic: hidden from assistive tech, which reads the list above. */}
      <div
        aria-hidden="true"
        className="flex h-64 items-end gap-2 border-b border-slate-200"
      >
        {rows.map((row, index) => (
          <div
            key={`${row.step.label}-${index}`}
            className="relative flex h-full flex-1 flex-col justify-end"
          >
            <div className="relative h-full w-full">
              <div
                className="absolute w-full rounded-sm"
                style={{
                  bottom: `${row.bottomPercent}%`,
                  height: `${row.heightPercent}%`,
                  backgroundColor: KIND_COLOR[row.step.kind],
                  // Grounded total bar reads as a solid block; floating step
                  // bars get a subtle outline so a "floating" bar is legible
                  // even where the delta is small.
                  outline: row.step.isTotal
                    ? 'none'
                    : `1px solid ${KIND_COLOR[row.step.kind]}`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/*
        Keyboard-reachable call-outs. Because the bar graphic is aria-hidden,
        these focusable buttons give keyboard users the same tooltip a mouse
        user gets on hover (R3.2): each step, labeled with its shape cue + word
        (asset / liability / total — not color), its signed dollars, its percent
        of total assets, and its running total. Focus/hover shows the tooltip;
        blur/leave dismisses it.
      */}
      <ul className="flex flex-col gap-2">
        {rows.map(({ step }, index) => {
          const cue = KIND_CUE[step.kind];
          const isActive = active === index;
          const signedDollars = step.isTotal
            ? formatCurrency(step.runningTotal)
            : formatSignedCurrency(step.delta);
          const percent = percentOfAssets(
            step.isTotal ? step.runningTotal : step.delta,
            totalAssets,
          );
          return (
            <li key={`${step.label}-${index}`}>
              <button
                type="button"
                className="relative flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                <span className="flex items-baseline gap-1.5 text-xs text-slate-500">
                  <span aria-hidden="true">{cue.glyph}</span>
                  <span>{step.label}</span>
                  <span className="text-slate-400">({cue.word})</span>
                </span>
                <span className="text-sm font-semibold text-slate-900 tabular-nums">
                  {signedDollars}
                </span>
                {isActive ? (
                  <span
                    role="tooltip"
                    className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white tabular-nums shadow"
                  >
                    {`${step.label} (${cue.word}): ${signedDollars} (${formatPercent(
                      percent,
                    )} of total assets), running total ${formatCurrency(
                      step.runningTotal,
                    )}`}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

/**
 * Format a signed dollar delta with an explicit leading "+" for positive asset
 * steps (negative amounts already carry a minus sign from `formatCurrency`), so
 * the direction of each floating step is unambiguous in text as well as shape.
 */
function formatSignedCurrency(value: number): string {
  const formatted = formatCurrency(value);
  return value > 0 ? `+${formatted}` : formatted;
}

export default NetWorthWaterfall;
