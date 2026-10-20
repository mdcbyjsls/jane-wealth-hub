# Design: Visualization & Experience Pass (Spec 4)

## Overview

This spec is a visual and interaction upgrade across all three views. It changes **no**
calculation logic: every number already shown stays identical. New chart data comes from the
existing pure calculators, and where a needed shape does not exist yet, we add a **pure, tested
helper** in `lib/calculations/` rather than computing in components (per the tech and structure
steering rules). All visual choices follow `ui-style.md` (calm, card-based, navy/teal palette,
tabular numerals, never color alone) and never weaken the accessibility requirements already in the
prior specs (text alternative per chart, non-color cues, keyboard reachability).

Scope is organized by priority: Buy-vs-Rent (hero) first, then Projection, then Dashboard, then the
cross-app concerns (nav, tooltips, click-to-hide legends, shared colors, responsiveness).

### Decisions locked with the user

1. **One shared color module** is the single source of truth, reconciled to `ui-style.md`. Asset
   classes look identical in every view; dashboard colors change as a result, and that is intended.
2. **Live sliders** are a separate "What matters most" strip above the two-path chart, **bound to
   the same assumption state** as the full panel (two-way: slider ↔ panel). Fixed set of three:
   home appreciation, mortgage rate, expected investment return. Labeled "Typically the biggest
   drivers." Controls never reorder while dragging.
3. **Tornado** shows the effect on the **year-10 Buy − Rent gap in dollars**, top 6 by magnitude,
   largest first, each bar labeled with the **low and high input values** used.
4. **Stacked area** is **independent per-class growth, no rebalancing**, framed "If you never
   rebalance," with a one-line note that the total differs from the base projection (which assumes a
   constant mix). The divergence is a feature — it visualizes drift.
5. **Waterfall** is **per-institution** granularity; liabilities are **itemized as separate steps**.
6. **Nav** uses Today / Future / Decision as primary labels with a short descriptor underneath.
7. **Click-to-hide legends** only on multi-series charts (two-path, fan, stacked area, composition);
   hidden state is reflected in the **text alternative**.
8. **Buy-vs-Rent layout**: one-sentence verdict headline → slider strip + two-path chart (full
   width) → composition → tornado → existing detail cards (two-column on wide screens for the
   secondary cards only; hero stays full width; one column on phone).

### Non-goals

- No change to any calculation result, requirement, or data source.
- No new automated tests beyond unit tests for the **new pure helpers**. No component tests.
- No Monte Carlo, no new market series, no persistence.

---

## Architecture & separation

The existing boundaries hold exactly:

- `lib/calculations/` stays pure (numbers in, numbers out; no UI, no fetch, no clock). New helpers
  live here with Vitest tests in `lib/calculations/__tests__/`.
- Client islands (`DashboardClient`, `ProjectionClient`, `BuyVsRentClient`) keep owning state and
  calling the calculators; charts stay presentational.
- A **new** shared presentation module `lib/chartColors.ts` (pure constants, no React) becomes the
  single source of truth for asset-class and series/path colors. It imports only the `AssetClass`
  type. Chart components and the legend/swatch UI import from it; the per-component local color
  constants and the `CLASS_COLORS`/`CLASS_LABELS` currently in `AllocationPie.tsx` are removed and
  re-exported from the shared module for backward-compatible imports during the migration.

```
lib/
  chartColors.ts                 # NEW: single source of truth for all chart colors + class labels
  calculations/
    composition.ts               # NEW: year-10 Buy composition breakdown (pure)
    sensitivityTornado.ts        # NEW: signed two-sided sensitivity (pure)
    projectByClass.ts            # NEW: per-class year-by-year projection, no rebalancing (pure)
    waterfall.ts                 # NEW: net-worth waterfall steps (pure)
    __tests__/
      composition.test.ts        # NEW
      sensitivityTornado.test.ts # NEW
      projectByClass.test.ts     # NEW
      waterfall.test.ts          # NEW
components/
  charts/
    TwoPathChart.tsx             # two-path net worth + ranges + breakeven marker (evolves ComparisonChart)
    SensitivityTornado.tsx       # NEW
    CompositionBars.tsx          # NEW: year-10 stacked composition
    FanChart.tsx                 # projection fan + 10/20/30 markers + current/target overlay (evolves ProjectionChart)
    GrowthByClassArea.tsx        # NEW: stacked area, no rebalancing
    AllocationDonut.tsx          # donut + target outer ring (evolves AllocationPie)
    DriftBars.tsx                # NEW: diverging drift bars with shaded ±5 band
    NetWorthWaterfall.tsx        # NEW
    ChartLegend.tsx              # NEW: shared, optionally click-to-hide legend
  ui/
    SliderStrip.tsx              # NEW: "Typically the biggest drivers" three-slider strip
  layout/
    PrimaryNav.tsx               # relabel to Today/Future/Decision + descriptors
```

