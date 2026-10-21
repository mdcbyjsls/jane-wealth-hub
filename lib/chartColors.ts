import type { AssetClass } from '@/types/accounts';

/**
 * Single source of truth for every chart color in the app (Spec 4 R1.1–R1.3),
 * reconciled to `ui-style.md`'s calm navy/teal palette. Pure constants only —
 * no React imports, importing only the `AssetClass` type — so charts, legends,
 * and text alternatives all draw a class in exactly the same color in every
 * view (dashboard, projection, buy-vs-rent).
 *
 * Color is always a visual aid, never the sole cue: callers pair every slice,
 * segment, line, and status with a shape, marker, arrow, or text label.
 */

/** Fixed one-color-per-class map, used everywhere a class appears (ui-style). */
export const CLASS_COLORS: Record<AssetClass, string> = {
  stocks: '#0f1e3d', // deep navy (primary)
  bonds: '#0d94ae', // teal (ui-style names bonds teal)
  cash: '#6b7a99', // muted slate-blue
  other: '#b0806a', // warm taupe
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
  primary: '#0f1e3d', // navy — Buy / Current
  primaryBand: '#c7d2e8', // navy band tint — Buy / Current range
  secondary: '#0d94ae', // teal — Rent / Target
  secondaryBand: '#cdeaf0', // teal band tint — Rent / Target range
} as const;

/** Reserved status colors — green = on track, red/amber = off target. Never used for anything else. */
export const STATUS = {
  onTrack: '#15803d', // green-700
  offTarget: '#b45309', // amber-700
} as const;
