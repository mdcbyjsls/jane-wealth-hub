'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';

/**
 * React error boundary wrapping the dashboard (R6.2, R6.6).
 *
 * Error boundaries must be class components (React only supports the
 * `getDerivedStateFromError` / `componentDidCatch` lifecycle on classes), and
 * they run on the client, hence the `'use client'` directive.
 *
 * On a genuinely unexpected fault — a thrown exception in a calculation or a
 * child component — this catches it and renders the same plain-language
 * LoadError copy the dashboard already uses for recoverable load failures
 * (via `ErrorState` with the `'load'` variant). The user never sees a stack
 * trace or a blank/misleading screen (R6), only the vetted message with a
 * clear next action (R6.6). When no error has occurred, children render
 * normally.
 */
export interface DashboardErrorBoundaryProps {
  /** The dashboard subtree to protect. Rendered as-is when there is no error. */
  children: ReactNode;
}

interface DashboardErrorBoundaryState {
  /** True once a descendant has thrown; flips the UI to the fallback. */
  hasError: boolean;
}

export class DashboardErrorBoundary extends Component<
  DashboardErrorBoundaryProps,
  DashboardErrorBoundaryState
> {
  constructor(props: DashboardErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  /**
   * React calls this during rendering when a child throws, letting us swap to
   * the fallback UI without touching the caught error's details.
   */
  static getDerivedStateFromError(): DashboardErrorBoundaryState {
    return { hasError: true };
  }

  /**
   * Side-effect hook for the caught error. We log for debugging only — the
   * raw error is never surfaced to the user (R6.6).
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Dashboard error boundary caught an unexpected fault:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Same plain-language copy as a recoverable load failure (R6.2).
      return <ErrorState variant="load" />;
    }
    return this.props.children;
  }
}

export default DashboardErrorBoundary;
