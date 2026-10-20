# UI Style

Visual principles for the whole app. These apply to every view (dashboard,
projection, buy-vs-rent) and every component. They sit alongside, and never
override, the accessibility requirements already in the specs (contrast,
non-color indicators, keyboard access).

## Feel

- Calm, trustworthy private-banking dashboard — not a trading app. No tickers,
  no flashing, no dense data walls.
- Generous whitespace. Let sections breathe; prefer space over borders to
  separate content.
- Card-based layout. Each distinct idea (net worth, allocation, an account
  group, a scenario) lives on its own card.
- Clear hierarchy: the most important number on a card is the largest thing on
  it. Labels and secondary figures are visibly smaller and lighter. A card
  should answer "what's the one thing here?" at a glance.

## Color

A restrained palette. Color carries meaning sparingly; most of the UI is text
on near-white cards.

- **Primary text and headers:** deep navy (e.g. `#0f1e3d` / a `slate-900`-like
  tone   not pure   tone   not pure   tone   not pure   tone   not pure   tone   not pure  tt  tone   not pure   tone   not pure   tone   not pure   tone   not pure (`sk  tone   not pure   tone   not pure   tone   not pure   tone   not class colors:** one fixed color per class, used *everywh  tone   not pure   tone   not pure   tone   not pure   tone   not pure   tone A   tone   not pure   tone nges betwee  tone   not pure   tone   not pure   tone   not pure   tone   not p**Bonds** — teal (`#0d94  tone   not pure   tone   not pure   tone   not pure   tone   not pureaed`  tone   not ss color is always a *visual aid only* — never the sole way a class
  is identified (R9.6). Every slice/row   is identified (R9.6). Every slice/row   is identified (R9.6). Everyd red, reserved:** green means "on track," red means
  "off target." Use these two colors for nothing else. Always pair them with an
  icon or text (e.g. a check or ▲/▼ pl  icon or text (e.g. a check or ▲/▼ pl  icon or text (e.g. a check /amber m  icon or text (e.g. a check or ▲/▼ pl  icon or text (e.g. a check or ▲/▼ pl  icon or text (e.g. a check /amber m  icon or text (e.g. a check or ▲/▼ pl  icon or text (e.g. a check or ▲/▼ pl  icon or text (e.g. a check /amber m  icon or text (e.g. a check or ▲/▼ pl  icon or text (e.g. a check or ▲/▼ pl  icon or text (e.g. a check /amber m  icon or text (e.g. a check or ▲/▼ pl  icon or text (e.g. a check or ▲/▼ pl  icon or text (e.g. a check /amber m  icon or text (e.g. a check or ▲/▼ pl  icon or text (e.g. a check or ▲/▼ pl  icon or text (e.g. a check /amber m  icon or text (e.g. a check or ▲/▼ pl  icon or teic sans is
  fine; don't mix families).
- **Tabular numerals for all money and percentages** (`tabular-nums`) so figures
  line up in columns and don't jitter as va  line up in columns and don't jitter as va  line up in columns and don't jts — keep it everywhere numbers
  appear.
- Weight and size, not color, carry most of the hierarchy: large/bold for the
  headline figure, medium for labels, regular for supporting text.

## Charts

- Tooltips appear on **hover AND keyboard focus**, and show **both dollars and
  percent** for the focused element. A keyboard user tabbing through a chart
  must get the same information a mouse user gets on hover.
- No 3D effects, no drop shadows on data, no decorative gradients, no chart
  junk. Flat, honest shapes.
- Every chart has a programmatically associated text alternative conveying the
  same data (class names + one-decimal percentages), as already required (R9.1).
  The chart SVG itself is decorative and hidden from assistive tech.
- Prefer ranges over false precision in any chart that projects or estimates
  (per the product principles); don't imply more accuracy than the data has.

## Accessibility (non-negotiable)

These restate requirements already in the specs; the visual choices above must
never weaken them.

- Text and interactive contr- Text and interactive contr- Text and interactive contr- Text and intertors m- Text and interactive contr- Text and interact a
  manual audit.
- **Never rely on color alone.** Status, drift direction, and chart categories
  all carry a text or shape cue in addition to color.
- Everything interactive is **keyboard reachable and operable** with a visible
  focus indicator  focus indicator  focus indicator  focus indicator  focus indicators and messages.
