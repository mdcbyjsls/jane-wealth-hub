import type { ReactNode } from "react";
import PrimaryNav from "./PrimaryNav";

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
      {/*
        Skip-to-content link (R9.2): the first focusable element on the page, so
        a keyboard user can jump past any future chrome straight to the main
        landmark. It is visually hidden until focused (sr-only + focus:not-sr-only),
        then shows a high-contrast focus-visible ring (R9.3). The matching
        tabIndex={-1} on <main> lets the target receive focus on activation.
        Final focus-indicator contrast (≥ 3:1) still requires a manual audit
        per Task 18/19.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-sky-700 focus:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2"
      >
        Skip to main content
      </a>
      <PrimaryNav />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl px-4 py-8 focus:outline-none sm:px-6 sm:py-10 lg:px-8"
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
