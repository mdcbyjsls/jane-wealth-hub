import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { classifyDrift, ON_TRACK_THRESHOLD } from '@/lib/calculations/allocation';

/**
 * Property-based test for `classifyDrift` (Task 9.5).
 *
 * Property 8 (design.md): "Drift classification follows the ±5 threshold. For any percentage-point
 * drift value, `classifyDrift` returns 'on track' when the absolute value is less than or equal to
 * 5, 'over' when the drift is greater than positive 5, and 'under' when the drift is less than
 * negative 5."
 *
 * Validates: Requirements 4.3, 4.4, 4.5
 *
 * The arbitrary mixes a wide range of finite drift values with values deliberately clustered around
 * the ±5 boundary (including exactly +5 and -5, which are on track, inclusive), so the band edges
 * are exercised rather than relying on a broad uniform draw to land on them. The expectation is
 * derived independently from `ON_TRACK_THRESHOLD` — the single source of truth — rather than
 * hard-coding 5, so the test and the implementation can never disagree about the boundary.
 */

/** A drift value anywhere across a wide finite range. */
const wideDriftArb = fc.double({
  min: -1000,
  max: 1000,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * A drift value within a tight window around the ±5 band edges, so both boundaries (and the exact
 * ±5 values) are hit with meaningful frequency instead of by chance.
 */
const nearBoundaryArb = fc.oneof(
  fc.double({ min: ON_TRACK_THRESHOLD - 0.5, max: ON_TRACK_THRESHOLD + 0.5, noNaN: true, noDefaultInfinity: true }),
  fc.double({ min: -ON_TRACK_THRESHOLD - 0.5, max: -ON_TRACK_THRESHOLD + 0.5, noNaN: true, noDefaultInfinity: true }),
  fc.constant(ON_TRACK_THRESHOLD),
  fc.constant(-ON_TRACK_THRESHOLD),
);

const driftArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 2, arbitrary: wideDriftArb },
  { weight: 1, arbitrary: nearBoundaryArb },
);

describe('classifyDrift — Property 8 (drift classification follows the ±5 threshold)', () => {
  // Feature: consolidated-net-worth-view, Property 8: Drift classification follows the ±5 threshold
  it('returns "on track" within ±5 inclusive, "over" above +5, and "under" below -5', () => {
    fc.assert(
      fc.property(driftArb, (drift) => {
        const { direction } = classifyDrift(drift);

        if (Math.abs(drift) <= ON_TRACK_THRESHOLD) {
          expect(direction).toBe('on track');
        } else if (drift > ON_TRACK_THRESHOLD) {
          expect(direction).toBe('over');
        } else {
          // drift < -ON_TRACK_THRESHOLD
          expect(direction).toBe('under');
        }
      }),
      { numRuns: 100 },
    );
  });
});