Naming note: the design introduces new, clearer chart names (`TwoPathChart`, `FanChart`,
`AllocationDonut`). Implementation may either rename the existing files or keep the existing
filenames and evolve them in place — the task plan will pick one; either way the exported component
contracts below are what matters.

---

## New pure helpers (the only new tested logic)

Each helper is deterministic, imports only types and existing pure calculators, and gets
example-based Vitest unit tests. Signatures below are the contract.

### 1. `lib/calculations/sensitivityTornado.ts` — signed two-sided sensitivity

The existing `rankSensitivity` perturbs each assumption **once** (a single relative step) and returns
an absolute magnitude. A tornado needs both a **down** and an **up** perturbation per assumption and
the resulting signed gaps, plus the actual low/high input values so the bars can be labeled.

```ts
export interface TornadoEntry {
  key: keyof BuyVsRentAssumptions;
  label: string;              // plain-language assumption name
  lowInput: number;           // the assumption value at the down perturbation
  highInput: number;          // the assumption value at the up perturbation
  lowGap: number;             // year-10 (Buy − Rent) with the low input, all else fixed
  highGap: number;            // year-10 (Buy − Rent) with the high input, all else fixed
  baseGap: number;            // year-10 (Buy − Rent) at the unperturbed base (same for every entry)
  swing: number;              // |highGap − lowGap|, the ranking magnitude
}

/**
 * Two-sided sensitivity of the year-10 Buy − Rent gap to each editable assumption.
 * Perturbs each assumption down and up by SENSITIVITY_STEP (reusing buyVsRent's constant and the
 * same clamp bounds), recomputes the base-band year-10 gap each way via buildBands, and returns the
 * entries sorted by `swing` descending with the existing deterministic fixed-order tie-break.
 * Pure: inputs in, array out — no fetch, no localStorage, no clock.
 */
export function computeTornado(
  assumptions: BuyVsRentAssumptions,
  startingAssetsTotal: number,
  baseReturnPercent: number,
  multipliers: ScenarioMultipliers,
): TornadoEntry[];
```

Reuses `buildBands` and the year-10 gap exactly as `rankSensitivity` defines it, so the tornado is
consistent with the existing ranking. The UI takes `.slice(0, 6)`.

**Tests:** exact `lowGap`/`highGap`/`swing` for a fixed input; correct descending sort and tie-break
order; clamp respected at a bound (e.g. mortgage rate near 0 or 20); gap sign consistent with
`computeVerdict` on the same inputs.

### 2. `lib/calculations/composition.ts` — year-10 Buy composition

`computePaths` computes home value, loan balance, equity, and side investment internally but
discards the breakdown. This helper re-derives the **year-10 components** for the base band so the
stacked bars can show Buy = (home equity + side investments) vs Rent = (investments only). It does
not change `computePaths`; it computes the same quantities from the same inputs so results match.

```ts
export interface Year10Composition {
  buy: {
    homeEquity: number;        // Home_Value(10) − Loan_Balance(10) − year-10 selling cost
    sideInvestments: number;   // Buy_Path side investment at year 10
    total: number;             // homeEquity + sideInvestments (== bands.buy.base[10])
  };
  rent: {
    investments: number;       // Rent_Path invested balance at year 10 (== bands.rent.base[10])
    total: number;             // == investments
  };
}

/** Pure breakdown of the base-band year-10 net worth into stackable components. */
export function computeYear10Composition(
  assumptions: BuyVsRentAssumptions,
  startingAssetsTotal: number,
  baseReturnPercent: number,
): Year10Composition;
```

