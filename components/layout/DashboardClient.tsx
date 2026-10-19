'use client';

/*
 * DashboardClient — the interactive client island for the allocation + target
 * portion of the dashboard (R4.1, R5.4, R5.5, R5.6, R6.1).
 *
 * Why this is a client component: everything it owns needs the browser. The
 * target allocation is persisted in `localStorage` (via the Target_Store), and
 * drift against that target recomputes whenever the user edits it. The target
 * is the only input that changes after the initial data load, so only this
 * slice of the page is a client island — net worth, institution groups, and
 * data freshness are target-INDEPENDENT and are computed once on the server and
 * rendered outside this island (see Task 17.3).
 *
 * What the server hands down (all serializable, see `DashboardClientProps`):
 *   - `allocation`: the computed `AllocationResult` (percentages + the dollar
 *     basis + total asset value). Target-independent, so it is computed once on
 *     the server.
 *   - `totals`: the `ClassTotals` dollar-per-class basis that `computeDrift`
 *     needs to express drift in dollars.
 * This island assumes it only renders in the Ready state with valid, non-empty
 * allocation data; the Loading / LoadError / ValidationError / Empty routing is
 * the server page's job (Task 17.3).
 *
 * Target lifecycle and SSR consistency (R5.6, R6.1):
 *   - `localStorage` is browser-only, so the first server render and the first
 *     client paint must NOT read it — doing so would diverge and hydrate
 *     mismatched. We therefore seed state from `DEFAULT_TARGET` (the example
 *     60/20/10/10) so SSR and first paint agree, then read the persisted target
 *     in a mount-only `useEffect`. If the user had saved a target, state updates
 *     to it after mount and the view recomputes.
 *   - `hasLoadedTarget` tracks whether that first read has happened. Before it
 *     resolves we are still in the island's brief first-paint window (R6.1).
 *
 * Target-dependent recompute (R4.1): `computeDrift(allocation, totals, target)`
 * then `computeOnTrackStatus(drift)` are recomputed with `useMemo` whenever the
 * target (or the server-provided allocation/totals) changes. Drift math runs
 * here on the client because it depends on the user-editable target.
 *
 * Save handler (R5.4, R5.5): `handleSave` persists the validated target via
 * `saveTarget` and updates local state, so the side-by-side actual-vs-target
 * view and the drift/status recompute immediately.
 */

import { useEffect, useMemo, useState } from 'react';
import type {
  AllocationResult,
  ClassTotals,
  DriftResult,
  OnTrackStatus,
  TargetAllocation,
} from '@/types/accounts';
import { computeDrift, computeOnTrackStatus } from '@/lib/calculations/allocation';
import { DEFAULT_TARGET, loadTarget, saveTarget } from '@/lib/target/targetStore';
import AllocationSection from '@/components/ui/AllocationSection';
import TargetEditor from '@/components/ui/TargetEditor';

export interface DashboardClientProps {
  /**
   * Target-independent actual allocation, computed once on the server (R6.1).
   * Carries the percentages, the per-class dollar basis, and the total asset
   * value the drift math needs.
   */
  allocation: AllocationResult;
  /**
   * Per-class dollar totals, the basis `computeDrift` uses to express drift in
   * dollars. Target-independent, so computed on the server and passed down.
   */
  totals: ClassTotals;
  /** Extra Tailwind classes merged onto the island container. */
  className?: string;
}

export default function DashboardClient({
  allocation,
  totals,
  className,
}: DashboardClientProps): React.ReactElement {
  // Seed from the example default so SSR and the first client paint agree; the
  // persisted value is read after mount (R5.6, R6.1).
  const [target, setTarget] = useState<TargetAllocation>(DEFAULT_TARGET);
  const [hasLoadedTarget, setHasLoadedTarget] = useState<boolean>(false);

  // Mount-only: read the persisted target from the browser-only Target_Store.
  // Runs once after hydration so it never affects the server render (R5.6, R6.1).
  useEffect(() => {
    setTarget(loadTarget());
    setHasLoadedTarget(true);
  }, []);

  // Target-dependent math (R4.1): recompute drift and on-track status whenever
  // the target — or the server-provided allocation/totals — changes.
  const drift: DriftResult = useMemo(
    () => computeDrift(allocation, totals, target),
    [allocation, totals, target],
  );
  const onTrackStatus: OnTrackStatus = useMemo(
    () => computeOnTrackStatus(drift),
    [drift],
  );

  // Persist the validated target and update state so the side-by-side view and
  // the drift/status recompute immediately (R5.4, R5.5).
  function handleSave(next: TargetAllocation): void {
    saveTarget(next);
    setTarget(next);
  }

  return (
    <div
      className={`flex flex-col gap-8 ${className ?? ''}`}
      // Signal the brief first-paint window before the persisted target resolves
      // (R6.1). Content still renders from the example default, so nothing is
      // hidden; this is only an advisory busy cue for assistive tech.
      aria-busy={hasLoadedTarget ? undefined : true}
    >
      <AllocationSection
        allocation={allocation}
        drift={drift}
        onTrackStatus={onTrackStatus}
        target={target}
      />
      <TargetEditor currentTarget={target} actual={allocation} onSave={handleSave} />
    </div>
  );
}
