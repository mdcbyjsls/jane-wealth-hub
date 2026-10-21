'use client';

/**
 * Shared chart legend (Spec 4 — Cross-app building blocks → ChartLegend).
 *
 * One legend used by every chart. Each item renders a color swatch PLUS a
 * shape/pattern cue (a solid line sample, a dashed line sample, or a filled
 * swatch marker) PLUS the text label PLUS an optional value. The shape and the
 * text make each series identifiable without relying on color alone (R1.4,
 * carrying forward R9.6 from the prior specs).
 *
 * Two modes, selected by whether `onToggle` is supplied:
 *
 * - **Static** (`onToggle` omitted) — single-series charts. Plain,
 *   non-interactive `<li>` items. No buttons, no toggling.
 * - **Interactive** (`onToggle` provided) — multi-series charts. Each item is a
 *   `<button>` with `aria-pressed` reflecting whether the series is currently
 *   visible, keyboard operable with a visible focus-visible ring. Clicking (or
 *   activating via the keyboard) calls `onToggle(id)`. The caller owns the
 *   `hidden` set and re-renders with it updated — this component is controlled
 *   and keeps no state of its own (R3.3, R3.4).
 *
 * Hidden items (present in the controlled `hidden` set) are visually
 * de-emphasized and annotated "(hidden)" so the state is perceivable; the
 * chart's own sr-only text alternative carries the authoritative hidden
 * annotation for assistive tech, per the design.
 *
 * Presentational only: items in, markup out. No data fetching, no color
 * constants of its own — callers pass colors from `@/lib/chartColors`.
 */

/** The shape cue drawn alongside the color for a legend item. */
export type LegendShape = 'solid' | 'dashed' | 'swatch';

export interface LegendItem {
  /** Stable identifier; the value passed back to `onToggle`. */
  id: string;
  /** Plain-language series/segment name. */
  label: string;
  /** The item's color (from `@/lib/chartColors`; a visual aid only). */
  color: string;
  /** Shape cue: a solid line, a dashed line, or a filled swatch marker. */
  shape: LegendShape;
  /** Optional value shown after the label (e.g. a dollar or percent figure). */
  valueText?: string;
}

export interface ChartLegendProps {
  /** The legend items, in display order. */
  items: LegendItem[];
  /**
   * Controlled set of hidden item ids (multi-series charts). An item whose id
   * is in this set is de-emphasized and marked hidden. Defaults to empty.
   */
  hidden?: Set<string>;
  /**
   * Toggle handler. When provided the legend is interactive (each item is a
   * toggle button); when omitted the legend is a static, non-interactive list.
   */
  onToggle?: (id: string) => void;
}

/**
 * The shape/pattern cue drawn next to the label. For `solid`/`dashed` it is a
 * short line sample (matching the solid/dashed convention charts use for their
 * base lines); for `swatch` it is a filled rounded marker. Always decorative —
 * the text label carries the meaning — so it is hidden from assistive tech.
 */
function ShapeCue({ shape, color }: { shape: LegendShape; color: string }) {
  if (shape === 'swatch') {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 shrink-0 rounded-sm"
        style={{ backgroundColor: color }}
      />
    );
  }
  return (
    <svg
      aria-hidden="true"
      width="28"
      height="12"
      viewBox="0 0 28 12"
      className="shrink-0"
    >
      <line
        x1="0"
        y1="6"
        x2="28"
        y2="6"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={shape === 'dashed' ? '6 4' : undefined}
      />
    </svg>
  );
}

/** The label + optional value text for an item. */
function LegendContent({ item }: { item: LegendItem }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-sm font-medium text-slate-700">{item.label}</span>
      {item.valueText ? (
        <span className="text-sm text-slate-500 tabular-nums">
          {item.valueText}
        </span>
      ) : null}
    </span>
  );
}

export function ChartLegend({ items, hidden, onToggle }: ChartLegendProps) {
  const hiddenSet = hidden ?? EMPTY;
  const interactive = typeof onToggle === 'function';

  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2">
      {items.map((item) => {
        const isHidden = hiddenSet.has(item.id);

        if (!interactive) {
          // Static mode — single-series charts. Plain, non-interactive item.
          return (
            <li key={item.id} className="flex items-center gap-2">
              <ShapeCue shape={item.shape} color={item.color} />
              <LegendContent item={item} />
            </li>
          );
        }

        // Interactive mode — multi-series charts. A toggle button whose
        // `aria-pressed` reflects visible (true) / hidden (false); a visible
        // focus-visible ring; hidden items de-emphasized and annotated.
        return (
          <li key={item.id} className="flex">
            <button
              type="button"
              aria-pressed={!isHidden}
              onClick={() => onToggle(item.id)}
              className={`flex items-center gap-2 rounded px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
                isHidden ? 'opacity-40' : ''
              }`}
            >
              <ShapeCue shape={item.shape} color={item.color} />
              <LegendContent item={item} />
              {isHidden ? (
                <span className="text-xs font-medium text-slate-500">
                  (hidden)
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Shared empty set so an omitted `hidden` prop doesn't allocate each render. */
const EMPTY: ReadonlySet<string> = new Set<string>();

export default ChartLegend;