**Tests:** `buy.homeEquity + buy.sideInvestments` equals `bands.buy.base[10]` from `buildBands` on
the same inputs (consistency); `rent.investments` equals `bands.rent.base[10]`; selling cost is
reflected in year-10 equity; a zero-appreciation / zero-side-investment case.

### 3. `lib/calculations/projectByClass.ts` — per-class growth, no rebalancing

Projection currently blends the four classes into one rate before projecting, so per-class series do
not exist. This helper projects **each class independently** at its own expected return, with **no
rebalancing**, so the mix drifts over time — the point of the chart.

```ts
/** Per-class year-by-year nominal values, each class compounding at its own rate. years 0..maxYears. */
export function projectByClass(
  classDollars: ClassTotals,                 // starting dollars per class (AllocationResult.classDollars)
  returnModel: ReturnModel,                  // per-class expected returns (Spec 2 deriveReturnModel)
  currentYear: number,                       // supplied; helper never reads the clock
  maxYears?: number,                         // default PROJECTION_MAX_YEARS (30)
): Record<AssetClass, ProjectedPoint[]>;
```

Each class uses the existing `projectSeries` with its own `returnModel[class].returnPercent` and zero
contribution. The sum across classes is deliberately **not** equal to the blended base projection;
the view states this explicitly. Optional per-band variants are out of scope — the stacked area shows
the base scenario only.

**Tests:** each class equals an independent `projectSeries` at its class rate; year-0 equals the
starting dollars; the four series summed at year 0 equals the starting total; a higher-return class
grows to a larger share by year N (drift direction).

### 4. `lib/calculations/waterfall.ts` — net-worth waterfall steps

Produces the ordered steps for the waterfall: each **institution** asset subtotal stacking up to
total assets, then **each liability** itemized as a downward step, ending at net worth. Built from
the already-computed `InstitutionGroup[]` and `NetWorthResult` (no new account math).

```ts
export type WaterfallStepKind = 'institution' | 'liability' | 'total';

export interface WaterfallStep {
  label: string;             // institution name, liability name, or "Net worth"
  kind: WaterfallStepKind;
  delta: number;             // signed contribution (+ assets, − liabilities); 0 for the total marker
  runningTotal: number;      // cumulative value after this step
  isTotal: boolean;          // true for the final net-worth bar (drawn from 0, not floating)
}

/**
 * Ordered waterfall from institution asset subtotals (ascending stack) through itemized liabilities
 * down to net worth. Asset institutions contribute their non-liability subtotal; each liability
 * account is its own negative step; the final step is the net-worth total bar. Pure: data in,
 * ordered steps out.
 */
export function computeWaterfall(
  groups: InstitutionGroup[],
  netWorth: NetWorthResult,
): WaterfallStep[];
```

Because institutions may contain both asset and liability accounts, the helper splits each group
into its asset portion (an `institution` step) and its liability accounts (individual `liability`
steps). The final `runningTotal` equals `netWorth.netWorth`.

**Tests:** final `runningTotal` equals `netWorth.netWorth`; asset steps sum to `totalAssets`;
liability steps sum to `−totalLiabilities`; running totals are monotonic through the asset steps and
decrease through liabilities; a single-liability fixture matches today's data; an all-asset fixture
has exactly one total step and no liability steps.

---

## Shared color module (`lib/chartColors.ts`)

Single source of truth, reconciled to `ui-style.md`. No React imports.

```ts
import type { AssetClass } from '@/types/accounts';

/** Fixed one-color-per-class map, used everywhere a class appears (ui-style). */
export const CLASS_COLORS: Record<AssetClass, string> = {
  stocks: '#0f1e3d', // deep navy (primary)
  bonds:  '#0d94ae', // teal (ui-style names bonds teal)
  cash:   '#6b7a99', // muted slate-blue
  other:  '#b0806a', // warm taupe
};

/** Canonical display order + labels, reused by every legend and text alternative. */
export const CLASS_LABELS: ReadonlyArray<{ key: AssetClass; label: string }> = [
  { key: 'stocks', label: 'Stocks' },
  { key: 'bonds', label: 'Bonds' },
  { key: 'cash', label: 'Cash' },
  { key: 'other', label: 'Other' },
];

/** Series/path colors for the comparison and projection charts (shape still carries meaning). */
export const SERIES = {
  primary:   '#0f1e3d', // navy — Buy / Current
  primaryBand: '#c7d2e8',
  secondary: '#0d94ae', // teal — Rent / Target
  secondaryBand: '#cdeaf0',
} as const;

/** Reserved status colors — green = on track, red/amber = off target. Never used for anything else. */
export const STATUS = {
  onTrack: '#15803d',    // green-700
  offTarget: '#b45309',  // amber-700
} as const;
```

