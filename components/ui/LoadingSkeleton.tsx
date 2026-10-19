/*
 * LoadingSkeleton — the dashboard's Loading state (R6.1).
 *
 * Pure presentational component: no data fetching, no state, no props. It renders
 * grey, pulsing placeholder blocks in place of the net worth, account breakdown, and
 * allocation sections while the dashboard is in its Loading state (first paint / the
 * client island's localStorage target read). It deliberately shows NO real values —
 * only shapes — so nothing misleading is on screen before validated data is ready.
 *
 * Styling is Tailwind-only (animate-pulse + bg-gray-200 + rounded). Decorative blocks
 * are hidden from assistive tech; a single visually-hidden "Loading…" line announces
 * the state instead.
 */

/** A single grey, rounded placeholder bar. Decorative only (hidden from AT). */
function SkeletonBar({ className }: { className?: string }): React.ReactElement {
  return <div className={`rounded bg-gray-200 ${className ?? ''}`} aria-hidden="true" />;
}

export default function LoadingSkeleton(): React.ReactElement {
  return (
    <div className="animate-pulse space-y-8" aria-busy="true" role="status">
      {/* Screen-reader-only status; the rest of the tree is decorative. */}
      <span className="sr-only">Loading your accounts…</span>

      {/* Net worth section placeholder (R1). */}
      <section aria-hidden="true" className="space-y-3">
        <SkeletonBar className="h-4 w-32" />
        <SkeletonBar className="h-10 w-64" />
        <div className="flex gap-6">
          <SkeletonBar className="h-4 w-24" />
          <SkeletonBar className="h-4 w-24" />
        </div>
      </section>

      {/* Account breakdown section placeholder (R2). */}
      <section aria-hidden="true" className="space-y-3">
        <SkeletonBar className="h-4 w-40" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center justify-between gap-4">
            <SkeletonBar className="h-4 w-48" />
            <SkeletonBar className="h-4 w-24" />
          </div>
        ))}
      </section>

      {/* Allocation section placeholder (R3): pie circle + legend rows. */}
      <section aria-hidden="true" className="space-y-3">
        <SkeletonBar className="h-4 w-36" />
        <div className="flex items-center gap-6">
          <div className="h-40 w-40 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-2">
            {[0, 1, 2, 3].map((row) => (
              <SkeletonBar key={row} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
