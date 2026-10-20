# Implementation Plan: Visualization & Experience Pass (Spec 4)

## Overview

This plan implements the Spec 4 visualization/experience upgrade across all three views on top of the
completed Specs 1–3. It follows the design exactly and the project's separation rules: new pure
calculators live in `lib/calculations/` (numbers in, numbers out; no imports from `app/`,
`components/`, or `lib/fred/`; no fetch, no `localStorage`, no clock) with Vitest unit tests in
`lib/calculations/__tests__/`; charts stay presentational; client islands keep owning state and
calling the calculators. No existing calculation result changes, so the current 68 tests must keep
passing unchanged.

Work is ordered so the shared color module and the four new pure helpers (with their unit tests) land
first, then the shared chart building blocks (legend), then each view's charts and layout, then the
navigation relabel, then a final verification + manual accessibility audit. The expected-investment-
return slider uses the island-level Return_Override feeding the existing `computeComparison`; no
calculator is modified.

Per the design's Testing Strategy and Requirement 2.7, testing scope is strictly example-based Vitest
unit tests for the four new pure helpers. There are no component or integration tests. Those test
sub-tasks are required (the helpers are the only new logic); all other tasks are implementation/UI.

## Tasks

- [x] 1. Add the shared color module (single source of truth)
  - [x] 1.1 Implement `lib/chartColors.ts`
    - Pure constants module, no React imports; imports only `AssetClass` from `@/types/accounts`
    - Export `CLASS_COLORS` (one color per Asset_Class, reconciled to the `ui-style.md` navy/teal
      palette: stocks navy, bonds teal, cash muted slate, other taupe), `CLASS_LABELS` (canonical
      order + labels), `SERIES` (primary/secondary + band tints for Buy/Current and Rent/Target), and
      `STATUS` (reserved on-track green / off-target amber)
    - _Requirements: 1.1, 1.2, 1.3_
    - _Design: Shared color module (`lib/chartColors.ts`)_
  - [x] 1.2 Migrate existing color consumers to the shared module
    - Re-export `CLASS_COLORS`/`CLASS_LABELS` from `components/charts/AllocationPie.tsx` (or its
      successor) so existing imports keep working; remove the local color constants in
      `ProjectionChart.tsx` and `ComparisonChart.tsx` and the per-class map in `AllocationPie.tsx`,
      pointing all of them at `lib/chartColors.ts`
    - Verify no component defines its own chart color constant afterward
    - _Requirements: 1.1_
    - _Design: Architecture & separation; Shared color module_

