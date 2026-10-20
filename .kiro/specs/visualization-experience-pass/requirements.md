# Requirements Document

## Introduction

This feature is a visualization and experience pass across all three existing views of the Jane
Wealth Hub: the dashboard (Spec 1), the long-term projection (Spec 2), and the buy-vs-rent scenario
tester (Spec 3). The core flows already work, but the interface is too plain to tell the product's
story — where the user is today, where they are headed, and the buy-vs-rent decision. This spec
upgrades the visual experience only.

It changes **no calculation logic**. Every number already displayed stays identical. All new chart
data comes from the existing pure calculation functions; where a needed shape does not yet exist, a
new **pure, tested helper** is added under `lib/calculations/` rather than computing in components,
consistent with the project's separation rules. All visual choices follow `ui-style.md` (calm,
card-based, navy/teal palette, tabular numerals, never color alone) and must never weaken the
accessibility requirements already in the prior specs (a text alternative per chart, non-color cues,
keyboard reachability, tooltips on hover and focus).

The buy-vs-rent view (the product hero) receives the richest treatment: a two-path net-worth chart
with ranges and a labeled breakeven marker, a sensitivity tornado chart, a year-10 composition
stacked-bar chart, and a live slider strip for the three assumptions users most want to explore,
bound to the same assumption state as the full panel. The projection view gains a fan chart with
10/20/30-year markers and a current-vs-target overlay plus a stacked-area "if you never rebalance"
growth-by-class chart. The dashboard gains a donut with a target outer ring, diverging drift bars
with a shaded tolerance band, and a net-worth waterfall. Across the app, the top navigation is
reframed as Today / Future / Decision, every chart shows dollars and percent in its tooltips,
multi-series charts support click-to-hide legends, asset-class colors are consistent everywhere, and
all views are responsive to phone width.

The following are explicitly out of scope: any change to a calculation result, requirement, data
source, or market series; Monte Carlo simulation; persistence; and component/integration tests. The
only automated tests in scope are example-based unit tests for the new pure helpers.

## Glossary

- **Visualization_Pass**: This spec — the set of presentation and interaction upgrades across the
  three existing views, adding no new calculation results.
- **Shared_Color_Module**: The single source of truth for chart colors at `lib/chartColors.ts`, a
  pure constants module (no React) exporting the Asset_Class color map, the canonical class labels,
  the series/path palette, and the reserved status colors. Imported by every chart and legend.
- **Asset_Class**: One of four buckets — stocks, bonds, cash, other — as defined in Spec 1.
- **Class_Color**: The one fixed color assigned to an Asset_Class, identical in every view.
- **Series_Color**: A navy/teal palette color used for a chart series or path (e.g. Buy/Current =
  navy, Rent/Target = teal), where a shape or text cue always accompanies the color.
- **Status_Color**: The reserved green ("on track") and amber/red ("off target") colors, used for
  nothing else and always paired with an icon, arrow, or text.
- **Text_Alternative**: The programmatically associated, screen-reader-only description of a chart
  (a `<figure aria-labelledby>` referencing an `sr-only` list) conveying the same data as the chart —
  class/series names with one-decimal percentages and dollar values — while the chart SVG is
  `aria-hidden`. Required for every chart, per the prior specs.
- **Call_Out_Button**: A keyboard-focusable button rendered outside the decorative chart SVG that
  surfaces the same tooltip on focus as a mouse user gets on hover, within the existing time budget.
- **Multi_Series_Chart**: A chart drawing more than one toggleable series or segment — the two-path
  chart, the fan chart, the stacked-area growth-by-class chart, and the composition bars.
- **Single_Series_Chart**: A chart with one conceptual series — the donut, the drift bars, the
  tornado, and the waterfall — which does not offer click-to-hide.
- **Click_To_Hide_Legend**: An interactive legend on a Multi_Series_Chart whose items are buttons
  that toggle a series/segment hidden or shown, with the hidden state reflected in the chart and in
  the Text_Alternative.
- **Primary_Nav**: The top navigation at `components/layout/PrimaryNav.tsx`, framing the three views
  as Today (dashboard), Future (projection), and Decision (buy-vs-rent), each with a short descriptor.
