'use client';

import { useMemo, useState } from 'react';

import type { AssetClass, DriftResult } from '@/types/accounts';
import { ON_TRACK_THRESHOLD } from '@/lib/calculations/allocation';
import { CLASS_COLORS, CLASS_LABELS, STATUS } from '@/lib/chartColors';
import { formatCurrency, formatPercent } from '@/lib/format';

/**
 * Drift_Bars: per-class allocation drift as diverging horizontal bars for the
 * dashboard (Spec 4 R7.2, R7.4, R1.3, R1.4, R3.1, R3.2).
 *
 * Each row is one Asset_Class, in the canonical {@link CLASS_LABELS} order. Its
 * bar is centered on zero — the target weight — and extends RIGHT when the
 * class is over target (positive drift points) and LEFT when it is under
 * (negative drift points). The ±`ON_TRACK_THRESHOLD` band (±5 points) is shaded
 * behind the bars as the on-track tolerance zone, so "how far past the line"
 * reads at a glance.
 *
 * Direction and status are carried by POSITION (left/right of center) PLUS an
 * arrow (▲ over / ▼ under) PLUS text ("over" / "under" / "on track") — never by
 * color alone (R1.3, R1.4). The reserved {@link STATUS} colors (green on-track,
 * amber off-target) appear ONLY as a secondary cue on top of those non-color
 * signals; the bar itself uses the class color so it still reads as that class.
 *
 * This is a single-series chart, so there is no click-to-hide legend.
 *
 * Accessibility mirrors {@link SensitivityTornado} / {@link TwoPathChart}:
 * - The bar graphic is decorative and hidden from assistive technology
 *   (`aria-hidden`), so it is never the only source of the data (R3.1).
 * - A visually-hidden `<dl>` carries the authoritative Text_Alternative — each
 *   class's signed drift in points, its drift in dollars, and its on/over/under
 *   status — and the `<figure>` references it via `aria-labelledby`.
 * - Each class is a focusable Call_Out_Button: focusing or hovering it reveals a
 *   tooltip with that class's drift points AND drift dollars (R3.2), giving
 *   keyboard users the same information a mouse user gets on hover; blur/leave
 *   dismisses it.
 *
 * Presentational only: the resolved {@link DriftResult} in, markup out. No data
 * fetching; the only state is the transient focused/hovered tooltip target. The
 * caller computes drift via the pure `computeDrift` helper and passes it here.
 */

/** Minimum half-span (in points) for the scale, so tiny drifts still show the band. */
const MIN_HALF_SPAN = ON_TRACK_THRESHOLD * 1.5;

export interface DriftBarsProps {
  /**
   * The resolved per-class drift from `computeDrift`. When omitted the
   * component exposes the unavailable message (if any) instead of a graphic.
   */
  drift?: DriftResult;
  /**
   * The ±band half-width, in percentage points. Defaults to the shared
   * `ON_TRACK_THRESHOLD` (±5). Accepted as a prop so a caller can pass the same
   * constant explicitly, per the task.
   */
  onTrackThreshold?: number;
  /**
   * Plain-language message exposed to assistive technology when there is no
   * drift to draw. Rendered in place of the chart; no graphic is drawn.
   */
  unavailableMessage?: string;
}

/** A row ready to draw: the class, its drift, and its resolved bar geometry (percent of width). */
interface DriftRow {
  key: AssetClass;
  label: string;
  driftPoints: number;
  driftDollars: number;
  direction: 'on track' | 'over' | 'under';
  /** Center (target) line position across the scale, 0..100. */
  centerPercent: number;
  /** Left edge of the bar, 0..100. */
  leftPercent: number;
  /** Bar width as a percent of the full scale. */
  widthPercent: number;
}