- [x] 2. Implement the four new pure helpers with unit tests
  - [x] 2.1 Implement `lib/calculations/sensitivityTornado.ts`
    - Add `TornadoEntry` (to `types/buyVsRent.ts`) and `computeTornado(assumptions,
      startingAssetsTotal, baseReturnPercent, multipliers)`; perturb each editable assumption down and
      up by the existing `SENSITIVITY_STEP` and clamp bounds, recompute the base-band year-10
      Buy-minus-Rent gap each way via `buildBands`, return entries with `lowInput`/`highInput`/
      `lowGap`/`highGap`/`baseGap`/`swing` sorted by `swing` descending with the existing
      deterministic tie-break
    - _Requirements: 2.2, 2.3_
    - _Design: New pure helpers → 1. sensitivityTornado_
  - [ ]* 2.2 Unit-test `computeTornado` in `lib/calculations/__tests__/sensitivityTornado.test.ts`
    - Assert exact `lowGap`/`highGap`/`swing` for a fixed input; the descending sort and tie-break
      order; the clamp respected at a bound; gap sign consistent with `computeVerdict` on the inputs
    - _Requirements: 2.3, 2.7_
    - _Design: Testing strategy_
  - [x] 2.3 Implement `lib/calculations/composition.ts`
    - Add `Year10Composition` (to `types/buyVsRent.ts`) and `computeYear10Composition(assumptions,
      startingAssetsTotal, baseReturnPercent)`; re-derive the base-band year-10 home equity (home
      value − loan balance − year-10 selling cost), side investments, and the Rent investments from
      the same inputs `computePaths` uses, without modifying `computePaths`
    - _Requirements: 2.2, 2.4_
    - _Design: New pure helpers → 2. composition_
  - [ ]* 2.4 Unit-test `computeYear10Composition` in `lib/calculations/__tests__/composition.test.ts`
    - Assert `buy.homeEquity + buy.sideInvestments` equals `buildBands(...).buy.base[10]` and
      `rent.investments` equals `...rent.base[10]` on the same inputs; selling cost reflected in
      year-10 equity; a zero-appreciation / zero-side-investment case
    - _Requirements: 2.4, 2.7_
    - _Design: Testing strategy_
  - [x] 2.5 Implement `lib/calculations/projectByClass.ts`
    - Implement `projectByClass(classDollars, returnModel, currentYear, maxYears?)` projecting each
      Asset_Class independently via the existing `projectSeries` at its own
      `returnModel[class].returnPercent` with zero contribution; return `Record<AssetClass,
      ProjectedPoint[]>` for years 0..maxYears (default `PROJECTION_MAX_YEARS`); the module reads no
      clock (caller supplies `currentYear`)
    - _Requirements: 2.2, 2.5_
    - _Design: New pure helpers → 3. projectByClass_
  - [ ]* 2.6 Unit-test `projectByClass` in `lib/calculations/__tests__/projectByClass.test.ts`
    - Assert each class equals an independent `projectSeries` at its class rate; year-0 equals the
      starting dollars; the four summed at year 0 equal the starting total; a higher-return class
      grows to a larger share by year N (drift direction)
    - _Requirements: 2.5, 2.7_
    - _Design: Testing strategy_
  - [x] 2.7 Implement `lib/calculations/waterfall.ts`
    - Add `WaterfallStep`/`WaterfallStepKind` (to `types/accounts.ts`) and `computeWaterfall(groups,
      netWorth)`; split each `InstitutionGroup` into its asset-subtotal step (`institution`) and its
      liability accounts (individual `liability` steps), end with the net-worth total bar; carry
      `delta`, `runningTotal`, and `isTotal`; final `runningTotal` equals `netWorth.netWorth`
    - _Requirements: 2.2, 2.6_
    - _Design: New pure helpers → 4. waterfall_
  - [ ]* 2.8 Unit-test `computeWaterfall` in `lib/calculations/__tests__/waterfall.test.ts`
    - Assert final `runningTotal` equals net worth; asset steps sum to total assets; liability steps
      sum to −total liabilities; running totals monotonic up through assets then down through
      liabilities; single-liability and all-asset fixtures
    - _Requirements: 2.6, 2.7_
    - _Design: Testing strategy_

- [x] 3. Checkpoint — helpers and colors
  - Ensure the new unit tests pass and the existing 68 tests still pass unchanged; typecheck and
    build clean. Ask the user if questions arise.

- [x] 4. Add the shared chart building blocks
  - [x] 4.1 Implement `components/charts/ChartLegend.tsx`
    - Shared legend: each item is a swatch + a shape/pattern cue (solid/dashed/marker) + text label +
      optional value; static when `onToggle` is omitted (single-series), interactive when provided
      (multi-series) with `<button aria-pressed>` and a visible focus-visible ring; controlled
      `hidden` set
    - _Requirements: 1.4, 3.3, 3.4_
    - _Design: Cross-app building blocks → ChartLegend_