- **Two_Path_Chart**: The buy-vs-rent chart drawing the Buy and Rent net-worth bands (years 0..10)
  with each base line, a labeled Breakeven_Marker, and dollars-and-percent tooltips.
- **Breakeven_Marker**: A labeled visual reference at the Breakeven_Year on the Two_Path_Chart, with
  the breakeven statement also present in the Text_Alternative; absent when there is no breakeven.
- **Sensitivity_Tornado**: The buy-vs-rent horizontal diverging-bar chart of the assumptions whose
  perturbation most moves the year-10 Buy-minus-Rent gap in dollars, top 6 by magnitude, sorted
  largest first, each bar labeled with the low and high input values used.
- **Composition_Bars**: The buy-vs-rent year-10 stacked-bar chart showing Buy as home equity plus
  side investments and Rent as investments only.
- **Slider_Strip**: The buy-vs-rent control strip titled "Typically the biggest drivers," sitting
  directly above the Two_Path_Chart, with live sliders for exactly three assumptions — home
  appreciation rate, mortgage rate, and expected investment return — bound to the same assumption
  state as the full Assumption_Panel.
- **Return_Override**: The island-level mechanism by which the expected-investment-return slider
  feeds a chosen base return into the existing `computeComparison`, without altering any calculator;
  cleared by the panel's reset control.
- **Fan_Chart**: The projection chart drawing the pessimistic-to-optimistic band as a shaded fan with
  the base line, 10/20/30-year markers, and the current and target allocation series overlaid.
- **Growth_By_Class_Area**: The projection stacked-area chart of per-Asset_Class value over the
  horizon, projected independently with no rebalancing, framed "If you never rebalance."
- **Allocation_Donut**: The dashboard donut chart of the actual allocation with the target allocation
  drawn as an outer ring.
- **Drift_Bars**: The dashboard diverging horizontal bars of per-class drift in points, with the ±5
  On_Track_Threshold band shaded, and over/under direction shown with an arrow or text.
- **Net_Worth_Waterfall**: The dashboard waterfall where each institution's asset subtotal stacks up
  to total assets, each liability is an itemized downward step, and the final bar is net worth.
- **New_Helper**: Any new pure function added under `lib/calculations/` to supply data a chart needs
  that the existing calculators do not expose: `computeTornado`, `computeYear10Composition`,
  `projectByClass`, and `computeWaterfall`.

## Requirements

### Requirement 1: Single Source of Truth for Chart Colors

**User Story:** As a user comparing views, I want each asset class to look the same everywhere, so
that I can connect what I see on the dashboard, the projection, and the decision view.

#### Acceptance Criteria

1. THE Visualization_Pass SHALL define all chart colors in the Shared_Color_Module, and every chart
   and legend SHALL import its Class_Color, Series_Color, and Status_Color values from that module
   rather than defining its own color constants.
2. THE Shared_Color_Module SHALL assign exactly one Class_Color per Asset_Class, reconciled to the
   `ui-style.md` palette, and that color SHALL be used for that Asset_Class in every view.
3. THE Shared_Color_Module SHALL reserve the Status_Color green and amber/red for on-track and
   off-target meaning only, and no other chart element SHALL use those reserved colors.
4. WHERE a chart element is distinguished for the user, THE Visualization_Pass SHALL provide a shape,
   pattern, marker, arrow, or text cue in addition to color, so no element is identified by color
   alone.

### Requirement 2: New Pure Helpers Supply All New Chart Data

**User Story:** As a maintainer, I want new chart data to come from pure, tested functions, so that
the separation between calculation and presentation holds and the math stays verifiable.

#### Acceptance Criteria

1. THE Visualization_Pass SHALL NOT change any existing calculation result; every value already
   displayed by the three views SHALL remain identical after this spec.
2. WHERE a chart needs data the existing calculators do not expose, THE Visualization_Pass SHALL add
   a New_Helper under `lib/calculations/` that is pure (inputs in, numbers out; no imports from
   `app/`, `components/`, or `lib/fred/`; no fetch, no localStorage, no clock) rather than computing
   the value inside a component.