/** The non-color direction cue for a class: an arrow symbol plus a word. */
function directionCue(direction: 'on track' | 'over' | 'under'): {
  arrow: string;
  word: string;
} {
  if (direction === 'over') {
    return { arrow: '▲', word: 'over' };
  }
  if (direction === 'under') {
    return { arrow: '▼', word: 'under' };
  }
  return { arrow: '•', word: 'on track' };
}

/** Signed drift in points, e.g. "+6.2 pts" / "−3.1 pts", with tabular-friendly text. */
function formatDriftPoints(driftPoints: number): string {
  const safe = Number.isFinite(driftPoints) ? driftPoints : 0;
  const sign = safe > 0 ? '+' : safe < 0 ? '−' : '';
  return `${sign}${formatPercent(Math.abs(safe))} pts`;
}

/** Signed drift in dollars, e.g. "+$12,000" / "−$4,500". */
function formatDriftDollars(driftDollars: number): string {
  const safe = Number.isFinite(driftDollars) ? driftDollars : 0;
  const sign = safe < 0 ? '−' : '+';
  return `${sign}${formatCurrency(Math.abs(safe))}`;
}

export function DriftBars({
  drift,
  onTrackThreshold = ON_TRACK_THRESHOLD,
  unavailableMessage,
}: DriftBarsProps) {
  const [tooltip, setTooltip] = useState<AssetClass | null>(null);

  const { rows, bandLeftPercent, bandWidthPercent, centerPercent } =
    useMemo(() => {
      if (!drift) {
        return {
          rows: [] as DriftRow[],
          bandLeftPercent: 0,
          bandWidthPercent: 0,
          centerPercent: 50,
        };
      }

      const classes = CLASS_LABELS.map(({ key, label }) => ({
        key,
        label,
        entry: drift.byClass[key],
      })).filter((c) => c.entry !== undefined);

      // Symmetric scale centered on zero (the target). The half-span covers the
      // largest absolute drift and at least the shaded band, so every bar and the
      // ±threshold band fit without clipping and the center line stays at 50%.
      let halfSpan = Math.max(MIN_HALF_SPAN, onTrackThreshold);
      for (const c of classes) {
        halfSpan = Math.max(halfSpan, Math.abs(c.entry.driftPoints));
      }
      const fullSpan = halfSpan * 2;
      const center = 50;
      const toPercent = (points: number) =>
        ((points + halfSpan) / fullSpan) * 100;

      const builtRows: DriftRow[] = classes.map((c) => {
        const points = c.entry.driftPoints;
        const zeroPercent = center;
        const valuePercent = toPercent(points);
        const leftPercent = Math.min(zeroPercent, valuePercent);
        const widthPercent = Math.max(0.5, Math.abs(valuePercent - zeroPercent));
        return {
          key: c.key,
          label: c.label,
          driftPoints: points,
          driftDollars: c.entry.driftDollars,
          direction: c.entry.direction,
          centerPercent: center,
          leftPercent,
          widthPercent,
        };
      });

      return {
        rows: builtRows,
        bandLeftPercent: toPercent(-onTrackThreshold),
        bandWidthPercent: toPercent(onTrackThreshold) - toPercent(-onTrackThreshold),
        centerPercent: center,
      };
    }, [drift, onTrackThreshold]);

  if (rows.length === 0) {
    if (unavailableMessage) {
      return <p role="status">{unavailableMessage}</p>;
    }
    return null;
  }

  return (
    <figure aria-labelledby="drift-bars-alt" className="flex flex-col gap-4">
      {/*
        Authoritative, screen-reader-only Text_Alternative: each class's signed
        drift in points, its drift in dollars, and its on/over/under status. The
        figure is labeled by this list so assistive tech announces the data
        rather than the decorative SVG bars below.
      */}
      <dl id="drift-bars-alt" className="sr-only tabular-nums">
        <dt>
          {`Allocation drift from target by asset class, in percentage points. On track within plus or minus ${onTrackThreshold} points.`}
        </dt>
        {rows.map((row) => {
          const cue = directionCue(row.direction);
          return (
            <dd key={row.key}>
              {`${row.label}: ${formatDriftPoints(row.driftPoints)}, ${formatDriftDollars(
                row.driftDollars,
              )}, ${cue.word}.`}
            </dd>
          );
        })}
      </dl>

      {/* Decorative bar graphic: hidden from assistive tech, which reads the list above. */}
      <div aria-hidden="true" className="relative flex flex-col gap-3">
        {/* The shaded ±threshold on-track band, behind the bars. */}
        <div
          className="pointer-events-none absolute inset-y-0 rounded-sm bg-slate-100"
          style={{ left: `${bandLeftPercent}%`, width: `${bandWidthPercent}%` }}
        />
        {/* The center (target) reference line. */}
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-slate-400"
          style={{ left: `${centerPercent}%` }}
        />
        {rows.map((row) => (
          <DriftBar key={row.key} row={row} />
        ))}
      </div>

      {/*
        Keyboard-reachable call-outs. Because the bar graphic is aria-hidden,
        these focusable buttons give keyboard users the same tooltip a mouse user
        gets on hover (R3.2): each class, its drift in points and dollars, and
        its direction shown by an arrow + text (color is only a secondary cue).
        Focus/hover shows the tooltip; blur/leave dismisses it.
      */}
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key}>
            <DriftCallOut
              row={row}
              active={tooltip === row.key}
              onShow={() => setTooltip(row.key)}
              onHide={() => setTooltip(null)}
            />
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * One decorative diverging bar for a class, drawn from the center (target) line
 * out to its drift. Filled with the class color so it still reads as that class;
 * direction/status are carried by the call-out's arrow + text, not this fill.
 */
function DriftBar({ row }: { row: DriftRow }) {
  return (
    <div className="relative h-6">
      <div
        className="absolute inset-y-1 rounded-sm"
        style={{
          left: `${row.leftPercent}%`,
          width: `${row.widthPercent}%`,
          backgroundColor: CLASS_COLORS[row.key],
        }}
      />
    </div>
  );
}

/**
 * A focusable call-out for one class. Shows the drift direction (arrow + text,
 * never color alone), the signed drift in points, and the signed drift in
 * dollars; focus/hover reveals a tooltip repeating the same, blur/leave
 * dismisses it. The reserved status color tints the arrow/word ONLY as a
 * secondary cue on top of the arrow glyph and the word themselves (R1.3).
 */
function DriftCallOut({
  row,
  active,
  onShow,
  onHide,
}: {
  row: DriftRow;
  active: boolean;
  onShow: () => void;
  onHide: () => void;
}) {
  const cue = directionCue(row.direction);
  const statusColor =
    row.direction === 'on track' ? STATUS.onTrack : STATUS.offTarget;

  return (
    <button
      type="button"
      className="relative flex w-full items-baseline justify-between gap-3 rounded px-2 py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
      onMouseEnter={onShow}
      onMouseLeave={onHide}
      onFocus={onShow}
      onBlur={onHide}
    >
      <span className="flex items-baseline gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 shrink-0 rounded-sm"
          style={{ backgroundColor: CLASS_COLORS[row.key] }}
        />
        <span className="text-sm font-medium text-slate-700">{row.label}</span>
      </span>
      <span className="flex items-baseline gap-2 tabular-nums">
        <span className="text-sm font-semibold" style={{ color: statusColor }}>
          <span aria-hidden="true">{`${cue.arrow} `}</span>
          {cue.word}
        </span>
        <span className="text-sm font-semibold text-slate-900">
          {formatDriftPoints(row.driftPoints)}
        </span>
      </span>
      {active ? (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white tabular-nums shadow"
        >
          {`${row.label}: ${formatDriftPoints(row.driftPoints)} (${formatDriftDollars(
            row.driftDollars,
          )}) — ${cue.word}`}
        </span>
      ) : null}
    </button>
  );
}

export default DriftBars;