- [x] 5. Build the buy-vs-rent (hero) visualization
  - [x] 5.1 Implement `components/ui/SliderStrip.tsx`
    - "Typically the biggest drivers" strip with three fixed-order live sliders (home appreciation,
      mortgage rate, expected investment return); each slider is a labeled `<input type="range">` with
      the same clamp bounds as the panel, an inline value readout, a source label/as-of where one
      exists, a visible focus ring; emits committed values via the same reducer the panel uses
    - _Requirements: 5.3, 5.4, 3.3_
    - _Design: Per-view → Buy-vs-Rent; Slider ↔ panel binding_
  - [x] 5.2 Evolve the two-path chart into `components/charts/TwoPathChart.tsx`
    - Keep the existing band + base-line + Call_Out_Button + Text_Alternative pattern; add a labeled
      Breakeven_Marker (visual reference + existing text-alt sentence); add a Click_To_Hide_Legend
      (toggle Buy/Rent) reflected in the text alternative; tooltips show dollars and percent; colors
      from `SERIES`, Buy solid / Rent dashed
    - _Requirements: 5.2, 3.1, 3.2, 3.4, 1.1_
    - _Design: Per-view → Buy-vs-Rent → TwoPathChart_
  - [x] 5.3 Implement `components/charts/CompositionBars.tsx`
    - Two stacked year-10 bars (Buy = home equity + side investments; Rent = investments) from
      `computeYear10Composition`; labeled segments + Click_To_Hide_Legend; Text_Alternative lists each
      segment's dollars and percent of its bar; tooltips dollars + percent
    - _Requirements: 5.6, 3.1, 3.2, 3.4, 1.1, 1.4_
    - _Design: Per-view → Buy-vs-Rent → CompositionBars_
  - [x] 5.4 Implement `components/charts/SensitivityTornado.tsx`
    - Horizontal diverging bars from `computeTornado(...).slice(0, 6)`, largest first, centered on the
      base gap; each bar labeled with its low/high input values and the dollar gap at each end;
      direction by position + arrow/text (not color alone); Text_Alternative lists each assumption's
      low/high inputs and gaps
    - _Requirements: 5.7, 3.1, 3.2, 1.4_
    - _Design: Per-view → Buy-vs-Rent → SensitivityTornado_
  - [x] 5.5 Wire the hero into `components/layout/BuyVsRentClient.tsx` and `app/buy-vs-rent/page.tsx`
    - Add the verdict headline above the chart; mount the SliderStrip directly above the full-width
      TwoPathChart; add CompositionBars then SensitivityTornado; keep the existing detail cards below
      in a two-column (wide) / one-column (phone) arrangement, hero full width
    - Bind the SliderStrip to the single `assumptions` state via the existing `handleChange`; add the
      island-level Return_Override state for the expected-investment-return slider, feeding its value
      into `computeComparison`'s base return and clearing on reset; charts recompute live
    - _Requirements: 5.1, 5.4, 5.5, 8.1, 8.2_
    - _Design: Per-view → Buy-vs-Rent; Slider ↔ panel binding; Return override_

- [x] 6. Build the projection visualization
  - [x] 6.1 Evolve the projection chart into `components/charts/FanChart.tsx`
    - Shaded pessimistic→optimistic fan + base line; labeled 10/20/30-year markers; current (solid
      navy) and target (dashed teal) overlays via shape + legend; honor the existing DollarBasisToggle;
      Click_To_Hide_Legend (current/target) reflected in the text alternative; tooltips dollars +
      percent-change-from-base; colors from `SERIES`
    - _Requirements: 6.1, 6.2, 6.5, 3.1, 3.2, 3.4, 1.1_
    - _Design: Per-view → Projection → FanChart_
  - [x] 6.2 Implement `components/charts/GrowthByClassArea.tsx`
    - Stacked area of per-class value over the horizon from `projectByClass`; `CLASS_COLORS`;
      "If you never rebalance" heading + the one-line divergence note; Click_To_Hide_Legend reflected
      in the text alternative; Text_Alternative lists each class value + percent at 10/20/30
    - _Requirements: 6.3, 6.4, 6.5, 3.1, 3.2, 3.4, 1.1_
    - _Design: Per-view → Projection → GrowthByClassArea_
  - [x] 6.3 Mount both projection charts in `components/layout/ProjectionClient.tsx`
    - Replace the current projection chart with FanChart; add GrowthByClassArea below, fed by
      `projectByClass(allocation.classDollars, returnModel, currentYear)`; keep responsive layout
    - _Requirements: 6.1, 6.3, 8.1, 8.3_
    - _Design: Per-view → Projection_