3. THE `computeTornado` New_Helper SHALL return, for each editable buy-vs-rent assumption, the low
   and high input values under a down and up perturbation by the existing sensitivity step and clamp
   bounds, the resulting year-10 Buy-minus-Rent gap at each end, and a swing magnitude, sorted by
   swing descending with the existing deterministic tie-break.
4. THE `computeYear10Composition` New_Helper SHALL return the base-band year-10 Buy net worth split
   into home equity and side investments and the base-band year-10 Rent net worth as investments,
   such that the Buy components sum to the base-band year-10 Buy value and the Rent value equals the
   base-band year-10 Rent value computed by the existing calculator on the same inputs.
5. THE `projectByClass` New_Helper SHALL project each Asset_Class independently at its own expected
   return with no rebalancing, returning a year-by-year series per class whose year-0 values equal
   the starting per-class dollars.
6. THE `computeWaterfall` New_Helper SHALL return ordered steps in which each institution's asset
   subtotal is a positive step, each liability is its own negative step, and the final step's running
   total equals the net worth computed by the existing calculator.
7. THE Visualization_Pass SHALL cover each New_Helper with example-based Vitest unit tests in
   `lib/calculations/__tests__/`, and SHALL add no component or integration tests.

### Requirement 3: Every Chart Remains Accessible

**User Story:** As a user relying on a keyboard or a screen reader, I want every chart to be
perceivable and operable, so that the richer visuals do not lock me out.

#### Acceptance Criteria

1. THE Visualization_Pass SHALL give every chart a Text_Alternative conveying the same data as the
   chart, and SHALL keep the chart SVG hidden from assistive technology.
2. THE Visualization_Pass SHALL show a tooltip for a focused or hovered chart element that includes
   both the dollar value and the percent for that element, and SHALL surface it on both pointer hover
   and keyboard focus via a Call_Out_Button, dismissing it on blur or leave.
3. THE Visualization_Pass SHALL make every interactive control — sliders, Click_To_Hide_Legend
   buttons, Call_Out_Buttons, and Primary_Nav links — keyboard reachable and operable with a visible
   focus indicator.
4. WHEN a series or segment is hidden via a Click_To_Hide_Legend, THE Visualization_Pass SHALL
   reflect the hidden state in the chart and annotate it as hidden in the Text_Alternative.

### Requirement 4: Top Navigation Frames the Three Views

**User Story:** As a user, I want the navigation to name the story — today, the future, and the
decision — so that I understand what each view is for.

#### Acceptance Criteria

1. THE Primary_Nav SHALL present the dashboard as "Today," the projection as "Future," and the
   buy-vs-rent view as "Decision," each with a short descriptor beneath the primary label.
2. THE Primary_Nav SHALL indicate the active view with a non-color cue (for example a bold weight and
   an underline) in addition to any color, and SHALL mark it with `aria-current`.
3. THE Primary_Nav SHALL keep every destination reachable from every view and operable by keyboard
   with a visible focus indicator.

### Requirement 5: Buy-vs-Rent Hero Visualization

**User Story:** As someone deciding whether to buy, I want the decision shown at a glance with live
controls, so that I can explore the tradeoff quickly and see what drives it.

#### Acceptance Criteria

1. THE buy-vs-rent view SHALL present, in order: a one-sentence verdict headline; the Slider_Strip
   directly above the full-width Two_Path_Chart; the Composition_Bars; the Sensitivity_Tornado; and
   then the existing detail cards.
2. THE Two_Path_Chart SHALL draw the Buy and Rent net-worth ranges as pessimistic-to-optimistic bands
   with each base line, distinguished by a shape cue and a labeled legend rather than color alone,
   and SHALL show a labeled Breakeven_Marker when a breakeven exists and none when it does not.
3. THE Slider_Strip SHALL provide live sliders for exactly three assumptions — home appreciation
   rate, mortgage rate, and expected investment return — titled "Typically the biggest drivers," and
   SHALL keep the three controls in a fixed order that does not reorder while a slider is dragged.
4. THE Slider_Strip and the full Assumption_Panel SHALL read and write the same single assumption
   state, so moving a slider updates the corresponding panel value and editing the panel moves the
   corresponding slider, with no second copy of any value.
