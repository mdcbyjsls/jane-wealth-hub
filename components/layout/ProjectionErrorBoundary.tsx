'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import ProjectionErrorState from '@/components/ui/ProjectionErrorState';
import { PROJECTION_MESSAGES } from '@/lib/projectionMessages';

/**
 * React error boundary wrapping the projection island (R10.2, R10.5).
 *
 * Mirrors Spec 1's `DashboardErrorBoundary`. Error boundaries must be class
 * components (React only supports the `getDerivedStateFromError` /
 * `componentDidCatch` lifecycle on classes), and they run on the client, hence
 * the `'use client'` directive.
 *
 * On a genuinely unexpected fault — a thrown exception in a projection
 * calculation or a child component — this catches it and renders the same
 * plain-language route-error copy the projection view already uses for a failed
 * market-data request (via `ProjectionErrorState` with
 * `PROJECTION_MESSAGES.routeError`). The user never sees a stack trace or a
 * blank/misleading screen, only the vetted plain-language message (R10.2,
 * R10.5). When no error has occurred, children render normally.
 */
export interface ProjectionErrorBoundaryProps {
  /** The projection subtree to protect. Rendered as-is when there is no error. */
  children: ReactNode;
}

interface ProjectionErrorBoundaryState {
  /** True once a descendant has thrown; flips the UI to the fallback. */
  hasError: boolean;
}

export class ProjectionErrorBoundary extends Component<
  ProjectionErrorBoundaryProps,
  ProjectionErrorBoundaryState
> {
  constructor(props: ProjectionErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  /**
   * React calls this during rendering when a child throws, letting us swap to
   * the fallback UI without touching the caught error's details.
   */
  static getDerivedStateFromError(): ProjectionErrorBoundaryState {
    return { hasError: true };
  }

  /**
   * Side-effect hook for the caught error. We log for debugging only — the
   * raw error is never surfaced to the user (R10.5).
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Projection error boundary caught an unexpected fault:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Same plain-language copy as a recoverable market-data failure (R10.2).
      return <ProjectionErrorState message={PROJECTION_MESSAGES.routeError} />;
    }
    return this.props.children;
  }
}

export default ProjectionErrorBoundary;