Final contrast of these exact hues against the near-white cards (text/interactive ≥ 4.5:1, non-text
≥ 3:1) and the status pairing (always with an icon/▲▼/text, never color alone) are confirmed in the
manual accessibility audit step, consistent with how the prior specs defer final contrast to a manual
pass. The specific `cash`/`other`/status hex values may be nudged in implementation to clear the
ratio; the **structure** (one map, class = same color everywhere, reserved status colors) is fixed.

`AllocationPie.tsx`'s current exports are replaced by re-exports from this module so existing imports
(`AllocationShiftCard`, etc.) keep working.

---

## Cross-app building blocks

### `components/charts/ChartLegend.tsx`

Shared legend used by every chart. For **multi-series** charts it is interactive (click-to-hide); for
single-series charts it is static.

- Each legend item: a color swatch + **a shape/pattern cue** (solid vs dashed line sample, or a
  distinct marker) + the text label + the value. The shape and text mean the series is identifiable
  without color (R9.6).
- Interactive mode: each item is a `<button>` with `aria-pressed` reflecting visible/hidden. Clicking
  toggles the series in the chart **and** in the text alternative. Keyboard operable with a visible
  focus-visible ring.
- Hidden series are excluded from the chart and marked in the sr-only `<dl>` (e.g. the item is
  annotated "(hidden)"), so assistive-tech users perceive the same state.

Props (sketch):

```ts
interface LegendItem { id: string; label: string; color: string; shape: 'solid' | 'dashed' | 'swatch'; valueText?: string; }
interface ChartLegendProps {
  items: LegendItem[];
  hidden?: Set<string>;              // controlled hidden set (multi-series charts)
  onToggle?: (id: string) => void;  // omitted → static legend (single-series)
}
```

### Tooltips (all charts)

The established pattern stays: a row of **focusable call-out buttons** outside the decorative SVG, so
hover and keyboard focus both surface the tooltip within the existing budget. Every tooltip now shows
**both dollars and percent** for the focused element (ui-style requirement):