5. WHEN a Slider_Strip control or an Assumption_Panel field changes, THE buy-vs-rent view SHALL
   recompute the comparison and update the affected charts live, via the existing `computeComparison`,
   with the expected-investment-return slider feeding its value through the Return_Override without
   altering any calculator.
6. THE Composition_Bars SHALL show the year-10 Buy net worth as a stack of home equity and side
   investments and the year-10 Rent net worth as investments only, with each segment labeled and
   each bar's Text_Alternative listing the segment dollars and percent of the bar total.
7. THE Sensitivity_Tornado SHALL show the top 6 assumptions by swing in the year-10 Buy-minus-Rent
   gap, sorted largest first, each bar labeled with the low and high input values used, with
   direction shown by position plus an arrow or text rather than color alone.

### Requirement 6: Projection Visualization

**User Story:** As a user planning for the future, I want to see my projected range and how my mix
would drift, so that I understand both the uncertainty and the long-run shape of my portfolio.

#### Acceptance Criteria

1. THE Fan_Chart SHALL draw the pessimistic-to-optimistic band as a shaded fan with the base line,
   and SHALL mark the 10-, 20-, and 30-year horizons with labeled markers.
2. THE Fan_Chart SHALL overlay the current-allocation and target-allocation series, distinguished by
   a shape cue (solid versus dashed) and a labeled legend rather than color alone, and SHALL honor
   the existing nominal / today's-dollars toggle for the displayed values.
3. THE Growth_By_Class_Area SHALL draw a stacked area of each Asset_Class value over the horizon from
   the `projectByClass` New_Helper, using the Shared_Color_Module Class_Colors.
4. THE Growth_By_Class_Area SHALL be framed "If you never rebalance" and SHALL include a one-line note
   that its total differs from the base projection, which assumes the mix stays constant.
5. THE Fan_Chart and the Growth_By_Class_Area SHALL each offer a Click_To_Hide_Legend and a
   Text_Alternative listing values and percents at the 10-, 20-, and 30-year horizons, reflecting any
   hidden series.

### Requirement 7: Dashboard Visualization

**User Story:** As a user checking where I stand today, I want to see my allocation against target,
my drift, and how my accounts add up to net worth, so that today's picture is clear at a glance.

#### Acceptance Criteria

1. THE Allocation_Donut SHALL draw the actual allocation as a donut with the target allocation as an
   outer ring, each Asset_Class using its Shared_Color_Module Class_Color, with the target ring
   distinguished by position and a label rather than a different hue per class.
2. THE Drift_Bars SHALL draw per-class drift in points as diverging bars centered at the target, with
   the ±5 On_Track_Threshold band shaded, and SHALL indicate over or under with an arrow or text in
   addition to any color.
3. THE Net_Worth_Waterfall SHALL draw each institution's asset subtotal stacking up to total assets,
   each liability as an itemized downward step, and the final bar as net worth, from the
   `computeWaterfall` New_Helper, with each step labeled and distinguished by shape and position
   rather than color alone.
4. THE Allocation_Donut, Drift_Bars, and Net_Worth_Waterfall SHALL each provide a Text_Alternative
   conveying the same data (class or step names with dollars and one-decimal percentages) and SHALL
   show dollars-and-percent tooltips on hover and keyboard focus.

### Requirement 8: Responsive, Calm Layout

**User Story:** As a user on any device, I want the views to stay calm and readable from desktop down
to phone width, so that the richer charts do not become cramped or overwhelming.

#### Acceptance Criteria

1. THE Visualization_Pass SHALL render every view in a single-column stack at phone width with no
   horizontal scrolling, and MAY use a two-column arrangement for secondary cards on wider screens.
2. THE buy-vs-rent view SHALL keep the Slider_Strip and the Two_Path_Chart full width at every
   breakpoint, placing only the secondary detail cards in the optional two-column arrangement.
3. THE Visualization_Pass SHALL follow `ui-style.md` — card-per-idea, generous whitespace, tabular
   numerals for money and percentages, and a clear size-and-weight hierarchy — without weakening any
   accessibility requirement in this document.