- [x] 7. Build the dashboard visualization
  - [x] 7.1 Evolve the pie into `components/charts/AllocationDonut.tsx`
    - Donut of actual allocation + target as an outer ring; `CLASS_COLORS`; target ring distinguished
      by position + label (not a different hue); static legend with swatch + label + actual% and
      target%; Text_Alternative lists each class's actual and target percentages; tooltips dollars +
      percent
    - _Requirements: 7.1, 7.4, 3.1, 3.2, 1.1_
    - _Design: Per-view → Dashboard → AllocationDonut_
  - [x] 7.2 Implement `components/charts/DriftBars.tsx`
    - Diverging per-class bars (drift points) centered at zero with the ±5 On_Track_Threshold band
      shaded; over/under by arrow + text (reserved `STATUS` color only as secondary cue);
      Text_Alternative lists each class's drift points, drift dollars, and status; tooltips dollars +
      percent; from the existing `computeDrift` output
    - _Requirements: 7.2, 7.4, 1.3, 1.4, 3.1, 3.2_
    - _Design: Per-view → Dashboard → DriftBars_
  - [x] 7.3 Implement `components/charts/NetWorthWaterfall.tsx`
    - Floating step bars (institution assets up, liabilities down) + grounded net-worth total bar from
      `computeWaterfall`; each step labeled; asset/liability/total told apart by shape + position (not
      color alone); Text_Alternative lists each step's label, signed dollars, and running total;
      tooltips dollars + percent
    - _Requirements: 7.3, 7.4, 1.4, 3.1, 3.2_
    - _Design: Per-view → Dashboard → NetWorthWaterfall_
  - [x] 7.4 Mount the dashboard charts in `components/layout/DashboardClient.tsx` and
        `app/page.tsx`
    - Replace the pie with AllocationDonut in the allocation section; add DriftBars near the on-track
      status; compute `computeWaterfall(groups, netWorth)` on the server page and render
      NetWorthWaterfall (server-side if it needs the institution Dates, else pass serializable steps);
      keep the five-state routing and responsive layout
    - _Requirements: 7.1, 7.2, 7.3, 8.1, 8.3_
    - _Design: Per-view → Dashboard_

- [x] 8. Relabel the primary navigation
  - [x] 8.1 Update `components/layout/PrimaryNav.tsx` to Today / Future / Decision
    - Primary word + descriptor beneath (Today — Net worth & allocation; Future — Long-term
      projection; Decision — Buy vs. rent); keep routes, `aria-current`, the non-color active cue
      (bold + underline), and the focus-visible ring
    - _Requirements: 4.1, 4.2, 4.3_
    - _Design: Per-view → Nav_

- [x] 9. Final checkpoint — full visualization pass
  - Run the full suite (new helper tests + existing 68), typecheck, and build; confirm no calculation
    result changed. Do a manual accessibility audit pass (contrast ≥ 4.5:1 text / 3:1 non-text, focus
    rings, keyboard operation of sliders and click-to-hide legends, tooltips on hover and focus,
    hidden-state reflected in text alternatives). Verify phone-width single-column layout with no
    horizontal scroll. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are the only test tasks in scope: example-based Vitest unit tests for the four
  new pure helpers (2.2, 2.4, 2.6, 2.8). There are no component or integration tests, per Requirement
  2.7 and the design's Testing Strategy.
- No existing calculation result changes. The existing 68 tests are a regression gate and must pass
  unchanged throughout.
- The expected-investment-return slider uses the island-level Return_Override feeding the existing
  `computeComparison`; no calculator is modified. The SliderStrip and the full Assumption_Panel share
  the single `assumptions` state (one source of truth) via the existing `handleChange` reducer.
- All chart colors come from `lib/chartColors.ts`; no component defines its own chart color constants.
- Chart components may either rename existing files (ComparisonChart→TwoPathChart,
  ProjectionChart→FanChart, AllocationPie→AllocationDonut) or evolve them in place; the exported
  contracts in the design are what matter.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.3", "2.5", "2.7"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6", "2.8", "4.1"] },
    { "id": 3, "tasks": ["3"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "5.4", "6.1", "6.2", "7.1", "7.2", "7.3", "8.1"] },
    { "id": 5, "tasks": ["5.5", "6.3", "7.4"] },
    { "id": 6, "tasks": ["9"] }
  ]
}
```