- Two-path / fan / composition: dollars plus percent-of-relevant-base (fan uses percent change from
  the projected base, as today; composition uses percent of that path's year-10 total).
- Donut / drift: dollars plus percent (donut shows class % and class $; drift shows drift points and
  drift $).
- Tornado: each bar's low/high **input values** and the resulting dollar gap at each end.

### Responsiveness

All charts wrap in Recharts `ResponsiveContainer` (already the norm). Layout uses a single-column
stack on phones; cards go two-column (`sm:`/`lg:` grid) on wider screens. The hero two-path chart and
the slider strip are always full width. Call-out/tooltip rows wrap. Minimum support target is phone
width (~360px) with no horizontal scroll.

---

## Per-view design

### Buy-vs-Rent (hero) — `app/buy-vs-rent/page.tsx` + `BuyVsRentClient`

Page order (top to bottom), matching the agreed layout:

1. **Verdict headline** — one sentence ("Buying ends about $X ahead of renting in 10 years," or the
   reverse / tie), from the existing `VerdictCard` data, promoted to a prominent headline above the
   chart. Plain language, active Dollar_Basis.
2. **Slider strip (`SliderStrip`) + two-path chart (`TwoPathChart`)**, full width. The strip sits
   directly above the chart and is labeled "Typically the biggest drivers." Three sliders: home
   appreciation rate, mortgage rate, expected investment return.
3. **Composition (`CompositionBars`)** — year-10 stacked bars: Buy = home equity + side investments,
   Rent = investments only.
4. **Tornado (`SensitivityTornado`)** — top 6 assumptions by swing, each bar labeled with low/high
   input values.
5. **Detail cards** — existing `BuyVsRentComparisonSummary`, `VerdictCard` detail, `SensitivityCard`,
   `CushionCard`, `AllocationShiftCard`, and the full `BuyVsRentAssumptionPanel`. Two-column on wide
   screens; one column on phone.

**Slider ↔ panel binding.** The three sliders and the full panel both read and write the single
`assumptions` state already owned by `BuyVsRentClient`. A slider's `onChange` calls the same committing
reducer the panel uses (`handleChange(field, value)`); the panel's number inputs reflect the same
state, so moving a slider updates the panel and editing the panel moves the slider. There is exactly
one source of truth — no duplicated value. Sliders are continuous (`<input type="range">`) with the
same clamp bounds and inline value readout; the pure `computeComparison` runs on every change (already
sub-second), so the chart updates live. Each slider still shows its market source label/as-of where
one exists (mortgage rate → MORTGAGE30US; appreciation → CSUSHPINSA; investment return → derived),
preserving "every assumption is sourced."

**Expected investment return as a slider.** Investment return is derived today (not a direct editable
field). To expose it as a live slider without changing calculation logic, the island adds a single
**return override** that, when set, replaces the derived base return fed to `computeComparison` for
that run; cleared by Reset. This is an island-level input wiring, not a change to any calculator. (If
preferred during implementation, the slider can instead drive the optimistic/pessimistic multipliers;
the design's intent is "a live control over expected return" — the exact lever is an implementation
detail resolved in the task, documented either way.)

**`TwoPathChart`** evolves the current `ComparisonChart`: adds a **labeled breakeven marker** (a
vertical reference at `breakevenYear` with a visible text label, and a sentence in the text
alternative — already present), click-to-hide legend (toggle Buy / Rent bands), and dollars+percent
tooltips. Buy is solid navy, Rent is dashed teal (shape carries meaning). Ranges render as the
pessimistic→optimistic band exactly as today.

**`CompositionBars`** — two stacked bars (Buy, Rent) at year 10. Buy stacks home equity + side
investments; Rent is a single investments segment. Segments use distinct fills **and** labeled
legend entries; the sr-only alt lists each segment's dollars and percent of that bar's total.
Multi-series → click-to-hide the segments.

**`SensitivityTornado`** — horizontal diverging bars centered on the base gap, one per assumption
(top 6 by `swing`), sorted largest first. Each bar is labeled with its **low and high input values**
and the dollar gap at each end. Direction (which way the bar points) is reinforced with ▲/▼ or a text
label, not color alone. Text alternative lists each assumption with its low/high inputs and resulting
gaps.

### Projection — `app/projection/page.tsx` + `ProjectionClient`

Two charts:

1. **`FanChart`** (evolves `ProjectionChart`) — the pessimistic→optimistic **band** as a shaded fan,
   the base as a line, with **10/20/30-year markers** (reference lines/dots with labeled call-outs),
   and the **current vs target allocation overlaid** (current = solid navy band+line, target = dashed
   teal band+line — the existing shape convention). The **nominal / today's-dollars toggle**
   (`DollarBasisToggle`) stays and drives the displayed values. Click-to-hide legend toggles
   current/target overlays. Tooltips show dollars + percent change from the projected base (as today).
   The 10/20/30 call-out buttons remain the keyboard-accessible tooltip surface.
2. **`GrowthByClassArea`** — stacked area of per-class value over the horizon, from `projectByClass`.
   Framed with a heading "If you never rebalance" and a one-line note: the stacked total differs from
   the base projection above, which assumes your mix stays constant. Classes use the shared
   `CLASS_COLORS`; legend is click-to-hide; the sr-only alt lists each class's value and percent at
   10/20/30 and notes any hidden class. This visualizes drift (stocks taking over), tying back to the
   dashboard.

### Dashboard — `app/page.tsx` + `DashboardClient`

Three charts:

1. **`AllocationDonut`** (evolves `AllocationPie`) — a donut of the actual allocation with the
   **target as an outer ring**. Both rings use `CLASS_COLORS` (same class, same color); the target
   ring is visually distinguished by position (outer) **and** labeled, not by a different hue per
   class. Single primary series for actual + an outer target ring; legend pairs swatch + label +
   actual% and target%. The sr-only alt lists each class's actual and target percentages. (Single
   conceptual series → static legend; no click-to-hide required here.) Tooltips show class dollars
   and percent.
