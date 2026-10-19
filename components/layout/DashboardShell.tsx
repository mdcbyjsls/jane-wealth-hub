import type { ReactNode } from "react";

/**
 * Presentational layout container for the dashboard (R9.2).
 *
 * Provides the page shell: a responsive, centered max-width container, the
 * single top-level heading for the dashboard, and the `<main>` landmark that
 * establishes a defined document order for the sections rendered into it.
 *
 * It is deliberately generic — it owns the shell, heading, and landmark
 * structure, not the specific sections. The page (or client island) passes the
 * dashboard sections as `children`, and they render in order inside the main
 * landmark, preserving the document order defined by the caller.
 *
 * Pure and presentational: props in, markup out. No data fetching, no state.
 */
export interface DashboardShellProps {
  /**
   * The dashboard sections, rendered in order within the `<main>` landmark.
   * The caller controls document order by the order it passes children.
   */
  children: ReactNode;
  /** The dashboard's top-level heading text. */
  title?: string;
  /** Optional sub-heading / description shown beneath the title. */
  description?: string;
}

export function DashboardShell({
  children,
  title = "Your wealth at a glance",
  description,
}: DashboardShellProps) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <main
        id="main-content"
        className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
      >
        <header className="mb-8 flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-prose text-sm text-gray-600 sm:text-base">
              {description}
            </p>
          ) : null}
        </header>

        <div className="flex flex-col gap-8 sm:gap-10">{children}</div>
      </main>
    </div>
  );
}

export default DashboardShell;