2. **`DriftBars`** — diverging horizontal bars, one per class, centered at zero (target), showing
   drift in points. The **±5 On_Track_Threshold band is shaded** behind the bars so "within band"
   reads at a glance. Over/under direction uses ▲/▼ + text (and the reserved status colors only as a
   secondary cue), never color alone. The sr-only alt lists each class's drift points and dollars and
   its on/over/under status. Uses existing `computeDrift` output; no new math.
3. **`NetWorthWaterfall`** — institution asset subtotals stacking up to total assets, each liability
   as a downward step, ending at the net-worth total bar, from `computeWaterfall`. Floating bars for
   steps, a grounded bar for the total. Each step labeled; asset vs liability vs total distinguished
   by shape/label and position, not color alone. The sr-only alt lists each step's label, signed
   dollars, and running total.

### Nav — `components/layout/PrimaryNav.tsx`

Relabel the three items to primary word + descriptor, keeping routes and the existing active-state
accessibility (aria-current + bold + underline bar, not color alone):

| Route | Primary | Descriptor |
|---|---|---|
| `/` | Today | Net worth & allocation |
| `/projection` | Future | Long-term projection |
| `/buy-vs-rent` | Decision | Buy vs. rent |

The primary word is the larger/bolder line; the descriptor is smaller and lighter beneath it.

---

## Accessibility (restated, non-negotiable)

- **Every chart** has a programmatically associated sr-only text alternative conveying the same data
  (class names / series + one-decimal percentages and dollars). The SVG stays `aria-hidden`.
- **Never color alone:** every series/segment/slice/bar carries a shape, pattern, marker, ▲/▼, or
  text cue in addition to color. Status (on track / off target) always pairs color with icon or text.
- **Keyboard:** every interactive control (sliders, click-to-hide legend buttons, call-out tooltip
  buttons, nav links) is reachable and operable with a visible focus-visible indicator.
- **Click-to-hide reflected in text:** hidden series are annotated as hidden in the text alternative
  so assistive-tech users perceive the same visible state.
- **Tooltips** appear on hover **and** keyboard focus and show **both dollars and percent**.
- Final contrast ratios (text/interactive ≥ 4.5:1, non-text ≥ 3:1, focus ring ≥ 3:1) are confirmed in
  a manual audit pass, consistent with prior specs.

---

## Testing strategy

Per the user's scope: **unit tests only for the new pure helpers**, no component tests.

- `sensitivityTornado.test.ts` — signed deltas, swing, sort/tie-break, clamp, sign consistency.
- `composition.test.ts` — buy components sum to the base-band year-10 buy value; rent equals the
  base-band year-10 rent value; selling-cost reflected; zero-case.
- `projectByClass.test.ts` — per-class equals independent `projectSeries`; year-0 equals starting
  dollars; sum-at-0 equals total; drift direction for a higher-return class.
- `waterfall.test.ts` — final running total equals net worth; asset steps sum to total assets;
  liability steps sum to −total liabilities; ordering/monotonicity; single-liability and all-asset
  fixtures.

Existing calculator tests and the build/typecheck remain the regression gate. No projection,
buy-vs-rent, or allocation result changes, so the current 68 tests must still pass unchanged.

---

## Risks & mitigations

- **Color reconciliation is a visible change.** Mitigated by one shared module so the change is
  consistent and reviewable in one place; dashboard hue change is intended and approved.
- **Return-as-slider wiring** must not alter calculator logic. Mitigated by keeping the override at
  the island boundary feeding `computeComparison`; the calculator is untouched and the task documents
  the exact lever.
- **Stacked-area total diverging from the base line** could confuse. Mitigated by the explicit "If you
  never rebalance" framing and the one-line note — it is presented as insight, not inconsistency.
- **Chart proliferation vs. calm aesthetic.** Mitigated by the card-per-idea layout, generous
  whitespace, hero-first ordering, and collapsing to one column on phone.
```